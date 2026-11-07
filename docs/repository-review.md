# Repository, architecture and security review

| | |
|---|---|
| Repository | `https://github.com/agentbatch/agentbatch` (default branch `main`) |
| Baseline commit | `0931ab4` (`docs: specify production architecture and operational requirements`), identical to `origin/main` at the start of the review |
| Review branch | `review/architecture-and-backlog` |
| Contract under review | `AgentBatchPoC`, optimized WASM 17,001 bytes, SHA-256 `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04` |
| Type | Internal engineering review. **Not an independent external security audit.** |

Earlier reviews remain in [review-findings.md](review-findings.md) and
[audit-report.md](audit-report.md). Unresolved items from all reviews are
consolidated in [FUTURE_WORK.md](FUTURE_WORK.md).

## 1. Summary

- **No new contract vulnerability was found.** The runtime contract is unchanged
  since the second internal review (source diff against `27b4f14` is empty outside
  tests). Every fund-safety attack in [§4](#4-security-analysis) is prevented by code
  and covered by tests; batch denial of service remains a disclosed liveness risk.
- **The accounting model is sound and is now fully stated and tested.** Three
  identities that link vouchers, settled amounts and withdrawable funds were
  maintained by the code but not asserted; they are now asserted after every
  transition (RR-02).
- **The architecture is now documented in the required form.**
  [ARCHITECTURE.md](ARCHITECTURE.md) describes the complete platform with eight
  diagrams, the accounting model and a source-referenced status matrix. The
  previous primary document is preserved as the
  [production specification](production-specification.md).
- **Every historical PoC claim was re-derived from the raw Testnet XDR** and holds
  ([§5](#5-verification-of-poc-claims)). One figure supplied for verification
  (32,892 stroops) is not in the record; the archived value is 32,898.
- 25 findings: 0 Critical, 0 High, 5 Medium, 18 Low, 2 Informational. Seventeen
  are fixed in this branch, one is documented as accepted design, one needs no
  change, and six are open and carried into the future-work register.
- **The README now describes the project** (what it is, why, how it works, the
  financial guarantee, what exists versus what is planned, demonstrated results),
  and documents no longer state dates of the work (RR-15, RR-16).

## 2. Repository assessment

| Area | Assessment |
|---|---|
| Structure | Clear separation already in place: `contracts/` (Soroban), `packages/` (reusable library), `tools/` (deployment and evidence), `examples/`, `test-vectors/`, `deployments/` (archived evidence), `docs/`. No restructuring of code is warranted. |
| Contract | Small, immutable, checked arithmetic, effects before transfers, strict signature verification, stored payout addresses. 66 tests including WASM, randomized model and mutation-informed authorization tests. |
| Off-chain library | Correct and strict for sequential use; persistence and counters are prototypes ([ARCHITECTURE §13](ARCHITECTURE.md#13-implementation-status)). |
| Tooling | Testnet runner writes isolated, write-once run directories; evidence verifier checks archives offline and against RPC without rewriting history. |
| CI | Pinned actions and toolchain; rebuilds the deployed WASM and requires its hash to equal the manifest; all suites and archive checks. Latest `main` run (`42113216433`, commit `0931ab4`) succeeded. |
| Documentation | Rigorous and cautious about claims. Gaps were structural (RR-01) and a few stale counts or unverified statuses (RR-06, RR-10). |
| Licensing and policy | Apache-2.0 at root and in the package; security, contribution, conduct and maintenance policies present; hosting controls not yet configured ([FW-SEC-06](FUTURE_WORK.md#fw-sec-06), [FW-SEC-08](FUTURE_WORK.md#fw-sec-08)). |

### Structure changes made

| Change | Technical value | Compatibility impact |
|---|---|---|
| `docs/architecture.md` → `docs/production-specification.md` (`git mv`, content kept) | Separates the system architecture from the detailed normative specification; avoids an `ARCHITECTURE.md` / `architecture.md` pair that collides on case-insensitive filesystems | All tracked links updated, including historical links in the review log (same anchors). External bookmarks to `docs/architecture.md` will not redirect. |
| New `docs/ARCHITECTURE.md`, `docs/FUTURE_WORK.md`, this report | Required deliverables | Additive |
| README rewritten around the project description (RR-15) | First-time readers learn what AgentBatch is, how it works and what exists before evidence details | Same evidence links and commands; section anchors changed |
| Work dates removed from all documents (RR-16) | Documentation describes the system, not the timeline of the work | Review headings no longer carry dates; historical evidence JSON keeps its recorded timestamps |

## 3. Findings

Severity reflects consequence in the PoC context unless stated. **Verified** means
reproduced from source, tests or archived data; **theoretical** means a reasoned
risk without a demonstrated failure in this repository.

### RR-01 — Architecture document lacked the system-level structure

- **Category:** Documentation · **Severity:** Medium · **Verified**
- **Components:** `docs/architecture.md` (now `production-specification.md`)
- **Description:** The primary architecture was a dense normative specification.
  It had no statement of principles and no complete-system diagram distinguishing
  implemented from proposed parts. It also lacked integration and trust-boundary
  diagrams, a component matrix with source references, and an accounting section
  connecting vouchers to settled and withdrawable funds.
- **Evidence:** Original headings (§1–§12) and three diagrams (component flow,
  channel state, request sequence).
- **Impact:** Readers had to reconstruct how the system fits together and what exists.
- **Remediation:** New [ARCHITECTURE.md](ARCHITECTURE.md) following the required
  structure; specification retained and linked section by section.
- **Acceptance criteria:** Required sections 1–15 present; eight diagrams; every
  component has a status, source path or backlog ID; all links resolve.
- **Status:** **Fixed** in this branch.

### RR-02 — Invariant suite did not assert the payout and withdrawable-funds identities

- **Category:** Testing / accounting · **Severity:** Low · **Verified**
- **Components:** `contracts/agentbatch-poc/src/test/mod.rs` (`assert_invariants`)
- **Description:** The suite asserted conservation (`Dp − P − X = A + R`), per-channel
  bounds, `Σ remaining = R` and solvency. It did not assert `P = Σ redeemed`,
  `Σ allocation = R + P`, or `A = Dp − X − Σ allocation`.
- **Evidence:** Counterexample: a hypothetical bug recording a withdrawal of `x` as
  a payout (`A −= x`, `P += x`, transfer to owner) preserves conservation,
  `Σ remaining = R` and solvency, so the previous checks pass. `P = Σ redeemed` fails.
- **Impact:** A class of misclassification bugs between payouts and withdrawals
  would have gone undetected by the invariant suite.
- **Remediation:** Added the three identities to `assert_invariants`, which runs
  after every step of the randomized model test and in scenario tests. Test-only
  change; contract logic untouched.
- **Acceptance criteria:** Identities asserted; full suite passes (66/66).
- **Status:** **Fixed** in this branch.

### RR-03 — Above-allocation vouchers are rejected, not capped

- **Category:** Protocol · **Severity:** Low · **Theoretical**
- **Components:** `redeem_batch`; provider implementations
- **Description:** A voucher with `amount > allocation` fails with `ExceedsAllocation`.
  A provider implementation that accepted such a voucher as its highest claim
  could redeem nothing on that channel.
- **Evidence:** `lib.rs` (`if v.amount > channel.allocation { return Err(ExceedsAllocation) }`);
  the reference `ProviderVerifier` rejects these vouchers (`exceeds-allocation`).
- **Impact:** None with the reference library; a risk for third-party providers.
- **Remediation:** Stated as normative rule 1 in [ARCHITECTURE §6.5](ARCHITECTURE.md#65-vouchers-allocations-settlement-and-withdrawal).
- **Acceptance criteria:** Rule documented; future adapters include the check (FW-PRV-04, FW-PRV-05).
- **Status:** **Documented** (accepted design).

### RR-04 — Cached `redeemed` can make a provider's voucher stale on-chain

- **Category:** Off-chain consistency · **Severity:** Low · **Verified by reasoning against source**
- **Components:** `ProviderVerifier.highest`, settlement workflow
- **Description:** `highest()` uses `redeemed` from the last `sync`. If a voucher the
  provider never received is redeemed directly (for example by the agent), the
  provider may accept a voucher at or below the new on-chain `redeemed`.
- **Evidence:** `verifier.ts` (`highest` returns `max(stored, channel.redeemed)`
  with cached `channel`); `redeem_batch` rejects `amount ≤ redeemed`.
- **Impact:** No economic loss: cumulative redemption already paid the provider up to the
  higher amount. But a batch including that voucher reverts (liveness).
- **Remediation:** Refresh `redeemed` before building batches; treat stale candidates as settled.
- **Dependencies:** Coordinator service.
- **Acceptance criteria:** See [FW-BS-02](FUTURE_WORK.md#fw-bs-02).
- **Status:** **Open** — documented in ARCHITECTURE §6.5 rule 2.

### RR-05 — Shared code entry has no maintainer

- **Category:** Operations · **Severity:** Medium · **Verified**
- **Components:** `storage.rs::extend_instance`; deployment operations
- **Description:** By design, contract calls extend only the instance, never the shared
  WASM code entry. No keeper exists, so the deployed code entry archives when its
  TTL lapses. Later invocations then need prepared automatic restoration, which the
  Testnet runner does not handle.
- **Evidence:** `extend_instance` uses `extend_ttl_for_contract_instance`; there is no
  TTL job in `tools/`; the runner aborts on a restore preamble.
- **Impact:** Increased cost or failed calls after archival; no fund loss (persistent
  entries are archived, not deleted).
- **Remediation:** Keeper extending all dependencies, including shared code.
- **Acceptance criteria:** See [FW-OPS-02](FUTURE_WORK.md#fw-ops-02).
- **Status:** **Open.**

### RR-06 — Hosted CI status described as unverified

- **Category:** Verification · **Severity:** Low · **Verified**
- **Components:** Review log, CI
- **Description:** Earlier sections state that hosted CI results and cross-machine
  reproducibility were not verified.
- **Evidence:** GitHub Actions run `42113216433` for `0931ab4` completed successfully.
  Its contracts job includes the step `test "$built" = "$deployed"`, so the hosted
  runner reproduced the manifest hash.
- **Impact:** Understated evidence.
- **Remediation:** Recorded here; historical sections left as written.
- **Status:** **Fixed** (this report).

### RR-07 — Supplied benchmark figure does not match the archive

- **Category:** Evidence · **Severity:** Informational · **Verified**
- **Description:** The figure of 32,892 stroops for three individual settlements is not
  in the archive. The archived results are three transactions of 10,966 stroops each,
  32,898 in total. With the batch at 22,294 the saving is 32.23% (32.22% would follow
  from 32,892).
- **Evidence:** `feeCharged` decoded from the raw `resultXdr` of the three baseline
  redemptions in [evidence.json](../deployments/testnet/evidence.json).
- **Status:** **No change needed**; repository documents already state −32.2%.

### RR-08 — Architecture file naming

- **Category:** Repository structure · **Severity:** Low · **Verified**
- **Description:** Adding the required `docs/ARCHITECTURE.md` next to the existing
  `docs/architecture.md` would create paths that differ only in case.
- **Remediation:** The specification was renamed; see [§2](#structure-changes-made).
- **Status:** **Fixed** in this branch.

### RR-09 — Local untracked documentation drafts diverge from tracked docs

- **Category:** Developer experience · **Severity:** Low · **Verified**
- **Description:** The working copy contains untracked drafts (a documentation index,
  a development guide, an evidence report and additional Testnet run directories).
  They reference a structure that differs from the tracked documentation. They were
  not modified or committed.
- **Remediation:** [FW-DX-01](FUTURE_WORK.md#fw-dx-01).
- **Status:** **Open.**

### RR-10 — Test counts in historical sections differ from current suites

- **Category:** Documentation · **Severity:** Low · **Verified**
- **Description:** Historical review sections cite 124 TypeScript tests (113 + 11).
  The current suites contain 157: 113 voucher, 21 Testnet tooling and 23 evidence.
  The contract suite is 66.
- **Remediation:** Current counts recorded in [§6](#6-verification-report);
  historical sections left unchanged.
- **Status:** **Fixed** (this report).

### RR-11 — Maximum batch size is not qualified

- **Category:** Scalability · **Severity:** Low · **Theoretical**
- **Description:** `MAX_BATCH_SIZE = 4` is a conservative choice. Linear extrapolation
  from measured per-voucher resources suggests the write-entry limit would bind first,
  near 99 vouchers. That is not measured.
- **Remediation:** [FW-BS-03](FUTURE_WORK.md#fw-bs-03).
- **Status:** **Open.**

### RR-12 — Two isolation properties observed on Testnet by simulation only

- **Category:** Evidence · **Severity:** Low · **Verified**
- **Description:** Over-allocation and reserved-funds withdrawal were rejected by
  simulation (`#102`) on Testnet. The voucher attacks, by contrast, were submitted
  and recorded as failed transactions. The test suite covers both properties.
- **Remediation:** [FW-TEST-04](FUTURE_WORK.md#fw-test-04).
- **Status:** **Open.**

### RR-13 — Pending dependency update

- **Category:** Dependencies · **Severity:** Informational · **Verified**
- **Description:** Pull request #10 (Dependabot) bumps `@stellar/stellar-sdk` from
  17.2.1 to 17.4.0 for the TypeScript tools. It does not affect the contract artifact.
- **Remediation:** [FW-DX-03](FUTURE_WORK.md#fw-dx-03), together with [FW-VP-04](FUTURE_WORK.md#fw-vp-04).
- **Status:** **Open.**

### RR-14 — Contract tests can exhaust memory on small machines

- **Category:** Developer experience · **Severity:** Low · **Verified**
- **Description:** On a 5.9 GB machine, compiling and running the contract suite with
  default parallelism was killed by the operating system (exit 137) twice. With
  `CARGO_BUILD_JOBS=1` and `--test-threads=1` it passes.
- **Remediation:** Low-memory settings documented in [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Status:** **Fixed** in this branch.

### RR-15 — README did not describe the project clearly

- **Category:** Documentation · **Severity:** Medium · **Verified**
- **Components:** `README.md`
- **Description:** The README opened with links to other payment schemes before saying
  what AgentBatch is. It never explained the financial guarantee, and two long
  lists of transaction links dominated its middle.
- **Remediation:** Rewritten: purpose and status, the problem, how it works (with a
  diagram), the accounting guarantee, implemented versus planned, Testnet results,
  quick start, interface, layout and a documentation map. All evidence links kept.
- **Acceptance criteria:** A first-time reader can state what the system does, what
  protects funds and what exists today from the README alone.
- **Status:** **Fixed** in this branch.

### RR-16 — Documents stated dates of the work

- **Category:** Documentation · **Severity:** Low · **Verified**
- **Components:** README, changelog, architecture, benchmarks, specification,
  review documents
- **Description:** Run dates, review dates and consultation dates appeared in
  prose and headings.
- **Remediation:** Removed from all tracked Markdown. Section headings no longer carry
  dates. Archived evidence data (`*.json`) keeps its recorded timestamps, because
  altering measurement records would falsify them.
- **Acceptance criteria:** No calendar date in tracked Markdown outside the license text.
- **Status:** **Fixed** in this branch.

### Documentation and supply-chain audit (RR-17 to RR-25)

A line-by-line review of every document against the code and Stellar behavior.
All findings are **verified** and **fixed** in this branch.

| ID | Severity | Document | Finding | Correction |
|---|---|---|---|---|
| RR-17 | Medium | `vision.md` §6.3 | Listed "AgentBatch contract" and "Treasury" as separate signed fields and omitted the owner. The payload binds network, contract (which identifies the treasury), owner, channel, provider, signer, amount and domain. | Field list corrected; notes that callers submit only channel, amount and signature. |
| RR-18 | Low | `vision.md` §7 | "Treasury solvency checks" implied a runtime solvency check. The contract checks the exact deposit delta; solvency is asserted by tests and checked live by the Testnet runner. | Reworded to what the code does. |
| RR-19 | Low | `vision.md` §6.1 | Implied the contract accepts SEP-41 assets including USDC. The PoC accepts any token contract reporting 7 decimals; production admits a pinned SAC. | Target and PoC behavior stated separately. |
| RR-20 | Low | `vision.md` §8–§10 | Planned SDK described in the present tense; "suspend compromised agents" contradicted the design (no instant revocation); "verifies instantly". | Tense corrected; suspension described as stopping service and closing; "locally, without a network round trip". |
| RR-21 | Low | `poc-spec-review.md` | Cited section numbers of a requirements brief not in the repository; S13 said agents continue from `redeemed`, contradicting the normative restart rule. | Brief identified (vision §15); S13 limited to the controlled demo with the general rule linked. |
| RR-22 | Low | `voucher-format.md` | Binding table omitted the owner binding and its test; one link labeled "architecture" pointed at the specification. | Row and label added. |
| RR-23 | Low | `ARCHITECTURE.md`, `benchmarks.md` | TTL given only in days although the contract counts ledgers; "transactions serialize" imprecise under parallel Soroban execution. | Ledger counts stated with approximate days; contention described as conflicting footprints on the treasury instance. |
| RR-24 | Medium | CI, `maintenance.md` | The job that proves the deployed WASM hash installed the Stellar CLI with `curl \| tar` and no checksum. | CI verifies the archive against the SHA-256 recorded in the GitHub release metadata (`31c83db3…2e84`) before extracting; doc updated. |
| RR-25 | Low | Issue and PR templates | Bug report offered a non-existent "coordinator" component; nothing prompted keeping the status matrix and backlog in sync. | Real components listed; PR template gains documentation checks; feature requests reference backlog IDs. |

RR-15 was also extended: the README now covers the full project, technical
features, use cases and value for Stellar, with links to the key technical documents.

## 4. Security analysis

| Attack | Result | Enforced by | Test evidence |
|---|---|---|---|
| Forged voucher (wrong key, tampered amount or signature) | Rejected | Strict Ed25519 over a payload rebuilt from storage | `vouchers::invalid_signature_rejected`, `incorrect_signer_rejected`, `amount_substitution_rejected`; invalid-signature vectors |
| Provider substitution | Impossible | Payout to stored provider; provider bound in payload | `wrong_provider_rejected`, `redeem_batch_is_permissionless_but_pays_only_stored_provider` |
| Cross-channel or cross-deployment replay | Rejected | Channel ID, contract and network bound | `cross_channel_replay_rejected`, `voucher_for_other_deployment_rejected`, `wrong_network_rejected`; Testnet FAILED transaction |
| Replayed cumulative balance | No payout | `amount > redeemed` | `cumulative_vouchers_pay_only_increment`; Testnet FAILED transaction `#109` |
| Over-allocation (channel or voucher) | Rejected | `allocation ≤ available`; `amount ≤ allocation` | `over_allocation_rejected`, `amount_above_allocation_rejected`; Testnet `#102`, `#110` |
| Withdrawal of reserved funds | Rejected | `amount ≤ available` | `withdrawal_limited_to_unallocated_funds`; Testnet `#102` |
| Withdrawal race | Not possible on-chain | Ledger application is serializable; every mutation writes the treasury instance, so conflicting calls never interleave, and each re-reads `available` | Randomized model test |
| Channel replacement or rewrite | Not possible | No function modifies provider, signer or allocation | `channel_provider_and_signer_are_immutable` |
| Stale off-chain state | No loss; possible batch revert | Cumulative semantics | RR-04 |
| Reentrancy | Not possible | Host forbids re-entering a contract; accounting written before transfers; token fixed | Code review |
| Overflow and underflow | Rejected | Checked arithmetic, `overflow-checks = true` | `deposit_overflow_rejected`, zero/negative and `i128::MIN` vouchers |
| Fee-on-transfer token | Rejected | Deposit balance-delta check | `deposit_credits_only_what_arrives` |
| Archived channel resetting replay protection | Not possible | Persistent storage; restored with full state | `archived_channel_restores_with_full_state` |
| Denial of service on a batch | Possible (liveness) | — | `failed_asset_transfer_reverts_whole_batch`; FW-BS-01 |

## 5. Verification of PoC claims

Re-derived during this review from the tracked archive
[deployments/testnet/evidence.json](../deployments/testnet/evidence.json). Each
transaction hash was recomputed from its raw envelope, and each fee was decoded
from its raw result XDR (0 mismatches). This authenticates archive consistency,
not the live network; no transaction was submitted and no RPC read was made in
this review.

| Claim | Result | Basis |
|---|---|---|
| Deposit of 100 AUSD | **Verified** | `afterSetup.tokenBalance = 1,000,000,000` base units |
| Channels of 40 / 35 / 15, 10 unallocated | **Verified** | `afterSetup`: available 100,000,000, reserved 900,000,000 |
| 11 simulated paid requests, no transactions during them | **Verified** (simulated providers, not production traffic) | 11 request records; submission counter 0 |
| One atomic batch paid 12 / 8 / 5 | **Verified** | Provider payouts 120,000,000 / 80,000,000 / 50,000,000 |
| Incremental redemption to 17 paid 5 | **Verified** | Provider A total 170,000,000; total paid 300,000,000 |
| Unauthorized allocation and channel-binding attempts rejected | **Verified** | Over-allocation `#102` (simulation); cross-channel FAILED `Crypto/InvalidInput`; above-allocation FAILED `#110` |
| Replay protection | **Verified** | Batch replay FAILED `#109`; balances unchanged afterwards |
| Withdrawal accounting | **Verified** | Withdrew 100,000,000 = available; reserved stayed 650,000,000; one more unit rejected `#102` |
| 22 transactions: 19 successful, 3 intentionally failed | **Verified** | Status count from archive |
| Batch 22,294 vs separate 32,898 stroops (−32.23%) | **Verified**; the 32,892 figure is not supported | Decoded `feeCharged` |
| Rust, TypeScript and scenario tests | **Verified** by execution | [§6](#6-verification-report) |
| Contracts still live on Testnet today | **Unverified** | Not queried in this review |

Benchmark scope: one workload (three channels, one voucher each, first payouts,
warm dependencies, G-account providers), one run, Testnet fees on one day.
Resource figures are simulation-declared limits. It does not establish a general
saving, throughput, latency or Mainnet cost.

## 6. Verification report

| Category | Item | Result |
|---|---|---|
| Executed | `pnpm check` on the baseline (`0931ab4`): format, Clippy `-D warnings`, typecheck, optimized WASM build, 66 contract tests, 157 TypeScript tests (113 voucher, 21 Testnet tooling, 23 evidence), offline archive checks, offline example | Passed |
| Executed | Contract suite after RR-02 (`cargo test --locked --workspace`, single-threaded) | 66 passed |
| Executed | Final `pnpm check` on the review branch | See [§7](#7-final-validation) |
| Executed | Raw-XDR re-derivation of PoC claims | Passed, 0 mismatches |
| Executed | Local link and anchor check over tracked Markdown | See [§7](#7-final-validation) |
| Source-verified | Contract entry points, storage, TTL policy, errors, events; provider verifier, stores, signer; Testnet workflows | Matches ARCHITECTURE §4–§8 |
| Observed | Hosted CI run `42113216433` for `0931ab4` | Success (run list; job log not retrieved) |
| Not executed | Testnet or Mainnet transactions, live RPC reads, Mermaid graphical rendering, external audit | — |
| Unverified | Authenticity of local untracked run directories; current liveness of archived Testnet contracts | — |

## 7. Final validation

Run on the review branch after all changes:

| Check | Result |
|---|---|
| `pnpm check` (format, Clippy, typecheck, optimized WASM build, all tests, archive checks, offline example) | Passed |
| Optimized WASM hash equals manifest (`ab37537a…68a04`) | Passed — runtime contract unchanged |
| Local links and anchors in tracked Markdown, including `<a id>` anchors | 0 problems |
| Funding-programme and AI-authorship references in tracked files | None found |
| Calendar dates in tracked Markdown (excluding the license) | None found |
| Stellar CLI 26.0.0 release archive SHA-256 equals the GitHub release digest pinned in CI | Passed |
| Sensitive logic (escrow accounting, authorization, signature verification, settlement) | Unchanged; only test assertions added |
