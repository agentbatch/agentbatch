//! Batch settlement and atomicity.

use soroban_sdk::testutils::{Address as _, IssuerFlags, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, BytesN, IntoVal};

use super::*;
use crate::{Error, MAX_BATCH_SIZE};

type Snapshot = (crate::TreasuryView, std::vec::Vec<crate::ChannelView>, std::vec::Vec<i128>);

fn snapshot(s: &Setup, ch: &ThreeChannels) -> Snapshot {
    (
        s.client.get_treasury(),
        ch.ids.iter().map(|id| s.client.get_channel(id)).collect(),
        ch.providers.iter().map(|p| s.balance(p)).collect(),
    )
}

fn final_vouchers(s: &Setup, ch: &ThreeChannels) -> [Voucher; 3] {
    [
        s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(12)),
        s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], units(8)),
        s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(5)),
    ]
}

#[test]
fn three_providers_settled_in_one_invocation() {
    let (s, ch) = funded();
    let total = s.client.redeem_batch(&s.batch(&final_vouchers(&s, &ch)));
    assert_eq!(total, units(25));
    assert_eq!(s.balance(&ch.providers[0]), units(12));
    assert_eq!(s.balance(&ch.providers[1]), units(8));
    assert_eq!(s.balance(&ch.providers[2]), units(5));
    let t = s.client.get_treasury();
    assert_eq!(t.total_paid, units(25));
    assert_eq!(t.token_balance, units(75));
    assert_eq!(t.available, units(10));
    assert_eq!(t.total_reserved, units(65));
    s.assert_invariants();
}

#[test]
fn duplicate_channel_rejected() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    let a = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    let b = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(5));
    let other = s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], units(1));
    assert_contract_err!(
        s.client.try_redeem_batch(&s.batch(&[a.clone(), a.clone()])),
        Error::DuplicateChannel
    );
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[a, other, b])), Error::DuplicateChannel);
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn invalid_last_signature_reverts_whole_batch() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    let [a, b, mut c] = final_vouchers(&s, &ch);
    let mut sig = c.signature.to_array();
    sig[0] ^= 0xFF;
    c.signature = BytesN::from_array(&s.env, &sig);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[a, b, c])));
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn stale_last_voucher_reverts_whole_batch() {
    let (s, ch) = funded();
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(5))]));
    let before = snapshot(&s, &ch);
    let [a, b, c] = final_vouchers(&s, &ch);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[a, b, c])), Error::StaleVoucher);
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn over_allocation_last_voucher_reverts_whole_batch() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    let [a, b, _] = final_vouchers(&s, &ch);
    let c = s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(16));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[a, b, c])), Error::ExceedsAllocation);
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn failed_asset_transfer_reverts_whole_batch() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);

    // The issuer freezes provider C's balance (setup step, issuer-authorized).
    s.asset_issuer.set_flag(IssuerFlags::RevocableFlag);
    let invoke = MockAuthInvoke {
        contract: &s.token,
        fn_name: "set_authorized",
        args: (ch.providers[2].clone(), false).into_val(&s.env),
        sub_invokes: &[],
    };
    s.sac
        .mock_auths(&[MockAuth {
            address: &s.issuer,
            invoke: &invoke,
        }])
        .set_authorized(&ch.providers[2], &false);

    // Vouchers A and B are valid; C's transfer fails inside the token contract.
    let res = s.client.try_redeem_batch(&s.batch(&final_vouchers(&s, &ch)));
    assert_token_err!(res, 11); // BalanceDeauthorizedError
    assert_eq!(snapshot(&s, &ch), before);
    assert_eq!(s.balance(&ch.providers[0]), 0);
    assert_eq!(s.balance(&ch.providers[1]), 0);
}

#[test]
fn batch_size_limits() {
    let (s, ch) = funded();
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[])), Error::EmptyBatch);

    // A fourth channel makes a maximum-size batch possible.
    let p4 = Address::generate(&s.env);
    let a4 = Agent::numbered(14);
    let id4 = s.open(&p4, &a4, units(10));
    let [a, b, c] = final_vouchers(&s, &ch);
    let d = s.voucher(id4, &p4, &a4, units(1));
    let too_many = [a.clone(), b.clone(), c.clone(), d.clone(), s.voucher(5, &p4, &a4, units(1))];
    assert_eq!(too_many.len() as u32, MAX_BATCH_SIZE + 1);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&too_many)), Error::BatchTooLarge);

    assert_eq!(s.client.redeem_batch(&s.batch(&[a, b, c, d])), units(26));
    s.assert_invariants();
}

#[test]
fn partial_increments_across_batches() {
    let (s, ch) = funded();
    s.client.redeem_batch(&s.batch(&[
        s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(4)),
        s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], units(2)),
    ]));
    let total = s.client.redeem_batch(&s.batch(&final_vouchers(&s, &ch)));
    // 12-4 + 8-2 + 5-0
    assert_eq!(total, units(19));
    assert_eq!(s.client.get_treasury().total_paid, units(25));
    s.assert_invariants();
}
