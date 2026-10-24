use soroban_sdk::{xdr::ToXdr, Bytes, BytesN, Env, Symbol};

use crate::types::{Channel, VoucherPayload};

/// Signature-domain separator. Changing the payload format requires a new value.
pub const DOMAIN: &str = "AGENTBATCH_POC_V1";

/// Builds the payload for a cumulative `amount` on `channel`.
///
/// Network and contract identities come from the executing environment; the
/// owner, provider and signer come from the stored channel. None of them can
/// be supplied by the caller.
pub fn payload(env: &Env, channel: &Channel, amount: i128) -> VoucherPayload {
    VoucherPayload {
        amount,
        channel_id: channel.id,
        contract: env.current_contract_address(),
        domain: Symbol::new(env, DOMAIN),
        network: env.ledger().network_id(),
        owner: channel.owner.clone(),
        provider: channel.provider.clone(),
        signer: channel.signer.clone(),
    }
}

pub fn message(env: &Env, channel: &Channel, amount: i128) -> Bytes {
    payload(env, channel, amount).to_xdr(env)
}

/// Verifies `signature` over the voucher message with the channel's signer.
/// Traps (aborting the whole invocation) if the signature is invalid.
pub fn verify(env: &Env, channel: &Channel, amount: i128, signature: &BytesN<64>) {
    let msg = message(env, channel, amount);
    env.crypto().ed25519_verify(&channel.signer, &msg, signature);
}
