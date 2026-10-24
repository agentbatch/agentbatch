//! Treasury accounting, collateral reservation and conservation invariants.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, IntoVal};

use super::*;
use crate::Error;

#[test]
fn deposit_accounting() {
    let s = Setup::new(units(150));
    s.deposit(units(100));
    s.deposit(units(25));
    let t = s.client.get_treasury();
    assert_eq!(t.total_deposited, units(125));
    assert_eq!(t.available, units(125));
    assert_eq!(t.total_reserved, 0);
    assert_eq!(t.token_balance, units(125));
    assert_eq!(s.balance(&s.owner), units(25));
    s.assert_invariants();
}

#[test]
fn invalid_deposits_rejected() {
    let s = Setup::new(units(10));
    assert_contract_err!(s.try_deposit_as(&s.owner, 0), Error::InvalidAmount);
    assert_contract_err!(s.try_deposit_as(&s.owner, -1), Error::InvalidAmount);
    // More than the owner holds: the token transfer fails, nothing is recorded.
    assert_token_err!(s.try_deposit_as(&s.owner, units(11)), 10); // BalanceError
    assert_eq!(s.client.get_treasury().total_deposited, 0);
    s.assert_invariants();
}

#[test]
fn deposit_overflow_rejected() {
    let s = Setup::new(i128::MAX);
    s.deposit(i128::MAX);
    assert_contract_err!(s.try_deposit_as(&s.owner, 1), Error::ArithmeticOverflow);
    assert_eq!(s.client.get_treasury().total_deposited, i128::MAX);
}

#[test]
fn collateral_reservation() {
    let (s, ch) = funded();
    let t = s.client.get_treasury();
    assert_eq!(t.available, units(10));
    assert_eq!(t.total_reserved, units(90));
    assert_eq!(ch.ids, [1, 2, 3]);
    let allocations: std::vec::Vec<i128> = ch.ids.iter().map(|id| s.client.get_channel(id).allocation).collect();
    assert_eq!(allocations, [units(40), units(35), units(15)]);
    s.assert_invariants();
}

#[test]
fn over_allocation_rejected() {
    let (s, _) = funded();
    let p = Address::generate(&s.env);
    let key = Agent::numbered(50).public(&s.env);
    // 90 of 100 is already reserved: 11 cannot be promised again.
    assert_contract_err!(s.try_open_as(&s.owner, &p, &key, units(10) + 1), Error::InsufficientAvailable);
    // Exactly the remainder is allowed, after which nothing more is.
    s.try_open_as(&s.owner, &p, &key, units(10)).unwrap().unwrap();
    assert_contract_err!(s.try_open_as(&s.owner, &p, &key, 1), Error::InsufficientAvailable);
    assert_eq!(s.client.get_treasury().available, 0);
    s.assert_invariants();
}

#[test]
fn invalid_channel_configuration_rejected() {
    let (s, _) = funded();
    let p = Address::generate(&s.env);
    let key = Agent::numbered(50).public(&s.env);
    let zero = BytesN::from_array(&s.env, &[0; 32]);

    assert_contract_err!(s.try_open_as(&s.owner, &p, &key, 0), Error::InvalidAmount);
    assert_contract_err!(s.try_open_as(&s.owner, &p, &key, -5), Error::InvalidAmount);
    assert_contract_err!(s.try_open_as(&s.owner, &p, &zero, units(1)), Error::InvalidSigner);
    assert_contract_err!(s.try_open_as(&s.owner, &s.contract, &key, units(1)), Error::InvalidProvider);
    assert_contract_err!(s.try_open_as(&s.owner, &s.owner, &key, units(1)), Error::InvalidProvider);
    assert_contract_err!(s.try_open_as(&s.owner, &s.token, &key, units(1)), Error::InvalidProvider);
    assert_eq!(s.client.get_treasury().next_channel_id, 4);
}

#[test]
fn channel_isolation() {
    let (s, ch) = funded();
    // Fully drain channel 3 (15 units).
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(15))]));
    assert_eq!(s.client.get_channel(&ch.ids[2]).remaining, 0);
    // Other channels and available funds are untouched.
    assert_eq!(s.client.get_channel(&ch.ids[0]).remaining, units(40));
    assert_eq!(s.client.get_channel(&ch.ids[1]).remaining, units(35));
    assert_eq!(s.client.get_treasury().available, units(10));
    // Channel 3 cannot draw on the treasury's other funds.
    let v = s.voucher(ch.ids[2], &ch.providers[2], &ch.agents[2], units(16));
    assert_contract_err!(s.client.try_redeem_batch(&s.batch(&[v])), Error::ExceedsAllocation);
    s.assert_invariants();
}

