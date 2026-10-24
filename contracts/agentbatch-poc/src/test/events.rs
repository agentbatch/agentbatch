//! Emitted events: exact topics and data, and none from a failed batch.

use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{Address, Event};

use super::*;
use crate::events::{BatchRedeemed, ChannelOpened, Deposited, VoucherRedeemed, Withdrawn};

fn contract_events(s: &Setup) -> std::vec::Vec<soroban_sdk::xdr::ContractEvent> {
    s.env.events().all().filter_by_contract(&s.contract).events().to_vec()
}

#[test]
fn deposit_open_and_withdraw_events() {
    let s = Setup::new(units(100));
    s.deposit(units(100));
    let expected = Deposited {
        owner: s.owner.clone(),
        amount: units(100),
        available: units(100),
    };
    assert_eq!(contract_events(&s), [expected.to_xdr(&s.env, &s.contract)]);

    let provider = Address::generate(&s.env);
    let agent = Agent::numbered(11);
    let id = s.open(&provider, &agent, units(40));
    let expected = ChannelOpened {
        channel_id: id,
        provider,
        signer: agent.public(&s.env),
        allocation: units(40),
    };
    assert_eq!(contract_events(&s), [expected.to_xdr(&s.env, &s.contract)]);

    s.withdraw(units(10));
    let expected = Withdrawn {
        owner: s.owner.clone(),
        amount: units(10),
        available: units(50),
    };
    assert_eq!(contract_events(&s), [expected.to_xdr(&s.env, &s.contract)]);
}

#[test]
fn batch_events_report_each_increment_and_total() {
    let (s, ch) = funded();
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(4))]));
    s.client.redeem_batch(&s.batch(&[
        s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(12)),
        s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], units(8)),
    ]));
    let expected = [
        VoucherRedeemed {
            channel_id: ch.ids[0],
            provider: ch.providers[0].clone(),
            cumulative: units(12),
            payout: units(8),
        }
        .to_xdr(&s.env, &s.contract),
        VoucherRedeemed {
            channel_id: ch.ids[1],
            provider: ch.providers[1].clone(),
            cumulative: units(8),
            payout: units(8),
        }
        .to_xdr(&s.env, &s.contract),
        BatchRedeemed {
            vouchers: 2,
            total_payout: units(16),
        }
        .to_xdr(&s.env, &s.contract),
    ];
    assert_eq!(contract_events(&s), expected);
}

#[test]
fn failed_batch_emits_no_contract_events() {
    let (s, ch) = funded();
    let stale = s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], 0);
    let batch = s.batch(&[s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(12)), stale]);
    assert_contract_err!(s.client.try_redeem_batch(&batch), crate::Error::StaleVoucher);
    assert!(contract_events(&s).is_empty());
}
