//! Storage layout, TTL maintenance and archival behavior.

use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::Ledger as _;

use super::*;
use crate::storage::DAY_IN_LEDGERS;
use crate::{DataKey, Error, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::Address;

fn channel_ttl(s: &Setup, id: u64) -> u32 {
    s.env
        .as_contract(&s.contract, || s.env.storage().persistent().get_ttl(&DataKey::Channel(id)))
}

fn instance_ttl(s: &Setup) -> u32 {
    s.env.as_contract(&s.contract, || s.env.storage().instance().get_ttl())
}

fn advance(s: &Setup, ledgers: u32) {
    let seq = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(seq + ledgers);
}

#[test]
fn channels_use_separate_persistent_entries() {
    let (s, ch) = funded();
    s.env.as_contract(&s.contract, || {
        for id in ch.ids {
            assert!(s.env.storage().persistent().has(&DataKey::Channel(id)));
            assert!(!s.env.storage().instance().has(&DataKey::Channel(id)));
            assert!(!s.env.storage().temporary().has(&DataKey::Channel(id)));
        }
        assert!(s.env.storage().instance().has(&DataKey::Config));
        assert!(s.env.storage().instance().has(&DataKey::Treasury));
    });
}

#[test]
fn ttl_extended_on_open_and_on_state_changes() {
    let (s, ch) = funded();
    for id in ch.ids {
        assert_eq!(channel_ttl(&s, id), TTL_EXTEND_TO);
    }
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);

    // Above the threshold: no extension, TTL simply counts down.
    advance(&s, 20 * DAY_IN_LEDGERS);
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(1))]));
    assert_eq!(channel_ttl(&s, ch.ids[0]), TTL_EXTEND_TO - 20 * DAY_IN_LEDGERS);

    // Below the threshold: redemption extends the touched channel and the instance.
    advance(&s, 5 * DAY_IN_LEDGERS);
    assert!(channel_ttl(&s, ch.ids[0]) < TTL_THRESHOLD);
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(2))]));
    assert_eq!(channel_ttl(&s, ch.ids[0]), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);
    // Untouched channels keep counting down.
    assert_eq!(channel_ttl(&s, ch.ids[1]), TTL_EXTEND_TO - 25 * DAY_IN_LEDGERS);
}

#[test]
fn views_do_not_extend_ttl() {
    let (s, ch) = funded();
    advance(&s, DAY_IN_LEDGERS);
    s.client.get_channel(&ch.ids[0]);
    s.client.get_treasury();
    s.client.voucher_message(&ch.ids[0], &units(1));
    assert_eq!(channel_ttl(&s, ch.ids[0]), TTL_EXTEND_TO - DAY_IN_LEDGERS);
}

#[test]
fn archived_channel_restores_with_full_state() {
    let (s, ch) = funded();
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(12));
    s.client.redeem_batch(&s.batch(&[v.clone()]));

    // Past every TTL: channel and instance entries are archived. Persistent
    // entries are archived (never deleted) and restored on access, so the
    // redeemed counter, and with it replay protection, survives archival.
    advance(&s, TTL_EXTEND_TO + 1);
    let c = s.client.get_channel(&ch.ids[0]);
    assert_eq!(c.redeemed, units(12));
    assert_eq!(c.allocation, units(40));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::StaleVoucher);
    assert_eq!(s.balance(&ch.providers[0]), units(12));
    s.assert_invariants();
}

#[test]
fn missing_channel_is_an_error_not_an_empty_channel() {
    let (s, ch) = funded();
    assert_contract_err!(s.client.try_get_channel(&0), Error::ChannelNotFound);
    assert_contract_err!(s.client.try_get_channel(&4), Error::ChannelNotFound);
    assert_contract_err!(s.client.try_voucher_message(&4, &1), Error::ChannelNotFound);
    let v = s.voucher(4, &ch.providers[0], &ch.agents[0], units(1));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::ChannelNotFound);
}

#[test]
fn new_channel_gets_full_ttl_even_above_network_minimum() {
    let s = Setup::new(units(100));
    s.deposit(units(100));
    // A network whose minimum persistent TTL already exceeds the threshold:
    // a threshold-based extension alone would leave the channel at 10 days.
    s.env.ledger().with_mut(|l| l.min_persistent_entry_ttl = 10 * DAY_IN_LEDGERS);
    let id = s.open(
        &<Address as soroban_sdk::testutils::Address>::generate(&s.env),
        &Agent::numbered(9),
        units(1),
    );
    assert_eq!(channel_ttl(&s, id), TTL_EXTEND_TO);
}
