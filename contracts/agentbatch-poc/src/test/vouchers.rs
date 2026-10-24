//! Voucher security with real Ed25519 signatures.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Symbol};

use super::*;
use crate::{Error, Voucher};

/// Snapshot of all state a failed redemption must leave untouched.
fn snapshot(s: &Setup, ch: &ThreeChannels) -> (crate::TreasuryView, std::vec::Vec<crate::ChannelView>, [i128; 3]) {
    (
        s.client.get_treasury(),
        ch.ids.iter().map(|id| s.client.get_channel(id)).collect(),
        [
            s.balance(&ch.providers[0]),
            s.balance(&ch.providers[1]),
            s.balance(&ch.providers[2]),
        ],
    )
}

fn signed(s: &Setup, agent: &Agent, payload: &crate::VoucherPayload, channel_id: u64) -> Voucher {
    Voucher {
        channel_id,
        amount: payload.amount,
        signature: agent.sign_payload(&s.env, payload),
    }
}

#[test]
fn valid_voucher_pays_provider() {
    let (s, ch) = funded();
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    assert_eq!(s.client.redeem_batch(&s.batch(&[v])), units(3));
    assert_eq!(s.balance(&ch.providers[0]), units(3));
    assert_eq!(s.client.get_channel(&ch.ids[0]).redeemed, units(3));
    s.assert_invariants();
}

#[test]
fn contract_message_matches_test_payload_encoding() {
    let (s, ch) = funded();
    let expected = s.payload(ch.ids[1], &ch.providers[1], &ch.agents[1], units(8)).to_xdr(&s.env);
    assert_eq!(s.client.voucher_message(&ch.ids[1], &units(8)), expected);
}

#[test]
fn invalid_signature_rejected() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    let mut v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    let mut sig = v.signature.to_array();
    sig[10] ^= 0x01;
    v.signature = BytesN::from_array(&s.env, &sig);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn incorrect_signer_rejected() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    // Payload names the registered signer, but a different key signs it.
    let payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    let v = signed(&s, &Agent::numbered(77), &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
    // Another channel's agent cannot sign for this channel either.
    let v = signed(&s, &ch.agents[1], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
    assert_eq!(snapshot(&s, &ch), before);
}

#[test]
fn signer_field_substitution_rejected() {
    let (s, ch) = funded();
    let attacker = Agent::numbered(77);
    let mut payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    payload.signer = attacker.public(&s.env);
    let v = signed(&s, &attacker, &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn wrong_provider_rejected() {
    let (s, ch) = funded();
    let before = snapshot(&s, &ch);
    let attacker = Address::generate(&s.env);
    let payload = s.payload(ch.ids[0], &attacker, &ch.agents[0], units(3));
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
    // A voucher for provider B cannot be redeemed on provider A's channel.
    let payload = s.payload(ch.ids[0], &ch.providers[1], &ch.agents[0], units(3));
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
    assert_eq!(snapshot(&s, &ch), before);
    assert_eq!(s.balance(&attacker), 0);
}

#[test]
fn cross_channel_replay_rejected() {
    let (s, ch) = funded();
    // Same agent key on two channels to the same provider: only the channel
    // ID in the payload separates them.
    let provider = ch.providers[0].clone();
    let shared = Agent::numbered(21);
    let a = s.open(&provider, &shared, units(2));
    let b = s.open(&provider, &shared, units(2));
    let payload = s.payload(a, &provider, &shared, units(1));
    let v_a = signed(&s, &shared, &payload, a);
    let replay = Voucher {
        channel_id: b,
        ..v_a.clone()
    };
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[replay])));
    assert_eq!(s.client.get_channel(&b).redeemed, 0);
    // The original remains valid on its own channel.
    s.client.redeem_batch(&s.batch(&[v_a]));
    assert_eq!(s.client.get_channel(&a).redeemed, units(1));
    s.assert_invariants();
}

