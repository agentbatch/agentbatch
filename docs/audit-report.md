# Internal Security Review — AgentBatch PoC

> **Superseded.** This first review covers WASM `f915e248…`. The second review
> ([`review-findings.md`](review-findings.md)) found further issues, including
> one High in the off-chain verifier, and the current code and evidence
> (WASM `ab37537a…`) reflect its fixes. Error codes cited below predate the
> renumbering to 101–113 (e.g. `#9` is now `#109`).

This is the project team's internal review, done after the implementation was
complete. **It is not an independent external audit.** Severity reflects
impact in the PoC context (Testnet, test assets, a single owner).

Reviewed revision: contract WASM SHA-256
`f915e248eca5ab71ab87ae1fb4341d3951415b36cbc4e8ad90777b57c3c87863`.

| ID | Pass | Severity | Title | Status |
|---|---|---|---|---|
| A-1 | Contract | Medium | Constructor authorization tests were vacuous | Fixed (tests) |
| A-2 | Contract | Low | One failing voucher blocks the whole batch | Accepted (design) |
| A-3 | Contract | Low | Provider without an authorized trustline cannot be paid | Accepted, documented |
| A-4 | Contract | Low | Signer key validity is not proven at `open_channel` | Open, deferred |
| A-5 | Contract | Info | Permissionless `redeem_batch` cannot redirect funds | Verified |
| A-6 | Contract | Info | Effects before interactions; no reentrancy | Verified |
| A-7 | Contract | Info | Replay protection survives archival | Verified |
| B-1 | Crypto | Medium | Providers trusted channel data from any contract | Fixed |
| B-2 | Crypto | Low | Provider depends on an honest RPC | Open, documented |
| B-3 | Crypto | Info | Domain separation, context binding, cross-language parity | Verified |
| B-4 | Crypto | Info | No cross-protocol signature confusion; malleability irrelevant | Verified |
| C-1 | Economic | Info | Invariants hold under randomized adversarial sequences | Verified |
| C-2 | Economic | Low | Unredeemed collateral and unsolicited tokens are locked | Accepted (PoC scope) |
| C-3 | Economic | Low | Solvency depends on the asset issuer's powers | Documented |
| C-4 | Economic | Info | Concurrency in provider and agent state | Documented |
| C-5 | Economic | Info | Rent dominates setup cost | Documented |
| D-1 | Integration | Low | Evidence over-counted on-chain transactions during simulation | Fixed |
| D-2 | Integration | Info | Deployed WASM must be reproducible from source | Addressed (reproduced locally; CI job defined, not yet run) |
| D-3 | Integration | Info | Benchmark claims | Verified |
| D-4 | Integration | Info | Originality relative to the one-way channel | Assessed |

## Audit A — Soroban contract security

**A-1 Constructor authorization tests were vacuous (Medium, fixed).**
The first constructor tests deployed the contract with `Env::register_at`,
which always runs the constructor in recording-auth mode. "Missing owner
authorization" therefore *succeeded*, and the tests asserting failure caught
it. The contract code was correct (`owner.require_auth()`), but the suite did
not prove it.
*Fix:* constructor authorization is now tested by deploying the compiled WASM
through `deployer().with_current_contract(salt).deploy_v2(..)` from a test
factory contract, the same way it is deployed on-chain.
*Regression tests:* `auth::constructor_without_owner_auth_fails`,
`auth::constructor_with_other_address_auth_fails`,
`auth::constructor_succeeds_when_owner_authorizes` (control).

**A-2 One failing voucher blocks the whole batch (Low, accepted).** Atomicity
means a stale voucher (for example, one already settled by a provider acting
alone) or an invalid voucher reverts every payout in the batch. No funds are at
risk, but settlement for honest providers is delayed. The demo coordinator
simulates before it submits and aborts if simulation fails. Dropping failing
entries, or a best-effort mode, is future work.
*Tests:* `stale_last_voucher_reverts_whole_batch`,
`invalid_last_signature_reverts_whole_batch`.

**A-3 Provider without an authorized trustline (Low, accepted).** A SAC
transfer to a G-account without an authorized trustline fails, and so does
any batch that includes that provider. `open_channel` does not check this.
Checking would need SAC-specific calls and would not cover a later
deauthorization anyway.
*Test:* `failed_asset_transfer_reverts_whole_batch` (issuer deauthorizes
provider C; providers A and B receive nothing; state unchanged).

**A-4 Signer key validity is not proven (Low, deferred).** Only the all-zero
key is rejected. The owner could register a key that no agent controls, or a
weak point. The impact is limited to the owner's own channel (vouchers become
unforgeable or forgeable only toward the bound provider). A production
`open_channel` should require proof of possession: a signature by the new key
over a registration message.

**A-5 Permissionless `redeem_batch` (Info, verified).** Payout recipients are
read from channel storage, and the voucher carries only `channel_id`,
`amount` and `signature`. A third party can only trigger payment of an amount
the agent signed to the provider the owner registered.
*Tests:* `redeem_batch_is_permissionless_but_pays_only_stored_provider`,
`wrong_provider_rejected`.

**A-6 Effects before interactions (Info, verified).** `redeem_batch` validates
all vouchers and writes all accounting before it makes any token transfer. The
token is fixed at construction, and the Soroban host forbids re-entering a
contract.

**A-7 Replay protection survives archival (Info, verified).** `redeemed` is
held in persistent storage, which is archived rather than deleted.
Temporary storage would have allowed replay after expiry.
*Test:* `archived_channel_restores_with_full_state`.

