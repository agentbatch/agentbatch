# Future work register

This register preserves every unresolved finding and every planned capability
needed to turn the Testnet proof of concept into the platform described in
[ARCHITECTURE.md](ARCHITECTURE.md). Items are grouped by area. Each one states
its priority, status, affected component, proposed resolution, dependencies and
measurable acceptance criteria.

- **Priority:** Critical (blocks admitting funds of value), High (required for a
  production release), Medium (required for a complete product or materially
  reduces risk), Low (improvement).
- **Status:** Planned (specified, not started), Research (design open), Blocked
  (waiting on a decision, owner or prerequisite outside engineering), Deferred
  (deliberately postponed).
- **Origin** traces each item to the review or document that raised it:
  [review findings](review-findings.md) (historical sections),
  [this review](repository-review.md) (`RR-` IDs), or the
  [production specification](production-specification.md).

Nothing in this register is implemented unless its row says so.

Areas:
[Core architecture](#core-architecture) ·
[Treasury](#treasury-infrastructure) ·
[Channels](#payment-channels) ·
[Vouchers](#voucher-protocol) ·
[Batch settlement](#batch-settlement) ·
[Security](#security-hardening) ·
[Providers](#provider-integrations) ·
[SDKs and APIs](#sdks-and-apis) ·
[Operations](#monitoring-and-operations) ·
[Performance](#performance-and-scalability) ·
[Testing](#testing-and-verification) ·
[Developer experience](#developer-experience) ·
[Documentation](#documentation) ·
[Research](#research-and-optional-extensions)

## Core architecture

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-arch-01"></a>FW-ARCH-01 | Freeze the production contract (v2) ABI | High | Planned | Treasury contract v2 | The PoC ABI has no lifecycle, budgets or versioned events. Production needs a frozen interface before SDKs, Console and adapters are built. | Specify and review the v2 ABI, `AGENTBATCH_V1` domain and versioned events in [specification §4](production-specification.md#4-production-contract-and-lifecycle-design); generate bindings. | FW-TRE-01, FW-CH-01, FW-CH-04, FW-VP-01, FW-CH-05 | Reviewed ABI/spec document; every conservation transition and deadline boundary reviewed; generated bindings compile; no open design questions | Specification §12 stage 1 |
| <a id="fw-arch-02"></a>FW-ARCH-02 | Multi-organization deployment topology and catalog | Medium | Planned | Deployment tooling | One treasury per organization and asset is implemented per contract, but there is no catalog mapping verified releases to deployments. | Deployment catalog with no fund authority; owner-authorized construction; release manifest per deployment ([ADR-001](decisions.md#adr-001-isolate-treasury-custody-per-organization-and-asset)). | FW-DOC-04 | Catalog lists deployments with verified code hash and constructor state; cannot move or authorize funds; tested with ≥ 2 organizations | Specification §2 |
| <a id="fw-arch-03"></a>FW-ARCH-03 | Cross-treasury budgets and policy | Low | Research | Policy layer | A local budget does not span several treasuries of the same organization. | Research an on-chain policy design that preserves per-treasury custody isolation. | FW-TRE-01 | Written design with conservation proof across treasuries, or a documented decision not to support it | Specification §2, ADR-001 |

## Treasury infrastructure

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-tre-01"></a>FW-TRE-01 | Aggregate agent and provider budgets | Critical | Planned | Treasury contract v2 | Limits are per channel only. Several channels, or key rotation, multiply an agent's or provider's effective cap. | One lifetime budget per `(kind, subject)`; `spent + reserved ≤ cap`; payouts move reserved to spent; caps cannot drop below `spent + reserved` ([ADR-002](decisions.md#adr-002-reserve-worst-case-claims-and-cumulative-budget-exposure)). | FW-ARCH-01 | Randomized independent model covers budgets; no sequence of opens, top-ups, payouts, rotations or closures exceeds a cap; duplicate subjects rejected | Review findings DOC-02, ARC-04 |
| <a id="fw-tre-02"></a>FW-TRE-02 | Asset admission records | High | Planned | Deployment, SDK | The constructor checks only `decimals() == 7`, which a look-alike contract can satisfy. The PoC also allows the issuer as a provider. | Admission record binding network, code, issuer, SAC ID, decimals and observed issuer controls; reject issuer-as-provider in v2 and clients. | FW-ARCH-01 | Clients refuse any treasury whose token is not an admitted SAC; v2 `open_channel` rejects the issuer; fixtures cover G and C holders and i64 trustline headroom | DOC-08, ARC-07 |
| <a id="fw-tre-03"></a>FW-TRE-03 | Outbound transfer checks for non-SAC assets | Low | Deferred | Treasury contract | Withdrawal and redemption assume exact outgoing transfers; only deposits are balance-checked. Safe for the SAC; not for arbitrary SEP-41 tokens. | Keep production restricted to admitted SACs; if other tokens are ever supported, add outgoing balance checks and behavioral review. | FW-TRE-02 | Documented decision; if implemented, tests with a fee-charging token on every outflow | Specification §6 |
| <a id="fw-tre-04"></a>FW-TRE-04 | Unsolicited token (surplus) policy | Low | Deferred | Treasury contract | Tokens sent directly to the treasury are never credited and cannot be recovered. | Specify a sweep that can only move `B − (A + R)` to the owner, never reserved funds. | FW-ARCH-01 | Sweep cannot reduce `A + R`; randomized test with unsolicited transfers and clawbacks | Review findings "Locked funds" |
| <a id="fw-tre-05"></a>FW-TRE-05 | Deficit (clawback) incident handling | Medium | Planned | Indexer, operations | Issuer clawback can make `B < A + R`; the contract cannot prevent it, and nothing monitors it. | Alert on negative `unaccounted_balance`; runbook for issuer coordination; never mark claims paid from an insufficient balance. | FW-OPS-01, FW-OPS-04 | Alert fires in a test with a simulated clawback; runbook exercised | Specification §6; security assumption 4 |
| <a id="fw-tre-06"></a>FW-TRE-06 | Version and configuration view | Low | Planned | Treasury contract v2 | Clients identify the PoC's version only by WASM hash; there is no `get_config` view. | Add a `get_config` view returning protocol version, domain, asset, owner and claim window. | FW-ARCH-01 | View returns constructor values; SDK checks the version before signing | Specification §4 |

## Payment channels

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-ch-01"></a>FW-CH-01 | Protected channel closure | Critical | Planned | Treasury contract v2 | There is no closure: unused reservations are locked forever, and compromised keys cannot be retired. | Open → Closing → Closed with immutable window `W`. Claims execute in ledger ≤ `D = L + W`; `finalize_close` releases `a − r − l` exactly once after `D` ([ADR-003](decisions.md#adr-003-protect-closure-through-a-fixed-ledger-deadline)). | FW-ARCH-01, FW-CH-05 | Tests at D−1, D and D+1, concurrent redeem/finalize, repeated start/finalize; release exactly once; conservation identities with release term hold | Review findings "Locked funds"; DOC-02, DOC-03, ARC-01 |
| <a id="fw-ch-02"></a>FW-CH-02 | Allocation top-up | Medium | Planned | Treasury contract v2 | Allocations are fixed at opening. | `increase_allocation` while Open, checked against `A` and both budgets; no decrease before finalization. | FW-TRE-01 | Top-up moves exactly `x` from `A` to `R`; rejected when Closing or over budget | Specification §4 |
| <a id="fw-ch-03"></a>FW-CH-03 | Signer replacement through replacement channels | High | Planned | Treasury contract v2, SDK | Signer keys are immutable. A rotated key must not cancel claims under the old key. | Open a new channel with the new key; close the old one under the claim window. | FW-CH-01, FW-TRE-01 | Old claims stay redeemable until `D`; new exposure needs fresh `A` and budget headroom | ADR-003 |
| <a id="fw-ch-04"></a>FW-CH-04 | On-chain agent-key proof of possession and safety | High | Planned | Treasury contract v2 | The contract rejects only the all-zero key. An owner can register an unsafe or unpossessed key; providers refuse unsafe keys off-chain only. | Domain-separated signature by the new key over network, contract, agent identity and arguments at opening; reject non-canonical keys. | FW-ARCH-01 | Opening fails without a valid proof; vectors shared with TypeScript | Second review A-4 |
| <a id="fw-ch-05"></a>FW-CH-05 | Numerical claim window and recovery objectives | High | Blocked | Operations, contract v2 | `W` must exceed monitoring lag, outage recovery, restoration and submission margin. No value is chosen. | Measure lag and recovery in drills; publish `W` with its derivation ([production-operations.md](production-operations.md)). | Named operators (FW-OPS-05) | Published `W` with the safety relation satisfied by measured drill results | Specification §4, §12 |
| <a id="fw-ch-06"></a>FW-CH-06 | Terminal records and ID non-reuse across archival | Medium | Planned | Treasury contract v2 | Closed channels must stay terminal even after archival and restoration. | Persistent terminal record; IDs from a monotonic counter; restoration never recreates an Open channel. | FW-CH-01 | Restored terminal channel rejects vouchers; IDs never reused in randomized tests | Specification §4 |

## Voucher protocol

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-vp-01"></a>FW-VP-01 | Freeze the `AGENTBATCH_V1` domain and vectors | High | Planned | Contract v2, voucher package | The production domain is specified but not frozen; v1 vouchers must not redeem on v2 deployments. | Freeze the eight-field payload with the new domain; generate shared valid and host-rejected vectors. | FW-ARCH-01 | Rust and TypeScript reproduce all v2 vectors byte for byte; v1 vouchers fail on v2 | Specification §5 |
| <a id="fw-vp-02"></a>FW-VP-02 | Authenticated service-request protocol | High | Planned | Provider adapter | The voucher authorizes payment, not a request. A stolen voucher must not buy service or a result. | Signed request binding body, quote, voucher, request ID and client certificate; mutual TLS; scoped deduplication ([specification](production-specification.md#authenticated-service-requests)). | FW-VP-03 | Replay on another client fails; identical retry returns the same receipt; conflicting retry rejected | ARC-03 |
| <a id="fw-vp-03"></a>FW-VP-03 | Canonical quote encoding | Medium | Planned | Provider adapter | Quotes are hashed into requests but have no canonical encoding. | Define canonical quote XDR and vectors. | — | Shared vectors; ambiguous routing rejected | ARC-03 |
| <a id="fw-vp-04"></a>FW-VP-04 | Re-qualify strict verification on host or library upgrades | Medium | Planned | Voucher package, CI | Off-chain acceptance must never be wider than the host's `verify_strict`. A host or `@noble/ed25519` change could alter that. | Run the shared host-rejected vectors in both languages on every dependency update (Dependabot PRs included). | — | CI fails if any host-rejected vector is accepted off-chain | Second review B-1; DOC-12 |
| <a id="fw-vp-05"></a>FW-VP-05 | Optional voucher expiry | Low | Research | Voucher protocol | v1 vouchers carry no expiry; validity ends only with channel closure. | Evaluate an expiry field against provider risk and the closure window. | FW-CH-01 | Decision record with threat analysis | This review (RR-03 context) |

## Batch settlement

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-bs-01"></a>FW-BS-01 | Settlement coordinator service | High | Planned | Coordinator | Batching logic exists only inside the Testnet runner, which stops on any simulation failure. | Service that leases candidates per channel, simulates, quarantines failing candidates, re-simulates the rest and prioritizes deadlines ([ADR-004](decisions.md#adr-004-preserve-atomic-settlement-and-offer-provider-self-submission)). | FW-OPS-01, FW-SDK-02 | One frozen provider or stale voucher never blocks other providers' settlement beyond one retry; deadline-near claims settle first | Review findings "Batch liveness"; B-12 |
| <a id="fw-bs-02"></a>FW-BS-02 | Refresh `redeemed` before including a voucher | Medium | Planned | Coordinator, provider library | A provider's cached `redeemed` can be lower than on-chain after a direct redemption. A voucher at or below the real value is already paid, but makes the batch revert. | Read `get_channel` just before building a batch; drop candidates with `amount ≤ redeemed` as already settled. | FW-BS-01 | Test: agent self-redeems, provider then submits a lower voucher; coordinator excludes it and the batch succeeds | This review RR-04 |
| <a id="fw-bs-03"></a>FW-BS-03 | Qualify the maximum batch size | Medium | Planned | Contract, benchmarks | `MAX_BATCH_SIZE = 4` is a conservative choice. Linear projection from measured data suggests write entries would bound it near 99. | Measure n = 1…N with cold and restored dependencies, G and C recipients and maximum-size events; set the cap from the worst case with margin. | FW-PERF-02 | Published worst-case table; cap justified by measurement; tests at the cap | This review RR-11 |
| <a id="fw-bs-04"></a>FW-BS-04 | Best-effort batch mode | Low | Research | Contract | Atomicity lets one bad voucher revert the batch. | Evaluate per-voucher error isolation against the atomicity guarantee. | FW-BS-01 | Decision record | B-12 |
| <a id="fw-bs-05"></a>FW-BS-05 | Aggregate transfers to the same provider | Low | Research | Contract | Two channels to the same provider in one batch produce two transfers. | Evaluate summing per-provider payouts before transfer. | FW-BS-03 | Measured saving and unchanged events/accounting | This review |

## Security hardening

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-sec-01"></a>FW-SEC-01 | Independent external security assessment | Critical | Blocked | All | Only internal reviews have been performed. | Engage a qualified independent assessor on the v2 contract and services; remediate. | FW-ARCH-01 and implementation | Published report; all Critical/High findings fixed or accepted with rationale | Every review section |
| <a id="fw-sec-02"></a>FW-SEC-02 | Mutation testing of authorization guards in CI | Medium | Planned | Contract tests | Guard-removal mutations were run manually in reviews, not continuously. | Add a mutation job (removed `require_auth`, removed bounds) that must fail the suite. | — | CI job fails on every listed mutation | Second review A-5 |
| <a id="fw-sec-03"></a>FW-SEC-03 | Fuzz and property tests for XDR and integer boundaries | Medium | Planned | Contract, voucher package | Encoding and bounds are covered by vectors and fixed cases only. | Property tests for i128/u64 boundaries and XDR round trips in Rust and TypeScript. | — | Fuzz targets run in CI for a fixed budget without findings | Specification §12 |
| <a id="fw-sec-04"></a>FW-SEC-04 | RPC trust reduction | Medium | Planned | Provider library, SDK | Providers trust one RPC for channel state; a dishonest RPC can make them over-serve. | Corroborate allocation and signer from independent endpoints or a self-hosted node before admitting a channel. | — | Provider refuses a channel when endpoints disagree | Review findings "RPC trust" |
| <a id="fw-sec-05"></a>FW-SEC-05 | Owner-key protection | High | Planned | Owner wallet policy | A compromised owner can withdraw `A` and allocate it to an attacker-controlled provider. | Require threshold or contract-account owners with policy; separate funding from administration. | — | Documented wallet policy; tests with a contract-account owner | Specification §2 |
| <a id="fw-sec-06"></a>FW-SEC-06 | Confidential vulnerability reporting route | High | Blocked | Governance | Private reporting is not verified as enabled; no responders are named. | Enable and test a monitored route; appoint primary and backup responders. | Maintainer appointment | Test report received and acknowledged within target | DOC-14 |
| <a id="fw-sec-07"></a>FW-SEC-07 | Portable owner-authorization reconciliation | High | Planned | SDK, Console | Signed owner credentials stay valid in other envelopes; retries could execute an administrative action twice. | Track every issued credential's nonce and expiry; forbid fresh grants for an unresolved intent ([specification](production-specification.md#transaction-source-payer-and-authorizers)). | FW-SDK-04 | Target-network tests for expiry at E vs E+1 and failed-call nonce rollback | ARC-02 |
| <a id="fw-sec-08"></a>FW-SEC-08 | Repository and release supply-chain controls | Medium | Blocked | Hosting | Branch protection, required reviews, signing and secret scanning are policy only. | Configure hosting controls; sign releases; record provenance. | Maintainer appointment | Controls verified in repository settings; signed release artifact | DOC-10 |

## Provider integrations

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-prv-01"></a>FW-PRV-01 | Transactional provider acceptance journal | Critical | Planned | Provider service | The file store supports one sequential writer. Concurrent requests could both be accepted against the same previous amount. | Database transaction or compare-and-set per `(deployment, channel)`; request deduplication; receipt and outbox before serving. | — | Concurrency test: N parallel requests never credit more than the voucher increments; crash after acknowledgment loses nothing | Review findings "Concurrency"; DOC-09 |
| <a id="fw-prv-02"></a>FW-PRV-02 | Provider state backup and recovery | High | Planned | Provider service | On-chain `redeemed` cannot rebuild unredeemed claims; losing the store loses them. | Synchronous replicated journal; zero loss of acknowledged claims. | FW-PRV-01 | Restore drill recovers every acknowledged voucher | AB-M01 follow-up; operations runbook |
| <a id="fw-prv-03"></a>FW-PRV-03 | Closing-state monitoring and self-submission | High | Planned | Provider service | With closure, providers must stop serving and redeem before `D`. | Watch channel state with bounded freshness; independent submission path. | FW-CH-01, FW-OPS-03 | Claims execute in ledger ≤ D in drills with coordinator outage | ADR-003 |
| <a id="fw-prv-04"></a>FW-PRV-04 | MPP adapter | Medium | Planned | Adapter | No MPP integration exists; MPP channel commitments are not AgentBatch vouchers. | Adapter pinned to a specific MPP SDK revision, mapping its flows onto treasury channels. | FW-SDK-01, FW-VP-02 | Interoperability tests against the pinned MPP version | Vision; specification §11 |
| <a id="fw-prv-05"></a>FW-PRV-05 | x402 deferred-settlement adapter | Medium | Planned | Adapter | x402 `exact` settles per payment; AgentBatch needs a distinct deferred scheme. | Specify and implement a deferred-settlement scheme; never report a voucher as an `exact` transfer. | FW-SDK-01, FW-VP-02 | Conformance tests; unknown scheme versions fail closed | Specification §11 |

## SDKs and APIs

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-sdk-01"></a>FW-SDK-01 | Browser-safe core package | High | Planned | SDK | The voucher package imports Node `fs` and `crypto`, so its root entry cannot run in a browser. | Split encoding/verification core from Node persistence. | — | Core builds for browser targets; Node store in a separate entry | DOC-09; [sdk.md](sdk.md) |
| <a id="fw-sdk-02"></a>FW-SDK-02 | Generated contract bindings and typed errors | High | Planned | SDK | The only contract client is hand-written inside the Testnet tool. | Generate bindings from the v2 spec; typed errors that keep contract context. | FW-ARCH-01 | Bindings match the deployed spec; error decoding distinguishes contract and SAC codes | Specification §9 |
| <a id="fw-sdk-03"></a>FW-SDK-03 | Durable agent signer counter | Critical | Planned | Signer service | `ChannelSpender` is memory-only. After a restart from `redeemed` it re-signs amounts providers already hold. | Persist the highest-ever-signed amount with a single writer or CAS before releasing a voucher. | — | Crash at any point never produces two vouchers with the same cumulative amount for different requests | B-6; DOC-09 |
| <a id="fw-sdk-04"></a>FW-SDK-04 | Wallet authorization and transaction state machine | High | Planned | SDK, Console | The runner signs as the source account; production needs wallet-collected auth and durable intents. | Implement the [transaction state machine](production-specification.md#production-transaction-state-machine). | FW-SDK-02 | Crash and timeout tests never repeat an economic action | DOC-05, DOC-06 |
| <a id="fw-sdk-05"></a>FW-SDK-05 | Read and settlement API | Medium | Planned | API | No hosted API exists. | Versioned API with OpenAPI schema, idempotent settlement submission and freshness metadata. | FW-OPS-01 | Published schema; idempotency and freshness tests | Specification §10 |
| <a id="fw-sdk-06"></a>FW-SDK-06 | Exact amount parser | Medium | Planned | SDK | The demo's `ausd(number)` helper rounds floats. | Decimal-string parser rejecting more than 7 decimals and out-of-range values. | — | Property tests; no floating-point path | [sdk.md](sdk.md#exact-amounts-and-existing-example) |
| <a id="fw-sdk-07"></a>FW-SDK-07 | Package publication policy | Low | Blocked | Packaging | All packages are private. | Decide publication, versioning and support; publish signed packages. | FW-SEC-08 | Published package with provenance, or a documented decision to stay private | [maintenance.md](maintenance.md) |

## Monitoring and operations

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-ops-01"></a>FW-OPS-01 | Indexer and raw archive | High | Planned | Data services | No history, discovery or export exists beyond RPC retention; billing integration is unspecified. | Event ingestion with checkpoints and gap detection; immutable raw archive; export interface for billing systems. | Feed provider selection | Replay rebuilds projections; retention gaps reported, never skipped | DOC-07 |
| <a id="fw-ops-02"></a>FW-OPS-02 | TTL and restoration keeper | High | Planned | Keeper | The contract never extends the shared code entry, and no keeper exists; archived dependencies need prepared restoration. | Inventory all dependencies (code, instance, channels, SAC balances); extend in bounded chunks; restore and re-simulate. | Funding, FW-OPS-05 | No dependency falls below its margin in a soak test; restoration drill passes | Second review F-2; DOC-04 |
| <a id="fw-ops-03"></a>FW-OPS-03 | Deadline and claim watcher | High | Planned | Keeper | Closure deadlines need monitoring for providers and coordinators. | Watcher with bounded freshness and alerting. | FW-CH-01 | Alert before `D − margin` in drills | ADR-003 |
| <a id="fw-ops-04"></a>FW-OPS-04 | Common-ledger reconciliation | Medium | Planned | Indexer | Comparing channel sums and balances across different ledgers produces false deficits. | Reconcile at one ledger from replayed metadata; mark inconclusive otherwise. | FW-OPS-01 | Reconciliation reports a ledger and hash; inconclusive states are explicit | ARC-06 |
| <a id="fw-ops-05"></a>FW-OPS-05 | Service owners and objectives | High | Blocked | Operations | No named operators, RPO/RTO or freshness objectives. | Appoint owners; publish objectives derived from the claim window. | Organizational decision | Published objectives; drills meet them | DOC-10 |
| <a id="fw-ops-06"></a>FW-OPS-06 | Testnet reset handling | Low | Planned | Tooling | Testnet resets reuse the passphrase and deterministic asset IDs. | Generation labels, fresh salts and keys after reset; archive old evidence unchanged. | — | Runner refuses mixing generations | Specification §7 |
| <a id="fw-ops-07"></a>FW-OPS-07 | Treasury Console | Medium | Planned | Console | No administration UI exists. | Implement the Console journeys in [specification §9](production-specification.md#9-treasury-console-and-sdk), accessibility included. | FW-SDK-02, FW-SDK-04, FW-SDK-05 | Journeys pass keyboard and screen-reader tests; signed-plan verification | Specification §9 |

## Performance and scalability

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-perf-01"></a>FW-PERF-01 | Full lifecycle cost per paid request | Medium | Planned | Benchmarks | Only settlement of one archived three-voucher workload is measured. | Measure deposit, open, rent, settlement, closure and withdrawal per paid request, including operator overhead. | FW-CH-01 | Published results with raw evidence | Specification §12 |
| <a id="fw-perf-02"></a>FW-PERF-02 | Repeatable benchmark matrix | Medium | Planned | Benchmarks | One run, one workload; no latency percentiles or variance. | n = 1…4 (then the qualified cap), first and repeated payouts, cold/restored dependencies, G and C recipients; repeated runs. | — | Matrix with variance and network versions recorded | Specification §12 |
| <a id="fw-perf-03"></a>FW-PERF-03 | Rent volatility and TTL tuning | Medium | Planned | Contract config, keeper | Testnet rent varied more than 4× within hours; `TTL_EXTEND_TO` is a fixed 30 days. | Model rent against state size; choose TTL constants per network with keeper support. | FW-OPS-02 | Documented rent model; TTL values justified per network | Second review F-2; benchmarks |
| <a id="fw-perf-04"></a>FW-PERF-04 | Storage growth of channel records | Low | Planned | Contract v2, keeper | Channel entries are never deleted; rent accrues while they must stay live. | Keep terminal records minimal; allow terminal records to archive safely. | FW-CH-06 | Bounded per-channel rent after closure | This review |

## Testing and verification

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-test-01"></a>FW-TEST-01 | Independent accounting model for the v2 lifecycle | High | Planned | Contract tests | The randomized model covers the PoC only. | Independently written model including release, budgets, closure deadlines and SAC freeze/clawback. | FW-ARCH-01 | All identities in [ARCHITECTURE §6.4](ARCHITECTURE.md#64-invariants-and-identities) hold across randomized lifecycle sequences | Specification §12 |
| <a id="fw-test-02"></a>FW-TEST-02 | End-to-end network restoration drill | Medium | Planned | Tooling | Native test restoration does not exercise a real network. | Archive and restore entries on Testnet, then redeem. | FW-OPS-02 | Recorded drill with transaction evidence | DOC-04 |
| <a id="fw-test-03"></a>FW-TEST-03 | Concurrency and crash tests for signer and provider | High | Planned | Signer, provider | Current stores and counters are tested sequentially. | Parallel and crash-injection tests. | FW-PRV-01, FW-SDK-03 | No duplicate crediting or counter reuse under fault injection | DOC-09 |
| <a id="fw-test-04"></a>FW-TEST-04 | Testnet run of over-allocation and withdrawal as submitted transactions | Low | Planned | Tooling | Over-allocation and reserved-withdrawal attempts were observed by simulation only on Testnet. | Submit them as failing transactions with reused footprints, as already done for voucher attacks. | — | Evidence records FAILED transactions with `#102` | This review |

## Developer experience

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-dx-01"></a>FW-DX-01 | Reconcile local documentation drafts | Low | Planned | Documentation | Local untracked drafts (documentation index, development guide, evidence report) differ from the tracked documentation. | Review, update to the current structure, and either add them or discard them. | — | No tracked document links to an untracked file; drafts resolved | This review RR-09; earlier architecture and documentation review |
| <a id="fw-dx-02"></a>FW-DX-02 | Split the review log | Low | Planned | Documentation | `review-findings.md` holds several reviews in one growing file. | One file per review under a reviews directory, with an index. | — | Each review file self-contained; links preserved | This review |
| <a id="fw-dx-03"></a>FW-DX-03 | Evaluate pending dependency updates | Low | Planned | Dependencies | An open Dependabot update moves `@stellar/stellar-sdk` from 17.2.1 to 17.4.0 for the TypeScript tools. | Run all TypeScript suites, vectors and evidence checks on the update; record the decision. | FW-VP-04 | Update merged or declined with reasons | This review RR-14 |

## Documentation

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-doc-01"></a>FW-DOC-01 | Keep the status matrix synchronized | Low | Planned | Documentation | The implementation matrix in ARCHITECTURE §13 can drift from code. | Require a matrix update in the pull-request template for component changes. | — | Template item present; matrix reviewed per release | This review |
| <a id="fw-doc-02"></a>FW-DOC-02 | Render Mermaid diagrams in CI | Low | Planned | CI | Diagrams are syntax-reviewed manually. | Render with a pinned Mermaid CLI in CI. | — | CI fails on a diagram that does not render | Earlier architecture and documentation review |
| <a id="fw-doc-03"></a>FW-DOC-03 | Link and anchor check in CI | Low | Planned | CI | Link checks are run manually. | Add a link checker over tracked Markdown, including `<a id>` anchors. | — | CI fails on a broken local link or anchor | This review |
| <a id="fw-doc-04"></a>FW-DOC-04 | Complete the release manifest schema | Medium | Planned | Deployment | Current manifests omit build image, constructor arguments, deployment salt and other provenance. | Implement the release manifest in [specification §7](production-specification.md#identity-and-provenance). | — | Manifest validated against a schema in CI | Specification §7 |

## Research and optional extensions

| ID | Title | Priority | Status | Component | Description | Proposed resolution | Dependencies | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|
| <a id="fw-res-01"></a>FW-RES-01 | Bilateral or multilateral netting | Low | Research | Settlement | Batching is not netting; netting needs its own authorization and clearing model. | Research a clearing design that keeps per-provider collateral guarantees. | — | Written design with conservation proof | Vision |
| <a id="fw-res-02"></a>FW-RES-02 | Keeper incentives | Low | Research | Settlement | Settlement and maintenance are operator-funded; no incentive exists. | Research bounded incentives that never reduce provider claims. | FW-BS-01 | Decision record | Vision |
| <a id="fw-res-03"></a>FW-RES-03 | Passkey or contract-account agent authorization | Low | Research | Voucher protocol | Agent keys are raw Ed25519. | Evaluate secp256r1 or contract-account signers. | FW-VP-01 | Design with vectors | Vision |
| <a id="fw-res-04"></a>FW-RES-04 | Privacy-preserving payment metadata | Low | Research | Protocol | Allocations and redemptions are public. | Research confidentiality options compatible with collateral checks. | — | Design note | Vision; specification §11 |
| <a id="fw-res-05"></a>FW-RES-05 | Verifiable usage commitments | Low | Research | Protocol | A voucher proves payment authority, not delivery. | Research commitments that bind usage to payment without claiming proof of delivery. | FW-VP-02 | Design note | Vision |
| <a id="fw-res-06"></a>FW-RES-06 | Channel interoperability standard | Low | Research | Protocol | Formats differ from Stellar one-way channels and MPP. | Work with ecosystem maintainers on a shared channel interface. | FW-PRV-04 | Draft specification | Vision |
| <a id="fw-res-07"></a>FW-RES-07 | Calendar or epoch budgets | Low | Research | Contract v2 | First-version budgets are lifetime-only. | Design epochs without allowing counter resets to multiply exposure. | FW-TRE-01 | Design with conservation proof | ARC-04 |
