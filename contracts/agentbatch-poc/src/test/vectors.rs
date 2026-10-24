//! Cross-language voucher test vectors shared with `packages/voucher`.
//!
//! The vectors are produced by the contract's own encoder (`voucher_message`)
//! and `ed25519-dalek`. The TypeScript test suite rebuilds every message and
//! signature independently and must match byte for byte.
//!
//! Regenerate with `AGENTBATCH_UPDATE_VECTORS=1 cargo test vectors`.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use soroban_sdk::Address;

use super::*;
use std::string::ToString;

pub const VECTORS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test-vectors/vouchers.json");

const PASSPHRASE: &str = "Test SDF Network ; September 2015";
const CONTRACT: &str = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const OWNER: &str = "GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC";
const PROVIDERS: [&str; 3] = [
    "GBEAOWSZPZZBUFLOFYDZTXS4YDCTETOG47VPDTOUMJIINDWFGIK53RM6",
    "GBPCCLAJQDSLHH6AS4QRGSVAEEETOTW72JQMBU6QHS2QDSGWKRL2TXDY",
    "GAL4W6P3FNASB4VR5RS6IGMNNYELFDUBH7VQDZFEACBZXBPBQCAM5QIF",
];
const AGENT_SEEDS: [u8; 3] = [0x41, 0x42, 0x43];

/// (channel index, amount in base units, note)
const CASES: [(usize, i128, &str); 7] = [
    (0, 30_000_000, "channel 1 cumulative 3 AUSD"),
    (0, 70_000_000, "channel 1 cumulative 7 AUSD"),
    (0, 120_000_000, "channel 1 cumulative 12 AUSD"),
    (1, 80_000_000, "channel 2 cumulative 8 AUSD"),
    (2, 50_000_000, "channel 3 cumulative 5 AUSD"),
    (2, 1, "channel 3 smallest unit"),
    (0, (1i128 << 64) + 5, "encoding only: amount uses the i128 high word"),
];

fn generate() -> Value {
    let env = Env::default();
    let network: [u8; 32] = Sha256::digest(PASSPHRASE.as_bytes()).into();
    env.ledger().set_network_id(network);

    let owner = Address::from_str(&env, OWNER);
    let contract = Address::from_str(&env, CONTRACT);
    let issuer = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = asset.address();
    env.register_at(&contract, crate::AgentBatchPoC, (owner.clone(), token.clone()));

    let s = Setup {
        client: AgentBatchPoCClient::new(&env, &contract),
        token_client: TokenClient::new(&env, &token),
        sac: StellarAssetClient::new(&env, &token),
        asset_issuer: asset.issuer(),
        env: env.clone(),
        owner,
        issuer,
        token,
        contract,
    };
    // Encoding fixture only: the G-account owner has no trustline in the test
    // ledger, so the treasury balance is seeded directly instead of deposited.
    env.as_contract(&s.contract, || {
        let mut t = crate::storage::read_treasury(&env);
        t.total_deposited = units(100);
        t.available = units(100);
        crate::storage::write_treasury(&env, &t);
    });
    let agents = AGENT_SEEDS.map(|b| Agent::from_seed([b; 32]));
    let providers = PROVIDERS.map(|p| Address::from_str(&env, p));
    let allocations = [units(40), units(35), units(15)];
    // Encoding fixture only: channel setup by the G-account owner uses
    // `mock_all_auths` (the SDK's `mock_auths` does not accept account
    // addresses). Owner authorization is covered by `auth.rs`; voucher
    // signatures below are real and verified by the host.
    env.mock_all_auths();
    let ids: std::vec::Vec<u64> = (0..3)
        .map(|i| s.client.open_channel(&providers[i], &agents[i].public(&env), &allocations[i]))
        .collect();

    let cases: std::vec::Vec<Value> = CASES
        .iter()
        .map(|&(i, amount, note)| {
            let msg = s.client.voucher_message(&ids[i], &amount);
            let sig = agents[i].sign_bytes(&env, &msg);
            // Verified by the Soroban host's Ed25519 implementation.
            env.crypto().ed25519_verify(&agents[i].public(&env), &msg, &sig);
            let msg: std::vec::Vec<u8> = msg.iter().collect();
            json!({
                "note": note,
                "channel_id": ids[i],
                "provider": PROVIDERS[i],
                "signer_seed": hex::encode([AGENT_SEEDS[i]; 32]),
                "signer_public_key": hex::encode(agents[i].public(&env).to_array()),
                "amount": amount.to_string(),
                "message_xdr": hex::encode(&msg),
                "signature": hex::encode(sig.to_array()),
            })
        })
        .collect();

    json!({
        "description": "AgentBatch PoC voucher vectors. message_xdr = XDR(ScVal::Map) of VoucherPayload; signature = Ed25519(signer_seed, message_xdr).",
        "domain": crate::DOMAIN,
        "network_passphrase": PASSPHRASE,
        "network_id": hex::encode(network),
        "contract": CONTRACT,
        "owner": OWNER,
        "cases": cases,
    })
}

#[test]
fn voucher_vectors_match_committed_file() {
    let generated = generate();
    if std::env::var("AGENTBATCH_UPDATE_VECTORS").as_deref() == Ok("1") {
        let text = serde_json::to_string_pretty(&generated).unwrap() + "\n";
        std::fs::write(VECTORS_PATH, text).unwrap();
        return;
    }
    let committed: Value = serde_json::from_str(
        &std::fs::read_to_string(VECTORS_PATH).expect("test-vectors/vouchers.json missing; run with AGENTBATCH_UPDATE_VECTORS=1"),
    )
    .unwrap();
    assert_eq!(generated, committed, "contract encoding diverged from committed vectors");
}
