//! Storage layout and TTL policy.
//!
//! - Instance storage: `Config` and `Treasury` (small, read on every call).
//!   On every state-changing call, extended to `TTL_EXTEND_TO` if below
//!   `TTL_THRESHOLD`. Only the instance is extended, never the shared WASM
//!   code entry (see `extend_instance`).
//! - Persistent storage: one entry per channel under `DataKey::Channel(id)`.
//!   At least `TTL_EXTEND_TO` when opened; on redemption, extended again if
//!   below `TTL_THRESHOLD`.
//!
//! Persistent entries are archived, never deleted, when their TTL lapses. An
//! archived channel must be restored before use; it is never read as empty.
//! A missing key always yields `Error::ChannelNotFound`.

use soroban_sdk::{contracttype, Env};

use crate::error::Error;
use crate::types::{Channel, Config, Treasury};

/// ~5s ledgers: 17,280 ledgers per day.
pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
pub const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    Treasury,
    Channel(u64),
}

/// Extends this contract's instance entry only. `instance().extend_ttl()`
/// would also extend the WASM code entry, which is shared by every deployment
/// of the code and is by far the largest entry (rent scales with size), so
/// each call would pay rent for the code. The code entry is maintained
/// separately with `ExtendFootprintTTLOp`; if it is ever archived, protocol 23+
/// restores it automatically on the next invocation.
pub fn extend_instance(env: &Env) {
    env.deployer()
        .extend_ttl_for_contract_instance(env.current_contract_address(), TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn read_config(env: &Env) -> Config {
    // Always present: written by the constructor, which runs exactly once.
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn write_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn read_treasury(env: &Env) -> Treasury {
    env.storage().instance().get(&DataKey::Treasury).unwrap()
}

pub fn write_treasury(env: &Env, treasury: &Treasury) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn read_channel(env: &Env, id: u64) -> Result<Channel, Error> {
    env.storage().persistent().get(&DataKey::Channel(id)).ok_or(Error::ChannelNotFound)
}

/// Stores a new channel with a TTL of at least `TTL_EXTEND_TO`, regardless of
/// the network's minimum TTL for new persistent entries.
pub fn create_channel(env: &Env, channel: &Channel) {
    let key = DataKey::Channel(channel.id);
    let persistent = env.storage().persistent();
    persistent.set(&key, channel);
    persistent.extend_ttl(&key, TTL_EXTEND_TO, TTL_EXTEND_TO);
}

pub fn write_channel(env: &Env, channel: &Channel) {
    let key = DataKey::Channel(channel.id);
    let persistent = env.storage().persistent();
    persistent.set(&key, channel);
    persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
