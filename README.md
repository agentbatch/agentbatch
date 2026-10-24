# AgentBatch

**Shared treasury and batch settlement infrastructure for AI-agent payments on Stellar.**

AgentBatch lets an organization fund **one** Soroban treasury, back **many**
independent provider payment channels from it, let AI agents pay through
off-chain Ed25519 cumulative vouchers, and settle several providers in **one
atomic transaction**.

> **Status:** Proof of concept for the Stellar Community Fund #46. Testnet
> only, with a synthetic test asset (`AUSD`). Internally reviewed; **not
> independently audited**. Do not use with real funds.

## What the PoC proves

| Innovation | Demonstrated by |
|---|---|
| **Shared treasury funding**: one deposit funds several providers | 100 AUSD deposited once; three channels of 40 / 35 / 15 reserved from it |
| **Independent virtual channels**: storage records with isolated collateral, no per-channel contracts | On Testnet, 40 / 35 / 15 AUSD reserved from one 100 AUSD deposit in a single contract; over-allocation, cross-channel and reserved-withdrawal attacks rejected in the contract test suite |
| **Batched multi-provider settlement**: independent vouchers settled atomically | One `redeem_batch` transaction paid 12 / 8 / 5 AUSD to three providers on Testnet |

Results, transaction hashes and benchmarks: **[SCF_POC_EVIDENCE.md](SCF_POC_EVIDENCE.md)**.

## Repository layout

```text
contracts/agentbatch-poc/   Soroban contract AgentBatchPoC (Rust, no_std) and its test suite
packages/voucher/           @agentbatch/voucher: voucher encoding, agent signing,
                            provider-side verification, highest-voucher store
apps/demo/                  Testnet runner: AUSD issuance, deployment, three-provider
                            simulation, batch settlement, benchmarks, evidence files
test-vectors/               Rust-generated voucher vectors that TypeScript must match byte for byte
deployments/testnet/        Deployment manifest and raw evidence from the Testnet run
docs/                       Architecture, voucher format, invariants, security, benchmarks, review
scripts/testnet-demo.sh     Build, test, deploy and demonstrate end to end
```

## Contract interface

| Function | Auth | Purpose |
|---|---|---|
| `__constructor(owner, token)` | owner | Bind the owner and the 7-decimal payment token permanently |
| `deposit(amount)` | owner | Fund the treasury |
| `open_channel(provider, signer_key, allocation)` | owner | Reserve collateral for a provider and an agent key |
| `redeem_batch(vouchers)` | anyone | Settle 1–4 channels atomically; payouts go only to stored providers |
| `withdraw_available(amount)` | owner | Withdraw unallocated funds only |
| `get_treasury()` / `get_channel(id)` / `voucher_message(id, amount)` | — | Read-only views |

See [docs/architecture.md](docs/architecture.md) and
[docs/voucher-format.md](docs/voucher-format.md).

## Quick start

Requirements: Rust 1.94.1 with the `wasm32v1-none` target (pinned in
`rust-toolchain.toml`), Stellar CLI 26.x, Node ≥ 22.12, pnpm 10.

```bash
# Everything: install, format check, build, lint, contract and TypeScript tests
make all

# Testnet: build the contract, deploy and run the full demonstration
# (writes deployments/testnet/ and docs/benchmarks/testnet-resources.json)
pnpm demo:testnet
```

The Testnet runner creates its keys on first use in `.secrets/`, which is
gitignored, and funds them through friendbot. No secret is ever written to a
tracked file.

## Documentation

| Document | Contents |
|---|---|
| [SCF_POC_EVIDENCE.md](SCF_POC_EVIDENCE.md) | What is implemented, tested and observed on Testnet; all transaction hashes |
| [docs/architecture.md](docs/architecture.md) | Contract design, storage and TTL, settlement flow, deviations from existing Stellar channels |
| [docs/voucher-format.md](docs/voucher-format.md) | Exact signed-message encoding and binding properties |
| [docs/accounting-invariants.md](docs/accounting-invariants.md) | Treasury invariants and how they are verified |
| [docs/security-assumptions.md](docs/security-assumptions.md) | Threat model, trust assumptions, known limitations |
| [docs/benchmarks.md](docs/benchmarks.md) | Testnet and local resource and fee measurements |
| [docs/poc-spec-review.md](docs/poc-spec-review.md) | Review of the PoC brief: interpretation decisions and how they were implemented |
| [docs/review-findings.md](docs/review-findings.md) | Second internal review: every finding and fix, with regression tests |
| [docs/audit-report.md](docs/audit-report.md) | First internal review (superseded by the second) |
| [docs/vision.md](docs/vision.md) | Full product vision and roadmap |

## Scope

The PoC deliberately leaves out channel closure and dispute periods,
revocation, signer rotation, collateral reallocation, multi-tenant treasuries,
keeper incentives, netting, MPP and x402 adapters, a production SDK, a
Treasury Console, upgradeability, and Mainnet deployment. These are the
grant-funded roadmap (see [docs/vision.md](docs/vision.md)).

Building on prior Stellar work: the voucher encoding follows the commitment
convention of
[stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel)
and the [Stellar MPP SDK](https://github.com/stellar/stellar-mpp-sdk).

## License

[Apache-2.0](LICENSE)
