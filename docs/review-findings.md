# Second Internal Review — Findings and Fixes

**Date:** 2026-10-25. **Scope:** contract, voucher package, Testnet tooling and
CI, documentation. **Type:** internal review in four separate passes; **not an
independent external audit.**

**Baseline reviewed:** commit `0bf42eb` (WASM `f915e248…`).
**Result after fixes:** WASM `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04`,
66 contract tests and 93 TypeScript tests passing, and a new Testnet run with
all 34 checks passing ([`SCF_POC_EVIDENCE.md`](../SCF_POC_EVIDENCE.md)).

| Pass | Area | Findings | Highest severity |
|---|---|---:|---|
| A | Soroban contract and its tests | 9 | Low |
| B | Voucher cryptography and TypeScript package | 13 | **High** |
| C | Testnet demo, build and CI | 17 | Medium |
| D | Documentation accuracy against code and evidence | 17 | High (wording) |
| E | Evidence gap: channel isolation shown only in tests | 1 | Medium |
| F | Issues found while implementing the fixes | 6 | Medium |

Status key: **Fixed** (code or docs changed, with a regression test where
applicable), **Accepted** (deliberate, documented), **Open** (deferred,
documented).

---

## B. Voucher cryptography and TypeScript package

| ID | Sev. | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| B-1 | **High** | The off-chain verifier accepted signatures the contract rejects. `Keypair.verify` uses a cofactored Ed25519 check; the Soroban host uses ed25519-dalek `verify_strict` (cofactorless; rejects small-order `R` and `A`). A voucher with a torsion component in `R`, or any voucher on a channel registered with a mixed-order key, was accepted off-chain but unredeemable. Because the store keeps only the highest voucher, accepting one replaced the last redeemable claim. | New `verifyStrict` implements the host's rule exactly: canonical `s < L`, decodable non-small-order `R` and `A`, cofactorless `encode([s]B − [k]A) == R`. It is the only verifier used for vouchers. `isSafeSignerKey` makes providers refuse channels whose key is not a prime-order point (`unsafe-signer-key`). | 4 Rust-generated invalid vectors (mixed-order `R`, small-order `R`, non-canonical `s`, mixed-order signer key). Rust asserts dalek `verify_strict` and the Soroban host reject each; TypeScript asserts the verifier rejects each, and that a generic cofactored verifier would have accepted 3 of them. | Fixed |
| B-2 | Medium | The voucher store was keyed by channel ID only. Channel IDs repeat across deployments, so one store shared by two contracts lost claims. | Stores are bound to one `{networkPassphrase, contract}` scope, written into the file. `ProviderVerifier` refuses a store for another deployment; loading a file for another deployment throws. | `refuses a store written for another deployment`, `validates its configuration and the store's deployment` | Fixed |
| B-3 | Medium | `FileVoucherStore` failed open. A missing file silently reset to empty, duplicate records let the last one win, malformed signatures and negative amounts loaded, and nothing was fsynced. | Strict schema validation (decimal strings, 128-hex signatures, positive amounts, unique channels). A missing file is an error unless `{ create: true }`. Writes fsync the temp file, rename, then fsync the directory. | `fails closed when the file is missing…`, `refuses malformed or duplicate records` | Fixed |
| B-4 | Low | `MemoryVoucherStore` stored and returned the caller's object, so mutating a voucher after `put` changed the accepted claim. | Copies on `put`, `get` and `all`. | `stores copies, so callers cannot mutate accepted vouchers` | Fixed |
| B-5 | Low | `accept` allowed a zero or negative price. | Throws `RangeError` for `price ≤ 0`. | `refuses a non-positive price` | Fixed |
| B-6 | Low | `ChannelSpender` accepted a negative or over-allocation starting amount. | Validates `0 ≤ alreadyAuthorized ≤ allocation` and `allocation > 0`; documents that the starting amount must be the highest amount ever signed. Persisting the agent counter across restarts is left to production. | `validates its starting state` | Fixed (persistence Open) |
| B-7 | Low | `assertTrustedDeployment` matched malformed pinned values (e.g. two empty strings). | Requires a 64-hex hash and a `C…` token address. Checking the issuer's flags remains a documented assumption. | `rejects malformed pinned values instead of matching them` | Fixed |
| B-8 | Low | The encoder accepted addresses the contract cannot produce (a `G…` contract, muxed `M…` addresses), and configuration mistakes surfaced as `bad-signature`. | `contract` must be `C…`; `owner` and `provider` must be `G…` or `C…`. `ProviderVerifier` validates its configuration at construction and throws. | `encoder input validation` (4 tests), `validates its configuration…` | Fixed |
| B-9 | Low | Provider tests signed over `verifier.context()` itself, so a bug there could not be detected. | The agent's context is built independently; a test asserts the two are equal. | `builds the same context the agent signs over` | Fixed |
| B-10 | Low | The key-order test decoded the Rust vector, not the TypeScript encoder's output. | Decodes `encodeVoucherMessage(...)`. | `encodes map keys in ascending order (TypeScript encoder output)` | Fixed |
| B-11 | Low | Vector gaps: `channel_id` as a JSON number, no contract-address provider, no negative amounts, no Ed25519 edge cases, no store-corruption tests. | `channel_id` is a string. Added a contract-address provider channel, `-1` and `i128::MIN` encodings, u64-max encoder test, invalid signature vectors, and store, owner, price and spender tests. | vectors 10 valid + 4 invalid; `provider.test.ts` | Fixed |
| B-12 | Info | One failing voucher reverts a mixed batch. | Same as audit A-2: atomicity is required by the specification. | — | Accepted |
| B-13 | Info | `verifyVoucherSignature` did not state its verification rule. | Documented as the host's `verify_strict` rule. | — | Fixed |