#[test]
fn wrong_contract_rejected() {
    let (s, ch) = funded();
    let mut payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    payload.contract = Address::generate(&s.env);
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn voucher_for_other_deployment_rejected() {
    // Two deployments with identical owner, providers, agents and channel IDs.
    let (a, ch) = funded();
    let other = Address::generate(&a.env);
    a.env.register_at(&other, crate::AgentBatchPoC, (a.owner.clone(), a.token.clone()));
    let b = Setup {
        env: a.env.clone(),
        owner: a.owner.clone(),
        issuer: a.issuer.clone(),
        token: a.token.clone(),
        contract: other.clone(),
        client: crate::AgentBatchPoCClient::new(&a.env, &other),
        token_client: TokenClient::new(&a.env, &a.token),
        sac: StellarAssetClient::new(&a.env, &a.token),
        asset_issuer: a.asset_issuer.clone(),
    };
    b.mint(&b.owner, units(100));
    b.deposit(units(100));
    for i in 0..3 {
        assert_eq!(b.open(&ch.providers[i], &ch.agents[i], units(10)), ch.ids[i]);
    }
    let v = a.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    assert_fails!(b.client.try_redeem_batch(&b.batch(&[v.clone()])));
    assert_eq!(a.client.redeem_batch(&a.batch(&[v])), units(3));
}

#[test]
fn wrong_network_rejected() {
    let (s, ch) = funded();
    let mut payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    payload.network = BytesN::from_array(&s.env, &[0xAB; 32]);
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn voucher_signed_for_testnet_rejected_on_other_network() {
    let (s, ch) = funded();
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    // Same contract, same state; the ledger now reports a different network.
    s.env.ledger().set_network_id([0x42; 32]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn wrong_domain_rejected() {
    let (s, ch) = funded();
    let mut payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    payload.domain = Symbol::new(&s.env, "AGENTBATCH_POC_V2");
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn wrong_owner_rejected() {
    let (s, ch) = funded();
    let mut payload = s.payload(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    payload.owner = Address::generate(&s.env);
    let v = signed(&s, &ch.agents[0], &payload, ch.ids[0]);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn amount_substitution_rejected() {
    let (s, ch) = funded();
    let mut v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(3));
    v.amount = units(30);
    assert_fails!(s.client.try_redeem_batch(&s.batch(&[v])));
}

#[test]
fn cumulative_vouchers_pay_only_increment() {
    let (s, ch) = funded();
    let (id, p, a) = (ch.ids[0], &ch.providers[0], &ch.agents[0]);
    let v3 = s.voucher(id, p, a, units(3));
    let v7 = s.voucher(id, p, a, units(7));
    let v12 = s.voucher(id, p, a, units(12));

    assert_eq!(s.client.redeem_batch(&s.batch(&[v7.clone()])), units(7));
    assert_eq!(s.client.redeem_batch(&s.batch(&[v12.clone()])), units(5));
    assert_eq!(s.balance(p), units(12));

    // Replays of the same or older vouchers never pay.
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v12])), Error::StaleVoucher);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v7])), Error::StaleVoucher);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v3])), Error::StaleVoucher);
    assert_eq!(s.balance(p), units(12));
    s.assert_invariants();
}

#[test]
fn amount_above_allocation_rejected() {
    let (s, ch) = funded();
    // Validly signed by the agent, but above the 40-unit ceiling.
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(40) + 1);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::ExceedsAllocation);
    // Exactly the allocation is payable.
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(40));
    assert_eq!(s.client.redeem_batch(&s.batch(&[v])), units(40));
    assert_eq!(s.client.get_channel(&ch.ids[0]).remaining, 0);
    s.assert_invariants();
}

#[test]
fn zero_and_negative_amounts_rejected() {
    let (s, ch) = funded();
    for amount in [0, -1, i128::MIN] {
        let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], amount);
        assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::StaleVoucher);
    }
    s.assert_invariants();
}

#[test]
fn unknown_channel_rejected() {
    let (s, ch) = funded();
    let v = s.voucher(99, &ch.providers[0], &ch.agents[0], units(1));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::ChannelNotFound);
    let v = s.voucher(0, &ch.providers[0], &ch.agents[0], units(1));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::ChannelNotFound);
}
