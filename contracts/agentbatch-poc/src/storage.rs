//! Storage layout and TTL policy.
//!
//! - Instance storage: `Config` and `Treasury` (small, read on every call).
//!   Extended on every state-changing call; extending the instance also
//!   extends the contract code entry.
//! - Persistent storage: one entry per channel under `DataKey::Channel(id)`.
//!   Extended when opened and whenever redeemed.
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

pub fn extend_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
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

pub fn write_channel(env: &Env, channel: &Channel) {
    let key = DataKey::Channel(channel.id);
    let persistent = env.storage().persistent();
    persistent.set(&key, channel);
    persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