## A. Soroban contract and its tests

No High or Medium contract defect was found. Mutation testing confirmed that the
archival replay-protection test detects a switch to temporary storage.

| ID | Sev. | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| A-1 | Low | Constructor and WASM tests read a prebuilt artifact that `cargo test` does not rebuild, so they could pass against stale code. | A test fails if any contract source is newer than the WASM; `make test-contracts` builds first; CI builds the deployed artifact before testing. | `wasm_artifact_is_newer_than_contract_sources` | Fixed |
| A-2 | Low | No test checked any event. | Exact-match tests for `Deposited`, `ChannelOpened`, `Withdrawn`, `VoucherRedeemed` and `BatchRedeemed`, and that a failed batch emits none. | `test::events` (3 tests) | Fixed |
| A-3 | Low | Token validation only checked `decimals()`. A fee-on-transfer token would credit more than arrived and break solvency. | `deposit` compares the contract's balance before and after the transfer and fails with `TransferMismatch` (113) unless it rose by exactly `amount`. | `deposit_credits_only_what_arrives` (fee-charging mock token) | Fixed |
| A-4 | Low | `assert_fails!` accepted any failure, so a wrong failure (a contract error, a budget overrun) passed signature and authorization tests. | Requires a host-level failure (`Err(Err(_))`); contract error codes no longer satisfy it. Substitution tests also assert that no state or balance changed. Token failures use a new `assert_token_err!` with the exact SAC code. | all `vouchers.rs`, `batch.rs` and `auth.rs` negative tests | Fixed (revealed F-1) |
| A-5 | Info | `deposit_requires_owner` survived removal of `deposit`'s `require_auth` (mutation test). | Added a case where the owner authorizes only the nested token transfer; it succeeds if and only if `deposit` lacks `require_auth`. | `deposit_requires_owner` | Fixed |
| A-6 | Info | `constructor_rejects_non_contract_token` passed on any panic; the `token == owner` and `token == contract` branches were unreachable. | Expected panic message pinned; unreachable branches removed. | `constructor_rejects_non_contract_token` | Fixed |
| A-7 | Info | Comments said `mock_all_auths` is never used; `unaccounted_balance` and solvency were described as unconditional. | Comments name the two uses; `unaccounted_balance` can be negative under issuer clawback; solvency is conditional on issuer powers. | — | Fixed |
| A-8 | Info | `Channel.owner` duplicates `Config.owner`. | Kept: the specification (§4.3) requires each channel to record the treasury owner. | — | Accepted |
| A-9 | Low | Opening a channel used the threshold extension, so on a network whose minimum persistent TTL exceeds 7 days a new channel would not reach 30 days. | `create_channel` always extends a new entry to `TTL_EXTEND_TO`. | `new_channel_gets_full_ttl_even_above_network_minimum` (mutation-verified) | Fixed |

## C. Testnet demo, build and CI

The reviewer confirmed independently that both deployed contracts' on-chain
WASM matched the manifest, that all 18 recorded transactions existed with the
recorded fees, and that a clean rebuild at another path with the release
stellar-cli 26.0.0 reproduced the hash.