#[test]
fn withdrawal_limited_to_unallocated_funds() {
    let (s, _) = funded();
    assert_contract_err!(s.try_withdraw_as(&s.owner, units(10) + 1), Error::InsufficientAvailable);
    assert_contract_err!(s.try_withdraw_as(&s.owner, 0), Error::InvalidAmount);
    assert_contract_err!(s.try_withdraw_as(&s.owner, -1), Error::InvalidAmount);
    s.withdraw(units(10));
    assert_eq!(s.balance(&s.owner), units(10));
    // All remaining funds are reserved for providers.
    assert_contract_err!(s.try_withdraw_as(&s.owner, 1), Error::InsufficientAvailable);
    let t = s.client.get_treasury();
    assert_eq!(t.total_withdrawn, units(10));
    assert_eq!(t.total_reserved, units(90));
    assert_eq!(t.token_balance, units(90));
    s.assert_invariants();
}

#[test]
fn unsolicited_transfers_are_not_credited() {
    let (s, _) = funded();
    // Tokens sent directly to the contract, bypassing `deposit`.
    let donor = Address::generate(&s.env);
    s.mint(&donor, units(7));
    s.mint(&s.contract, units(3));
    let t = s.client.get_treasury();
    assert_eq!(t.available, units(10));
    assert_eq!(t.total_deposited, units(100));
    assert_eq!(t.token_balance, units(103));
    assert_eq!(t.unaccounted_balance, units(3));
    // Unaccounted tokens can be neither allocated nor withdrawn.
    assert_contract_err!(s.try_withdraw_as(&s.owner, units(11)), Error::InsufficientAvailable);
    let key = Agent::numbered(50).public(&s.env);
    assert_contract_err!(
        s.try_open_as(&s.owner, &Address::generate(&s.env), &key, units(11)),
        Error::InsufficientAvailable
    );
    s.assert_invariants();
}

/// Deterministic xorshift64* generator so failures are reproducible.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    fn amount(&mut self, max_units: u64) -> i128 {
        // Mix whole units with odd base-unit amounts; includes zero and negatives.
        match self.below(8) {
            0 => 0,
            1 => -(self.below(1_000) as i128) - 1,
            2 => self.below(max_units * UNIT as u64 + 1) as i128,
            _ => units(self.below(max_units + 1) as i128),
        }
    }
}

/// Independent model of the expected state.
#[derive(Clone, Debug, Default, PartialEq)]
struct Model {
    deposited: i128,
    paid: i128,
    withdrawn: i128,
    available: i128,
    channels: std::vec::Vec<(i128, i128)>, // (allocation, redeemed)
    owner_balance: i128,
}

#[test]
fn randomized_transitions_preserve_invariants() {
    for seed in [1u64, 7, 42, 1337, 0xDEAD_BEEF] {
        run_random_sequence(seed, 250);
    }
}

