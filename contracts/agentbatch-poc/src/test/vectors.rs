//! Cross-language voucher test vectors shared with `packages/voucher`.
//!
//! The vectors are produced by the contract's own encoder (`voucher_message`)
//! and `ed25519-dalek`. The TypeScript test suite rebuilds every message and
//! signature independently and must match byte for byte.
//!
//! `invalid_signatures` are Ed25519 edge cases that the Soroban host rejects
//! (it uses `verify_strict`). Some of them pass a cofactored verifier; the
//! TypeScript verifier must reject all of them.
//!
//! Regenerate with `AGENTBATCH_UPDATE_VECTORS=1 cargo test voucher_vectors`.

use curve25519_dalek::constants::{ED25519_BASEPOINT_POINT, EIGHT_TORSION};
use curve25519_dalek::edwards::EdwardsPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::IsIdentity;
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha512};
use soroban_sdk::{Address, Symbol};

use super::*;
use std::string::ToString;

pub const VECTORS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test-vectors/vouchers.json");

const PASSPHRASE: &str = "Test SDF Network ; September 2015";
const CONTRACT: &str = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const OWNER: &str = "GCEEXCCX6TVKCYJ4MFIE3M2NJPVPGRSRPIHDDXR43XKNTNBADWOQWDYC";
/// Three account providers and one contract-address provider.
const PROVIDERS: [&str; 4] = [
    "GBEAOWSZPZZBUFLOFYDZTXS4YDCTETOG47VPDTOUMJIINDWFGIK53RM6",
    "GBPCCLAJQDSLHH6AS4QRGSVAEEETOTW72JQMBU6QHS2QDSGWKRL2TXDY",
    "GAL4W6P3FNASB4VR5RS6IGMNNYELFDUBH7VQDZFEACBZXBPBQCAM5QIF",
    "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ",
];
const AGENT_SEEDS: [u8; 4] = [0x41, 0x42, 0x43, 0x44];

/// L = 2^252 + 27742317777372353535851937790883648493, little-endian.
const GROUP_ORDER: [u8; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0x10,
];

/// (channel index, amount in base units, note)
const CASES: [(usize, i128, &str); 10] = [
    (0, 30_000_000, "channel 1 cumulative 3 AUSD"),
    (0, 70_000_000, "channel 1 cumulative 7 AUSD"),
    (0, 120_000_000, "channel 1 cumulative 12 AUSD"),
    (1, 80_000_000, "channel 2 cumulative 8 AUSD"),
    (2, 50_000_000, "channel 3 cumulative 5 AUSD"),
    (2, 1, "channel 3 smallest unit"),
    (3, 20_000_000, "channel 4 (contract-address provider) cumulative 2 AUSD"),
    (0, (1i128 << 64) + 5, "encoding only: amount uses the i128 high word"),
    (0, -1, "encoding only: negative amount (rejected by the contract as stale)"),
    (0, i128::MIN, "encoding only: i128::MIN"),
];

fn secret_scalar(seed: [u8; 32]) -> Scalar {
    let h = Sha512::digest(seed);
    let mut a = [0u8; 32];
    a.copy_from_slice(&h[..32]);
    a[0] &= 248;
    a[31] &= 127;
    a[31] |= 64;
    Scalar::from_bytes_mod_order(a)
}

fn challenge(r: &[u8; 32], a: &[u8; 32], msg: &[u8]) -> Scalar {
    let digest: [u8; 64] = Sha512::new().chain_update(r).chain_update(a).chain_update(msg).finalize().into();
    Scalar::from_bytes_mod_order_wide(&digest)
}

fn nonce(tag: &str, i: u32) -> Scalar {
    let digest: [u8; 64] = Sha512::new().chain_update(tag).chain_update(i.to_le_bytes()).finalize().into();
    Scalar::from_bytes_mod_order_wide(&digest)
}

/// Signs with nonce point `big_r` (which may carry torsion) and secret `a` for key bytes `a_bytes`.
fn sign_raw(big_r: EdwardsPoint, r: Scalar, a: Scalar, a_bytes: &[u8; 32], msg: &[u8]) -> [u8; 64] {
    let r_bytes = big_r.compress().to_bytes();
    let s = r + challenge(&r_bytes, a_bytes, msg) * a;
    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(&r_bytes);
    sig[32..].copy_from_slice(&s.to_bytes());
    sig
}

/// The cofactored equation `[8]([s]B − [k]A − R) == 0`, which `verify_strict` does not use.
fn cofactored_valid(a_bytes: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> bool {
    let (Some(a), Some(r)) = (
        curve25519_dalek::edwards::CompressedEdwardsY(*a_bytes).decompress(),
        curve25519_dalek::edwards::CompressedEdwardsY(sig[..32].try_into().unwrap()).decompress(),
    ) else {
        return false;
    };
    let Some(s) = Option::<Scalar>::from(Scalar::from_canonical_bytes(sig[32..].try_into().unwrap())) else {
        return false;
    };
    let k = challenge(sig[..32].try_into().unwrap(), a_bytes, msg);
    (ED25519_BASEPOINT_POINT * s - a * k - r).mul_by_cofactor().is_identity()
}

/// Asserts the Soroban host rejects the signature, as does ed25519-dalek `verify_strict`.
fn assert_host_rejects(env: &Env, a_bytes: &[u8; 32], msg: &[u8], sig: &[u8; 64]) {
    let strict = VerifyingKey::from_bytes(a_bytes)
        .map(|k| k.verify_strict(msg, &Signature::from_bytes(sig)).is_ok())
        .unwrap_or(false);
    assert!(!strict, "verify_strict unexpectedly accepted an invalid vector");
    let host = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.crypto().ed25519_verify(
            &BytesN::from_array(env, a_bytes),
            &soroban_sdk::Bytes::from_slice(env, msg),
            &BytesN::from_array(env, sig),
        )
    }));
    assert!(host.is_err(), "Soroban host unexpectedly accepted an invalid vector");
}

