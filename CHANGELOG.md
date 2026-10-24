# Changelog

## 0.2.0 — 2026-10-25 — second internal review

Every finding and fix is listed in [docs/review-findings.md](docs/review-findings.md).

### Security

- Off-chain verifier now applies the host's Ed25519 `verify_strict` rule and
  refuses unsafe signer keys; previously it could accept vouchers the contract
  rejects (High).
- Voucher stores are bound to one deployment and fail closed on bad data.
- `deposit` credits only the balance actually received (`TransferMismatch`).
- Contract error codes renumbered to 101–113 so they never collide with
  Stellar Asset Contract errors.

### Changed

- The contract extends only its own instance TTL, never the shared code
  entry; new channels always receive the full 30-day TTL.
- Testnet demo submits isolation and replay attacks on-chain, records each
  channel's ledger entry, performs a real withdrawal, labels every metric by
  source, and archives raw transaction XDR.
- CI builds and tests the deployed artifact, checks its hash, pins actions by
  SHA and uses `--locked`.

### Tests

- Contract: 66 tests (events, fee-charging token, code-TTL policy, artifact
  freshness, invalid-signature vectors, exact error assertions).
- TypeScript: 93 tests.

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