fn run_random_sequence(seed: u64, steps: usize) {
    let mut rng = Rng(seed);
    let s = Setup::new(units(1_000));
    let mut m = Model {
        owner_balance: units(1_000),
        ..Model::default()
    };
    let mut providers: std::vec::Vec<Address> = std::vec::Vec::new();
    let mut agents: std::vec::Vec<Agent> = std::vec::Vec::new();

    for step in 0..steps {
        let before = s.client.get_treasury();
        let ok = match rng.below(6) {
            0 => {
                let amount = rng.amount(120);
                let ok = amount > 0 && amount <= m.owner_balance;
                let res = s.try_deposit_as(&s.owner, amount);
                if ok {
                    m.deposited += amount;
                    m.available += amount;
                    m.owner_balance -= amount;
                }
                assert_eq!(res.is_ok(), ok, "seed {seed} step {step}: deposit {amount}");
                ok
            }
            1 => {
                let amount = rng.amount(60);
                let p = Address::generate(&s.env);
                let agent = Agent::from_seed([(step % 251) as u8 + 1; 32]);
                let ok = amount > 0 && amount <= m.available;
                let res = s.try_open_as(&s.owner, &p, &agent.public(&s.env), amount);
                assert_eq!(res.is_ok(), ok, "seed {seed} step {step}: open {amount}");
                if ok {
                    m.available -= amount;
                    m.channels.push((amount, 0));
                    providers.push(p);
                    agents.push(agent);
                }
                ok
            }
            2 | 3 if !m.channels.is_empty() => {
                // Batch of 1..=3 distinct channels with random cumulative amounts.
                let n = (rng.below(3) + 1).min(m.channels.len() as u64) as usize;
                let mut picked: std::vec::Vec<usize> = std::vec::Vec::new();
                while picked.len() < n {
                    let i = rng.below(m.channels.len() as u64) as usize;
                    if !picked.contains(&i) {
                        picked.push(i);
                    }
                }
                let mut vouchers = std::vec::Vec::new();
                let mut next = m.clone();
                let mut ok = true;
                for &i in &picked {
                    let (alloc, redeemed) = m.channels[i];
                    let amount = match rng.below(4) {
                        0 => redeemed,                                   // replay
                        1 => alloc + 1 + rng.below(UNIT as u64) as i128, // over ceiling
                        _ => redeemed + 1 + (rng.below(((alloc - redeemed).max(1)) as u64) as i128),
                    };
                    let valid = amount > redeemed && amount <= alloc;
                    ok &= valid;
                    if valid {
                        next.paid += amount - redeemed;
                        next.channels[i].1 = amount;
                    }
                    vouchers.push(s.voucher(i as u64 + 1, &providers[i], &agents[i], amount));
                }
                let paid_before: std::vec::Vec<i128> = picked.iter().map(|&i| s.balance(&providers[i])).collect();
                let res = s.client.try_redeem_batch(&s.batch(&vouchers));
                assert_eq!(res.is_ok(), ok, "seed {seed} step {step}: batch {picked:?}");
                if ok {
                    for &i in &picked {
                        assert_eq!(s.balance(&providers[i]), next.channels[i].1, "provider {i} paid in full");
                    }
                    m = next;
                } else {
                    // Atomicity: no provider in a failed batch was paid.
                    let paid_after: std::vec::Vec<i128> = picked.iter().map(|&i| s.balance(&providers[i])).collect();
                    assert_eq!(paid_before, paid_after, "seed {seed} step {step}: partial settlement");
                }
                ok
            }
            4 => {
                let amount = rng.amount(40);
                let ok = amount > 0 && amount <= m.available;
                let res = s.try_withdraw_as(&s.owner, amount);
                assert_eq!(res.is_ok(), ok, "seed {seed} step {step}: withdraw {amount}");
                if ok {
                    m.available -= amount;
                    m.withdrawn += amount;
                    m.owner_balance += amount;
                }
                ok
            }
            _ => {
                // Unsolicited transfer: must never change accounting.
                s.mint(&s.contract, rng.below(UNIT as u64) as i128);
                true
            }
        };

        if !ok {
            let after = s.client.get_treasury();
            assert_eq!(
                (
                    after.total_deposited,
                    after.total_paid,
                    after.total_withdrawn,
                    after.available,
                    after.total_reserved
                ),
                (
                    before.total_deposited,
                    before.total_paid,
                    before.total_withdrawn,
                    before.available,
                    before.total_reserved
                ),
                "seed {seed} step {step}: failed op changed state"
            );
        }

        let t = s.client.get_treasury();
        assert_eq!(t.total_deposited, m.deposited);
        assert_eq!(t.total_paid, m.paid);
        assert_eq!(t.total_withdrawn, m.withdrawn);
        assert_eq!(t.available, m.available);
        let reserved: i128 = m.channels.iter().map(|(a, r)| a - r).sum();
        assert_eq!(t.total_reserved, reserved);
        assert_eq!(s.balance(&s.owner), m.owner_balance);
        s.assert_invariants();
    }
}

/// A 7-decimal token that silently keeps 1 base unit of every transfer.
#[soroban_sdk::contract]
struct FeeOnTransferToken;

#[soroban_sdk::contractimpl]
impl FeeOnTransferToken {
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let b: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&to, &(b + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&id).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let f: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        let t: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&from, &(f - amount));
        env.storage().persistent().set(&to, &(t + amount - 1));
    }
}

#[test]
fn deposit_credits_only_what_arrives() {
    let env = Env::default();
    let token = env.register(FeeOnTransferToken, ());
    let owner = Address::generate(&env);
    let contract = env.register(crate::AgentBatchPoC, (owner.clone(), token.clone()));
    FeeOnTransferTokenClient::new(&env, &token).mint(&owner, &units(10));
    let client = crate::AgentBatchPoCClient::new(&env, &contract);
    let invoke = soroban_sdk::testutils::MockAuthInvoke {
        contract: &contract,
        fn_name: "deposit",
        args: (units(1),).into_val(&env),
        sub_invokes: &[],
    };
    let res = client
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &owner,
            invoke: &invoke,
        }])
        .try_deposit(&units(1));
    assert_contract_err!(res, Error::TransferMismatch);
    assert_eq!(client.get_treasury().total_deposited, 0);
}
