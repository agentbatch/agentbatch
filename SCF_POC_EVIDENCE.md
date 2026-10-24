# AgentBatch — SCF #46 Proof-of-Concept Evidence

**Claim demonstrated:** one Soroban treasury, funded by one deposit, backs three
independent virtual payment channels. AI agents pay three providers through
off-chain Ed25519 cumulative vouchers, and all three providers are settled in
**one atomic transaction** on Stellar Testnet.

Every figure below was read back from Testnet during the run of 2026-10-24
(`deployments/testnet/evidence.json`). Nothing here describes Mainnet, and no
real funds were used.

## 1. What is implemented, tested, observed and missing

| Capability | Implemented | Automated tests | Observed on Testnet |
|---|:-:|:-:|:-:|
| Single shared treasury, owner and token bound at construction | ✓ | ✓ | ✓ |
| Three virtual channels as storage records, no per-channel contracts | ✓ | ✓ | ✓ |
| Exclusive per-channel collateral reservation; no double allocation | ✓ | ✓ | ✓ |
| Real Ed25519 cumulative vouchers, domain- and context-bound | ✓ | ✓ | ✓ |
| Provider-side off-chain verification and highest-voucher store | ✓ | ✓ | ✓ (11 requests, 0 transactions) |
| Provider pins contract WASM hash and token before trusting data | ✓ | ✓ | ✓ |
| One atomic `redeem_batch` paying three providers | ✓ | ✓ | ✓ |
| Incremental redemption of a later cumulative voucher | ✓ | ✓ | ✓ |
| Replay rejection | ✓ | ✓ | ✓ (simulation rejected, balances unchanged) |
| Withdrawal limited to unallocated funds | ✓ | ✓ | not exercised |
| Whole-batch revert on failed SAC transfer | ✓ | ✓ | not exercised |
| Resource and fee benchmarks | ✓ | local metering | ✓ |

**Not built in the PoC (grant scope):** channel closure and dispute period,
revocation, signer rotation, reallocation and collateral recycling,
multi-tenant treasuries, keeper incentives, netting, MPP and x402 adapters, a
production SDK, a Treasury Console, passkeys, upgradeability, Mainnet.

## 2. Deployment (Stellar Testnet, protocol 29)

