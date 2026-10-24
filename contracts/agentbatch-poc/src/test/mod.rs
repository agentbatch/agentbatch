//! Test suite.
//!
//! Authorization model used in tests:
//! - Treasury-owner and token-issuer authorization uses `mock_auths` with the
//!   exact invocation tree (enforcing mode), so a missing or wrong
//!   `require_auth` makes the test fail. `mock_all_auths` appears only in two
//!   places that are not negative authorization tests: the cross-language
//!   vector fixture (channel setup by a G-account owner, which `mock_auths`
//!   does not accept) and the positive constructor control test.
//! - `Env::register` always mocks constructor authorization, so constructor
//!   authorization is tested separately through a real `deploy_v2` of the
//!   compiled WASM (see `auth.rs`).
//! - Voucher authorization always uses real Ed25519 signatures produced with
//!   `ed25519-dalek` over the contract-encoded payload. Nothing about voucher
//!   verification is mocked.

// Tests index parallel arrays (providers/agents/ids) and build one-element
// batches inline; these lints hurt readability there.
#![allow(clippy::needless_range_loop, clippy::cloned_ref_to_slice_refs)]

extern crate std;

/// Extracts the contract error from a failed `try_` call.
macro_rules! assert_contract_err {
    ($res:expr, $err:expr) => {
        match $res {
            Err(Ok(e)) => assert_eq!(e, $err),
            other => panic!("expected contract error {:?}, got {:?}", $err, other),
        }
    };
}

/// Asserts that a `try_` call failed inside the Stellar Asset Contract with
/// the given SAC error code (e.g. 10 = BalanceError, 11 = BalanceDeauthorizedError).
macro_rules! assert_token_err {
    ($res:expr, $code:expr) => {{
        let res = $res;
        assert!(
            matches!(res, Err(Err(soroban_sdk::InvokeError::Contract(c))) if c == $code),
            "expected SAC error #{}, got {:?}",
            $code,
            res
        )
    }};
}

/// Asserts that a `try_` call failed at the host level (authorization,
/// Ed25519 verification or a token-contract error), not with one of this
/// contract's error codes, so an unrelated contract error cannot satisfy it.
macro_rules! assert_fails {
    ($res:expr) => {{
        let res = $res;
        assert!(matches!(res, Err(Err(_))), "expected a host-level failure, got {:?}", res)
    }};
}

mod accounting;
mod auth;
mod batch;
mod bench;
mod events;
mod scenario;
mod storage;
mod vectors;
mod vouchers;
mod wasm;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke, StellarAssetIssuer};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{Address, BytesN, ConversionError, Env, IntoVal, InvokeError, Symbol, Vec};

use crate::{AgentBatchPoC, AgentBatchPoCClient, Error, Voucher, VoucherPayload, DOMAIN};

pub type TryResult<T, C = ConversionError> = Result<Result<T, C>, Result<Error, InvokeError>>;

/// One whole token in base units (7 decimals).
pub const UNIT: i128 = 10_000_000;

pub fn units(n: i128) -> i128 {
    n * UNIT
}

/// A delegated agent signer: a raw Ed25519 key, not a Stellar account.
pub struct Agent {
    key: SigningKey,
}

impl Agent {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Agent {
            key: SigningKey::from_bytes(&seed),
        }
    }

    pub fn numbered(n: u8) -> Self {
        Self::from_seed([n; 32])
    }

    pub fn public(&self, env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &self.key.verifying_key().to_bytes())
    }

    pub fn sign_bytes(&self, env: &Env, msg: &soroban_sdk::Bytes) -> BytesN<64> {
        let raw: std::vec::Vec<u8> = msg.iter().collect();
        BytesN::from_array(env, &self.key.sign(&raw).to_bytes())
    }

    pub fn sign_payload(&self, env: &Env, payload: &VoucherPayload) -> BytesN<64> {
        self.sign_bytes(env, &payload.clone().to_xdr(env))
    }
}

pub struct Setup {
    pub env: Env,
    pub owner: Address,
    pub issuer: Address,
    pub token: Address,
    pub contract: Address,
    pub client: AgentBatchPoCClient<'static>,
    pub token_client: TokenClient<'static>,
    pub sac: StellarAssetClient<'static>,
    /// Classic issuer account of the test asset (flags can be changed in tests).
    pub asset_issuer: StellarAssetIssuer,
}

impl Setup {
    /// Native (non-WASM) contract, owner funded with `owner_balance`.
    pub fn new(owner_balance: i128) -> Self {
        let env = Env::default();
        Self::with_env(env, owner_balance, |env, owner, token, contract| {
            env.register_at(contract, AgentBatchPoC, (owner.clone(), token.clone()));
        })
    }

    pub fn with_env(env: Env, owner_balance: i128, register: impl FnOnce(&Env, &Address, &Address, &Address)) -> Self {
        let issuer = Address::generate(&env);
        let sac_contract = env.register_stellar_asset_contract_v2(issuer.clone());
        let token = sac_contract.address();
        let asset_issuer = sac_contract.issuer();
        let owner = Address::generate(&env);
        let contract = Address::generate(&env);
        register(&env, &owner, &token, &contract);

        let s = Setup {
            client: AgentBatchPoCClient::new(&env, &contract),
            token_client: TokenClient::new(&env, &token),
            sac: StellarAssetClient::new(&env, &token),
            asset_issuer,
            env,
            owner,
            issuer,
            token,
            contract,
        };
        if owner_balance > 0 {
            s.mint(&s.owner.clone(), owner_balance);
        }
        s
    }

    /// Issuer mints test tokens (setup only).
    pub fn mint(&self, to: &Address, amount: i128) {
        self.sac
            .mock_auths(&[MockAuth {
                address: &self.issuer,
                invoke: &MockAuthInvoke {
                    contract: &self.token,
                    fn_name: "mint",
                    args: (to.clone(), amount).into_val(&self.env),
                    sub_invokes: &[],
                },
            }])
            .mint(to, &amount);
    }

