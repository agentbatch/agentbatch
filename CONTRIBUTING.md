# Contributing

## Setup

- Rust toolchain from `rust-toolchain.toml` (1.94.1, `wasm32v1-none`)
- Stellar CLI 26.x
- Node ≥ 22 and pnpm 10 (`corepack enable`)

```bash
pnpm install --frozen-lockfile
make all        # fmt check, clippy, contract + TS tests, builds
```

## Rules for changes

- **Contract changes** need tests. Authorization tests use enforcing
  `mock_auths` with exact invocation trees, never `mock_all_auths`. Voucher
  tests use real Ed25519 signatures. Constructor authorization must be tested
  through `deploy_v2`, because `Env::register` mocks constructor auth.
- **Accounting changes** must keep every invariant in
  [docs/accounting-invariants.md](docs/accounting-invariants.md) and pass
  `randomized_transitions_preserve_invariants`.
- **Voucher format changes** require a new domain value, regenerated vectors
  (`AGENTBATCH_UPDATE_VECTORS=1 cargo test voucher_vectors`), and matching
  TypeScript changes.
- **Evidence and benchmarks** must come from real runs. Never edit
  `deployments/testnet/` or `docs/benchmarks/*.json` by hand.
- **Secrets** must never be committed. Testnet keys live in `.secrets/`
  (gitignored).
- Pin exact dependency versions.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `test:`, `docs:`, `chore:`). Fill in the security checklist in the
pull request template for any contract change.
