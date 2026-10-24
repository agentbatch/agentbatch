//! Authorization: constructor binding, owner-only mutations, permissionless redemption.

use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, IntoVal, Symbol};

use super::*;
use crate::{AgentBatchPoC, Error};

#[test]
fn constructor_binds_owner_and_token() {
    let s = Setup::new(0);
    let t = s.client.get_treasury();
    assert_eq!(t.owner, s.owner);
    assert_eq!(t.token, s.token);
    assert_eq!(t.next_channel_id, 1);
    assert_eq!(t.total_deposited, 0);
}

/// Test-only factory deploying the compiled WASM the way it is deployed
/// on-chain, so the constructor runs under the environment's real auth.
#[contract]
struct Factory;

#[contractimpl]
impl Factory {
    pub fn deploy(env: Env, wasm_hash: BytesN<32>, salt: BytesN<32>, owner: Address, token: Address) -> Address {
        env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, (owner, token))
    }
}

struct Deploy {
    env: Env,
    factory: FactoryClient<'static>,
    hash: BytesN<32>,
    owner: Address,
    token: Address,
}

fn deploy_fixture() -> Deploy {
    let env = Env::default();
    let hash = env.deployer().upload_contract_wasm(super::wasm::wasm().as_slice());
    let token = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let factory = FactoryClient::new(&env, &env.register(Factory, ()));
    let owner = Address::generate(&env);
    Deploy {
        env,
        factory,
        hash,
        owner,
        token,
    }
}

#[test]
fn constructor_without_owner_auth_fails() {
    let d = deploy_fixture();
    d.env.set_auths(&[]);
    let salt = BytesN::from_array(&d.env, &[1; 32]);
    assert_fails!(d.factory.try_deploy(&d.hash, &salt, &d.owner, &d.token));
}

#[test]
fn constructor_with_other_address_auth_fails() {
    let d = deploy_fixture();
    let attacker = Address::generate(&d.env);
    let salt = BytesN::from_array(&d.env, &[1; 32]);
    // The attacker authorizes the factory call; the constructor demands `owner`.
    let invoke = MockAuthInvoke {
        contract: &d.factory.address,
        fn_name: "deploy",
        args: (d.hash.clone(), salt.clone(), d.owner.clone(), d.token.clone()).into_val(&d.env),
        sub_invokes: &[],
    };
    let res = d
        .factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &invoke,
        }])
        .try_deploy(&d.hash, &salt, &d.owner, &d.token);
    assert_fails!(res);
}

#[test]
fn constructor_succeeds_when_owner_authorizes() {
    // Control for the two tests above: identical deployment with the owner's
    // authorization (mocked for every address, including non-root calls).
    let d = deploy_fixture();
    d.env.mock_all_auths_allowing_non_root_auth();
    let salt = BytesN::from_array(&d.env, &[1; 32]);
    let id = d.factory.deploy(&d.hash, &salt, &d.owner, &d.token);
    let auths = d.env.auths();
    assert!(auths.iter().any(|(addr, _)| *addr == d.owner), "owner authorization was required");
    let t = crate::AgentBatchPoCClient::new(&d.env, &id).get_treasury();
    assert_eq!((t.owner, t.token), (d.owner.clone(), d.token.clone()));
}

#[contract]
struct SixDecimalToken;

