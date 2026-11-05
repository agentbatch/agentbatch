# Second Internal Review — Findings and Fixes

**Date:** 2026-10-25. **Scope:** contract, voucher package, Testnet tooling and
CI, documentation. **Type:** internal review in four separate passes; **not an
independent external audit.**

**Baseline reviewed:** commit `0bf42eb` (WASM `f915e248…`).
**Result after fixes:** WASM `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04`,
66 contract tests and 93 TypeScript tests passing, and a new Testnet run with
all 34 checks passing ([archived Testnet records](../deployments/testnet/evidence.json)).

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

The original reviewer checked both deployed contracts' on-chain WASM against
the manifest and reproduced the hash with a clean build at another path using
stellar-cli 26.0.0. The subsequent follow-up PoC review reconfirmed all 22
transactions in the current evidence run (19 successful and 3 failed), including
their fees, through public Testnet RPC and Horizon. The earlier reference to
18 transactions described an older review baseline.

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
- **Agent keys:** proof of possession at `open_channel` is future protocol work; providers already refuse unsafe keys off-chain.
- **Locked funds:** unredeemed collateral and unsolicited tokens are locked, since closure is future protocol work.
- **Issuer powers:** solvency depends on the asset issuer's freeze and clawback powers.
- **Concurrency:** agent counters are not persisted, and provider stores are not concurrency-safe.
- **Hosted CI:** check [GitHub Actions](https://github.com/agentbatch/agentbatch/actions) for results on the published revision; local validation is recorded separately.

## PoC audit follow-up — 2026-10-25

The subsequent internal review of `fe23cb8` verified the core PoC on public
Testnet and identified four remaining provider or documentation findings.
The following changes address those findings without changing the contract,
voucher format, dependencies, or the historical deployment records. This is
remediation verification, not an independent external security audit.

| Finding | Severity | Correction | Regression evidence | Status |
|---|---|---|---|---|
| AB-M01: the demo silently recreated a missing provider store | Medium | Ordinary `SimulatedProvider` construction reopens an existing store and fails if it is missing. Fresh deployment setup explicitly sets `createStore: true`; file provisioning uses exclusive creation and refuses an existing path. | `provider storage lifecycle`: first-time provisioning, ordinary restart replay refusal, and missing-store refusal after an accepted unredeemed voucher; file-store exclusive provisioning test | Fixed |
| AB-L01: stored voucher integers allowed wrong JSON types and exceeded contract bounds | Low | Require canonical decimal strings; channel IDs must be in `1..=u64::MAX`, amounts in `1..=i128::MAX`. Memory-store writes enforce the same bounds. | Numeric, rounded-number, null, object, array, zero, leading-zero and overflow file cases; memory-store bounds; maximum-value round trip | Fixed |
| AB-L02: pinned contract code and channel reads could use different clients | Low | Reject a different client contract or chain connection before any RPC call; check the network passphrase; validate the returned channel ID and provider before publishing synchronized state. | `provider deployment binding`: wrong contract, connection, network, code, token, channel and provider; successful requests need no per-request RPC | Fixed |
| AB-I01: the review's 18-transaction count was ambiguous | Informational | Distinguish the earlier review baseline from the current evidence run's 22 transactions (19 successful, 3 failed). | Current manifest/evidence inspection and the preceding public RPC/Horizon reconciliation | Fixed |

Reopening an existing provider must omit `createStore`. Explicit provisioning
is only for a channel that has never served a request. If accepted-voucher
history is lost, recover it before resuming service: the on-chain redeemed
amount cannot reconstruct outstanding unredeemed claims. The PoC still assumes
one sequential provider process and one sequential agent signer per channel;
distributed persistence and durable agent counters remain disclosed production
work.

Validation commands:

```bash
pnpm --filter @agentbatch/voucher build
pnpm typecheck
pnpm test
stellar contract build --optimize
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

The regression suite contains 113 voucher-package tests and 11 demo-provider
tests (124 TypeScript tests in total); the contract suite contains 66 tests.
The optimized contract remains 17,001 bytes with SHA-256
`ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04`.

The committed [original Testnet archive](../deployments/testnet/evidence.json)
contains the transaction envelopes, results and metadata used by the offline
verifier. Fresh reproduction writes separate run directories.

## Repository structure validation — 2026-10-25

Operational code now lives in `tools/testnet`; reusable voucher code remains in
`packages/voucher`. The standalone `tools/evidence` workspace validates public
records without deployment code or private keys. `examples/offline-payments`
demonstrates the library without network access. See the [Testnet tooling](../tools/testnet/README.md) for commands.

New Testnet runs reserve unique directories and use isolated disposable keys
and provider state. Artifact writes refuse existing paths, completion is marked
last, and interrupted runs are excluded from automatic archive discovery.
An optional local run index selects another reviewed archive explicitly. Live verification
writes only to a new optional destination and never refreshes an archive in place.

Run `pnpm check` to reproduce format, Clippy, type checking, contract and
TypeScript tests, offline archive checks and the offline example. The contract
suite contains 66 tests. Additional tests cover provider persistence, deployment
binding, write-once runs, archive selection and tamper rejection.

## Architecture and documentation review — 2026-11-05

### Scope and evidence

This is an internal architecture/documentation review of the working tree based
on `8744bfb`. It is **not an independent external security audit**, a new Testnet
execution, or a production certification. Historical sections above retain their
original context and counts. The primary architecture explains the target system;
this section owns review findings, corrections, checks and limitations.

Reviewed the contract entry points, types, storage, events, crypto and all Rust
test modules; voucher implementation/tests; deployment, provider, settlement,
benchmark and archive tooling/tests; manifests/raw XDR; root and component docs;
lockfiles, build configuration, CI, dependency policy, license and contribution
metadata. Current claims are grounded in source and local reproducible checks.
Proposed behavior is explicitly separated and its missing implementation retained
as release requirements. No source/contract behavior, key, historical deployment
identity, archived measurement or original license was replaced.

Pre-existing untracked documentation/evidence was inspected as local context,
excluded from the intended source export and left byte-for-byte unchanged.
The maintained release documentation is reachable from the tracked README.
New supporting documents and package license/README are intentional additions;
they must be included in any eventual release source. A future tracked-only
commit cannot omit them while retaining links and packaging references to them.
No commit, staging or push is part of this review.

### Findings and corrections

Severity describes the consequence of relying on incomplete or inaccurate
production documentation; it does not imply a newly discovered exploitable PoC
contract defect. “Documented” closes the documentation gap, not its implementation
or operational release gate.

| ID | Severity | Finding | Correction / owner document | Remaining requirement |
|---|---|---|---|---|
| DOC-01 | High | The primary architecture described only the PoC and deferred essentially all completed-product behavior. | Replaced with coherent full design, implementation matrix, topology, trust boundaries and ordered release gates in [architecture](architecture.md). | Implement and validate the proposed product before production admission. |
| DOC-02 | High | Safe release/rotation and aggregate budget semantics were underspecified, allowing designs that free reserved claims or replenish a spending cap on redemption. | Fixed ledger-boundary closure, replacement channels, monotonic IDs, release accounting and spent+reserved budget invariants; aligned [vision](vision.md) and [accounting](accounting-invariants.md). | Choose/fund a measured claim window, implement guards and independent models/tests. |
| DOC-03 | High | “Before closure” voucher eligibility could imply a signature-issuance time the wire format does not contain. | Explicitly honor any valid cumulative claim through D, including post-close signatures; document compromised-key exposure and late-claim loss. Proposed production domain uses a separately frozen specification. | Provider/watchtower monitoring, deadline drills and new vectors. |
| DOC-04 | Medium | Automatic restoration wording omitted prepared restoration data/resources and could imply the demo recovers archived dependencies. | Qualified protocol behavior, dependency inventory and separate restoration/re-simulation; disclosed the runner's restore-preamble abort and native-test limitation. | Actual end-to-end restore/TTL/funding tests and keeper implementation. |
| DOC-05 | Medium | Source, fee payer, owner authorization and voucher signing were insufficiently separated for sponsored wallet flows. | Exact auth-tree, custom-account, credential-version, source/fee-bump and wallet-return verification requirements in architecture and [SDK](sdk.md). | Wallet capability matrix and actual enforced-auth fixtures. |
| DOC-06 | Medium | Retry/confirmation design did not cover duplicate submissions, included failure costs, expired signatures or ambiguous economic outcomes. | Durable intent/envelope state machine, source leases, hash reconciliation and per-channel stale-race recovery; disclosed current runner behavior. | Implement crash-safe submission and archive-backed outcome reconciliation. |
| DOC-07 | Medium | No production discovery/history/retention design supported the planned Console or safe scheduling. | Justified indexer, schemas, event identities, transactional checkpoints, raw archive, gap/replay/reconciliation, APIs and migration policy. | Select qualified feed/archive providers and implement completeness/freshness controls. |
| DOC-08 | Medium | Seven decimals and current numeric error separation could be mistaken for general token safety or global error provenance. | Exact issuer/SAC admission, trustline/C-balance restrictions, admin/issuer controls, outbound assumptions, conditional solvency and contextual error decoding. | Admit actual production asset and monitor issuer/holder state. |
| DOC-09 | Medium | The existing library could be mistaken for a browser/production SDK; acceptance/counter recovery was incomplete for concurrent operation. | Documented Node imports/current exports and designed browser separation, generated bindings, typed errors, durable CAS/dedup/outbox and highest-ever-signed counters. | Implement transactional APIs; do not use sequential PoC stores for concurrent service. |
| DOC-10 | Medium | Governance, ownership, succession, service objectives, incident/backup duties and release artifacts lacked actionable requirements. | Added [maintenance](maintenance.md), [operations](production-operations.md), [conduct](../CODE_OF_CONDUCT.md), and revised contribution/security policy without inventing owners. | Actual appointments, hosting controls, funding, recovery objectives and qualified independent assessment. |
| DOC-11 | Medium | The voucher tarball contained dist/package metadata but no license or usage guide; source maps referred to excluded src files. | Added an exact copy of root LICENSE and package README; packaging includes matching src. No dependency/runtime change. | Recheck artifact contents, third-party obligations and provenance on each release; package remains private. |
| DOC-12 | Low | Exact verifier equivalence and “views cannot trap” wording overstated source behavior; accounting wording obscured available-fund debits. | Verifier acceptance is a stricter subset; dependency calls can fail; only deposit credits available in the PoC. Corrected wire/security/accounting references. | Preserve negative vectors and qualify new host versions. |
| DOC-13 | Low | Current versus historical counts/versions/CI observations, function count and architecture navigation were ambiguous. | Marked first report historical, corrected eight-entry-point inventory, pinned CLI baseline and README links; kept old measurements and identities. | Hosted CI results and old live deployment availability were not re-verified here. |
| DOC-14 | Medium | Private reporting/response wording promised a hosting route and timing without verified configuration or responders. | SECURITY now makes availability explicit, gives a nonsensitive channel-establishment fallback and separates acknowledgment target from guarantee; issue metadata aligned. | Enable/test a monitored confidential route and appoint primary/backup responders. |

### Stellar reference verification

Official references were consulted on 5 November 2026. They are living documents;
linking them does not pin the target network's configuration. Production admission
must capture the actual protocol/RPC/SDK/wallet matrix and resource settings.
The repository remains pinned to Rust 1.94.1, SDK 27.0.6, host 27.0.1 in Cargo.lock,
JS SDK 17.2.1 and CLI 26.0.0. Installed pinned SDK/host source was also checked for
instance-only TTL, Ed25519 `verify_strict`, and built-in error values 1–15.

| Topic | Authoritative reference | Verified distinction |
|---|---|---|
| Authorization | [Host authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization), [signing guide](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations), [SDK protocol-27 migration](https://stellar.github.io/js-stellar-sdk/migration/protocol-27-soroban-auth/) | Exact invocation trees and credential/signature format; envelope and voucher signatures remain distinct. |
| Fee sponsorship | [Fee-bump guide](https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions) | Outer payer sponsors fees; does not supply treasury-owner authorization. |
| Finality/submission | [SCP](https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol), [sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | Ledger execution under consensus safety differs from RPC enqueueing and endpoint trust. |
| Asset controls | [SAC](https://developers.stellar.org/docs/tokens/stellar-asset-contract), [CAP-46-6](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-06.md), [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) | Account trustlines versus contract balances, issuer/admin powers, interface versus trusted asset behavior. |
| Archival | [State archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival), [CAP-66](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md), [simulation](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction) | Prepared automatic restoration, resource fees/limits and separate preamble handling; read simulation does not persist recovery. |
| Limits/fees | [Metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering) | Network-governed resource dimensions and XLM costs; historical measurements are not current fee constants. |
| RPC history | [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents), [getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction), [getHealth](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth) | Bounded provider-configurable history; actual oldest/latest ledger coverage must be observed. |
| Ecosystem compatibility | [Stellar MPP](https://github.com/stellar/stellar-mpp-sdk), [one-way channel](https://github.com/stellar-experimental/one-way-channel), [x402 exact specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md) | References/integration targets, not existing AgentBatch adapters or equivalent wire formats. |
| Networks/bindings | [Networks](https://developers.stellar.org/docs/networks), [official bindings](https://stellar.github.io/js-stellar-sdk/reference/contracts-bindings/) | Testnet resets/funding differ from production; generated ABI does not establish trusted deployment identity. |

The version-specific docs.rs page was unavailable through the documentation
reader; the pinned locally installed official crate sources supplied the relevant
SDK checks instead. No latest-version upgrade or current live Testnet protocol
claim is inferred from a historical manifest or from web examples.

### Validation

- `pnpm check` passed in the working repository: formatting, Clippy with warnings
  denied, workspace type checking, optimized-WASM contract tests (66 passed),
  TypeScript workspace suites, offline evidence checks and offline example.
  Local optional archives were also checked by that command; they are not part
  of the distributable source baseline.
- An isolated temporary source export included the intended tracked working-tree
  files and explicit new documentation/package additions, excluding all pre-existing
  untracked files, private state, dependencies and build outputs. Frozen offline
  dependency installation (with scripts disabled) succeeded using cached packages.
- `pnpm build` in that export succeeded. Its independently rebuilt optimized WASM
  is 17,001 bytes and reproduces
  `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04`.
  Exported lockfiles match the repository inputs.
- Exported `pnpm test:ts`, explicit original-archive offline check and
  `pnpm example:offline` passed without the optional local index or extra archives.
  The original archive contains 22 transactions: 19 success and 3 intentional
  failures; the check confirms payout/fee consistency, not network authentication.
- Actual recorded batch metadata was decoded to confirm documented event topic
  names and payout ordering. Signature and TTL implementation claims were checked
  against source and existing native/WASM tests.
- The corrected packed voucher artifact has 27 files: generated JS/types/maps,
  matching src, package metadata, LICENSE and README. License bytes match the
  unchanged root; all map source paths resolve inside the tarball; no test,
  private-state or deployment directories are shipped.
- A separate consumer installed the corrected tarball offline using a writable
  temporary dependency store, outside the repository. Its TypeScript declaration
  check and the complete offline payment example passed against packed exports;
  the proposed SDK interface example also typechecked. The first install attempt
  hit the read-only shared cache; the temporary-store retry succeeded without
  changing that cache or weakening permissions.
- Local documentation links/anchors, table structure, fenced blocks, explicit deployment IDs,
  financial transition arithmetic, package exports and whitespace were checked
  against the intended export (25 Markdown documents, 119 local links/anchors,
  21 fenced blocks at the final check). The three Mermaid diagrams were reviewed for
  syntax/semantics; no graphical renderer was available for visual rendering.

### Remaining limitations and production gates

No Testnet/Mainnet transaction was submitted, deployment restored, live historical
transaction re-authenticated, hosted CI checked, private-reporting control enabled,
package published or release signed. No production load/failover measurement or
external audit was performed. Official reference links were consulted; historical
explorer availability and every external hosting control were not certified.

The production contract lifecycle/budgets, transaction service, transactional
provider/signer storage, Console, generated SDK, indexer, jobs, APIs and adapters
remain unimplemented. Proposed policies still need actual owners, claim-window
and recovery/freshness numbers, hosting/signing/archive configuration, funded
operations, independent review and demonstrated acceptance. Packaging changes do
not remove those gates or make the private package a supported release.

Pre-existing untracked `docs/README.md` and `docs/development.md` still refer to a
local PoC-only documentation inventory and optional evidence paths. They were
preserved, not silently adopted into the release; reconcile their scope/links
before separately authorizing their inclusion. The pre-existing untracked evidence
report/run files remain local historical context, not dependencies of the revised
release documentation or package. Earlier review sections remain dated evidence;
the primary architecture contains no review-history commentary.

## Adversarial architecture follow-up — 2026-11-06

### Scope and disposition

This internal follow-up audits the architecture and its supporting SDK, lifecycle,
security, decision and operational references as they stood after the 5 November
review. It preserves that review and the earlier historical reports. It is not
an independent external security audit or a certification of production code.
Severity below applies to implementing or operating the proposed design as
written; it is not a claim that the limited PoC exposes every described path.

**Result:** two High, five Medium and one Low documentation/design findings.
Their owning documents have been corrected. The revised design remains
conditional on implementation, protocol fixtures, target-network tests and the
previously recorded production acceptance gates. No runtime code, contract ABI,
asset, deployment manifest, dependency or release artifact was changed in this
follow-up. Changes to proposed interfaces are specifications, not implemented APIs.

### Findings, counterexamples and corrections

| ID | Severity | Finding / counterexample | Correction | Disposition |
|---|---|---|---|---|
| ARC-01 | High | Closure text promised eligibility for a claim “submitted before the deadline.” An RPC accepts it at D, but it executes at D+1 or fails at D. The provider can lose its claim despite satisfying that wording. | [Architecture lifecycle](architecture.md#protected-closure-and-signer-replacement) now requires successful execution in ledger ≤ D, distinguishes enqueue/simulation/signing from execution and preserves finalize only at > D. Vision, wire reference, ADR and runbook agree. | Wording corrected; D−1/D/D+1 execution and failure/retry tests remain implementation gates. |
| ARC-02 | High | Retry recovery could be read as permitting a new owner grant once its original envelope expired or source sequence was consumed. A separately signed owner auth entry may remain valid in another envelope, so old and new grants can both execute a deposit/open/withdraw. A failed call may also roll nonce consumption back. | [Authorization rules](architecture.md#transaction-source-payer-and-authorizers) now track every issued credential's authorizer/nonce/invocation/expiry independently, reconcile all envelope attempts, and forbid fresh grants for an unresolved economic intent until old authority is consumed with reconciled effects or past expiry with complete outcome coverage. SDK, Console and runbook expose outstanding grants after disconnect. | Design corrected; no on-chain administrative idempotency mechanism is implemented or claimed. |
| ARC-03 | Medium | The voucher does not bind service body, quote, request ID or delivery identity. An undefined “authenticated request” could be implemented as a bearer voucher or signed-request replay, disclosing a result or serving the wrong client. Request IDs alone do not authenticate retrieval. | [Service protocol](architecture.md#authenticated-service-requests) specifies a separate signed request binding quote/body/voucher/client-certificate hashes, authenticated TLS client matching on all delivery/retrieval paths, scoped deduplication and trusted proxy identity propagation. Payment wire bytes remain unchanged. | Design requirements specified; canonical quote encoding, shared vectors, certificate admission/rotation and adapter tests remain required. |
| ARC-04 | Medium | Caller-supplied budget IDs and a loosely specified new “budget period” permitted mismatched agent/provider subjects or duplicate budgets that undermine a lifetime subject cap. | Resolve canonical `(kind, subject)` budget keys inside channel creation, require one budget per subject, immutable channel association and matching kinds/subjects; `set_budget` updates cap in place without resetting counters. The initial version excludes epochs/deletion/recreation. | Proposed ABI and schema corrected; cap guarantees cover registered identities, not inferred real-world processes. Enrollment of another identity is explicitly new owner authority. |
| ARC-05 | Medium | Database leases/fencing were presented without their network-authority limit. A stale worker can still broadcast a previously released signed envelope after its lease expires. | Signer/broadcaster check the current fence, retain all released attempts, and quarantine unresolved intents through failover. Lease expiry never cancels signed envelopes or portable grants. | Scheduling/recovery design corrected; split-brain and stale-broadcast exercises required. |
| ARC-06 | Medium | Reconciliation lacked a common-ledger condition. Summing channels across changing RPC snapshots and comparing a later treasury balance can falsely indicate a deficit or suggest an invalid repair. | Require ledger/hash-aligned replay snapshots, external SAC changes and explicit inconclusive status when consistency is unavailable. Do not assume ordinary `getLedgerEntries` can select a historical ledger. Runbook and alert semantics aligned. | Design corrected; qualified metadata coverage and reconciliation implementation remain required. |
| ARC-07 | Medium | Generic G-account/i128 wording omitted the narrower classic i64 bounds and issuer exception. An issuer has no self-trustline and a payment to it retires units rather than crediting an ordinary holder. | Asset section specifies non-issuer trustlines, i64 amount/headroom constraints and issuer behavior. Proposed production admission rejects issuer-as-provider; the PoC's lack of that restriction is explicit. SAC is identified as built-in host code without its own uploaded WASM entry. | Source/reference claims corrected; asset/holder boundary fixtures remain release requirements. |
| ARC-08 | Low | The voucher section attributed signing to the contract, and wallet-return instructions could imply reading a network field out of envelope XDR. | Attribute signing to the agent and verification to the contract; compute/verify transaction hashes and signatures using the configured passphrase, which is not an envelope field. | Corrected in the primary architecture. |

### Source and reference checks

The entry-point/storage/type implementations, provider verifier/signer, transaction
runner and affected tests were rechecked. Existing source has no closure/budget
or production service-authentication path, so the proposed guards cannot be
validated by claiming those PoC tests implement them.

Official [RPC submission documentation](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction)
was rechecked: queue admission does not report final execution. The
[authorization reference](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
and [signing guide](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)
were checked for signed invocation/nonces versus transaction source. The
[entry-read reference](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries)
was checked for current-state reads and observation-ledger fields. The
[asset specification](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-06.md)
and pinned host balance code supplied the classic/contract balance distinction;
[archival documentation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
was also checked. References were consulted on 6 November 2026; provider behavior
and target-network versions still require release-time qualification.

Pinned source observations: `soroban-env-host` 27.0.1 `auth.rs` constructs the
address-based signature preimage from network, invocation, nonce, expiration and
(for v2) authorizer address, not transaction source/sequence/time bounds. Its
`verify_and_consume_nonce` rejects only when current ledger > expiration, and
its rollback code explicitly permits nonce consumption to be undone on root-call
failure. Installed JS SDK 17.2.1 comments describe expiration as exclusive, while
its signing implementation preserves the supplied value. The design conservatively
treats E as still valid and requires E+1 plus target-network boundary verification
before declaring expiry. This discrepancy is not resolved by assuming a web or
SDK comment overrides the pinned host. A remote tagged host-source URL was not
available to the reader; the lockfile-resolved official crate source was inspected
locally instead.

### Validation and limitations

- An offline SDK probe constructed one signed address-v2 owner authorization and
  embedded it unchanged in two envelopes with different source accounts, sequences
  and time bounds. Envelope hashes differed; the credential XDR and authorization
  digest stayed identical, and the owner's signature verified. This demonstrates
  encoding/signature portability; it does not submit either envelope, simulate
  resources or prove network execution/expiry behavior.
- `pnpm typecheck` and `pnpm --filter @agentbatch/voucher test` passed
  (113 tests) for source/interface and encoding compatibility. Documentation local
  links/anchors, table shape, fenced blocks, proposed request-key ordering and
  whitespace were checked against an explicit source export excluding pre-existing
  untracked local evidence/documentation: 25 Markdown documents, 125 local
  links/anchors, 21 fenced blocks, three manually reviewed Mermaid diagrams, and
  all 11 proposed request-map keys in canonical order passed the applicable
  structural checks. `git diff --check` passed.
- Accounting release arithmetic and the D execution boundary were reviewed with
  adversarial traces; no production lifecycle implementation exists to test.
  The prior 66-test native/WASM run remains dated 5 November evidence and was not
  rerun for this documentation-only follow-up. No new production performance,
  independent external audit, graphical diagram render or live-network result
  is claimed.
- Previous changes and original local untracked files were preserved. No staging,
  commit, push, contract deployment or hosted-service change was performed.

Remaining gates include numerical claim/recovery/freshness objectives, actual
owners/funding/hosting, independent implementation review, portable-auth execution
and expiry/rollback tests, canonical request/quote conformance, concurrent budget
invariants, consistent archive replay and stale-worker recovery. Correcting the
design does not implement these controls or make the project production-ready.
