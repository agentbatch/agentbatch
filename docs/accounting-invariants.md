# Treasury Accounting Invariants

All amounts are `i128` base units of a 7-decimal Stellar Asset Contract
(1 AUSD = 10,000,000). Every addition and subtraction in state-changing
functions is checked (`checked_add` / `checked_sub` → `ArithmeticOverflow`).
Views use saturating arithmetic or bounded subtraction, and the release
profile keeps `overflow-checks = true`.

## State

| Field | Meaning | Changed by |
|---|---|---|
| `total_deposited` | sum of all `deposit` amounts | `deposit` (+) |
| `total_paid` | sum of all provider payouts | `redeem_batch` (+) |
| `total_withdrawn` | sum of all `withdraw_available` amounts | `withdraw_available` (+) |
| `available` | deposited funds not reserved by any channel | `deposit` (+), `open_channel` (−), `withdraw_available` (−) |
| `total_reserved` | sum over channels of `allocation − redeemed` | `open_channel` (+), `redeem_batch` (−) |
| channel `allocation` | collateral ceiling; immutable | `open_channel` |
| channel `redeemed` | cumulative paid to the provider; never decreases | `redeem_batch` |

## Invariants

| ID | Invariant | Why it holds |
|---|---|---|
| I1 | `total_deposited − total_paid − total_withdrawn = available + total_reserved` | Each transition changes both sides by the same amount: deposit +a/+a; open 0/(−a,+a); redeem −p/−p; withdraw −a/−a. |
| I2 | For every channel: `0 ≤ redeemed ≤ allocation`, `remaining = allocation − redeemed` | `redeemed` only moves to a voucher amount `v` with `redeemed < v ≤ allocation`. |
| I3 | `Σ remaining = total_reserved` | Opening adds `allocation` to both sides; redemption subtracts the payout from both. |
| I4 | `available ≥ 0`, `total_reserved ≥ 0` | Allocation and withdrawal require `amount ≤ available`; payouts are bounded by I2. |
| I5 | `token_balance ≥ available + total_reserved` (solvency) | A deposit is credited only if the contract's balance rose by exactly the amount (`TransferMismatch` otherwise), and payouts and withdrawals move out exactly what accounting records. Unsolicited transfers only increase the balance. Holds unless the asset issuer claws back the contract's balance. |
| I6 | No double allocation | `open_channel` moves funds from `available` to one channel's reservation; nothing else draws on a reservation except that channel's provider. |
| I7 | No withdrawal of reserved collateral | `withdraw_available` is bounded by `available` (I4). |
| I8 | No repeated payout | Payout is `v − redeemed`, and `redeemed := v`; resubmitting `v` or any lower amount fails with `StaleVoucher`. |
| I9 | Unaccounted tokens are never credited | `available` changes only through `deposit`; `get_treasury` reports `unaccounted_balance` separately. |
| I10 | Failed operations change nothing | Any error or trap reverts the whole invocation, including token transfers. |

Collateral consequence for providers: because a channel's allocation is
reserved when it opens and the PoC has no way to reduce it, any voucher with
`redeemed < amount ≤ allocation` is fully payable when redeemed, provided the
token transfer succeeds (an authorized trustline, and no issuer freeze or
clawback).

## Verification

| Method | Where |
|---|---|
| `Setup::assert_invariants` checks I1–I5 against stored state and the real SAC balance | [`test/mod.rs`](../contracts/agentbatch-poc/src/test/mod.rs) |
| Model-based randomized test: 5 seeds × 250 random deposits, channel openings, batches (valid, stale, over-ceiling), withdrawals and unsolicited transfers. Compares state with an independent model after every step and checks that failed steps changed nothing and paid no provider. | `accounting::randomized_transitions_preserve_invariants` |
| Targeted tests for I5–I9 | `deposit_credits_only_what_arrives`, `over_allocation_rejected`, `channel_isolation`, `withdrawal_limited_to_unallocated_funds`, `cumulative_vouchers_pay_only_increment`, `unsolicited_transfers_are_not_credited`, `deposit_overflow_rejected` |
| Atomicity (I10) | `batch::*_reverts_whole_batch`, `failed_asset_transfer_reverts_whole_batch`, `wasm::wasm_batch_failure_is_atomic` |
| Testnet: I1 and I5 checked against `get_treasury` after the batch, after the incremental redemption and after the withdrawal; I6 and I7 attempted on-chain (rejected with `#102`) | `apps/demo/src/cli.ts` (`checkInvariants`) |

## Scenario values

| Point | Deposited | Paid | Available | Reserved | Contract balance |
|---|---:|---:|---:|---:|---:|
| After deposit and three channels (40 / 35 / 15) | 100 | 0 | 10 | 90 | 100 |
| After batch (12 / 8 / 5) | 100 | 25 | 10 | 65 | 75 |
| After cumulative 17 on channel A | 100 | 30 | 10 | 60 | 70 |

These values are asserted by `scenario::run`
(`test::scenario::scf_demo_scenario_native`, `test::wasm::scf_demo_scenario_wasm`)
and read back
from Testnet in [`SCF_POC_EVIDENCE.md`](../SCF_POC_EVIDENCE.md).