#[contractimpl]
impl SixDecimalToken {
    pub fn decimals(_env: Env) -> u32 {
        6
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn constructor_rejects_non_seven_decimal_token() {
    let env = Env::default();
    Setup::with_env(env, 0, |env, owner, _token, contract| {
        let bad_token = env.register(SixDecimalToken, ());
        env.register_at(contract, AgentBatchPoC, (owner.clone(), bad_token));
    });
}

#[test]
#[should_panic]
fn constructor_rejects_non_contract_token() {
    let env = Env::default();
    Setup::with_env(env, 0, |env, owner, _token, contract| {
        let not_a_token = Address::generate(env);
        env.register_at(contract, AgentBatchPoC, (owner.clone(), not_a_token));
    });
}

#[test]
fn constructor_cannot_be_invoked_again() {
    let s = Setup::new(0);
    let attacker = Address::generate(&s.env);
    let args = (attacker.clone(), s.token.clone()).into_val(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name: "__constructor",
            args: (attacker.clone(), s.token.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    let res = s
        .env
        .try_invoke_contract::<(), Error>(&s.contract, &Symbol::new(&s.env, "__constructor"), args);
    assert!(res.is_err());
    assert_eq!(s.client.get_treasury().owner, s.owner);
}

#[test]
fn deposit_requires_owner() {
    let s = Setup::new(units(10));
    let attacker = Address::generate(&s.env);
    s.mint(&attacker, units(10));

    // Attacker-signed deposit is rejected even though the attacker holds tokens.
    assert_fails!(s.try_deposit_as(&attacker, units(1)));
    // No authorization at all.
    s.env.set_auths(&[]);
    assert_fails!(s.client.try_deposit(&units(1)));

    assert_eq!(s.client.get_treasury().total_deposited, 0);
    assert_eq!(s.balance(&s.owner), units(10));
}

#[test]
fn open_channel_requires_owner() {
    let (s, _) = funded();
    let attacker = Address::generate(&s.env);
    let key = Agent::numbered(99).public(&s.env);
    let before = s.client.get_treasury();

    assert_fails!(s.try_open_as(&attacker, &attacker, &key, units(1)));
    s.env.set_auths(&[]);
    assert_fails!(s.client.try_open_channel(&attacker, &key, &units(1)));

    assert_eq!(s.client.get_treasury(), before);
    assert_contract_err!(s.client.try_get_channel(&4), Error::ChannelNotFound);
}

#[test]
fn withdraw_requires_owner() {
    let (s, _) = funded();
    let attacker = Address::generate(&s.env);

    assert_fails!(s.try_withdraw_as(&attacker, units(1)));
    s.env.set_auths(&[]);
    assert_fails!(s.client.try_withdraw_available(&units(1)));

    assert_eq!(s.client.get_treasury().available, units(10));
    assert_eq!(s.balance(&attacker), 0);
}

#[test]
fn owner_auth_is_bound_to_exact_arguments() {
    let (s, _) = funded();
    // Owner authorized withdrawing 1 unit; the call asks for 10.
    let invoke = MockAuthInvoke {
        contract: &s.contract,
        fn_name: "withdraw_available",
        args: (units(1),).into_val(&s.env),
        sub_invokes: &[],
    };
    let res = s
        .client
        .mock_auths(&[MockAuth {
            address: &s.owner,
            invoke: &invoke,
        }])
        .try_withdraw_available(&units(10));
    assert_fails!(res);
    assert_eq!(s.client.get_treasury().available, units(10));
}

#[test]
fn redeem_batch_is_permissionless_but_pays_only_stored_provider() {
    let (s, ch) = funded();
    let v = s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(5));
    // No authorization of any kind is supplied by the submitter.
    s.env.set_auths(&[]);
    assert_eq!(s.client.redeem_batch(&s.batch(&[v])), units(5));
    assert_eq!(s.balance(&ch.providers[0]), units(5));
}

#[test]
fn channel_provider_and_signer_are_immutable() {
    let (s, ch) = funded();
    let before = s.client.get_channel(&ch.ids[0]);
    // Redemption and further owner actions never rewrite provider or signer.
    s.client
        .redeem_batch(&s.batch(&[s.voucher(ch.ids[0], &ch.providers[0], &ch.agents[0], units(1))]));
    s.withdraw(units(1));
    s.open(&Address::generate(&s.env), &Agent::numbered(42), units(1));
    let after = s.client.get_channel(&ch.ids[0]);
    assert_eq!(after.provider, before.provider);
    assert_eq!(after.signer, before.signer);
    assert_eq!(after.owner, before.owner);
    assert_eq!(after.allocation, before.allocation);
}
