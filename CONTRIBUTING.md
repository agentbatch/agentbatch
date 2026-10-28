# Contributing

## Setup

- Rust toolchain from `rust-toolchain.toml` (1.94.1, `wasm32v1-none`)
- Stellar CLI 26.x
- Node ≥ 22.12 and pnpm 10.19 (`corepack enable`)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check      # format, lint, contract + TS tests, archive checks, offline example
```

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
