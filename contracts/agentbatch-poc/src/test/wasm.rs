//! Tests against the compiled WASM (the artifact deployed to Testnet).
//!
//! Build it first: `make build-contracts` (or `stellar contract build`).

use super::*;

pub const WASM_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/wasm32v1-none/release/agentbatch_poc.wasm"
);

pub fn wasm() -> std::vec::Vec<u8> {
    std::fs::read(WASM_PATH).unwrap_or_else(|_| panic!("{WASM_PATH} not found: build the contract with `make build-contracts`"))
}

pub fn wasm_setup(env: Env, owner_balance: i128) -> Setup {
    let code = wasm();
    Setup::with_env(env, owner_balance, |env, owner, token, contract| {
        env.register_at(contract, code.as_slice(), (owner.clone(), token.clone()));
    })
}

/// Guards against testing a stale artifact: `cargo test` does not rebuild
/// the WASM, and constructor authorization is only exercised through it.
#[test]
fn wasm_artifact_is_newer_than_contract_sources() {
    let built = std::fs::metadata(WASM_PATH)
        .and_then(|m| m.modified())
        .expect("build the contract with `make build-contracts`");
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for entry in std::fs::read_dir(&src).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            assert!(
                modified <= built,
                "{} is newer than the WASM: run `make build-contracts`",
                path.display()
            );
        }
    }
}

#[test]
fn scf_demo_scenario_wasm() {
    super::scenario::run(&wasm_setup(Env::default(), units(100)));
}

#[test]
fn wasm_batch_failure_is_atomic() {
    let s = wasm_setup(Env::default(), units(100));
    s.deposit(units(100));
    let ch = three_channels(&s);
    let mut bad = s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(5));
    bad.signature = BytesN::from_array(&s.env, &[7u8; 64]);
    let batch = s.batch(&[
        s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(12)),
        s.voucher(ch.ids[1], &ch.providers[1], &ch.agents[1], units(8)),
        bad,
    ]);
    assert_fails!(s.client.try_redeem_batch(&batch));
    assert_eq!(s.client.get_treasury().total_paid, 0);
    assert_eq!(s.balance(&ch.providers[0]), 0);
    assert_eq!(s.balance(&ch.providers[1]), 0);
    s.assert_invariants();
}

/// State-changing calls extend the contract's own instance but never the
/// shared WASM code entry, whose rent would otherwise be paid by every call.
#[test]
fn calls_extend_instance_but_not_shared_code() {
    use soroban_sdk::testutils::{Deployer as _, Ledger as _};
    let s = wasm_setup(Env::default(), units(100));
    let code_ttl = s.env.deployer().get_contract_code_ttl(&s.contract);
    assert_eq!(s.env.deployer().get_contract_instance_ttl(&s.contract), crate::TTL_EXTEND_TO);
    assert!(code_ttl < crate::TTL_THRESHOLD, "test needs a code TTL below the threshold");

    let seq = s.env.ledger().sequence();
    s.env.ledger().set_sequence_number(seq + 25 * crate::storage::DAY_IN_LEDGERS);
    s.deposit(units(100));
    assert_eq!(s.env.deployer().get_contract_instance_ttl(&s.contract), crate::TTL_EXTEND_TO);
    assert!(s.env.deployer().get_contract_code_ttl(&s.contract) <= code_ttl);
}
