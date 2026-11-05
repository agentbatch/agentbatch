# Security policy

## Status and supported scope

AgentBatch is a Testnet proof of concept using synthetic AUSD. Do not use assets
of value. Internal reviews are in [review-findings](docs/review-findings.md) and
the [superseded first report](docs/audit-report.md); neither is an independent
external security audit. The production architecture is proposed and its services
are not implemented. No production version or guaranteed security-support period
is established. Report suspected issues against the exact revision and component.

In scope: contracts, voucher encoding/signing/verification and stores, Testnet
tooling, evidence verification, dependencies and financial/authorization claims
in documentation. Disclosed PoC limitations remain in
[security assumptions](docs/security-assumptions.md); a violation of a stated
bound or an unexpected interaction can still be a vulnerability.

## Private reporting and coordinated disclosure

Prefer [GitHub private vulnerability reporting](https://github.com/agentbatch/agentbatch/security/advisories/new)
if it is enabled and available to your account. This repository has not verified
that hosting setting or appointed a private triage team/contact. If unavailable,
ask repository administrators to establish a confidential reporting channel without
publishing exploit details, private keys, live vouchers or personal data. No private
email address is invented here; do not use public issues for sensitive findings.
A monitored reporting route and primary/backup responder are production release gates.

Provide affected revision/WASM hash, network/contract (if relevant), component,
impact, minimal reproduction, expected/observed behavior and any safe mitigation.
Use local tests or disposable Testnet assets; do not exploit other users or move
their funds. Share secrets only through an agreed protected channel, and avoid
including secrets at all when a minimal fixture suffices.

Proposed triage procedure: acknowledge privately, reproduce and assess financial,
privacy and operational impact, agree a disclosure plan with the reporter, prepare
fixes/tests and compatibility guidance, then publish an advisory and affected/fixed
versions when users can mitigate. Coordinate urgent user protection before public
technical details when appropriate. Record unresolved risks and do not mark a
fix deployed based only on a merged change. A five-business-day acknowledgment is
a target requiring an assigned responder, not a current guaranteed response time;
no bounty or fixed remediation deadline is promised.

## Response and release requirements

Preserve evidence and isolate compromised keys/services. The PoC has no pause,
rotation or closure function, and immutable code cannot be patched in place.
The proposed production [incident procedures](docs/production-operations.md)
preserve provider claims during replacement/closure. Issuer freeze/clawback and
RPC availability are external risks, not powers the repository can override.

Before production: appoint security/release owners, verify confidential reporting,
fund incident/claim/TTL response, complete independent assessment and remediation,
verify artifacts/provenance, and test recovery. Branch protection, signing, secret
scanning, registry permissions and advisories require actual hosting controls;
this policy does not enable them.
