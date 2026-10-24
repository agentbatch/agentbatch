# AgentBatch — SCF #46 Proof-of-Concept Evidence

**Claim demonstrated:** one Soroban treasury, funded by one deposit, backs three
independent virtual payment channels. Simulated AI agents pay three simulated
API providers through off-chain Ed25519 cumulative vouchers, and all three
providers are settled in **one atomic transaction** on Stellar Testnet.

Outcomes, balances and fees below were read back from Testnet during the run of
2026-10-24 (21:57:26 UTC); the raw base64 XDR of every transaction is archived
in [`deployments/testnet/evidence.json`](deployments/testnet/evidence.json). Each rejection states how it was
observed: by simulation (`simulateTransaction`) or as a transaction submitted
and recorded as FAILED on-chain (`sendTransaction`). No Mainnet, no real funds.

Changes since the previous evidence run are recorded in
[`docs/review-findings.md`](docs/review-findings.md).

## 1. The three innovations and where they are shown

| Innovation | Testnet evidence | Automated tests |
|---|---|---|
| **Shared treasury funding** | One `deposit` of 100 AUSD into one contract funds three providers; all payouts come from that one balance (§3.1, §3.4) | `scenario::*`, `accounting::*` |
| **Independent virtual channels** | Three `DataKey::Channel(id)` persistent entries under the same contract, no channel contracts deployed (§3.2). Over-allocation and reserved withdrawal rejected (`#102`); a voucher above its channel's allocation and a voucher replayed on another provider's channel **submitted and FAILED on-chain** (§3.3) | `accounting::channel_isolation`, `over_allocation_rejected`, `withdrawal_limited_to_unallocated_funds`, `vouchers::cross_channel_replay_rejected`, … |
| **Batched multi-provider settlement** | One `redeem_batch` transaction pays 12 / 8 / 5 AUSD to three providers (§3.4); benchmark against three separate transactions (§4) | `batch::*`, `wasm::*`, `bench::bench_resources` |

## 2. Deployment (Stellar Testnet, protocol 29)

