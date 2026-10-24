use soroban_sdk::{contracttype, Address, BytesN, Symbol};

/// Immutable deployment configuration, bound by the constructor.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub owner: Address,
    pub token: Address,
}

/// Treasury-wide accounting. All amounts are in the token's base units
/// (7 decimals for Stellar Asset Contracts).
///
/// Invariant (checked by the test suite after every transition):
/// `total_deposited - total_paid - total_withdrawn == available + total_reserved`
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Treasury {
    pub total_deposited: i128,
    pub total_paid: i128,
    pub total_withdrawn: i128,
    /// Deposited funds not reserved by any channel.
    pub available: i128,
    /// Sum over channels of `allocation - redeemed`.
    pub total_reserved: i128,
    pub next_channel_id: u64,
}

/// A virtual payment channel: an internal record, not a separate contract.
///
/// `provider` and `signer` are immutable once the channel is opened.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Channel {
    pub id: u64,
    pub owner: Address,
    pub provider: Address,
    /// Raw Ed25519 public key of the delegated agent signer.
    pub signer: BytesN<32>,
    /// Collateral ceiling reserved for this channel.
    pub allocation: i128,
    /// Cumulative amount already paid to the provider.
    pub redeemed: i128,
    pub created_ledger: u32,
}

/// A signed cumulative voucher as submitted to `redeem_batch`.
///
/// Only the channel ID, amount and signature are caller-supplied. Every other
/// field of the signed payload is taken from contract storage and the ledger.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Voucher {
    pub channel_id: u64,
    pub amount: i128,
    pub signature: BytesN<64>,
}

/// The message an agent signs. Serialized with `to_xdr` as an `ScVal::Map`
/// whose keys are the field names; fields are declared in ascending key order
/// to match the canonical Soroban map ordering. See `docs/voucher-format.md`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoucherPayload {
    pub amount: i128,
    pub channel_id: u64,
    pub contract: Address,
    pub domain: Symbol,
    pub network: BytesN<32>,
    pub owner: Address,
    pub provider: Address,
    pub signer: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryView {
    pub owner: Address,
    pub token: Address,
    pub total_deposited: i128,
    pub total_paid: i128,
    pub total_withdrawn: i128,
    pub available: i128,
    pub total_reserved: i128,
    pub next_channel_id: u64,
    /// Actual token balance held by the contract.
    pub token_balance: i128,
    /// `token_balance - (available + total_reserved)`: tokens sent to the
    /// contract outside `deposit`. Never credited to `available`.
    pub unaccounted_balance: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelView {
    pub id: u64,
    pub owner: Address,
    pub provider: Address,
    pub signer: BytesN<32>,
    pub allocation: i128,
    pub redeemed: i128,
    /// `allocation - redeemed`.
    pub remaining: i128,
    pub created_ledger: u32,
}
