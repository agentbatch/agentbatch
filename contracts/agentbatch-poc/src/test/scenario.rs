//! The SCF demonstration scenario, end to end, with exact 7-decimal amounts.

use super::*;
use crate::Error;

/// Runs the scenario against an already-registered contract (native or WASM).
pub fn run(s: &Setup) {
    s.deposit(units(100));
    let ch = three_channels(s);
    let t = s.client.get_treasury();
    assert_eq!((t.available, t.total_reserved), (units(10), units(90)));

    // Off-chain: each agent signs a growing cumulative voucher per request.
    // Nothing is submitted on-chain for these requests.
    let requests: [&[i128]; 3] = [
        &[units(2), units(5), units(9), units(12)],
        &[units(1), units(4), units(8)],
        &[units(2), units(5)],
    ];
    let mut latest: std::vec::Vec<Voucher> = std::vec::Vec::new();
    for (i, amounts) in requests.iter().enumerate() {
        let mut last = None;
        for &amount in amounts.iter() {
            last = Some(s.voucher(ch.ids[i], &ch.providers[i], &ch.agents[i], amount));
        }
        latest.push(last.unwrap());
    }
    assert_eq!(s.client.get_treasury().total_paid, 0);

    // One batch settles all three providers.
    assert_eq!(s.client.redeem_batch(&s.batch(&latest)), units(25));
    assert_eq!(s.balance(&ch.providers[0]), units(12));
    assert_eq!(s.balance(&ch.providers[1]), units(8));
    assert_eq!(s.balance(&ch.providers[2]), units(5));
    let t = s.client.get_treasury();
    assert_eq!(t.total_paid, units(25));
    assert_eq!(t.token_balance, units(75));
    assert_eq!(t.available, units(10));
    assert_eq!(t.total_reserved, units(65));
    s.assert_invariants();

    // Incremental redemption: cumulative 17 pays exactly 5 more.
    let v17 = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(17));
    assert_eq!(s.client.redeem_batch(&s.batch(&[v17.clone()])), units(5));
    assert_eq!(s.balance(&ch.providers[0]), units(17));
    let t = s.client.get_treasury();
    assert_eq!(t.total_paid, units(30));
    assert_eq!(t.token_balance, units(70));
    assert_eq!(t.total_reserved, units(60));
    assert_eq!(t.available, units(10));

    // Replay produces no payout.
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v17])), Error::StaleVoucher);
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&latest)), Error::StaleVoucher);
    assert_eq!(s.balance(&ch.providers[0]), units(17));
    assert_eq!(s.client.get_treasury().total_paid, units(30));
    s.assert_invariants();
}

#[test]
fn scf_demo_scenario_native() {
    run(&Setup::new(units(100)));
}
