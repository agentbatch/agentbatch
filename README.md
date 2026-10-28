# AgentBatch

**Shared treasury and batch settlement infrastructure for AI-agent payments on Stellar.**

Stellar's [x402 `exact` flow](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md)
settles individual payments on-chain. The current
[Stellar MPP channel implementation](https://github.com/stellar/stellar-mpp-sdk)
uses [one-way channels](https://github.com/stellar-experimental/one-way-channel)
funded for a payer–provider relationship. Agent fleets buying from many services
must manage repeated settlements and separately allocated balances.

AgentBatch proposes an open-source Soroban layer where **one organization-funded
USDC treasury backs many agents across independent providers**. Its differentiation
combines shared liquidity, virtual channels with reserved collateral, delegated
off-chain vouchers, and bounded multi-provider settlement.

## Full project design

- **One treasury, many virtual channels.** Channels are records inside shared
  infrastructure, avoiding a separate deployment and deposit for each relationship.
- **Bounded exposure.** Each channel reserves its maximum liability. The full
  design targets enforceable per-agent and per-provider budgets across channels;
  these require aggregate accounting in addition to individual channel ceilings.
- **Off-chain request payments.** Agents sign cumulative vouchers using delegated
  keys. Providers verify each voucher and its payment increment before serving.
- **Bounded batch settlement.** Providers or coordinators redeem claims across
  multiple channels, paying only the amount owed beyond previous redemptions.
- **Safe liquidity reuse.** Uncommitted or safely released funds can be reassigned
  through contract accounting without transferring USDC between channel contracts.
  Collateral backing outstanding claims remains reserved.
- **Protected closure.** The planned lifecycle starts a claim period during which
  providers can redeem outstanding vouchers before eligible remaining funds are
  released or refunded. Providers must monitor and submit claims within the
  protocol's defined window.
- **Developer integration.** A planned TypeScript SDK and explicit Stellar x402
  batch-settlement integration will support compatible clients and facilitators.
  Voucher payments require scheme/adapter support and cannot be assumed compatible
  with the existing `exact` implementation unchanged.

Our vision is to make Stellar the network of choice for high-volume agent commerce.
The [full vision and roadmap](docs/vision.md) describes the intended product;
[architecture](docs/architecture.md) describes the implementation available today.

## Implemented PoC

> The current code is a limited Stellar Testnet proof of concept using synthetic
> AUSD, not USDC. It has internal review and regression tests, but no independent
> external security audit. Do not use it with assets of value.

The PoC implements one treasury per deployment, independently reserved channels,
real Ed25519 cumulative vouchers, provider-side verification and durable voucher
stores, atomic settlement of 1–4 channels, incremental redemption, and owner
withdrawal of unallocated funds. It enforces per-channel allocations; aggregate
agent/provider budgets, channel closure, collateral recycling and x402 integration
remain planned work.

Its distinguishing architecture was demonstrated by one 100 AUSD deposit backing
three channels of 40 / 35 / 15 AUSD. Agents completed 11 simulated paid requests
with no transaction submissions during those requests. One batch then paid
12 / 8 / 5 AUSD to the three providers.

## PoC and execution evidence

The committed archive describes the **24 October 2026 run**:

- Public deployment metadata and build fingerprint:
  [deployments/testnet/manifest.json](deployments/testnet/manifest.json).
- Transaction hashes, raw envelope/result/metadata XDR, channel records and scenario
  assertions: [deployments/testnet/evidence.json](deployments/testnet/evidence.json).
  This run contains **22 transactions: 19 successful and 3 intentionally failed**.
- Recorded resource and fee measurements:
  [docs/benchmarks/testnet-resources.json](docs/benchmarks/testnet-resources.json).
- Accounting invariants and security findings:
  [accounting](docs/accounting-invariants.md),
  [security assumptions](docs/security-assumptions.md), and
  [review findings](docs/review-findings.md).

Public links for that committed run:

- Demo treasury:
  https://stellar.expert/explorer/testnet/contract/CCNFYVZNOP7TK4BK4PMF36FU7UXC4SN4G6LQWTQ3CBLAR4EBDT4YKMGJ
- Three-provider batch, paying 12 / 8 / 5 AUSD:
  https://stellar.expert/explorer/testnet/tx/cf74ff58182bfd6db9be07d3b0601191bd58f4b759172422a52d53d4b82dd2c2
- Incremental redemption, cumulative 17 AUSD paying an additional 5:
  https://stellar.expert/explorer/testnet/tx/8b707294e93897e3a5ca226ecc7de0767cd9bef299855a5ec6e6d3838a18f7e6
- Replayed batch rejected on-chain:
  https://stellar.expert/explorer/testnet/tx/ee90afe38c405ac89aaf8cff0e932c007b84137b3a257bcbf41d18dffc75fa8f

An additional **25 October 2026 reproduction** exercised the reorganized tooling
with fresh accounts and contracts. Its public transaction references are separate
from the committed 24 October archive:

- Demo treasury:
  https://stellar.expert/explorer/testnet/contract/CAG47O2YYEFW4RR6RXUCUN4H3JMCDWSXFNSKVSAQJ4PSFUZ5PS7EAXNF
- Shared deposit of 100 AUSD:
  https://stellar.expert/explorer/testnet/tx/454dbd2589fc87a1463af2ada09fdac11b9a1c814fe7eadb60a1d881742c1d43
- Three-provider batch:
  https://stellar.expert/explorer/testnet/tx/106aeba342fb9b120056dda94447509241067a0b441a374a37bbdc1f60c6cd5f
- Incremental redemption:
  https://stellar.expert/explorer/testnet/tx/7cc412ada3bfdebb8ad2dd0045760acd48ca578441748f89ddd1583bcdc59666
- Above-allocation voucher rejected:
  https://stellar.expert/explorer/testnet/tx/8d275765678190f4dceed7f244b46cc5b88d2105338112b1d5abc835fb25e5c3
- Cross-channel voucher rejected:
  https://stellar.expert/explorer/testnet/tx/9ea31ea897369f2e7d0630be1bfc9c24d27694db8203e029ec32ba68689b8a4e
- Replayed batch rejected:
  https://stellar.expert/explorer/testnet/tx/1ddc4f1d0c7ce779e458a5c03b242970593e1c240bfd2ee17f17073f68f0cacf
- Baseline treasury withdrawal, limited to 10 unallocated AUSD:
  https://stellar.expert/explorer/testnet/tx/e6402300b428add6bc8535920baec4740edc195cc730b2ea092dcc6a389017b3

The committed benchmark measured 22,294 stroops for a three-provider redemption
versus 32,898 for three separate redemptions: approximately **32.23% lower
settlement fees for that workload**. This measures redemption fees; deployment,
channel rent and other lifecycle costs are separate. Resource limits declared
from simulation are labeled separately from fees actually charged.

The optimized WASM is 17,001 bytes, SHA-256:

```text
ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04
```

Use `pnpm evidence:check` for offline consistency, payout and fee checks. Use
`pnpm evidence:verify` for read-only network reconciliation while the endpoint
retains the transaction records. Local consistency checks do not authenticate
files against the network. See [verification tooling](tools/evidence/README.md).

## Repository layout

```text
contracts/agentbatch-poc/    Soroban contract, native and compiled-WASM tests
packages/voucher/           Reusable encoding, signing, verification and voucher stores
tools/testnet/              Deployment, provider simulation, settlement and benchmarks
tools/evidence/             Offline archive checks and read-only RPC verification
examples/offline-payments/  Runnable local signing and verification example
test-vectors/              Shared Rust/TypeScript protocol compatibility fixtures
deployments/testnet/        Indexed historical evidence and isolated new runs
docs/                      Protocol, development, security and execution documentation
scripts/                   Thin command compatibility wrappers
.github/                   CI and contribution templates
```

## Contract interface

- `__constructor(owner, token)`: owner-authorized, permanently binds owner and
  the seven-decimal payment token.
- `deposit(amount)`: owner funds the treasury.
- `open_channel(provider, signer_key, allocation)`: owner reserves channel collateral.
- `redeem_batch(vouchers)`: anyone may settle 1–4 channels; recipients come from storage.
- `withdraw_available(amount)`: owner withdraws unallocated funds only.
- `get_treasury()`, `get_channel(id)`, `voucher_message(id, amount)`: read-only views.

See [docs/architecture.md](docs/architecture.md) and
[docs/voucher-format.md](docs/voucher-format.md).

## Quick start

Requirements: Rust 1.94.1 with the `wasm32v1-none` target (pinned in
`rust-toolchain.toml`), Stellar CLI 26.x, Node ≥ 22.12, pnpm 10.

```bash
# Install exact dependencies, build and run all offline checks
pnpm install --frozen-lockfile
pnpm build
pnpm check

# Try the signing and verification flow without network access
pnpm example:offline

# Deploy disposable accounts/contracts and run the Testnet demonstration
pnpm testnet:demo

# Check archived evidence locally, or reconcile the selected run with Testnet RPC
pnpm evidence:check
pnpm evidence:verify
```

Each Testnet invocation creates a unique `deployments/testnet/runs/<run-id>/`
directory and fresh disposable keys under `.secrets/testnet/`. Provider state
lives under `.state/testnet/<run-id>/`. Both private directories are gitignored.
Existing runs are never reused. The original committed archive is the default;
an optional local `deployments/testnet/index.json` can select additional runs.

See the [Testnet tooling](tools/testnet/README.md) and
[evidence verifier](tools/evidence/README.md) for commands and run selection. `make all` remains a shortcut for
installation, building and offline validation.

## Documentation

- [Vision and roadmap](docs/vision.md): complete product design and development objectives.
- [Architecture](docs/architecture.md): current contract, storage, TTL and settlement flow.
- [Voucher format](docs/voucher-format.md): exact signed encoding and domain binding.
- [Accounting invariants](docs/accounting-invariants.md): collateral and payout rules.
- [Security assumptions](docs/security-assumptions.md): threat model and implementation limits.
- [Benchmarks](docs/benchmarks.md): recorded resource and fee measurements.
- [Specification review](docs/poc-spec-review.md): implementation decisions.
- [Review findings](docs/review-findings.md): security corrections and regression coverage.
- [Earlier internal review](docs/audit-report.md): historical review findings.

## Scope

The PoC deliberately leaves out channel closure and dispute periods,
revocation, signer rotation, collateral reallocation, multi-tenant treasuries,
keeper incentives, netting, MPP and x402 adapters, a production SDK, a
Treasury Console, upgradeability, and Mainnet deployment. These are the
technical roadmap (see [docs/vision.md](docs/vision.md)).

Building on prior Stellar work: the voucher encoding follows the commitment
convention of
[stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel)
and the [Stellar MPP SDK](https://github.com/stellar/stellar-mpp-sdk).

## License

[Apache-2.0](LICENSE)