| Item | Value |
|---|---|
| Network passphrase | `Test SDF Network ; September 2015` |
| Payment asset | `AUSD`: synthetic, test-issued, **not Circle USDC** |
| AUSD issuer | [`GC6BHRLAZ4V37PSIBHYLMQJQ3VTMRHGGZE7HF4KZLI64KU4AEQH6LVFA`](https://stellar.expert/explorer/testnet/account/GC6BHRLAZ4V37PSIBHYLMQJQ3VTMRHGGZE7HF4KZLI64KU4AEQH6LVFA) |
| AUSD Stellar Asset Contract | [`CCIU2DJZIBZBUVXTHE2EUBQMJ3AZLOZNKQEQJK5HPIO4KIT4SMISAX2R`](https://stellar.expert/explorer/testnet/contract/CCIU2DJZIBZBUVXTHE2EUBQMJ3AZLOZNKQEQJK5HPIO4KIT4SMISAX2R) |
| AgentBatchPoC (demo treasury) | [`CDFIKGAARDDTY2SBNHRH2BCUBA5BRHHRJ6CTL4WA2LLBTRWGJO6HZHG5`](https://stellar.expert/explorer/testnet/contract/CDFIKGAARDDTY2SBNHRH2BCUBA5BRHHRJ6CTL4WA2LLBTRWGJO6HZHG5) |
| AgentBatchPoC (benchmark baseline) | [`CD7U3YVZ5S5OZXCXWNTZZPNR7MQPJKID272C7XZAGIU3J4BS2J3QA2VO`](https://stellar.expert/explorer/testnet/contract/CD7U3YVZ5S5OZXCXWNTZZPNR7MQPJKID272C7XZAGIU3J4BS2J3QA2VO) |
| WASM SHA-256 | `f915e248eca5ab71ab87ae1fb4341d3951415b36cbc4e8ad90777b57c3c87863` (16,575 bytes, `stellar contract build --optimize`) |
| Treasury owner | `GDW5EYOIPUMSIP6CUUS6THYL67I3SFSINSXMHHGSEIQP65BNPRV6FSGC` |
| Settlement coordinator (no treasury rights) | `GACOEEIXYO7NSY2CNT5U3XFND2FQWZX2COT7Z5UDWJC6WSXMZPCZX5WP` |
| Provider A, AI Inference API (channel 1, 40 AUSD) | `GDQ5ACVY7QBT7X2YQB4UZN4EMVFNXMCMFMWL7WEDU4RCG5U4AXJSOBRT` |
| Provider B, AI Search API (channel 2, 35 AUSD) | `GBJBCYG4KKBQMD62TQPKAJ24S3RELL2LNAHWBHKIX6OGVTE5XY2GATOO` |
| Provider C, Data Retrieval API (channel 3, 15 AUSD) | `GAGD5NWEVIU7RAL2NWFO2F4RKG5QO6YQ5PPRUAH44FO57H4GHYAA6HFN` |
| Agent signer keys (raw Ed25519; not accounts) | `314283b5…437d`, `da6e4c75…21dc`, `4a729cd9…e25b` (full keys in the manifest) |

The AUSD SAC was deployed by an earlier run of the same script. Its address is
derived deterministically from `AUSD:<issuer>`.

## 3. Results

### Shared funding and isolated channels

One `deposit` of 100 AUSD, then three `open_channel` calls on the same
contract:

| | Deposited | Available | Reserved | Contract balance |
|---|---:|---:|---:|---:|
| After setup | 100 | 10 | 90 (40 + 35 + 15) | 100 |

### Off-chain micropayments

11 paid requests, each verified locally by the provider. **No transaction was
submitted during the simulation.**

| Provider | Request prices (AUSD) | Final cumulative voucher |
|---|---|---:|
| AI Inference API | 1.5, 2.5, 3, 5 | 12 |
| AI Search API | 0.75, 1.25, 2, 4 | 8 |
| Data Retrieval API | 0.5, 1.5, 3 | 5 |

Rejected locally: a replayed voucher (`not-increasing`), a voucher moved to
another channel (`bad-signature`), and a voucher with an altered amount
(`bad-signature`).

Before any payment, the voucher bytes built by the TypeScript utility equalled
the deployed contract's `voucher_message` (412 bytes).

### One atomic batch settlement

[`a74cfdbdf645dcd8774addc06f0c4fb4bcb87a52dc45868828dd520e549bbf01`](https://stellar.expert/explorer/testnet/tx/a74cfdbdf645dcd8774addc06f0c4fb4bcb87a52dc45868828dd520e549bbf01):
one `redeem_batch` with three vouchers, submitted by the coordinator.

| | Expected | Observed |
|---|---:|---:|
| Provider A received | 12 AUSD | 12 AUSD |
| Provider B received | 8 AUSD | 8 AUSD |
| Provider C received | 5 AUSD | 5 AUSD |
| Total paid | 25 | 25 |
| Contract balance | 75 | 75 |
| Available | 10 | 10 |
| Reserved | 65 | 65 |

### Incremental redemption and replay

[`69b4df37af799fe7bf959ae419b60bcbcc77eaa6ea968c0870a7e2c259f462ec`](https://stellar.expert/explorer/testnet/tx/69b4df37af799fe7bf959ae419b60bcbcc77eaa6ea968c0870a7e2c259f462ec):
a cumulative 17 AUSD voucher for provider A paid **exactly 5 AUSD**. Totals
afterwards: paid 30, contract balance 70, reserved 60, available 10.

Resubmitting the 17 AUSD voucher, and the original three-voucher batch, was
rejected with `Error(Contract, #9)` (`StaleVoucher`), and provider balances
were unchanged. These rejections were observed by simulation, so no failing
transactions were submitted.

The invariants `deposits − payouts − withdrawals = available + reserved` and
`token balance ≥ available + reserved` were checked on Testnet after each
settlement.

## 4. Benchmarks (Testnet, equal starting states)

| | 3 separate 1-voucher transactions | 1 transaction with 3 vouchers |
|---|---:|---:|
| Transactions | 3 | 1 |
| Total fee charged | 32,904 stroops | 22,296 stroops (−32.2%) |
| CPU instructions | 4,785,681 | 3,309,030 (−30.9%) |
| Read-only / read-write entries | 6 / 12 | 2 / 8 |
| Write bytes | 3,924 | 2,372 |

Batching removes per-transaction overhead. It does **not** remove the
per-voucher signature check and token transfer, so the saving is about 32%,
not 66%. Setup costs are dominated by rent: `open_channel` ≈ 0.89–1.04 XLM
because of the 30-day TTL extension. Full tables and local metering are in
[`docs/benchmarks.md`](docs/benchmarks.md).

## 5. All Testnet transactions in the evidence run

| Step | Transaction | Ledger | Fee (stroops) |
|---|---|---:|---:|
| trustlines: owner and providers | [`cd466c0bb35e5106…`](https://stellar.expert/explorer/testnet/tx/cd466c0bb35e510698a99a1cba1569e89efaaf1a1bce74856f5999cb0d23eab6) | 5369591 | 400 |
| issue 200 AUSD to owner | [`c38dcd2de10721f9…`](https://stellar.expert/explorer/testnet/tx/c38dcd2de10721f9ce55d543d819ed3b9209c499ad3b0195b0a4901e58de2bd7) | 5369592 | 100 |
| upload AgentBatchPoC wasm | [`318e4e52234eaa80…`](https://stellar.expert/explorer/testnet/tx/318e4e52234eaa802fff898600e2f3c97bd818fe14922457717c48ac464e9040) | 5369593 | 42,154 |
| deploy AgentBatchPoC (demo treasury) | [`56a33f81e804cc92…`](https://stellar.expert/explorer/testnet/tx/56a33f81e804cc92555ceca6ce78fd25bd721748b197a79b73a26de1dd571bda) | 5369594 | 11,826,274 |
| deploy AgentBatchPoC (baseline treasury) | [`1b5271d6a7109347…`](https://stellar.expert/explorer/testnet/tx/1b5271d6a7109347c4a5f17c24194034d9f9e0acc7fce4bb94bae928d66747fb) | 5369595 | 11,826,274 |
| demo: deposit 100 AUSD | [`5611a8c2bcc3c4cd…`](https://stellar.expert/explorer/testnet/tx/5611a8c2bcc3c4cded33cf96fbcfed067ec66a9b999870293e4cbbc9f173009a) | 5369596 | 4,807,743 |
| demo: open channel A (AI Inference API, 40 AUSD) | [`60c23ea1bd4b7a69…`](https://stellar.expert/explorer/testnet/tx/60c23ea1bd4b7a698123594148357498099693cd3fe63aeebd4549b79a7f2935) | 5369597 | 8,915,421 |
| demo: open channel B (AI Search API, 35 AUSD) | [`3874db61152bf2ec…`](https://stellar.expert/explorer/testnet/tx/3874db61152bf2ec9234852c684f832510f3d116935586f798a563831b8c0f48) | 5369598 | 8,915,421 |
| demo: open channel C (Data Retrieval API, 15 AUSD) | [`1192d3aa4006dc13…`](https://stellar.expert/explorer/testnet/tx/1192d3aa4006dc13e89f8e748448fc7dfc1b1c1d02a02d24170b97c2a0655730) | 5369599 | 8,915,421 |
| **demo: redeem_batch (3 vouchers, 3 providers)** | [`a74cfdbdf645dcd8…`](https://stellar.expert/explorer/testnet/tx/a74cfdbdf645dcd8774addc06f0c4fb4bcb87a52dc45868828dd520e549bbf01) | 5369601 | 22,296 |
| demo: redeem_batch (provider A cumulative 17) | [`69b4df37af799fe7…`](https://stellar.expert/explorer/testnet/tx/69b4df37af799fe7bf959ae419b60bcbcc77eaa6ea968c0870a7e2c259f462ec) | 5369603 | 10,968 |
| baseline: deposit 100 AUSD | [`ff43cdef48f05c57…`](https://stellar.expert/explorer/testnet/tx/ff43cdef48f05c576624c654f961cce8dffe04bffdc8ceada5adcfd3d229c3ae) | 5369605 | 5,631,878 |
| baseline: open channel A | [`d693b415d653142a…`](https://stellar.expert/explorer/testnet/tx/d693b415d653142a6cc55db97f311c462a4a643cec05c6ecb0f293157163c050) | 5369606 | 10,445,957 |
| baseline: open channel B | [`5af4e08a8f6663c3…`](https://stellar.expert/explorer/testnet/tx/5af4e08a8f6663c3d5d92a2063c49244f175c3f0e2bc931a5a29a65a5800e071) | 5369607 | 10,445,957 |
| baseline: open channel C | [`44092a0d11042363…`](https://stellar.expert/explorer/testnet/tx/44092a0d110423631b2154ed379b8ccbb69f810a1a0c43582005d427350a90a8) | 5369608 | 10,445,957 |
| baseline: redeem_batch (1 voucher, provider A) | [`ada93c5c31ae2410…`](https://stellar.expert/explorer/testnet/tx/ada93c5c31ae24101d65ebd7726bdc38da2bf2e8e2d1b74dbade4cf10ea98e08) | 5369609 | 10,968 |
| baseline: redeem_batch (1 voucher, provider B) | [`d5722b38d1a92509…`](https://stellar.expert/explorer/testnet/tx/d5722b38d1a925095328704be02ed2ec08196f463ecf5cf57efc74389e462ec4) | 5369610 | 10,968 |
| baseline: redeem_batch (1 voucher, provider C) | [`f72828e5b681c076…`](https://stellar.expert/explorer/testnet/tx/f72828e5b681c0763e99ea45047952818fb180235bd464a3a2aaf972eeed1921) | 5369611 | 10,968 |

## 6. Automated tests

| Suite | Result |
|---|---|
| Soroban contract (`cargo test --workspace`) | 59 passed: authorization (incl. constructor via real `deploy_v2`), 15 voucher-rejection cases, accounting incl. randomized model-based test, batch atomicity incl. failed SAC transfer, storage TTL and archival, WASM execution, cross-language vectors, resource benchmark |
| TypeScript (`pnpm test`) | 52 passed: byte-for-byte parity with the Rust vectors, binding rejections, provider acceptance rules, store persistence, deployment pinning |

Authorization tests use enforcing `mock_auths` with exact invocation trees.
Voucher tests use real Ed25519 signatures throughout.

## 7. Unresolved risks

From the internal review ([`docs/audit-report.md`](docs/audit-report.md)),
which is **not an independent external audit**:

- One failing voucher, or one frozen provider, reverts the whole batch
  (liveness only).
- Providers depend on an honest RPC for channel state.
- The signer key is not proven valid or possessed at channel opening.
- Unredeemed collateral and unsolicited tokens stay locked, since there is no
  closure or sweep.
- Solvency against the real token balance depends on the asset issuer's
  freeze and clawback powers.
- Provider stores and agent counters are sequential, not concurrency-safe.

## 8. Reproduce

```bash
make build-contracts && cargo test --workspace
pnpm install --frozen-lockfile && pnpm -r build && pnpm test
pnpm demo:testnet        # or scripts/testnet-demo.sh
```

The demo creates Testnet keys in `.secrets/` (gitignored) on first run, funds them
through friendbot, deploys new contract instances, and rewrites
`deployments/testnet/`.
