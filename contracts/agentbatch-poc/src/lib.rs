//! # AgentBatchPoC
//!
//! One organization-owned treasury funds several virtual payment channels,
//! each bound to one provider and one delegated Ed25519 agent signer. Agents
//! sign cumulative vouchers off-chain; `redeem_batch` settles up to
//! [`MAX_BATCH_SIZE`] channels atomically in a single invocation.
//!
//! PoC scope: one treasury, no channel closure, revocation, signer rotation or
//! reallocation. Collateral reserved for a channel stays reserved until it is
//! redeemed. Test assets only; not audited.
//!
//! ## Accounting invariants
//!
//! - `total_deposited - total_paid - total_withdrawn == available + total_reserved`
//! - per channel: `remaining = allocation - redeemed`, `0 <= redeemed <= allocation`
//! - `sum(remaining) == total_reserved`
//! - `token_balance >= available + total_reserved`
#![no_std]

mod error;
mod events;
mod storage;
mod types;
mod voucher;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, Vec};

pub use crate::error::Error;
pub use crate::storage::{DataKey, TTL_EXTEND_TO, TTL_THRESHOLD};
pub use crate::types::{Channel, ChannelView, Config, Treasury, TreasuryView, Voucher, VoucherPayload};
pub use crate::voucher::DOMAIN;

use crate::events::{BatchRedeemed, ChannelOpened, Deposited, VoucherRedeemed, Withdrawn};
use crate::storage::{extend_instance, read_channel, read_config, read_treasury, write_channel, write_config, write_treasury};

/// Maximum number of vouchers accepted by one `redeem_batch` call.
pub const MAX_BATCH_SIZE: u32 = 4;

/// Stellar Asset Contracts use 7 decimals; the PoC accounts in base units.
pub const TOKEN_DECIMALS: u32 = 7;

#[contract]
pub struct AgentBatchPoC;

#[contractimpl]
impl AgentBatchPoC {
    /// Binds the treasury owner and payment token permanently.
    ///
    /// Runs exactly once, at deployment. There is no initializer, owner
    /// setter or token setter.
    ///
    /// # Auth
    /// - `owner`: required.
    pub fn __constructor(env: Env, owner: Address, token: Address) {
        owner.require_auth();
        if token == owner || token == env.current_contract_address() {
            soroban_sdk::panic_with_error!(&env, Error::InvalidToken);
        }
        if token::Client::new(&env, &token).decimals() != TOKEN_DECIMALS {
            soroban_sdk::panic_with_error!(&env, Error::InvalidToken);
        }
        write_config(&env, &Config { owner, token });
        write_treasury(
            &env,
            &Treasury {
                next_channel_id: 1,
                ..Treasury::default()
            },
        );
        extend_instance(&env);
    }

    /// Transfers `amount` from the owner into the treasury as unallocated funds.
    ///
    /// # Auth
    /// - `owner`: required (also authorizes the token transfer).
    pub fn deposit(env: Env, amount: i128) -> Result<(), Error> {
        let config = read_config(&env);
        config.owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut treasury = read_treasury(&env);
        treasury.total_deposited = add(treasury.total_deposited, amount)?;
        treasury.available = add(treasury.available, amount)?;
        write_treasury(&env, &treasury);
        extend_instance(&env);

        token::Client::new(&env, &config.token).transfer(&config.owner, env.current_contract_address(), &amount);

        Deposited {
            owner: config.owner,
            amount,
            available: treasury.available,
        }
        .publish(&env);
        Ok(())
    }

    /// Opens a virtual channel reserving `allocation` of the available funds
    /// exclusively for `provider`, payable against vouchers signed by
    /// `signer_key`. Returns the new channel ID.
    ///
    /// # Auth
    /// - `owner`: required.
    pub fn open_channel(env: Env, provider: Address, signer_key: BytesN<32>, allocation: i128) -> Result<u64, Error> {
        let config = read_config(&env);
        config.owner.require_auth();

        if provider == env.current_contract_address() || provider == config.owner || provider == config.token {
            return Err(Error::InvalidProvider);
        }
        if signer_key == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(Error::InvalidSigner);
        }
        if allocation <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut treasury = read_treasury(&env);
        if allocation > treasury.available {
            return Err(Error::InsufficientAvailable);
        }

        let id = treasury.next_channel_id;
        treasury.next_channel_id = id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        treasury.available = sub(treasury.available, allocation)?;
        treasury.total_reserved = add(treasury.total_reserved, allocation)?;

        let channel = Channel {
            id,
            owner: config.owner,
            provider: provider.clone(),
            signer: signer_key.clone(),
            allocation,
            redeemed: 0,
            created_ledger: env.ledger().sequence(),
        };
        write_channel(&env, &channel);
        write_treasury(&env, &treasury);
        extend_instance(&env);

