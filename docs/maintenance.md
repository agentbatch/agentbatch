# Governance, maintenance, and releases

This document defines reviewable policies for the repository and proposed
production services. Roles, controls and schedules below are requirements to
establish; they do not identify current maintainers or prove hosting controls
are enabled. [Contribution](../CONTRIBUTING.md), [security](../SECURITY.md),
[conduct](../CODE_OF_CONDUCT.md), and [operations](production-operations.md) own
their respective workflows.

## Governance and authority

The repository does not establish a named governing body, maintainer roster,
component ownership map, production operator or succession agreement. Repository
access is not evidence of ownership of contributions or authority over a deployed
treasury. Copyright holders retain their existing rights. No ownership transfer
or new copyright assignment is made by this documentation.

Before a production release, record actual primary/backup component owners,
reviewers, security triage contact, package publisher, deployment approver,
artifact custodian and hosting administrators. Use repository permissions and
organizational approval records to verify who may merge, tag, publish and deploy.
These are distinct actions: an accepted PR does not authorize Mainnet deployment.
Treasury owners alone authorize their contract administration; repository
maintainers cannot rewrite deployed immutable contracts.

Proposed decision process: routine documentation/tool fixes receive component
review; protocol, financial, key, dependency and operational changes require a
written proposal with affected invariants, compatibility, threat and migration
analysis, an ADR when changing a design choice, and review by both the relevant
component owner and a second qualified reviewer. Resolve technical disagreements
in the proposal with evidence, alternatives and recorded release-authority
acceptance. If qualified reviewers or owners are unavailable, defer production
release. This policy does not certify historical reviews or current protection.

A succession plan must name backup authorities and transfer procedures for
repository/registry/hosting access, signing policies, artifacts, alerts and
security reports. Verify recovery credentials in an organizational vault, remove
outgoing access, record the handover and test restoration. Never transfer treasury
or agent secrets through public issues. Without an authorized successor, announce
reduced support through established channels, stop new production admission and
follow the retirement plan; do not fabricate a new custodian.

## Contribution and license scope

Preserve the complete existing [Apache-2.0 LICENSE](../LICENSE), copyright and
attribution notices. The repository's contract, library, tools, examples and
documentation use that declared license unless a file or third-party component
states otherwise. This statement does not relicense dependencies, hosted assets,
issuer branding or third-party services. Do not add a fabricated NOTICE or owner.

Redistributors must include the license, identify modified files, retain applicable
copyright/patent/trademark/attribution notices, and carry forward relevant NOTICE
content when supplied, as required by the existing license. Apache-2.0 grants
specified copyright and patent permissions; it does not grant trademark rights
or provide a warranty. The license text controls over this practical checklist.
Contributors should submit only material they have authority to license; intentional
contributions are governed by the existing license's contribution provision unless
explicitly stated otherwise. There is no added copyright assignment, CLA, DCO or
mandatory sign-off policy in this repository.

Before redistributing dependencies or adapted code, inventory exact source/version,
license, copyright/NOTICE obligations, modifications and shipped files. Generate
and review third-party notices and an SBOM for the actual package/artifact, not
just direct package.json entries. Referencing a Stellar example is not proof that
all copied code notices were preserved. Keep evidence of the license review in
the release. An Apache license string in package.json alone does not ship the
license text or satisfy every third-party notice obligation.

## Support and component maintenance

Current support is best-effort PoC development only. The reproducible baseline is
Rust 1.94.1, Soroban SDK 27.0.6, CLI 26.0.0, Node 22.13.1 and pnpm 10.19.0,
with JS SDK 17.2.1; package engines are broader than the tested matrix. No runtime,
wallet, network protocol or older release has an implied production support term.
Security support dates and patch backport branches must be declared before a
supported release; historical changelog entries are not support promises.

The proposed operating schedule below must acquire named owners, automation,
funding and escalation before it is relied upon:

| Component / duty | Cadence or trigger | Evidence / responsible role |
|---|---|---|
| Contracts and accounting | Every protocol/asset/code change; before deployment | Models, exact auth tests, optimized WASM, independent review; contract owner/release authority |
| Voucher codec and crypto | Every crypto/host/SDK change | Shared positive/negative vectors and provider acceptance parity; protocol owner |
| SDK, wallets and adapters | Every release; upstream breaking change | Generated-binding diff, clean-consumer tests, supported wallet matrix; SDK/integration owners |
| Dependencies and actions | Weekly update triage; immediate high-impact advisory triage | Lockfile/license/integrity review, tests and SBOM; component owner/security triage |
| Deployment catalog/asset controls | Before admission and regularly during operation | Code/asset/issuer/admin/holder-state checks; deployment/treasury operators |
| Settlement and claims | Continuous bounded polling below deadline margin | Backlog, unknown outcomes, funding and deadline alerts; settlement/provider operators |
| TTL and rent | Bounded scan derived from minimum TTL/recovery margin | Key inventory, simulated rent, confirmed extension/restore receipts; maintenance operator |
| Indexer/archive | Continuous ingestion; daily integrity/coverage review | Ledger checkpoints, checksums, lag/gap reconciliation; data operator |
| Backups and recovery | Continuous durable journals; periodic full restore, at least quarterly proposed | Measured RPO/RTO and claim-window exercise; data/signer/provider operators |
| Governance/access/retirement | Quarterly and every personnel/provider change | Primary/backup roster, access review, handover drill; hosting/release authority |

