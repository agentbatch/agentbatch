# Changelog

## 0.1.0 — 2026-10-24 — SCF #46 proof of concept

### Added

- `AgentBatchPoC` Soroban contract: shared treasury, virtual channels with
  exclusive collateral reservations, Ed25519 cumulative vouchers
  (`AGENTBATCH_POC_V1`), atomic `redeem_batch` (up to 4 channels), and
  withdrawal limited to unallocated funds.
- Contract test suite (59 tests): authorization including constructor
  deployment via `deploy_v2`, voucher binding, accounting with a randomized
  model-based test, batch atomicity, storage TTL and archival, WASM execution,
  cross-language vectors, resource metering.
- `@agentbatch/voucher`: voucher encoding, agent signer, provider verifier,
  deployment pinning, file-backed highest-voucher store (52 tests).
- Testnet demo: AUSD issuance, two deployments, a three-provider off-chain
  simulation, batch and incremental settlement, replay checks, and a
  batch-versus-separate benchmark.
- Documentation: architecture, voucher format, invariants, security
  assumptions, benchmarks, specification review, internal audit report, SCF
  evidence.
