# Security policy

## Status and supported scope

AgentBatch is a Testnet proof of concept using synthetic AUSD. Do not use assets
of value. Internal reviews are in [review-findings](docs/review-findings.md),
[repository review](docs/repository-review.md) and the
[superseded first report](docs/audit-report.md); none is an independent external
security audit. The production architecture is specified and its services are not
implemented. No production version or security-support period is established.

| Version | Supported |
|---|---|
| `main` branch | Yes, best-effort: fixes land here |
| Deployed Testnet PoC (`ab37537a…8a04`) | Reports accepted; the deployed code cannot be patched ([below](#response-and-release-requirements)) |
| Published packages | None exist yet; the support table in [maintenance §3](docs/maintenance.md#3-support-policy) applies once they do |

In scope: contracts, voucher encoding, signing, verification and stores, Testnet
tooling, evidence verification, dependencies, CI and release configuration, and
financial or authorization claims in documentation. Disclosed PoC limitations are
listed in [security assumptions](docs/security-assumptions.md); a violation of a
stated bound or an unexpected interaction can still be a vulnerability.

## Reporting a vulnerability

Do not report vulnerabilities in public issues.

GitHub private vulnerability reporting is **not currently enabled** for this
repository, and no private triage team or security contact has been appointed.
Until both exist:

1. Open a public issue with the bug report template, titled "Request for a
   private security contact", with no technical details, exploit steps, keys,
   vouchers or personal data.
2. Share details only after a confidential channel has been agreed with a
   repository administrator.

When private reporting is enabled, use
[GitHub private vulnerability reporting](https://github.com/agentbatch/agentbatch/security/advisories/new)
instead. A monitored reporting route with primary and backup responders is a
production release gate ([maintenance §16](docs/maintenance.md#16-maintenance-sustainability)).

Include the affected revision or WASM hash, network and contract ID (if any),
component, impact, a minimal reproduction, expected and observed behavior, and any
safe mitigation. Use local tests or disposable Testnet assets; do not exploit
other users or move their funds. Avoid sharing secrets at all when a minimal
fixture is enough.

## Triage and disclosure

Proposed procedure: acknowledge privately, reproduce, assess financial, privacy
and operational impact, agree a disclosure plan with the reporter, prepare fixes,
tests and compatibility guidance, then publish an advisory with affected and fixed
versions once users can act on it. Coordinate user protection before publishing
technical details when needed. A merged fix is not a deployed fix. A
five-business-day acknowledgment is a target that requires an assigned responder,
not a current guarantee; there is no bounty or fixed remediation deadline.

## Response and release requirements

Responses depend on where the affected code runs
([maintenance §12](docs/maintenance.md#12-security-reporting-and-incident-response)):
unpublished source is fixed on `main`; published packages get patch releases and
advisories; a deployed contract **cannot be patched** and is handled by warning
affected users, stopping new exposure and releasing a fixed version under a new
contract ID. The PoC has no pause, rotation or closure function. The proposed
production [incident procedures](docs/production-operations.md) preserve provider
claims during replacement and closure. Issuer freeze or clawback and RPC
availability are external risks the repository cannot override.

Before a production release: appoint security and release owners, enable private
reporting, branch protection and secret scanning, staff and provision incident, claim and
storage response, complete an independent assessment and remediation, verify artifacts and
provenance, and test recovery. This policy does not enable any hosting control by
itself.