        ChannelOpened {
            channel_id: id,
            provider,
            signer: signer_key,
            allocation,
        }
        .publish(&env);
        Ok(id)
    }

    /// Settles up to [`MAX_BATCH_SIZE`] cumulative vouchers on distinct
    /// channels and returns the total paid.
    ///
    /// Each voucher pays `amount - redeemed` to the channel's stored provider.
    /// All vouchers are validated and all accounting is written before any
    /// transfer. Any failure, including a failed token transfer, reverts the
    /// whole invocation.
    ///
    /// # Auth
    /// None. The recipient of every payout is fixed by channel storage, so a
    /// third-party coordinator may submit the batch.
    pub fn redeem_batch(env: Env, vouchers: Vec<Voucher>) -> Result<i128, Error> {
        let count = vouchers.len();
        if count == 0 {
            return Err(Error::EmptyBatch);
        }
        if count > MAX_BATCH_SIZE {
            return Err(Error::BatchTooLarge);
        }
        for i in 1..count {
            let id = vouchers.get_unchecked(i).channel_id;
            for j in 0..i {
                if vouchers.get_unchecked(j).channel_id == id {
                    return Err(Error::DuplicateChannel);
                }
            }
        }

        let config = read_config(&env);
        let mut treasury = read_treasury(&env);
        let mut payouts: Vec<(Address, i128)> = Vec::new(&env);
        let mut total_payout: i128 = 0;

        for v in vouchers.iter() {
            let mut channel = read_channel(&env, v.channel_id)?;
            voucher::verify(&env, &channel, v.amount, &v.signature);
            if v.amount <= channel.redeemed {
                return Err(Error::StaleVoucher);
            }
            if v.amount > channel.allocation {
                return Err(Error::ExceedsAllocation);
            }

            let payout = sub(v.amount, channel.redeemed)?;
            channel.redeemed = v.amount;
            treasury.total_reserved = sub(treasury.total_reserved, payout)?;
            treasury.total_paid = add(treasury.total_paid, payout)?;
            total_payout = add(total_payout, payout)?;
            write_channel(&env, &channel);

            VoucherRedeemed {
                channel_id: channel.id,
                provider: channel.provider.clone(),
                cumulative: v.amount,
                payout,
            }
            .publish(&env);
            payouts.push_back((channel.provider, payout));
        }

        write_treasury(&env, &treasury);
        extend_instance(&env);

        let token = token::Client::new(&env, &config.token);
        let contract = env.current_contract_address();
        for (provider, payout) in payouts.iter() {
            token.transfer(&contract, &provider, &payout);
        }

        BatchRedeemed {
            vouchers: count,
            total_payout,
        }
        .publish(&env);
        Ok(total_payout)
    }

    /// Withdraws `amount` of unallocated funds to the owner. Reserved channel
    /// collateral can never be withdrawn.
    ///
    /// # Auth
    /// - `owner`: required.
    pub fn withdraw_available(env: Env, amount: i128) -> Result<(), Error> {
        let config = read_config(&env);
        config.owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut treasury = read_treasury(&env);
        if amount > treasury.available {
            return Err(Error::InsufficientAvailable);
        }
        treasury.available = sub(treasury.available, amount)?;
        treasury.total_withdrawn = add(treasury.total_withdrawn, amount)?;
        write_treasury(&env, &treasury);
        extend_instance(&env);

        token::Client::new(&env, &config.token).transfer(&env.current_contract_address(), &config.owner, &amount);

        Withdrawn {
            owner: config.owner,
            amount,
            available: treasury.available,
        }
        .publish(&env);
        Ok(())
    }

    /// Treasury totals and the contract's actual token balance.
    pub fn get_treasury(env: Env) -> TreasuryView {
        let config = read_config(&env);
        let treasury = read_treasury(&env);
        let token_balance = token::Client::new(&env, &config.token).balance(&env.current_contract_address());
        // Saturating: a view must not trap; the invariant suite asserts solvency.
        let liabilities = treasury.available.saturating_add(treasury.total_reserved);
        TreasuryView {
            owner: config.owner,
            token: config.token,
            total_deposited: treasury.total_deposited,
            total_paid: treasury.total_paid,
            total_withdrawn: treasury.total_withdrawn,
            available: treasury.available,
            total_reserved: treasury.total_reserved,
            next_channel_id: treasury.next_channel_id,
            token_balance,
            unaccounted_balance: token_balance.saturating_sub(liabilities),
        }
    }

    pub fn get_channel(env: Env, channel_id: u64) -> Result<ChannelView, Error> {
        let c = read_channel(&env, channel_id)?;
        Ok(ChannelView {
            id: c.id,
            owner: c.owner,
            provider: c.provider,
            signer: c.signer,
            allocation: c.allocation,
            redeemed: c.redeemed,
            remaining: c.allocation - c.redeemed,
            created_ledger: c.created_ledger,
        })
    }

    /// Returns the exact bytes an agent must sign for `amount` on
    /// `channel_id`. Off-chain signers build these bytes locally; this view
    /// exists for cross-implementation parity checks.
    pub fn voucher_message(env: Env, channel_id: u64, amount: i128) -> Result<Bytes, Error> {
        let channel = read_channel(&env, channel_id)?;
        Ok(voucher::message(&env, &channel, amount))
    }
}

fn add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::ArithmeticOverflow)
}

fn sub(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_sub(b).ok_or(Error::ArithmeticOverflow)
}

#[cfg(test)]
mod test;