fn invalid_signatures(env: &Env, s: &Setup, ids: &[u64], providers: &[Address], agents: &[Agent]) -> std::vec::Vec<Value> {
    let seed = [AGENT_SEEDS[0]; 32];
    let a = secret_scalar(seed);
    let a_bytes = agents[0].public(env).to_array();
    let amount = units(3);
    let msg: std::vec::Vec<u8> = s.client.voucher_message(&ids[0], &amount).iter().collect();
    let torsion = EIGHT_TORSION[1];
    let mut out = std::vec::Vec::new();
    let mut push = |note: &str, key: [u8; 32], msg: &[u8], sig: [u8; 64]| {
        assert_host_rejects(env, &key, msg, &sig);
        out.push(json!({
            "note": note,
            "channel_id": ids[0].to_string(),
            "provider": PROVIDERS[0],
            "signer_public_key": hex::encode(key),
            "amount": amount.to_string(),
            "message_xdr": hex::encode(msg),
            "signature": hex::encode(sig),
            "cofactored_valid": cofactored_valid(&key, msg, &sig),
        }));
    };

    // R = rB + T: valid under the cofactored equation, rejected by verify_strict.
    let r = nonce("mixed-order-r", 0);
    let sig = sign_raw(ED25519_BASEPOINT_POINT * r + torsion, r, a, &a_bytes, &msg);
    push("R has a torsion component (mixed order)", a_bytes, &msg, sig);

    // R itself is a small-order point.
    let sig = sign_raw(torsion, Scalar::ZERO, a, &a_bytes, &msg);
    push("R is a small-order point", a_bytes, &msg, sig);

    // Valid signature with s replaced by s + L (non-canonical scalar).
    let r = nonce("non-canonical-s", 0);
    let mut sig = sign_raw(ED25519_BASEPOINT_POINT * r, r, a, &a_bytes, &msg);
    let s_scalar = Scalar::from_canonical_bytes(sig[32..].try_into().unwrap()).unwrap();
    let mut wide = [0u8; 32];
    let (mut carry, sb, lb) = (0u16, s_scalar.to_bytes(), GROUP_ORDER);
    for i in 0..32 {
        let v = sb[i] as u16 + lb[i] as u16 + carry;
        wide[i] = v as u8;
        carry = v >> 8;
    }
    sig[32..].copy_from_slice(&wide);
    push("s is not reduced (s + L)", a_bytes, &msg, sig);

    // Signer key A' = aB + T registered on the channel: an honest signer's
    // signatures fail verify_strict unless [k]T happens to vanish.
    let mixed_key = (ED25519_BASEPOINT_POINT * a + torsion).compress().to_bytes();
    let payload = crate::VoucherPayload {
        amount,
        channel_id: ids[0],
        contract: s.contract.clone(),
        domain: Symbol::new(env, crate::DOMAIN),
        network: env.ledger().network_id(),
        owner: s.owner.clone(),
        provider: providers[0].clone(),
        signer: BytesN::from_array(env, &mixed_key),
    };
    let mixed_msg: std::vec::Vec<u8> = soroban_sdk::xdr::ToXdr::to_xdr(payload, env).iter().collect();
    let sig = (0..)
        .map(|i| {
            let r = nonce("mixed-order-key", i);
            sign_raw(ED25519_BASEPOINT_POINT * r, r, a, &mixed_key, &mixed_msg)
        })
        .find(|sig| {
            VerifyingKey::from_bytes(&mixed_key)
                .unwrap()
                .verify_strict(&mixed_msg, &Signature::from_bytes(sig))
                .is_err()
        })
        .unwrap();
    push("signer key has a torsion component (mixed order)", mixed_key, &mixed_msg, sig);
    out
}

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
    let allocations = [units(40), units(35), units(15), units(10)];
    // Encoding fixture only: channel setup by the G-account owner uses
    // `mock_all_auths` (the SDK's `mock_auths` does not accept account
    // addresses). Owner authorization is covered by `auth.rs`; voucher
    // signatures below are real and verified by the host.
    env.mock_all_auths();
    let ids: std::vec::Vec<u64> = (0..4)
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
                "channel_id": ids[i].to_string(),
                "provider": PROVIDERS[i],
                "signer_seed": hex::encode([AGENT_SEEDS[i]; 32]),
                "signer_public_key": hex::encode(agents[i].public(&env).to_array()),
                "amount": amount.to_string(),
                "message_xdr": hex::encode(&msg),
                "signature": hex::encode(sig.to_array()),
            })
        })
        .collect();
    let invalid = invalid_signatures(&env, &s, &ids, &providers, &agents);

    json!({
        "description": "AgentBatch PoC voucher vectors. message_xdr = XDR(ScVal::Map) of VoucherPayload; signature = Ed25519(signer_seed, message_xdr). invalid_signatures are rejected by the Soroban host (ed25519-dalek verify_strict).",
        "domain": crate::DOMAIN,
        "network_passphrase": PASSPHRASE,
        "network_id": hex::encode(network),
        "contract": CONTRACT,
        "owner": OWNER,
        "cases": cases,
        "invalid_signatures": invalid,
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