| ID | Sev. | Finding | Fix | Status |
|---|---|---|---|---|
| C-1 | Medium | `make all` failed on a fresh clone: typecheck ran before `@agentbatch/voucher` was built, and nothing ran `pnpm install`. | `install` target; `all: install fmt-check build lint test`; `lint` builds the voucher package first. | Fixed |
| C-2 | Medium | `pnpm demo:testnet` never built the contract and could deploy a stale or unoptimized WASM; a missing WASM was detected only after transactions had been sent. | The script runs `stellar contract build --optimize` first; the CLI reads the WASM before any transaction. | Fixed |
| C-3 | Low | CI's WASM tests ran on the unoptimized `cargo build`, not the deployed artifact. | One CI job installs the pinned CLI, builds the deployed artifact, checks its hash against the manifest, then runs all tests on it with `--locked`. | Fixed |
| C-4 | Low | Two checks could not fail: "0 on-chain transactions" and "no payout after replay" (replays were only simulated). | The first is reported as a submission counter. Attacks and replay are now **submitted on-chain** and recorded as FAILED transactions with their error codes, and balances are read after those transactions were applied. Every rejection in the evidence records its method (`simulateTransaction` or `sendTransaction`). | Fixed |
| C-5 | Low | The "cross-provider" check rewrote the channel ID, so it tested tampering, not cross-channel replay. Only `!ok` was asserted. | Provider A's unchanged voucher is shown to provider B and must fail with `channel-mismatch`; all three expected reasons are asserted. | Fixed |
| C-6 | Low | The benchmark JSON called all figures "transaction results read back via RPC", but the resources are simulation-declared limits and envelope sizes are computed locally. | Metrics are grouped as `declared`, `charged` and local `envelopeBytes`, and the source text says so. | Fixed |
| C-7 | Low | Tool versions in the evidence were hardcoded or read from the wrong place. | soroban-sdk from `Cargo.lock`; `@stellar/stellar-sdk` from the installed package. | Fixed |
| C-8 | Low | `engines` said `>=22`, but dependencies require `>=22.12.0`. | `>=22.12.0` and `engine-strict=true`. | Fixed |
| C-9 | Low | `soroban-sdk = "27.0.6"` was a caret range, and no cargo command used `--locked`. | `=27.0.6`; `--locked` in CI and the Makefile. | Fixed |
| C-10 | Low | Unfiltered Dependabot would open PRs that break the pinned WASM hash, and Node type majors beyond the runtime. | Ignores `soroban-sdk` and `@types/node` majors; groups Stellar packages. | Fixed |
| C-11 | Low | Actions were pinned by tag. | Pinned by commit SHA (major tag kept as a comment). | Fixed |
| C-12 | Info | The previous evidence run reused existing trustlines, SAC and code. | Trustlines step labeled idempotent; the first upload of the deployed WASM is recorded in the evidence report. | Fixed |
| C-13 | Low | `rustup show` no longer installs the pinned toolchain in recent rustup. | `rustup toolchain install`. | Fixed |
| C-14 | Low | Bare `catch` blocks treated any RPC error as "account missing" or "SAC missing"; friendbot returned before RPC saw new accounts. | Only "not found" or `SimulationFailed` is handled; funding polls until the account is visible. | Fixed |
| C-15 | Low | A poll timeout could leave a transaction that lands later, and a re-run would duplicate it. | Polls for 120 s; a still-unknown outcome is reported with its hash and the run stops. | Fixed |
| C-16 | Info | The provider's pinned hash is computed from the WASM just uploaded, so the check cannot fail during the demo. | The pinned value is the hash of the locally built, reviewed WASM; the observed value is the code fetched from the chain. The failure paths are unit-tested. Documented. | Accepted |
| C-17 | Info | Evidence becomes hard to verify once RPC history expires or Testnet resets. | Raw base64 envelope, result, meta and diagnostic events of every transaction are archived in `evidence.json`. | Fixed |

## D. Documentation accuracy

All transaction hashes, ledgers, fees, addresses and benchmark percentages in
the previous documents matched the evidence. The findings were wording and
detail errors.

| ID | Sev. | Finding | Fix | Status |
|---|---|---|---|---|
| D-1 | High | Code comment called the contract "audited". | "reviewed". | Fixed |
| D-2 | High | The WASM upload row showed a no-op re-upload (42,154 stroops) as the upload cost. | Labeled as not representative; the real first upload is now recorded (2,309,084,577 stroops at current Testnet rates). | Fixed |
| D-3 | Medium | Claimed the coordinator drops failing entries; it aborts. | Corrected. | Fixed |
| D-4 | Medium | Claimed `mock_all_auths` is never used. | States the two uses, neither in a negative authorization test. | Fixed |
| D-5 | Medium | Claimed channel TTL is extended on every redemption. | Extended only below the 7-day threshold. | Fixed |
| D-6 | Medium | Overstated the per-provider saving using the AgentBatchPoC deployment cost. | States that a per-provider channel contract was not measured. | Fixed |
| D-7 | Medium | Cited Testnet for isolation properties shown only in tests. | Corrected, and closed by E-1. | Fixed |
| D-8 | Medium | "AI agents pay three providers" without saying they are simulated. | "Simulated AI agents… simulated API providers". | Fixed |
| D-9 | Low | Attributed allocation enforcement to `AgentSigner`. | Only `ChannelSpender` enforces it. | Fixed |
| D-10 | Low | "Every addition and subtraction is checked" included views. | State-changing functions only. | Fixed |
| D-11 | Low | "Fully payable" omitted the token-transfer condition. | Added. | Fixed |
| D-12 | Low | Attributed the deposit's rent to the contract's TTL policy. | It is the new SAC balance entry. | Fixed |
| D-13 | Low | The after-setup state was checked but not stored in the evidence. | Stored (`demo.afterSetup`). | Fixed |
| D-14 | Low | "Pin exact versions" while soroban-sdk was a caret range. | See C-9. | Fixed |
| D-15 | Low | "Addressed (CI check)" for a job that had never run. | "CI job defined, not yet run". | Fixed |
| D-16 | Low | The spec review was described as pre-implementation only. | Re-described. | Fixed |
| D-17 | Low | Cited a test module path that does not exist for the WASM scenario. | Correct test names. | Fixed |

