# Security Policy

## Status

AgentBatch is a **proof of concept**. It is deployed on Stellar Testnet only,
with a synthetic test asset. The code has had an internal review
([docs/review-findings.md](docs/review-findings.md)) but **no independent external
audit**. Do not deploy it to Mainnet or use it with assets of value.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/agentbatch/agentbatch/security/advisories/new),
not as public issues. Include the affected component (contract, voucher
package, Testnet tooling or evidence verifier), the revision, and reproduction steps.

You can expect an acknowledgement within 5 business days.

## Scope

In scope: `contracts/agentbatch-poc`, `packages/voucher`, `tools/testnet`,
`tools/evidence`, and the voucher format in `docs/voucher-format.md`.

Known limitations that are not vulnerabilities are listed in
[docs/security-assumptions.md](docs/security-assumptions.md).