Also checked: owner-only mutations bound to exact arguments
(`owner_auth_is_bound_to_exact_arguments`); invalid configuration (zero or
negative allocation, zero signer, provider equal to the contract, owner or
token); over-allocation; i128 overflow (`deposit_overflow_rejected`);
negative and `i128::MIN` voucher amounts; duplicate channels; batch bounds.

## Audit B — Cryptographic security

**B-1 Providers trusted channel data from any contract (Medium, fixed).** The
provider read `get_channel` from whatever contract address it was given. A
look-alike contract can return any allocation and signer, accept vouchers, and
never pay. A real deployment paying in a worthless token is just as bad.
*Fix:* `assertTrustedDeployment` in `@agentbatch/voucher`. Before trusting
channel data, the demo provider fetches the contract's WASM via RPC, hashes
it, and compares the hash and the treasury token against pinned values.
*Regression tests:* `assertTrustedDeployment › rejects a contract running
different code`, `› rejects a treasury paying in another token`; the Testnet
run performs the check for all three providers.

**B-2 Provider depends on an honest RPC (Low, open).** Simulation results are
not authenticated. A dishonest RPC could overstate an allocation, and the
provider would then accept vouchers that the contract rejects as
`ExceedsAllocation`. Mitigation: a self-hosted RPC or cross-checking several.

**B-3 Binding and parity (Info, verified).** The message binds domain,
network, contract, owner, channel, provider, signer and amount. The contract
derives the network and contract from the environment and the rest from
storage. Rust-generated vectors (7 cases, including an i128 high-word amount)
are reproduced byte for byte by the TypeScript encoder and signer, and the
deployed contract's `voucher_message` matched local bytes on Testnet.
*Tests:* `vouchers.rs` (15 rejection tests), `vectors.test.ts` (39 tests).

**B-4 Cross-protocol confusion and malleability (Info, verified).** The
signed message is a 412-byte XDR `ScMap` starting with a map discriminant.
Stellar transaction signatures and Soroban authorization signatures cover
32-byte SHA-256 hashes, so a voucher cannot be valid as either. Agent keys are
not account signers. Replay protection depends on the cumulative amount, not
on signature uniqueness, so signature malleability gives an attacker nothing.

## Audit C — Economic correctness

**C-1 Invariants (Info, verified).** A model-based randomized test (5 seeds ×
250 steps) mixes deposits, channel openings, batches of valid, stale and
over-ceiling vouchers, withdrawals and unsolicited transfers. After every step
it compares contract state with an independent model, asserts I1–I5, checks
that failed steps changed nothing, and checks that no provider in a failed
batch was paid. On Testnet, conservation and solvency were checked after each
settlement.

**C-2 Locked funds (Low, accepted).** There is no close, reallocation or
sweep, so unredeemed allocations and unsolicited tokens stay in the contract.
This is intended for the PoC; closure with a challenge period is future protocol work.

**C-3 Issuer powers (Low, documented).** Freezing or clawback by the issuer
can block payouts or reduce the balance below liabilities. Contract accounting
stays correct, but solvency against the real balance then depends on the
issuer.

**C-4 Concurrency (Info, documented).** The provider store and agent counter
are sequential in the PoC. Production needs compare-and-set semantics, or two
requests could be accepted against the same previous amount.

**C-5 Rent dominates setup (Info, documented).** Opening a channel on Testnet
cost about 0.89–1.04 XLM, almost all of it rent for the 30-day TTL extension.
Settlement paid no rent. `TTL_EXTEND_TO` is a tunable trade-off.

## Audit D — Stellar integration and execution evidence

**D-1 Evidence over-counted on-chain transactions (Low, fixed).** The evidence
field `onchainTransactionsDuringSimulation` was computed after settlement and
so included the two settlement transactions. The live check, made during the
simulation, was correct. *Fix:* the value is captured when the check runs. The
evidence was regenerated by a full new Testnet run, and it records 0.

**D-2 Build reproducibility (Info, addressed; CI job not yet run).** The deployed WASM is built
with `stellar contract build --optimize` (CLI 26.0.0, rustc 1.94.1, SDK
27.0.6). Rebuilding locally, including after a clean build, reproduced SHA-256
`f915e248…`. The `contracts` CI job installs the pinned CLI release,
rebuilds, and fails unless the hash equals `contract.wasmHash` in
`deployments/testnet/manifest.json`. This lets anyone check the deployed code
against the source. The `contracts` CI job still uses plain `cargo build` for
the WASM tests, which produces different, unoptimized bytes.

**D-3 Benchmark claims (Info, verified).** The batch of three cost 32.2% less
in fees than three single redemptions from equal starting states, not 66%.
Each voucher still needs its own signature verification and token transfer.

**D-4 Originality (Info, assessed).** Ed25519 cumulative commitments and their
XDR encoding come from Stellar's one-way channel and MPP work, and AgentBatch
reuses that convention on purpose. What this PoC demonstrates beyond it is:
one contract and one deposit funding several provider channels, with explicit
per-channel reservations from a shared pool; channels as storage records
rather than deployments (avoiding one contract deployment per provider; an
AgentBatchPoC deployment cost about 11.8M stroops on this run against
8.9–10.4M for a channel entry, and a per-provider channel contract was not
measured); and atomic settlement of several independent channels
in one transaction. Batching is not netting: every provider receives its own
transfer.

## Re-run results after fixes

- `cargo test --workspace`: 59 passed.
- `pnpm test`: 52 passed.
- `pnpm demo:testnet`: all 20 checks passed; evidence regenerated.
