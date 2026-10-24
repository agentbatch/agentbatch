# Resource and Fee Benchmarks

Two sources, reported separately:

- **Testnet**: real transactions. Fees are `feeCharged` and the charged fee
  breakdown from the transaction result and meta. Resource figures are the
  limits **declared** in each transaction from simulation, not metered
  consumption. Envelope sizes are computed locally. Raw data:
  [`benchmarks/testnet-resources.json`](benchmarks/testnet-resources.json) and
  [`../deployments/testnet/evidence.json`](../deployments/testnet/evidence.json)
  (which also archives each transaction's raw XDR).
- **Local**: soroban-sdk invocation metering on the compiled WASM. Raw data:
  [`benchmarks/local-resources.json`](benchmarks/local-resources.json).
  Its fee estimates use the SDK's hardcoded Mainnet fee snapshot, exclude
  inclusion and size fees, and are not network fees.

Tool versions: rustc 1.94.1, soroban-sdk 27.0.6, stellar CLI 26.0.0,
@stellar/stellar-sdk 17.2.1, Node 22.13.1, Testnet protocol 29
(stellar-rpc 30.0.0). Run of 2026-10-24 21:57 UTC.

## Contract artifact

| Item | Value |
|---|---|
| Build | `stellar contract build --optimize` |
| WASM size | 17,001 bytes |
| SHA-256 | `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04` |

## Per-operation cost (Testnet)

1 XLM = 10,000,000 stroops.

| Operation | Fee charged (stroops) | of which rent | Declared CPU instructions | Entries RO / RW | Declared write bytes |
|---|---:|---:|---:|---:|---:|
| Upload WASM, first upload (tx `440077bb…`, earlier run the same day) | 2,309,084,577 | — | — | — | 17,001 code |
| Deploy treasury contract | 52,060,710 | 52,056,122 | 1,126,504 | 2 / 1 | 552 |
| `deposit` | 21,134,785 | 21,124,979 | 1,012,500 | 3 / 3 | 892 |
| `open_channel` | 39,237,024 | 39,231,014 | 802,077 | 1 / 2 | 968 |
| `redeem_batch`, 1 voucher | 10,966 | 0 | 1,587,004 | 2 / 4 | 1,308 |
| `redeem_batch`, 3 vouchers | 22,294 | 0 | 3,300,527 | 2 / 8 | 2,372 |
| `withdraw_available` | 8,574 | 0 | 919,288 | 2 / 3 | 892 |
| Rejected redemption submitted on-chain (FAILED) | 17,726–18,475 | — | — | — | — |

Reading the setup costs:

- **Rent dominates every operation that creates or extends an entry.**
  Deployment pays for the new instance's 30-day TTL. `open_channel` pays for
  the new channel entry's 30-day TTL (measured live: liveUntil − lastModified =
  518,400 ledgers = 30.0 days). The deposit's rent is for the contract's newly
  created token-balance entry in the SAC.
- **Testnet rent rates are volatile.** They rise with total Soroban state size.
  In the previous evidence run, about two hours earlier, the same operations
  cost 11.8M (deploy), 4.8M (deposit) and 8.9M (`open_channel`) stroops, a
  rise of more than 4×. Settlement fees did not move: 22,296 and 10,968 stroops
  then, 22,294 and 10,966 now.
- **The code upload is a one-time cost per WASM version** and is shared by every
  deployment of that code. The contract deliberately extends only its own
  instance, never the code entry (see
  [review finding F-2](review-findings.md)). Before that fix, deploying fresh
  code would have cost 8,783,023,303 stroops at these rates.
- On the identical baseline deployment minutes later, `deposit` cost
  21,225,972 and `open_channel` 39,406,371 stroops.

## Settlement comparison (Testnet)

Equal starting states: two deployments of the same WASM, each with 100 AUSD
deposited and 40 / 35 / 15 AUSD channels to the same three providers, settling
12 / 8 / 5 AUSD.

| Metric | Baseline: 3 separate 1-voucher txs | AgentBatch: 1 tx with 3 vouchers | Difference |
|---|---:|---:|---:|
| Transactions | 3 | 1 | −2 |
| Total fee charged (stroops) | 32,898 | 22,294 | −32.2% |
| Declared CPU instructions | 4,761,012 | 3,300,527 | −30.7% |
| Read-only footprint entries | 6 | 2 | −4 |
| Read-write footprint entries | 12 | 8 | −4 |
| Declared disk read bytes | 348 | 348 | 0 |
| Declared write bytes | 3,924 | 2,372 | −39.6% |
| Envelope bytes (local) | 2,580 | 1,540 | −40.3% |
| SAC transfers | 3 | 3 | 0 |
| Signature verifications | 3 | 3 | 0 |

Reading the result:

- Settling three vouchers in one transaction cost about **32% less** in fees
  than three separate transactions, **not 66%**. The work per voucher (one
  Ed25519 verification, one channel write, one token transfer) stays the same.
  What batching saves is the repeated per-transaction overhead: contract
  instance and code loading, the treasury entry write, the envelope, and the
  inclusion fee.
- Per-voucher cost after the first: (22,294 − 10,966) / 2 = 5,664 stroops.
- At Testnet rates, opening a channel costs far more than settling it. Shared
  funding avoids one contract deployment per provider (an AgentBatchPoC
  deployment cost 52.1M stroops on this run, against 39.2M for a channel
  entry; a per-provider channel contract was not measured), but it still pays
  rent for one channel entry per provider.

## Local metering (compiled WASM, soroban-sdk testutils)

| Operation | CPU instructions | Write entries | Write bytes |
|---|---:|---:|---:|
| `deposit` | 923,498 | 4 | 1,068 |
| `open_channel` | 677,349 | 3 | 1,028 |
| `redeem_batch`, 1 voucher | 1,337,846 | 4 | 1,404 |
| `redeem_batch`, 3 vouchers | 2,905,069 | 8 | 2,668 |
| Baseline: 3 × 1 voucher (total) | 4,007,540 | 12 | 4,212 |

`deposit` is higher than in the previous version because it now reads the
contract's token balance before and after the transfer (review finding A-3).
Local counts are lower than Testnet's declared values because local metering
does not model every production step, and simulation adds a margin. The
relative saving, 27.5% fewer instructions for the batch, is consistent with
Testnet.

## Reproduce

```bash
AGENTBATCH_WRITE_BENCH=1 cargo test --locked bench_resources -- --nocapture   # local
pnpm demo:testnet                                                              # Testnet
```