| Item | Value |
|---|---|
| Network passphrase | `Test SDF Network ; September 2015` |
| Payment asset | `AUSD`: synthetic, test-issued, **not Circle USDC** |
| AUSD issuer | [`GC6BHRLAZ4V37PSIBHYLMQJQ3VTMRHGGZE7HF4KZLI64KU4AEQH6LVFA`](https://stellar.expert/explorer/testnet/account/GC6BHRLAZ4V37PSIBHYLMQJQ3VTMRHGGZE7HF4KZLI64KU4AEQH6LVFA) |
| AUSD Stellar Asset Contract | [`CCIU2DJZIBZBUVXTHE2EUBQMJ3AZLOZNKQEQJK5HPIO4KIT4SMISAX2R`](https://stellar.expert/explorer/testnet/contract/CCIU2DJZIBZBUVXTHE2EUBQMJ3AZLOZNKQEQJK5HPIO4KIT4SMISAX2R) |
| AgentBatchPoC (demo treasury) | [`CCNFYVZNOP7TK4BK4PMF36FU7UXC4SN4G6LQWTQ3CBLAR4EBDT4YKMGJ`](https://stellar.expert/explorer/testnet/contract/CCNFYVZNOP7TK4BK4PMF36FU7UXC4SN4G6LQWTQ3CBLAR4EBDT4YKMGJ) |
| AgentBatchPoC (benchmark baseline) | [`CDKKG43YMI5OGS2MAUPNMIWCZNURXRY7RRTKF3AHXRRHI7F3DNWQ5WP7`](https://stellar.expert/explorer/testnet/contract/CDKKG43YMI5OGS2MAUPNMIWCZNURXRY7RRTKF3AHXRRHI7F3DNWQ5WP7) |
| WASM SHA-256 | `ab37537a6f65418bc968c4133ca9e9700d3980fd5a5915967e5914ce53068a04` (17,001 bytes, `stellar contract build --optimize`) |
| First upload of this WASM | [`440077bbbee80ceb…`](https://stellar.expert/explorer/testnet/tx/440077bbbee80ceb03bd6e31069faffee1f86ffa40ab758b137079bba36a1a26), 2,309,084,577 stroops (earlier run the same day; the evidence run's upload was a no-op) |
| Treasury owner | `GDW5EYOIPUMSIP6CUUS6THYL67I3SFSINSXMHHGSEIQP65BNPRV6FSGC` |
| Settlement coordinator (no treasury rights) | `GACOEEIXYO7NSY2CNT5U3XFND2FQWZX2COT7Z5UDWJC6WSXMZPCZX5WP` |
| Provider A, AI Inference API (channel 1, 40 AUSD) | `GDQ5ACVY7QBT7X2YQB4UZN4EMVFNXMCMFMWL7WEDU4RCG5U4AXJSOBRT` |
| Provider B, AI Search API (channel 2, 35 AUSD) | `GBJBCYG4KKBQMD62TQPKAJ24S3RELL2LNAHWBHKIX6OGVTE5XY2GATOO` |
| Provider C, Data Retrieval API (channel 3, 15 AUSD) | `GAGD5NWEVIU7RAL2NWFO2F4RKG5QO6YQ5PPRUAH44FO57H4GHYAA6HFN` |
| Agent signer keys (raw Ed25519; not accounts) | `314283b5…`, `da6e4c75…`, `4a729cd9…` (full keys in the manifest) |
| Tools | rustc 1.94.1, soroban-sdk 27.0.6, stellar CLI 26.0.0, @stellar/stellar-sdk 17.2.1, Node v22.13.1, RPC 30.0.0 |

The AUSD SAC was deployed by an earlier run of the same script; its address is
derived from `AUSD:<issuer>`. The trustline step is idempotent and re-applied
existing trustlines.

## 3. Results

### 3.1 Shared treasury funding

One `deposit` of 100 AUSD, then three `open_channel` calls on the same contract.
State read with `get_treasury` after setup (stored as `demo.afterSetup`):

| Deposited | Contract balance | Available | Reserved |
|---:|---:|---:|---:|
| 100 | 100 | 10 | 90 (40 + 35 + 15) |

### 3.2 Channels are records of the one treasury contract

Each channel's ledger entry, read by `getLedgerEntries` as contract data of the
demo contract (`CCNFYVZN…`). Exactly two AgentBatchPoC contracts were deployed in
the run (demo and baseline); none per channel.

| Channel | Key | Durability | Last modified ledger | Live until ledger |
|---|---|---|---:|---:|
| 1 | `DataKey::Channel(1)` | persistent | 5371070 | 5889470 |
| 2 | `DataKey::Channel(2)` | persistent | 5371071 | 5889471 |
| 3 | `DataKey::Channel(3)` | persistent | 5371072 | 5889472 |

### 3.3 Channel isolation on Testnet

| Attempt | Expected rule | Observed |
|---|---|---|
| Open a 4th channel for 10 AUSD + 1 base unit (only 10 unallocated) | no double allocation | simulation rejected `Error(Contract, #102)` (InsufficientAvailable) |
| Withdraw 10 AUSD + 1 base unit | reserved collateral cannot be withdrawn | simulation rejected `Error(Contract, #102)` |
| Redeem a validly signed 16 AUSD voucher on the 15 AUSD channel | provider capped at its own reservation | simulation `Error(Contract, #110)`; **on-chain** [`f0287fa4452928b5…`](https://stellar.expert/explorer/testnet/tx/f0287fa4452928b5f34867585fcb981e0b4b84b8c3dfa2147535b3c01c73c78f) FAILED `Error(Contract, #110)` |
| Redeem provider A's voucher on provider B's channel | vouchers bound to their channel and provider | simulation `Error(Crypto, InvalidInput)`; **on-chain** [`c28ecec77e1021b6…`](https://stellar.expert/explorer/testnet/tx/c28ecec77e1021b637be7b96e316e7dcaead80aa423a0c0879fc9a972a5ce874) FAILED `Error(Crypto, InvalidInput)` |
| Withdraw the unallocated 10 AUSD (baseline treasury) | owner may withdraw unallocated funds only | [`2ca6926ec2a6e082…`](https://stellar.expert/explorer/testnet/tx/2ca6926ec2a6e08201667fb53f8c385bcf02df11800f27b042493b0c79b21fd8) SUCCESS: owner received 10 AUSD, reserved stayed 65 AUSD |
| Then withdraw 1 more base unit | — | simulation rejected `Error(Contract, #102)` |

Error codes: `#102` InsufficientAvailable, `#109` StaleVoucher, `#110`
ExceedsAllocation; `Error(Crypto, InvalidInput)` is the host's Ed25519
verification failure. Contract codes start at 101 so they cannot be confused
with Stellar Asset Contract errors.

### 3.4 Off-chain micropayments and one batch settlement

Before trusting any channel data, each provider checked that the contract's
on-chain WASM hash and payment token match its pinned values. The voucher bytes
built by the TypeScript utility equalled the deployed contract's
`voucher_message` (412 bytes).

11 paid requests, each verified locally; transactions submitted meanwhile
(submission counter): **0**.

| Provider | Request prices (AUSD) | Final cumulative voucher |
|---|---|---:|
| AI Inference API | 1.5, 2.5, 3, 5 | 12 |
| AI Search API | 0.75, 1.25, 2, 4 | 8 |
| Data Retrieval API | 0.5, 1.5, 3 | 5 |

Rejected locally: a replayed voucher (`not-increasing`), provider A's voucher
presented to provider B (`channel-mismatch`), an altered amount
(`bad-signature`).

One atomic batch, submitted by the coordinator: [`cf74ff58182bfd6d…`](https://stellar.expert/explorer/testnet/tx/cf74ff58182bfd6db9be07d3b0601191bd58f4b759172422a52d53d4b82dd2c2)

| | Expected | Observed |
|---|---:|---:|
| Provider A received | 12 AUSD | 12 AUSD |
| Provider B received | 8 AUSD | 8 AUSD |
| Provider C received | 5 AUSD | 5 AUSD |
| Total paid | 25 | 25 |
| Contract balance | 75 | 75 |
| Available | 10 | 10 |
| Reserved | 65 | 65 |

### 3.5 Incremental redemption and replay

[`8b707294e93897e3…`](https://stellar.expert/explorer/testnet/tx/8b707294e93897e3a5ca226ecc7de0767cd9bef299855a5ec6e6d3838a18f7e6): a cumulative 17 AUSD voucher for provider A paid
**exactly 5 AUSD**. Afterwards: paid 30, contract balance 70, reserved 60,
available 10.

Replay: resubmitting the 17 AUSD voucher and the original three-voucher batch
was rejected in simulation with `Error(Contract, #109)` (StaleVoucher). The
original batch was then **submitted on-chain**: [`ee90afe38c405ac8…`](https://stellar.expert/explorer/testnet/tx/ee90afe38c405ac89aaf8cff0e932c007b84137b3a257bcbf41d18dffc75fa8f) FAILED with
`Error(Contract, #109)`. Provider balances read after the three failed
transactions had been applied were unchanged.

Conservation (`deposits − payouts − withdrawals = available + reserved`) and
solvency (`token balance ≥ available + reserved`) were checked on Testnet after
each settlement and after the withdrawal.

## 4. Benchmarks (Testnet, equal starting states)

| | 3 separate 1-voucher transactions | 1 transaction with 3 vouchers |
|---|---:|---:|
| Transactions | 3 | 1 |
| Total fee charged | 32,898 stroops | 22,294 stroops (−32.2%) |
| Declared CPU instructions | 4,761,012 | 3,300,527 (−30.7%) |
| Read-only / read-write entries | 6 / 12 | 2 / 8 |
| Declared write bytes | 3,924 | 2,372 |

Batching removes per-transaction overhead but not the per-voucher signature
check and token transfer, so the saving is about 32%, not 66%. Setup costs are
dominated by rent and varied by more than 4× between runs a few hours apart
as Testnet rent rates rose. Full tables: [`docs/benchmarks.md`](docs/benchmarks.md).

## 5. All Testnet transactions in the evidence run

| Step | Transaction | Status | Ledger | Fee (stroops) |
|---|---|---|---:|---:|
| trustlines: owner and providers (idempotent) | [`4e165f15b1744bb6…`](https://stellar.expert/explorer/testnet/tx/4e165f15b1744bb6a2aec1663e7de1692ce1bd6fbb7a6827cae846a735648bb7) | SUCCESS | 5371064 | 400 |
| issue 200 AUSD to owner | [`42dd88b75a2c6834…`](https://stellar.expert/explorer/testnet/tx/42dd88b75a2c683435eea2b0b715e679bd37f6a42e83e3f54d7c81e4d072ec92) | SUCCESS | 5371065 | 100 |
| upload AgentBatchPoC wasm | [`c8b6acfc5dc3f14f…`](https://stellar.expert/explorer/testnet/tx/c8b6acfc5dc3f14fc32666b679c1d8bd7e6c30c4ee9a3e60ccaa05b1cf57957c) | SUCCESS | 5371066 | 43,199 |
| deploy AgentBatchPoC (demo treasury) | [`19ec6931528d0cd2…`](https://stellar.expert/explorer/testnet/tx/19ec6931528d0cd279262e0116c6ff2e11b178705a93e4e7c0eeff51f4cea30d) | SUCCESS | 5371067 | 52,060,710 |
| deploy AgentBatchPoC (baseline treasury) | [`a2e10ee24d705e2c…`](https://stellar.expert/explorer/testnet/tx/a2e10ee24d705e2ce4f8ec10cd0438a4a33a7580717896eae74239b75fdc47cf) | SUCCESS | 5371068 | 52,060,710 |
| demo: deposit 100 AUSD | [`f9331e2b8efe1134…`](https://stellar.expert/explorer/testnet/tx/f9331e2b8efe11348582c0d4ceef4fec3ff576a2bdce5d99a67e01a84f0d0bee) | SUCCESS | 5371069 | 21,134,785 |
| demo: open channel A (AI Inference API, 40 AUSD) | [`cde764fdd3641734…`](https://stellar.expert/explorer/testnet/tx/cde764fdd3641734be356edef1eeb19f575d987e559d14c75e0472e25bf64a20) | SUCCESS | 5371070 | 39,237,024 |
| demo: open channel B (AI Search API, 35 AUSD) | [`93d00b181cf26825…`](https://stellar.expert/explorer/testnet/tx/93d00b181cf26825e2404e46cc6e0fb7a632846d4d3f90d4d04ab0655a1f5bf9) | SUCCESS | 5371071 | 39,237,024 |
| demo: open channel C (Data Retrieval API, 15 AUSD) | [`7ea4e05af33e8e9e…`](https://stellar.expert/explorer/testnet/tx/7ea4e05af33e8e9e5cf667d337a66e064a334fa75ad1bb4ff4dc44060785bba1) | SUCCESS | 5371072 | 39,237,024 |
| demo: redeem_batch (3 vouchers, 3 providers) | [`cf74ff58182bfd6d…`](https://stellar.expert/explorer/testnet/tx/cf74ff58182bfd6db9be07d3b0601191bd58f4b759172422a52d53d4b82dd2c2) | SUCCESS | 5371075 | 22,294 |
| attack: voucher above channel allocation | [`f0287fa4452928b5…`](https://stellar.expert/explorer/testnet/tx/f0287fa4452928b5f34867585fcb981e0b4b84b8c3dfa2147535b3c01c73c78f) | FAILED `Error(Contract, #110)` | 5371077 | 17,726 |
| attack: cross-channel voucher replay | [`c28ecec77e1021b6…`](https://stellar.expert/explorer/testnet/tx/c28ecec77e1021b637be7b96e316e7dcaead80aa423a0c0879fc9a972a5ce874) | FAILED `Error(Crypto, InvalidInput)` | 5371078 | 17,726 |
| demo: redeem_batch (provider A cumulative 17) | [`8b707294e93897e3…`](https://stellar.expert/explorer/testnet/tx/8b707294e93897e3a5ca226ecc7de0767cd9bef299855a5ec6e6d3838a18f7e6) | SUCCESS | 5371080 | 10,966 |
| attack: replay of the original batch | [`ee90afe38c405ac8…`](https://stellar.expert/explorer/testnet/tx/ee90afe38c405ac89aaf8cff0e932c007b84137b3a257bcbf41d18dffc75fa8f) | FAILED `Error(Contract, #109)` | 5371082 | 18,475 |
| baseline: deposit 100 AUSD | [`ccb7fe90758279d9…`](https://stellar.expert/explorer/testnet/tx/ccb7fe90758279d945ee75f3d945d30cfd83d6299c112381a3925e676511afe7) | SUCCESS | 5371083 | 21,225,972 |
| baseline: open channel A (AI Inference API, 40 AUSD) | [`fc85f7b4e139b7bf…`](https://stellar.expert/explorer/testnet/tx/fc85f7b4e139b7bfcccf18c78570a4966fc9e2ab00e09346163dceae8875b824) | SUCCESS | 5371084 | 39,406,371 |
| baseline: open channel B (AI Search API, 35 AUSD) | [`fbd6728fcdcd6c05…`](https://stellar.expert/explorer/testnet/tx/fbd6728fcdcd6c0556e98c20289357e4915dbad23369e2fa74ec73f7c2b4f518) | SUCCESS | 5371085 | 39,406,371 |
| baseline: open channel C (Data Retrieval API, 15 AUSD) | [`46d1f0a7ab4f1e74…`](https://stellar.expert/explorer/testnet/tx/46d1f0a7ab4f1e74665256e814ad82c904ed099e8b6c858fc2daf850c96b346e) | SUCCESS | 5371086 | 39,406,371 |
| baseline: redeem_batch (1 voucher, provider A) | [`9cec33bf35ea9464…`](https://stellar.expert/explorer/testnet/tx/9cec33bf35ea9464260833b4e5e4b54795cf0f513206983cee9dc54c6fcf05e1) | SUCCESS | 5371087 | 10,966 |
| baseline: redeem_batch (1 voucher, provider B) | [`dd9ad1c7f0ac70ee…`](https://stellar.expert/explorer/testnet/tx/dd9ad1c7f0ac70ee5b315500d68bda6399d0f94df86915ee821018455c9ecc80) | SUCCESS | 5371088 | 10,966 |
| baseline: redeem_batch (1 voucher, provider C) | [`afd406a5b4dac102…`](https://stellar.expert/explorer/testnet/tx/afd406a5b4dac102f7f66c7489ecb2e30a024fbb6084b287f7c9183a12e27648) | SUCCESS | 5371089 | 10,966 |
| baseline: withdraw_available(10 AUSD) | [`2ca6926ec2a6e082…`](https://stellar.expert/explorer/testnet/tx/2ca6926ec2a6e08201667fb53f8c385bcf02df11800f27b042493b0c79b21fd8) | SUCCESS | 5371091 | 8,574 |

## 6. Automated tests

| Suite | Result |
|---|---|
| Soroban contract (`cargo test --locked --workspace`) | 66 passed: authorization (constructor via real `deploy_v2`), voucher binding with real signatures, accounting incl. a randomized model-based test and a fee-charging token, batch atomicity incl. a failed SAC transfer, events, storage TTL and archival, WASM execution and freshness, cross-language and invalid-signature vectors, resource metering |
| TypeScript (`pnpm test`) | 93 passed: byte-for-byte parity with the Rust vectors, rejection of every host-rejected signature vector, binding rejections, encoder validation, provider acceptance rules, store scoping and corruption handling, deployment pinning |

Negative authorization tests use enforcing `mock_auths` with exact invocation
trees. `mock_all_auths` appears only in the vector fixture's channel setup and
in the positive constructor control test. Voucher tests use real Ed25519
signatures throughout.

## 7. What is not built (grant scope) and unresolved risks

Not built: channel closure and dispute period, revocation, signer rotation,
reallocation and collateral recycling, multi-tenant treasuries, keeper
incentives, netting, MPP and x402 adapters, a production SDK, a Treasury
Console, passkeys, upgradeability, Mainnet.

Unresolved risks (internal reviews only, [`docs/audit-report.md`](docs/audit-report.md) and
[`docs/review-findings.md`](docs/review-findings.md); **not an independent external audit**):

- One failing voucher or frozen provider reverts the whole batch (liveness only).
- Providers depend on an honest RPC endpoint for channel state.
- No on-chain proof of possession for agent keys (providers refuse unsafe keys off-chain).
- Unredeemed collateral and unsolicited tokens stay locked (no closure or sweep).
- Solvency against the real balance depends on the issuer's freeze and clawback powers.
- Agent counters are not persisted; provider stores are not concurrency-safe.

## 8. Reproduce

```bash
make all                 # install, fmt check, build, lint, all tests
pnpm demo:testnet        # builds the contract, then the full Testnet run
```

The demo creates Testnet keys in `.secrets/` (gitignored) on first run, funds
them through friendbot, deploys new contract instances, and rewrites
`deployments/testnet/`.