## E. Evidence gap

| ID | Sev. | Finding | Fix | Status |
|---|---|---|---|---|
| E-1 | Medium | "Independent virtual channels" was only partly demonstrated on Testnet: the isolation guarantees were proven in the test suite, but none was attempted on-chain. | The Testnet run now records each channel's `DataKey::Channel(id)` ledger entry under the one treasury contract. It attempts over-allocation and reserved-collateral withdrawal (rejected, `#102`), and submits on-chain a voucher above its channel's allocation (FAILED, `#110`) and a voucher replayed on another provider's channel (FAILED, `Crypto/InvalidInput`). It also performs a real `withdraw_available` limited to the unallocated 10 AUSD, after which 1 more base unit is rejected (`#102`). | Fixed |

## F. Found while implementing the fixes

| ID | Sev. | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| F-1 | Medium | Contract error codes collided with Stellar Asset Contract error codes. A SAC `BalanceError` (10) inside a batch surfaced as this contract's `ExceedsAllocation` (10), and `BalanceDeauthorizedError` (11) as `ArithmeticOverflow` (11). A coordinator could not tell a frozen provider from an overflow. Found when A-4 made the tests stricter. | Contract errors renumbered 101–113. Tests assert the exact SAC code for token failures. | `invalid_deposits_rejected` (SAC 10), `failed_asset_transfer_reverts_whole_batch` (SAC 11) | Fixed |
| F-2 | Medium | Every state-changing call extended the **shared WASM code entry** as well as the instance (`instance().extend_ttl`), so every deployment paid 30 days of rent for 17 KB of code. At current Testnet rent rates, which rise with total Soroban state size, deploying fresh code cost 8,783,023,303 stroops, more than a transaction's 32-bit fee field allows. | `extend_instance` uses `extend_ttl_for_contract_instance`. The code entry is maintained separately with `ExtendFootprintTTLOp` and is restored automatically if archived. A deployment now costs 52,060,710 stroops. | `calls_extend_instance_but_not_shared_code` (fails on the old code) | Fixed |
| F-3 | Info | Any constructor failure surfaces to a deploying contract as `Error(Context, InvalidAction)`, so that code alone does not prove an authorization failure. | Constructor authorization tests are documented as differential: identical to a passing control except for the authorization supplied. | `auth::constructor_*` | Fixed |
| F-4 | Low | A store file containing `null` threw an opaque `TypeError`. | Explicit "not a version 1 voucher store" error. | `refuses malformed or duplicate records` | Fixed |
| F-5 | Info | A load-balanced RPC node intermittently answered "account not found" for a live account, aborting a run. | Bounded retry when loading accounts that must exist. | Testnet run | Fixed |
| F-6 | Info | Process note: while verifying a tooling fix, the demo was started unintentionally. It sent five Testnet transactions (an idempotent trustline update, a 200 AUSD issuance, a no-op code upload, and two contract deployments, `24094553…` and `9ec8cd4d…`) and then stopped. No deposits, channels or payments were made; the two contracts are empty and unused. | Recorded here for transparency. Not part of the evidence. | — | Recorded |

## Still open after this review

- **Batch liveness:** one failing voucher reverts the whole batch (required by the specification).
- **RPC trust:** providers trust their RPC endpoint for channel state.
- **Agent keys:** proof of possession at `open_channel` is grant scope; providers already refuse unsafe keys off-chain.
- **Locked funds:** unredeemed collateral and unsolicited tokens are locked, since closure is grant scope.
- **Issuer powers:** solvency depends on the asset issuer's freeze and clawback powers.
- **Concurrency:** agent counters are not persisted, and provider stores are not concurrency-safe.
- **CI not yet run:** the `contracts` CI job, including the reproducibility check, has not run, because the repository has no remote yet.
