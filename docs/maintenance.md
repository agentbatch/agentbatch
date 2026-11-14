# Governance, maintenance, and releases

This is the maintenance policy for AgentBatch: what is maintained, what support
exists, how compatibility is managed, and how releases, dependencies, security
issues and retirement are handled. It separates two kinds of statement:

- **Current practice**: verifiable in this repository or its hosting settings today.
- **Required before release**: policy that needs real maintainers, infrastructure
  or hosting controls before anyone can rely on it.

[Contribution](../CONTRIBUTING.md), [security reporting](../SECURITY.md),
[conduct](../CODE_OF_CONDUCT.md) and [operations](production-operations.md) own
their detailed workflows; this document defines obligations and links to them.

Contents:
[1 Status](#1-current-maintenance-status) ·
[2 Areas](#2-maintenance-areas-and-responsibilities) ·
[3 Support](#3-support-policy) ·
[4 Governance](#4-governance-and-release-authority) ·
[5 Compatibility](#5-stellar-toolchain-and-compatibility) ·
[6 Contracts](#6-smart-contract-maintenance) ·
[7 Provider claims](#7-provider-claims-and-financial-safety) ·
[8 SDK](#8-sdk-and-developer-api-maintenance) ·
[9 Releases](#9-releases-and-reproducibility) ·
[10 Dependencies](#10-dependency-maintenance-and-security-updates) ·
[11 Contributions](#11-contribution-and-review) ·
[12 Security](#12-security-reporting-and-incident-response) ·
[13 Operations](#13-operational-maintenance) ·
[14 Licensing](#14-licensing-and-third-party-notices) ·
[15 Retirement](#15-deprecation-and-retirement) ·
[16 Sustainability](#16-maintenance-sustainability)

## 1. Current maintenance status

| Area | Current state |
|---|---|
| Source | Testnet proof of concept; best-effort maintenance on the `main` branch |
| Packages | None published; every workspace package is `"private": true` |
| Deployments | Testnet PoC treasuries recorded in [`deployments/testnet`](../deployments/testnet/manifest.json); no Mainnet deployment |
| Operational services | None operated (no coordinator, keeper, indexer, API or Console) |
| Maintainers | No published maintainer roster, component owners or security responders |
| Hosting controls (verified through the GitHub API at the last review) | Private vulnerability reporting **disabled**; no branch protection or rulesets on `main`; secret scanning and Dependabot security updates **disabled**; Dependabot version updates configured |
| CI controls | Actions pinned by commit SHA; workflow token limited to `contents: read`; Stellar CLI archive verified against a pinned SHA-256; frozen lockfiles; deployed WASM hash rebuilt and compared on every run |

Re-verify the hosting row before relying on it: settings can change without a
commit.

## 2. Maintenance areas and responsibilities

AgentBatch has four maintenance areas with different owners and failure modes.
Maintaining one does not imply maintaining the others: the source repository can
remain maintained while an externally operated service is unavailable, and no
source change alters a deployed contract.

| Area | Covers | Who acts (role) | What maintainers cannot do |
|---|---|---|---|
| **Source** | Contract code, voucher library, tools, tests, test vectors, interfaces, documentation, compatibility statements | Component maintainers and reviewers | Change any deployed contract or a signed voucher's meaning |
| **Packages** | npm packages, generated bindings, distribution contents, dependency and security updates | Package publisher | Revoke a published version from users who already installed it |
| **Deployments** | Released contract identities, constructor configuration, manifests, admission records, migration and retirement guidance | Release authority; each treasury owner for their own treasury | Administer, pause or upgrade a treasury: only its owner can call owner functions, and the code is immutable |
| **Operational infrastructure** | Settlement coordinator, indexer and archive, storage keeper, deadline watcher, read API, Console hosting, monitoring, RPC dependencies, provider claim recovery | Named operators per service | Guarantee availability of RPC providers, the asset issuer or the Stellar network |

## 3. Support policy

Support tiers follow the project's maturity. No tier below promises a response
time or a support period unless a published table says so.

| Tier | Applies to | Current status |
|---|---|---|
| Testnet PoC support | Archived Testnet run, PoC contract, voucher library, tools | **Active, best-effort.** Public issues; no SLA |
| Development and pre-release | `main` branch and any `0.x` pre-release | No compatibility guarantee between commits; breaking changes are allowed and recorded in the [changelog](../CHANGELOG.md) |
| Published SDK releases | npm packages | **None published.** The rules in [§8](#8-sdk-and-developer-api-maintenance) apply from the first release |
| Security maintenance | Supported source lines and published releases | Fixes land on `main`; no backport branches exist |
| Production deployment support | Mainnet treasuries | **Not established.** Requires the release gates in [§9](#9-releases-and-reproducibility) and named operators |
| Operational service support | Coordinator, indexer, keeper, API, Console | **Not established.** Requires operators, infrastructure and the objectives in [production operations](production-operations.md) |

When packages are first published, the release line table (Active, Maintenance,
End of life) becomes the single source of truth for support status. Each line's
end date is published when the line moves to Maintenance and may be extended but
never shortened. Maintenance lines receive critical security fixes only.

*Why:* this follows the Stellar JavaScript SDK release policy, which publishes
one Active line and dated Maintenance lines and treats its support table as the
source of truth, and the Soroban Rust SDK, which limits critical security fixes
to its two most recent majors. Both give integrators a predictable upgrade
horizon without promising indefinite backports, which an early project cannot
staff.

## 4. Governance and release authority

The repository does not establish a governing body, maintainer roster, component
ownership map, production operator or succession agreement. Repository access is
not evidence of ownership of contributions or authority over a deployed treasury.
Copyright holders retain their existing rights; this document transfers nothing.

Before a production release, record the actual primary and backup component
owners, reviewers, security triage contact, package publisher, deployment
approver, artifact custodian and hosting administrators, and verify them against
repository and registry permissions. Merging, tagging, publishing and deploying are
distinct authorities ([§9](#9-releases-and-reproducibility)); an accepted pull
request authorizes none of the others. Treasury owners alone administer their
treasuries.

**Decision process.** Routine documentation and tooling fixes need one component
review. Protocol, financial, key-handling, dependency-policy and operational
changes need a written proposal covering affected invariants, compatibility,
threats and migration, an [ADR](decisions.md) when a design choice changes, and
review by the component owner plus a second qualified reviewer. Disagreements are
resolved in the proposal with evidence and alternatives. If qualified reviewers
are unavailable, the production release waits.

**Succession.** A succession plan names backup holders and transfer procedures for
repository, registry and hosting access, signing policies, artifacts, alerts and
security reports. Recovery credentials live in an organizational vault; outgoing
access is removed and the handover recorded. Never transfer treasury or agent
secrets through public issues. Without an authorized successor, announce reduced
support, stop admitting new production deployments and follow
[§15](#15-deprecation-and-retirement).

## 5. Stellar toolchain and compatibility

### Pinned toolchain

| Component | Pinned version | Pinned in | Latest upstream at the last review | Assessment |
|---|---|---|---|---|
| Rust | 1.94.1, target `wasm32v1-none` | [`rust-toolchain.toml`](../rust-toolchain.toml) | 1.100.0 | Keep for the PoC: a different compiler can change WASM bytes and break the archived hash check |
| Soroban SDK | `=27.0.6` | [`Cargo.toml`](../Cargo.toml) | 29.0.1 (30.0.0 in release candidate) | Compiled into the deployed PoC; Dependabot ignores it deliberately. Upgrading means a new deployment and new evidence |
| Stellar CLI | 26.0.0 | [CI](../.github/workflows/ci.yml), [CONTRIBUTING](../CONTRIBUTING.md) | 30.0.1 | The Soroban SDK README now requires the CLI major version to be **equal to or greater than** the soroban-sdk major. The PoC pairing (CLI 26, SDK 27) does not meet that rule; it is kept only because it reproduces the archived WASM hash. A v2 release must use a compliant pair and publish new hashes |
| Stellar JS SDK | 17.2.1 | [`packages/voucher`](../packages/voucher/package.json) and every tool and example workspace | 17.4.0 (17.x is the Active line) | Minor update pending review ([FW-DX-03](FUTURE_WORK.md#fw-dx-03)) |
| Node.js | 22.13.1 tested; engines `>=22.12.0` | [`.nvmrc`](../.nvmrc), [`package.json`](../package.json) | Node 22 remains an LTS line | Supported for development |
| pnpm | 10.19.0 | `packageManager` in [`package.json`](../package.json) | — | Enabled through Corepack |
| Network protocol | Archive recorded on protocol 29 | [manifest](../deployments/testnet/manifest.json) | Testnet protocol 30, Mainnet protocol 29 | The PoC still executes on Testnet protocol 30: a read-only `get_treasury` simulation returned the archived post-run state. Per-transaction limits used in the [benchmarks](benchmarks.md) are unchanged |

Do not upgrade a pinned version inside an unrelated change. A newer version is
not automatically safer or compatible: it can change WASM output, host behavior,
generated bindings or XDR types.

### Compatibility dimensions

Each release states its position on every dimension below. They version
independently, and a change to one never silently changes another.

| Dimension | Rule |
|---|---|
| Stellar protocol | Each release lists the protocol versions it was tested on. Before a protocol upgrade reaches Mainnet, rerun the test suite, simulate the deployed contracts on Testnet and rerun evidence verification |
| Rust and Soroban SDK | One pinned Rust toolchain and one exact soroban-sdk per contract release; the CLI major must be at least the soroban-sdk major |
| JavaScript SDK | Each package release names the `@stellar/stellar-sdk` range it was tested with; XDR-type changes are reviewed before widening the range |
| Runtimes | Node minimum fixed per package major; browser support only for entry points tested in a browser |
| Contract ABI and generated bindings | Bindings are regenerated from the released contract specification and diffed in review; a binding for one contract version is never used against another |
| Voucher protocol | The domain symbol (`AGENTBATCH_POC_V1` today, `AGENTBATCH_V1` planned) identifies the signed format; any field or encoding change requires a new domain and new vectors |
| Network | Network passphrase and its hash are bound into every voucher; clients refuse a deployment whose network does not match their configuration |
| Events and APIs | Event topics and API schemas carry versions; a new version is additive or ships as a new name |

*Why:* the Stellar JavaScript SDK decouples protocol support from its major
versions, and the Soroban SDK and CLI publish explicit version pairing rules.
AgentBatch adds the voucher domain and contract ABI as dimensions because they
decide whether money moves correctly, not just whether code compiles.

**Upstream changes.** Dependabot opens weekly update pull requests, and upstream
release notes and protocol upgrade announcements are reviewed for each pinned
component. A breaking upstream change is adopted in a dedicated change that
records the old and new versions, the affected compatibility dimensions, the test
and evidence results, and any required redeployment.

## 6. Smart contract maintenance

- **Deployments are immutable.** There is no upgrade, pause or administrator path,
  and none may be added to custody code ([ADR-006](decisions.md#adr-006-replace-deployments-rather-than-upgrade-custody-in-place)).
  A fix ships as a new contract version deployed under a new contract ID.
- **Publishing code is not migrating users.** A new contract release changes
  nothing for existing treasuries; each owner decides whether to deploy the new
  version and move new exposure to it.
- **New version required** for any change to the ABI, events, voucher domain or
  encoding, storage schema, authorization rules, accounting invariants or
  lifecycle. Each needs new compatibility entries and regenerated bindings.
- **Authorization regressions** are tested with enforcing `mock_auths` and exact
  invocation trees, never `mock_all_auths`; constructor authorization through
  `deploy_v2` ([CONTRIBUTING](../CONTRIBUTING.md#rules-for-changes)).
- **Accounting changes** update the identities in
  [ARCHITECTURE §6.4](ARCHITECTURE.md#64-invariants-and-identities) and the
  randomized model before code review.
- **Resource-limit or protocol changes** re-qualify the batch cap and the storage
  lifetime constants against the network's current settings.
- **Host semantics** (strict Ed25519 verification, storage archival and
  restoration) are rechecked on every protocol upgrade using the shared
  host-rejected vectors.

## 7. Provider claims and financial safety

Maintenance actions must never strand a valid provider claim. These facts about
the PoC are fixed in its deployed code:

| Fact | Consequence for maintenance |
|---|---|
| No closure, release or top-up | Reserved collateral stays locked in the PoC permanently; no source change can release it |
| Vouchers never expire | A valid voucher remains redeemable for as long as the contract and channel state stay live |
| The contract extends only its instance and channel entries; it never extends its WASM code entry | The code entry can archive. Anyone can extend or restore it; doing so for active treasuries is an operator duty |
| Redemption is permissionless | Providers can always redeem directly, without any coordinator |
| Payouts depend on the asset | An issuer freeze or clawback can block a payout or create a deficit; the contract cannot override it |
| State is read through RPC | Settlement and verification depend on reachable, correct RPC endpoints |

Any migration or retirement of a v2 deployment therefore keeps claims redeemable:
stop new exposure on the old deployment, start closure only through the
contract's own rules, keep storage lifetimes and fee accounts funded until every
deadline has passed, keep readers and decoders for the old version available, and
reconcile payouts before finalizing. Maintainers cannot release collateral,
override authorization or recover funds where the contract provides no such
function, and must never imply otherwise.

## 8. SDK and developer API maintenance

No package is published yet. From the first release:

| Topic | Policy |
|---|---|
| Versioning | Semantic Versioning. Before 1.0, a minor version may break the API and a patch never does; from 1.0, breaking changes need a major version |
| Package boundaries | Separate entry points per role (core, Node persistence, generated bindings, provider middleware, agent client), each with type declarations; browser builds contain no Node built-ins |
| Contract compatibility | Every release lists the contract versions and voucher domains it supports and refuses unknown ones at runtime |
| Voucher meaning | No SDK release may change the bytes or meaning of a signed voucher, or the guarantees of an existing treasury. That requires a new voucher domain and a new contract version |
| Error codes | Contract and asset error codes map to stable typed errors; a code is never reused for a different meaning |
| Deprecation | Mark with `@deprecated`, document the replacement and record it in the changelog; remove only in a later breaking release |
| Runtime minimum | Fixed for a major line; raising it is a breaking change |
| Breaking changes | Changelog entry, release notes and a migration guide for every breaking release, including pre-1.0 minors |
| Security patches | Released on every supported line listed in the support table |

*Why:* these follow the Stellar JavaScript SDK (versioning table, deprecation
before removal, fixed Node minimum per major, migration guide per major) and the
Stellar MPP SDK (role-specific subpath exports and a migration guide for each
breaking `0.x` release). The voucher-meaning rule is specific to AgentBatch: a
signed voucher is a payment obligation, so its interpretation cannot depend on
which SDK version a provider runs.

## 9. Releases and reproducibility

### Release events are separate

| # | Event | Authority | Does not authorize |
|---|---|---|---|
| 1 | Source merged | Reviewers | Any release |
| 2 | Release built (tagged revision, reproducible artifacts) | Release authority | Publication |
| 3 | Artifacts published (WASM, checksums, manifests, SBOM, notes) | Release authority | Package publication or deployment |
| 4 | npm packages published | Package publisher | Deployment |
| 5 | Contract deployed | The deploying owner | Operational use |
| 6 | Deployment approved for operational use | Operators after [operational acceptance](production-operations.md) | Unrestricted use before the security gates are met |

Historical deployment manifests and evidence are never edited to describe new
code. New code gets a new version and a new manifest.

### Procedure

This is the required procedure for a future publishing release. Nothing here
authorizes a tag, push, registry publication or deployment.

1. Select the approved source revision with no unreviewed tracked changes, and
   confirm release authority and the compatibility table. Never rely on `.secrets`,
   `.state`, `target`, `dist`, optional run indexes or untracked documentation.
2. Export the tracked source into a clean temporary checkout. Install with
   `pnpm install --frozen-lockfile`, use the pinned Rust toolchain and CLI, build
   with `pnpm build` and run `pnpm check`. Rust commands use `--locked`; confirm
   that `stellar contract build --optimize` leaves the lockfile unchanged.
3. Reproduce the optimized WASM and its embedded specification in a second clean
   environment and compare SHA-256 hashes. CI already does this for the PoC
   against its historical manifest.
4. Pack each library into a new temporary directory, list and extract the
   tarball, verify every declared export exists, then import it from a clean
   consumer project outside the monorepo, type-check it and run its usage example.
5. Inspect the tarball contents: LICENSE, README, third-party notices, generated
   code and types, source maps with matching sources. Reject secrets, private
   state, deployment records and workspace-relative imports.
6. Assemble the release bundle: source archive with lockfiles, optimized WASM and
   specification, package tarballs, generated bindings, SHA-256 checksums, SBOM
   and notices, test and reproduction report, compatibility table, release notes,
   deployment manifest and schema. Record provenance (source revision, tool
   versions, build image, input and output hashes, builder and reviewer). Sign
   with a provisioned mechanism and verify from a separate consumer.
7. Publish after approval; keep bundles in versioned immutable storage plus an
   independent mirror. CI logs and temporary artifacts are not retention.
8. Deploy through [operational acceptance](production-operations.md), archive the
   deployment transactions and results, and validate on-chain code and
   configuration before admitting the deployment to a catalog.

Read-only, local commands for a release review:

```bash
pnpm build
pnpm check
sha256sum target/wasm32v1-none/release/agentbatch_poc.wasm
# From packages/voucher, with a fresh absolute output directory:
pnpm pack --pack-destination /tmp/agentbatch-package-review
```

Use a new output directory per review. `git archive HEAD` omits working-tree
edits and untracked files, so review the exact bytes that will be released, not
whatever happens to exist in a developer's workspace.

*Why:* the Stellar CLI and Soroban SDK release from tagged, locked sources and
publish checksummed artifacts; OpenZeppelin Stellar Contracts publish an audit
report per released version. AgentBatch adds the explicit separation of events 1–6
because a contract deployment holds funds and cannot be withdrawn like a package
version.

## 10. Dependency maintenance and security updates

| Control | Status |
|---|---|
| Dependabot version updates, weekly, for Cargo, npm and GitHub Actions ([config](../.github/dependabot.yml)) | Active. `soroban-sdk` is excluded because it is compiled into the deployed WASM; `@types/node` majors are excluded to match the Node 22 runtime |
| Lockfiles (`Cargo.lock`, `pnpm-lock.yaml`) with frozen installs and `--locked` builds | Active in CI |
| Actions pinned by commit SHA; workflow token `contents: read` | Active |
| Stellar CLI download verified by SHA-256 | Active |
| Dependabot security updates, secret scanning | **Disabled** in hosting settings |
| Automated license and advisory checks (`cargo-deny`, `cargo audit`, `pnpm audit`) | Not configured ([FW-DX-06](FUTURE_WORK.md#fw-dx-06)) |
| OpenSSF Scorecard | Not configured; optional once the hosting controls above are enabled |

**Routine updates.** Triage Dependabot pull requests weekly. Each update runs the
full `pnpm check`. Updates to `@stellar/*`, `@noble/*` or anything in the voucher
signing and verification path also rerun the shared host-rejected vectors
([FW-VP-04](FUTURE_WORK.md#fw-vp-04)), because off-chain acceptance must never be
wider than the host's.

**High-severity advisories.** Establish reachability first: code compiled into a
deployed WASM, code in a published package, or development-only tooling. Patch on
`main` with tests; a deployed contract cannot be patched, so an advisory affecting
its compiled code is handled as a contract incident ([§12](#12-security-reporting-and-incident-response)).

Neither pinning nor tests prove the absence of malicious code. Production builds
also verify the build image and optimizer identity, review install scripts and
network access during builds, and separate CI read credentials from publishing,
deployment and signing credentials.

## 11. Contribution and review

[CONTRIBUTING.md](../CONTRIBUTING.md) is the workflow. Review depth follows risk:

| Change | Required evidence |
|---|---|
| Documentation only | Link and anchor check, accurate status labels, commands that exist |
| Tools and examples | Relevant test suites and the offline example |
| Library, voucher encoding or verification | Shared vectors in both languages, host-rejected vectors |
| Contract accounting, authorization, vouchers, storage or settlement | Written rationale, randomized accounting model, exact authorization tests, optimized-WASM tests, review of claim preservation, resource bounds and migration, and a second qualified reviewer |

A policy does not enable required reviews, branch protection or code-owner routing;
those are hosting controls (currently not enabled, [§1](#1-current-maintenance-status)).

## 12. Security reporting and incident response

Reporting follows [SECURITY.md](../SECURITY.md). Incidents are classified by where
the affected code runs, because the available responses differ:

| Incident | Possible response |
|---|---|
| Vulnerability in unpublished source | Fix on `main` with a regression test; advisory if any published artifact is affected |
| Vulnerability in a published package | Patch release on every supported line, advisory, affected and fixed version ranges |
| Vulnerability in a deployed contract | No patch is possible. Warn affected owners and providers, stop admitting the version, stop new exposure, release a fixed version under a new contract ID, and guide closure and migration under the old contract's own rules |
| Agent signer compromise | Stop service acceptance for the affected channels and start closure; exposure is bounded by each channel's remaining allocation |
| Provider journal failure | Stop accepting vouchers; recover from replicas; settle every acknowledged claim before its deadline |
| Coordinator failure | Providers self-submit; the coordinator restarts from its durable intents |
| Treasury deficit (issuer clawback) | Alert, stop new exposure, coordinate with the issuer; never report claims as paid from an insufficient balance |
| Storage expiration risk | Extend or restore the affected entries; anyone can submit the restoration |

Detailed runbooks belong in [production operations](production-operations.md).
The PoC has no pause, rotation or closure function.

## 13. Operational maintenance

None of these services exists yet ([ARCHITECTURE §13](ARCHITECTURE.md#13-implementation-status)).
Before any is operated, it needs a named operator and the obligations below.

| Service | Maintenance obligations |
|---|---|
| Durable agent signer | Key protection, durable counter backups, restore tests that prove no counter regression |
| Provider journal | Synchronous replication, restore drills with zero loss of acknowledged claims, deadline monitoring |
| Settlement coordinator | Durable intents, idempotent recording, quarantine review, backlog and failure alerts |
| Indexer and read API | Gap detection, checksummed archive, single-ledger reconciliation, freshness reporting |
| Storage keeper and deadline watcher | Inventory of every dependency (code, instance, channels, balances), extension before margin, restoration readiness, alerts before closure deadlines |
| Treasury Console | Dependency updates, wallet compatibility, durable transaction intents |

Proposed review cadence:

| Duty | Cadence or trigger |
|---|---|
| Contracts and accounting | Every protocol, asset or code change; before every deployment |
| Voucher codec and cryptography | Every cryptographic library, host or SDK change |
| SDK, wallets and adapters | Every release; every upstream breaking change |
| Dependencies and actions | Weekly triage; immediate triage of high-severity advisories |
| Settlement and claims | Continuous, with polling well inside the claim-deadline margin |
| Storage lifetime and rent | Scan interval derived from the minimum entry lifetime and recovery margin |
| Indexer and archive | Continuous ingestion; daily integrity and coverage review |
| Backups and recovery | Continuous journals; full restore at least quarterly (proposed) |
| Governance, access and succession | Quarterly and on every personnel or provider change |

Recovery point and time objectives, monitoring thresholds and runbooks are
defined in [production operations](production-operations.md), not here.

## 14. Licensing and third-party notices

The repository is licensed under [Apache-2.0](../LICENSE). The file is the
unmodified Apache-2.0 text; every crate and package manifest declares
`Apache-2.0`. Apache-2.0 suits payment infrastructure that others embed: it is
permissive for commercial use and includes an express patent license from
contributors. It grants no trademark rights and provides no warranty.

Preserve the complete license and existing notices. The contract, library, tools,
examples and documentation use that license unless a file or third-party
component states otherwise. This does not relicense dependencies, hosted assets,
issuer branding or third-party services. There is no NOTICE file because no
upstream NOTICE content is incorporated; do not add a fabricated one or a
fabricated copyright owner.

Contributors submit only material they may license; contributions are governed by
the license's contribution clause. There is no CLA, DCO or sign-off requirement.

**Dependency review.** At the last review, all 214 third-party crates in the full
Rust dependency graph, including the 61 compiled into the contract WASM (plus 11
build-time procedural macros), use
permissive licenses (MIT, Apache-2.0, BSD-2/3-Clause, ISC, Zlib, Unicode-3.0,
Unlicense). In the npm graph, production dependencies of the voucher library are
MIT, Apache-2.0 and BSD-3-Clause; `lightningcss` (MPL-2.0) is a development-only
build dependency and is never distributed. Redistributing the WASM or a bundled
package carries the attribution duties of those licenses, so each release bundle
includes generated third-party notices and an SBOM for the shipped artifact, not
just for `package.json`.

Redistributors include the license, mark modified files, keep applicable notices,
and carry forward any NOTICE content supplied by a component. Code adapted from
other projects keeps its original notices: for example, the Stellar MPP SDK
declares MIT in its package metadata, and the one-way channel and x402 projects
are Apache-2.0 (x402 ships a NOTICE file). AgentBatch currently copies no code
from them.

## 15. Deprecation and retirement

| Subject | Policy |
|---|---|
| SDK APIs | Deprecated with a replacement and a changelog entry; removed only in a later breaking release |
| Unsupported versions | Listed as end of life in the support table; no further fixes |
| Contract versions | A version stops being admitted for new treasuries; existing deployments keep running under their own rules |
| Voucher protocol | A new domain is introduced with a new contract version; decoders for old domains stay available while old channels can still be redeemed |
| Services | Announced with the date after which no new exposure is accepted; claims are settled or handed to providers for self-submission before shutdown |
| Artifacts and evidence | Releases, checksums, manifests, advisories and accounting evidence are preserved so historical deployments stay verifiable |

Notice periods are published with each announcement when the responsible people
can support them; no universal duration is promised here.

For immutable contracts, these remain outside repository maintainers' control:
whether an owner closes channels, whether providers redeem before deadlines,
storage-rent funding by third parties, the asset issuer's actions and network
availability. The PoC has no release path for unused reservations, so no
migration can recover its locked collateral, and none must be promised.
Retirement follows [operational retirement](production-operations.md).

## 16. Maintenance sustainability

The policy is sized for a small team:

- **Automated:** CI rebuilds and compares the deployed WASM, runs every test suite
  and archive check, verifies the CLI download, and Dependabot proposes updates.
- **Minimal commitments:** best-effort support for the PoC, fixes on `main`, and
  no backport branches until packages are published.
- **Explicit authority:** merging, releasing, publishing, deploying and approving
  for operation are separate, recorded decisions.
- **Before a production release**, establish: named maintainers and security
  responders; private vulnerability reporting; branch protection with required
  review; secret scanning; signed releases with provenance; the support table;
  operators, monitoring and tested recovery for every service; and an independent
  security assessment with remediation.
