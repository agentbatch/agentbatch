# Contributing

Thank you for helping improve AgentBatch. This guide covers setup, checks,
contribution rules and review. Project status, support and release policy are in
the [maintenance policy](docs/maintenance.md).

## Setup

- Rust toolchain from `rust-toolchain.toml` (1.94.1, `wasm32v1-none`), installed
  automatically by `rustup`
- Stellar CLI 26.0.0, the version that reproduces the deployed PoC's WASM hash
  ([why it is pinned](docs/maintenance.md#5-stellar-toolchain-and-compatibility))
- Node ≥ 22.12 (tested with 22.13.1) and pnpm 10.19.0 (`corepack enable`)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check      # format, lint, contract + TS tests, archive checks, offline example
```

On machines with less than about 8 GB of memory, the contract build and test
run can be killed by the operating system. Limit parallelism:
`CARGO_BUILD_JOBS=1 cargo test --locked --workspace -- --test-threads=1`.

## Useful commands

| Command | What it does | Network |
|---|---|---|
| `pnpm check` | Everything CI runs: formatting, Clippy, type checks, contract tests against the optimized WASM, TypeScript tests, archive checks, offline example | None |
| `pnpm test:contracts` | Builds the optimized WASM and runs the Rust tests | None |
| `pnpm test:ts` | Runs the voucher, Testnet-tool and evidence test suites | None |
| `pnpm example:offline` | Runs the local signing and verification example | None |
| `pnpm evidence:check` | Checks the committed Testnet archive offline | None |
| `pnpm evidence:verify` | Re-fetches archived transactions from Testnet RPC (read-only) | Testnet RPC |
| `pnpm testnet:demo` | Deploys disposable accounts and contracts and records a new run | Testnet (submits transactions) |

## Reporting bugs and proposing features

- **Bugs:** use the bug report template with the exact revision, component,
  commands and output. Omit keys, signed vouchers, private claims and customer data.
- **Features:** use the feature request template and link the related
  [FUTURE_WORK](docs/FUTURE_WORK.md) item if one exists. Changes to money-moving
  behavior start with a written proposal (see [review requirements](#review-requirements)).
- **Security vulnerabilities:** never in public issues; follow [SECURITY.md](SECURITY.md).

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
- **Dependencies** are pinned to exact versions. Do not upgrade a pinned
  toolchain or SDK inside an unrelated change
  ([compatibility rules](docs/maintenance.md#5-stellar-toolchain-and-compatibility)).

Follow the command reference in the
[Testnet tooling](tools/testnet/README.md) and [evidence verifier](tools/evidence/README.md). Reusable protocol code belongs in
`packages/`; deployment and audit commands belong in `tools/`; runnable
integration examples belong in `examples/`.

## Pull requests

1. Branch from `main` and keep the change focused.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
   `fix:`, `test:`, `docs:`, `chore:`).
3. Run `pnpm check`, or the subset relevant to the change, and paste the result
   into the pull request.
4. Fill in the pull request template, including the security checklist for any
   contract change and the documentation checklist.
5. Never claim Testnet results without transaction hashes.

## Review requirements

Describe the concrete problem, resulting behavior, compatibility and validation.
Separate implemented behavior from proposals and recorded evidence. Update the owning
API, architecture or runbook when behavior changes; keep review findings in
[the separate report](docs/review-findings.md). Do not change archived identities
or measurements to describe new code.

Changes to treasury accounting, authorization, vouchers, storage or settlement need
a technical rationale, an independent accounting model or adversarial regression
evidence, optimized-WASM validation, and review of claim preservation, resource
bounds, migration and issuer assumptions. Proposed production policy requires
component-owner review and a second qualified reviewer
([maintenance §11](docs/maintenance.md#11-contribution-and-review)). A policy does
not enable required reviews, branch protection or code-owner routing by itself.

**Documentation-only changes** need no extra process: validate local links and
anchors, keep implementation-status labels accurate, and make sure every command
shown exists. Do not create tests that merely mirror wording. Preserve unrelated
local edits and untracked evidence.

**Breaking changes** (contract ABI, events, voucher format, package API, storage
schema) are listed under "Unreleased" in the [changelog](CHANGELOG.md) with
migration notes. A financial or lifecycle change ships as a new contract version,
never as a change to an existing deployment
([contract maintenance](docs/maintenance.md#6-smart-contract-maintenance)).

Build, pack and inspect packages in a clean temporary checkout to detect
accidental dependencies on local generated or untracked files. Package publication
and network deployment are separate release decisions; contributing a change
authorizes neither.

## License and conduct

Contribute only material you may license under the existing Apache-2.0 terms;
retain applicable third-party notices and do not assign another contributor's
copyright. There is no additional CLA or mandatory sign-off requirement. See
[licensing](docs/maintenance.md#14-licensing-and-third-party-notices),
[conduct](CODE_OF_CONDUCT.md) and [security reporting](SECURITY.md). Public issues
provide best-effort technical support, not a production SLA.
