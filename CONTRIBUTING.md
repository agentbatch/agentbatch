# Contributing

## Setup

- Rust toolchain from `rust-toolchain.toml` (1.94.1, `wasm32v1-none`)
- Stellar CLI 26.0.0
- Node ≥ 22.12 (tested with 22.13.1) and pnpm 10.19.0 (`corepack enable`)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check      # format, lint, contract + TS tests, archive checks, offline example
```

On machines with less than about 8 GB of memory, the contract build and test
run can be killed by the operating system. Limit parallelism:
`CARGO_BUILD_JOBS=1 cargo test --locked --workspace -- --test-threads=1`.

## Rules for changes

- **Contract changes** need tests. Authorization tests use enforcing
  `mock_auths` with exact invocation trees; never use `mock_all_auths` in a
  test that is meant to prove an authorization check. Voucher
  tests use real Ed25519 signatures. Constructor authorization must be tested
  through `deploy_v2`, because `Env::register` mocks constructor auth.
- **Accounting changes** must keep every invariant in
  [docs/accounting-invariants.md](docs/accounting-invariants.md) and pass
  `randomized_transitions_preserve_invariants`.
- **Voucher format changes** require a new domain value, regenerated vectors
  (`AGENTBATCH_UPDATE_VECTORS=1 cargo test voucher_vectors`), and matching
  TypeScript changes.
- **Evidence and benchmarks** must come from real runs. Preserve archived
  transaction and measurement files; create a new run with `pnpm testnet:demo`.
  The runner writes `deployments/testnet/runs/<run-id>/` and refuses reuse.
  An optional local `deployments/testnet/index.json` can select a reviewed run.
- **Secrets** must never be committed. Testnet keys live in `.secrets/`
  (gitignored).
- Pin exact dependency versions.

Follow the command reference in the
[Testnet tooling](tools/testnet/README.md) and [evidence verifier](tools/evidence/README.md). Reusable protocol code belongs in
`packages/`; deployment and audit commands belong in `tools/`; runnable
integration examples belong in `examples/`.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `test:`, `docs:`, `chore:`). Fill in the security checklist in the
pull request template for any contract change.

## Review requirements

Describe the concrete problem, resulting behavior, compatibility and validation.
Separate implemented behavior from proposals and recorded evidence. Update the owning
API, architecture or runbook when behavior changes; keep review findings in
[the separate report](docs/review-findings.md). Do not change archived identities
or measurements to describe new code.

Protocol/accounting/lifecycle/authorization changes need an independent accounting
model or adversarial regression evidence, optimized-WASM validation and review of
claim preservation, resource bounds, migration and issuer assumptions. Proposed
production policy requires component-owner review and a second qualified reviewer;
[maintenance](docs/maintenance.md) records that actual owners and hosting controls
still need appointment/configuration. A policy does not enable required reviews,
branch protection, CODEOWNERS routing or release signing automatically.

For documentation-only changes, validate local links/anchors, interface examples,
source claims, terminology and distributable references from the intended source
export. Re-run relevant existing checks; do not create tests that merely mirror
wording. Preserve unrelated local edits and untracked evidence. Build, pack and
inspect packages in a clean temporary checkout to detect accidental dependencies
on local generated/untracked files. Public package publication and network deployment
are separate release decisions; contributing a change authorizes neither.

Contribute only material you may license under the existing Apache-2.0 terms;
retain applicable third-party notices and do not assign another contributor's
copyright. There is no additional CLA or mandatory sign-off requirement. See
[license and release policy](docs/maintenance.md), [conduct](CODE_OF_CONDUCT.md)
and [security reporting](SECURITY.md). Public issues provide best-effort technical
support, not a production SLA; omit keys, signed private claims and customer data.
