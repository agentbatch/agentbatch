# Resource and Fee Benchmarks

Two sources, reported separately:

- **Testnet**: real transactions; fees are `feeCharged` from the transaction
  result, resources are the declared Soroban resources. Raw data:
  [`benchmarks/testnet-resources.json`](benchmarks/testnet-resources.json) and
  [`../deployments/testnet/evidence.json`](../deployments/testnet/evidence.json).
- **Local**: soroban-sdk invocation metering on the compiled WASM. Raw data:
  [`benchmarks/local-resources.json`](benchmarks/local-resources.json).
  Its fee estimates use the SDK's hardcoded Mainnet fee snapshot (with a
  deliberately conservative rent rate), exclude inclusion and size fees, and
  are not network fees.

Tool versions: rustc 1.94.1, soroban-sdk 27.0.6, stellar CLI 26.0.0,
@stellar/stellar-sdk 17.2.1, Node 22.13.1, Testnet protocol 29
(stellar-rpc 30.0.0). Run date 2026-10-24. Testnet fees vary with network
conditions; these figures come from one run.

## Contract artifact

| Item | Value |
|---|---|
| Build | `stellar contract build --optimize` |
| WASM size | 16,575 bytes |
| SHA-256 | `f915e248eca5ab71ab87ae1fb4341d3951415b36cbc4e8ad90777b57c3c87863` |

## Per-operation cost (Testnet)

1 XLM = 10,000,000 stroops.

| Operation | Fee charged (stroops) | of which rent | CPU instructions | Ledger entries RO / RW | Write bytes |
|---|---:|---:|---:|---:|---:|
| Upload WASM (one-time) | 42,154 | 0 | 15,629,638 | 1 / 0 | 0 |
| Deploy treasury contract | 11,826,274 | 11,821,684 | 1,130,788 | 2 / 1 | 552 |
| `deposit` | 4,807,743 | 4,797,961 | 932,398 | 3 / 3 | 892 |
| `open_channel` | 8,915,421 | 8,909,409 | 809,992 | 1 / 2 | 968 |
| `redeem_batch`, 1 voucher | 10,968 | 0 | 1,595,227 | 2 / 4 | 1,308 |
| `redeem_batch`, 3 vouchers | 22,296 | 0 | 3,309,030 | 2 / 8 | 2,372 |

Setup cost is almost entirely **rent**: the contract extends the instance,
code and each new channel entry to a 30-day TTL when they are created (the
channel entry was measured live with exactly 30.0 days of TTL). On the
identical baseline deployment minutes later, the same `deposit` cost 5,631,878
and `open_channel` 10,445,957 stroops: Testnet rent rates moved between the
runs. Settlement transactions paid no rent because their entries were already
above the extension threshold.

## Settlement comparison (Testnet)

Equal starting states: two deployments of the same WASM, each with 100 AUSD
deposited and 40 / 35 / 15 AUSD channels to the same three providers, settling
12 / 8 / 5 AUSD.

| Metric | Baseline: 3 separate 1-voucher txs | AgentBatch: 1 tx with 3 vouchers | Difference |
|---|---:|---:|---:|
| Transactions | 3 | 1 | −2 |
| Total fee charged (stroops) | 32,904 | 22,296 | −32.2% |
| CPU instructions | 4,785,681 | 3,309,030 | −30.9% |
| Read-only footprint entries | 6 | 2 | −4 |
| Read-write footprint entries | 12 | 8 | −4 |
| Disk read bytes | 348 | 348 | 0 |
| Write bytes | 3,924 | 2,372 | −39.6% |
| Envelope bytes | 2,580 | 1,540 | −40.3% |
| SAC transfers | 3 | 3 | 0 |
| Signature verifications | 3 | 3 | 0 |

Reading the result:

- Settling three vouchers in one transaction cost about **32% less** in fees
  than three separate transactions, **not 66%**. The work per voucher (one
  Ed25519 verification, one channel write, one token transfer) stays the same.
  What batching saves is the repeated per-transaction overhead: contract
  instance and code loading, the treasury entry write, the envelope, and the
  inclusion fee.
- Per-voucher cost after the first: (22,296 − 10,968) / 2 ≈ 5,664 stroops.
- At Testnet rates, opening a channel costs far more than settling it. Shared
  funding avoids deploying a contract per provider (11.8M stroops each on this
  run) but still pays rent for one channel entry per provider.

## Local metering (compiled WASM, soroban-sdk testutils)

| Operation | CPU instructions | Write entries | Write bytes |
|---|---:|---:|---:|
| `deposit` | 804,331 | 4 | 1,068 |
| `open_channel` | 686,292 | 3 | 1,028 |
| `redeem_batch`, 1 voucher | 1,346,669 | 4 | 1,404 |
| `redeem_batch`, 3 vouchers | 2,913,948 | 8 | 2,668 |
| Baseline: 3 × 1 voucher (total) | 4,033,709 | 12 | 4,212 |

The local instruction counts are lower than Testnet's declared values because
local metering does not model every production step (for example, some XDR
round trips), and simulation adds a safety margin. The relative ratio, about
28% fewer instructions for the batch, agrees with Testnet.

## Reproduce

```bash
AGENTBATCH_WRITE_BENCH=1 cargo test bench_resources -- --nocapture   # local
pnpm demo:testnet                                                     # Testnet
```