Existing Dependabot configuration proposes weekly Cargo, npm and Actions updates;
it excludes Soroban SDK automatic upgrades and Node type major upgrades as coded.
Bot configuration does not prove triage happened or updates were merged. CI pins
Actions by SHA and dependencies by lockfile, and verifies the downloaded Stellar
CLI archive against its pinned SHA-256 before extracting it. A production build
must also verify optimizer/toolchain artifacts, record immutable runner/image identity,
and review dependency scripts and build network access. Neither pinning nor tests
prove absence of malicious dependencies. Credential scopes must separate CI read
access from registry/deployment/signing privileges.

## Reproducible release procedure

This is a required future publishing procedure; no command here authorizes a tag,
commit, push, registry publication or deployment.

1. Select the approved source revision with no unreviewed tracked changes; inventory
   every required file. Verify release authority and compatibility/support matrix.
   Do not rely on `.secrets`, `.state`, `target`, `dist`, optional run indexes or
   untracked documentation. Preserve historical deployment evidence.
2. Export the intended tracked source into a clean temporary checkout. Install
   exact dependencies with `pnpm install --frozen-lockfile` and use pinned Rust/CLI.
   Build with `pnpm build` and run `pnpm check`. Rust commands use `--locked` where
   exposed; inspect that `stellar contract build --optimize` leaves the lockfile
   unchanged. Existing `cargo test` alone does not rebuild WASM.
3. In a second clean path/build environment reproduce optimized WASM and spec
   checksums. Current CI compares the PoC WASM to the historical Testnet manifest.
   Future production code needs a new version/manifest; do not relabel that archive
   to make a new binary appear historically deployed. Build-input checksums and
   independent reproduction accompany the new release.
4. Pack the library with the pinned package manager into a new temporary directory,
   list/extract its tarball and verify every declared export exists. Import it in
   a clean consumer outside the monorepo, typecheck declarations and run the
   published usage example. Repeat for proposed browser subpaths after they exist.
5. Inspect actual contents for LICENSE, usage docs, third-party notices, generated
   JS/types/spec, reviewed source maps and version metadata; reject secrets,
   private state, local deployment records and accidental workspace imports.
   Current `@agentbatch/voucher` is private and includes generated output, matching
   source for maps, the unchanged license and package README. Packaging completeness
   must be verified from the built tarball before any publication change.
6. Produce a release bundle: source archive with required lockfiles, optimized
   WASM and embedded spec, package tarballs, binding output, checksums (SHA-256),
   SBOM/notices, test/reproduction report, compatibility/support matrix, release
   notes, deployment manifest/schema and operator acceptance record. Record source,
   build tools/image, input/output hashes, builder and reviewer identities as
   provenance. Sign artifacts/manifests with an actually provisioned release
   mechanism and verify signatures from a separate consumer before publishing.
7. Publish only after approval, retain bundles in versioned immutable storage and
   an independent durable mirror, and verify downloaded checksums/imports. CI log
   and temporary artifact retention are insufficient. No signing key, provenance
   attestation, registry permission or durable mirror is established by this file.
8. Deploy through [operational acceptance](production-operations.md), archive actual
   deployment XDR/results/state, and validate on-chain code/config before catalog
   admission. Distinguish source publication, package release and network admission.

Useful read-only/local commands after preparing a clean release source:

```bash
pnpm build
pnpm check
sha256sum target/wasm32v1-none/release/agentbatch_poc.wasm
# From packages/voucher, with a fresh absolute output directory:
pnpm pack --pack-destination /tmp/agentbatch-package-review
```

Create a unique output directory for each packaging review; do not overwrite
retained artifacts. `git archive` of HEAD omits working-tree edits and all untracked
files. A review of pending changes must deliberately copy the intended tracked
working-tree bytes (plus explicitly selected new files when appropriate), then
check documentation links against that exact export. Never infer clone or package
completeness from files that happen to exist in a developer's workspace.

## Versioning, deprecation, and retirement

Use explicit contract/ABI, voucher-domain, package, event/API and database schema
versions; they are separate compatibility dimensions. Financial/lifecycle changes
need new immutable deployments and new compatibility entries, not a silent SDK
minor update to an existing contract identity. Regenerate and review bindings.
Announce deprecation with concrete support dates, migration instructions and
provider claim deadlines when authorities can actually support them; no universal
notice duration is invented here. Keep supported old readers/decoders available
while outstanding obligations or release verification require them.

Migration must stop new exposure on old deployments, preserve voucher validity
under old rules, maintain TTL and fee funding through closure, reconcile payouts,
finalize and withdraw eligible liquidity, and use fresh keys/channels on the new
contract. The PoC has no release path for unused reservations; source maintenance
cannot create one retroactively. Never promise automatic migration of its locked
funds. Retirement preserves public releases, checksums, manifests, security notices
and accounting evidence and follows [operational retirement](production-operations.md).