    pub fn deposit(&self, amount: i128) {
        self.try_deposit_as(&self.owner, amount).unwrap().unwrap();
    }

    /// `deposit` authorized by `signer` (authorizes the call and the nested token transfer).
    pub fn try_deposit_as(&self, signer: &Address, amount: i128) -> TryResult<()> {
        let transfer = [MockAuthInvoke {
            contract: &self.token,
            fn_name: "transfer",
            args: (signer.clone(), self.contract.clone(), amount).into_val(&self.env),
            sub_invokes: &[],
        }];
        let invoke = MockAuthInvoke {
            contract: &self.contract,
            fn_name: "deposit",
            args: (amount,).into_val(&self.env),
            sub_invokes: &transfer,
        };
        self.client
            .mock_auths(&[MockAuth {
                address: signer,
                invoke: &invoke,
            }])
            .try_deposit(&amount)
    }

    pub fn open(&self, provider: &Address, agent: &Agent, allocation: i128) -> u64 {
        self.try_open_as(&self.owner, provider, &agent.public(&self.env), allocation)
            .unwrap()
            .unwrap()
    }

    /// `open_channel` authorized by `signer`.
    pub fn try_open_as(
        &self,
        signer: &Address,
        provider: &Address,
        signer_key: &BytesN<32>,
        allocation: i128,
    ) -> TryResult<u64, soroban_sdk::Error> {
        let invoke = MockAuthInvoke {
            contract: &self.contract,
            fn_name: "open_channel",
            args: (provider.clone(), signer_key.clone(), allocation).into_val(&self.env),
            sub_invokes: &[],
        };
        self.client
            .mock_auths(&[MockAuth {
                address: signer,
                invoke: &invoke,
            }])
            .try_open_channel(provider, signer_key, &allocation)
    }

    pub fn withdraw(&self, amount: i128) {
        self.try_withdraw_as(&self.owner, amount).unwrap().unwrap();
    }

    /// `withdraw_available` authorized by `signer`.
    pub fn try_withdraw_as(&self, signer: &Address, amount: i128) -> TryResult<()> {
        let invoke = MockAuthInvoke {
            contract: &self.contract,
            fn_name: "withdraw_available",
            args: (amount,).into_val(&self.env),
            sub_invokes: &[],
        };
        self.client
            .mock_auths(&[MockAuth {
                address: signer,
                invoke: &invoke,
            }])
            .try_withdraw_available(&amount)
    }

    /// Payload exactly as the contract will rebuild it for `channel_id`.
    pub fn payload(&self, channel_id: u64, provider: &Address, agent: &Agent, amount: i128) -> VoucherPayload {
        VoucherPayload {
            amount,
            channel_id,
            contract: self.contract.clone(),
            domain: Symbol::new(&self.env, DOMAIN),
            network: self.env.ledger().network_id(),
            owner: self.owner.clone(),
            provider: provider.clone(),
            signer: agent.public(&self.env),
        }
    }

    pub fn voucher(&self, channel_id: u64, provider: &Address, agent: &Agent, amount: i128) -> Voucher {
        let payload = self.payload(channel_id, provider, agent, amount);
        Voucher {
            channel_id,
            amount,
            signature: agent.sign_payload(&self.env, &payload),
        }
    }

    pub fn batch(&self, vouchers: &[Voucher]) -> Vec<Voucher> {
        let mut v = Vec::new(&self.env);
        for x in vouchers {
            v.push_back(x.clone());
        }
        v
    }

    pub fn balance(&self, who: &Address) -> i128 {
        self.token_client.balance(who)
    }

    /// Asserts every accounting invariant against stored state.
    pub fn assert_invariants(&self) {
        let t = self.client.get_treasury();
        assert!(t.available >= 0 && t.total_reserved >= 0);
        assert_eq!(
            t.total_deposited - t.total_paid - t.total_withdrawn,
            t.available + t.total_reserved,
            "conservation invariant"
        );
        let mut sum_remaining = 0;
        for id in 1..t.next_channel_id {
            let c = self.client.get_channel(&id);
            assert!(0 <= c.redeemed && c.redeemed <= c.allocation, "channel {id} bounds");
            assert_eq!(c.remaining, c.allocation - c.redeemed);
            sum_remaining += c.remaining;
        }
        assert_eq!(sum_remaining, t.total_reserved, "sum of reservations");
        assert!(t.token_balance >= t.available + t.total_reserved, "solvency");
        assert_eq!(t.token_balance, self.balance(&self.contract));
    }
}

/// Three providers with independent agents, mirroring the demo scenario.
pub struct ThreeChannels {
    pub providers: [Address; 3],
    pub agents: [Agent; 3],
    pub ids: [u64; 3],
}

pub fn three_channels(s: &Setup) -> ThreeChannels {
    let providers = [Address::generate(&s.env), Address::generate(&s.env), Address::generate(&s.env)];
    let agents = [Agent::numbered(11), Agent::numbered(12), Agent::numbered(13)];
    let allocations = [units(40), units(35), units(15)];
    let ids = [
        s.open(&providers[0], &agents[0], allocations[0]),
        s.open(&providers[1], &agents[1], allocations[1]),
        s.open(&providers[2], &agents[2], allocations[2]),
    ];
    ThreeChannels { providers, agents, ids }
}

/// The standard funded state: 100 deposited, channels of 40/35/15, 10 available.
pub fn funded() -> (Setup, ThreeChannels) {
    let s = Setup::new(units(100));
    s.deposit(units(100));
    let ch = three_channels(&s);
    (s, ch)
}
