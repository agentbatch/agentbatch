# Pre-Implementation Review of the PoC Specification

The PoC brief was reviewed against the Soroban SDK, the Stellar one-way channel
contract, the Stellar MPP SDK and the live Testnet before any code was written.
This document records where the brief needed interpretation and what was
decided. Each item links to the code or test that implements the decision.

## Environment findings

| # | Finding | Decision |
|---|---|---|
| E1 | Installed: rustc 1.94.1, stellar CLI 26.0.0, soroban-sdk 27.0.6 (local cache). The latest crates.io release was 29.0.1; Testnet runs protocol 29. | Kept **27.0.6**, following "no unnecessary upgrades". A contract built with SDK 27 runs on protocol 29, as the Testnet run confirms. |
| E2 | `@stellar/stellar-sdk` 17.3.0 was 3 days old. | Pinned **17.2.1** (released 2026-10-01). TypeScript 6.0.3, vitest 4.1.11, tsx 4.23.15: all exact versions. |
| E3 | soroban-sdk ≥ 23 emulates automatic restoration of archived entries in tests (protocol 23 behavior). "Archived channel" therefore cannot be tested as an access error. | The tests assert exact TTL values and that an archived channel is restored with its full state, so replay protection survives archival (`storage.rs`). |

## Specification items

| # | Brief | Issue | Resolution |
|---|---|---|---|
| S1 | §4.1 constructor must require owner auth; §9 test incorrect initialization | `Env::register` in soroban-sdk **always mocks constructor authorization**. Tests written that way pass even with `require_auth` removed. | Constructor authorization is tested by deploying the compiled WASM through `deploy_v2` from a test factory, without auth, with an attacker's auth, and with a control (`auth.rs`). |
| S2 | §5 `redeem_batch`: authorization not specified | The reference one-way channel requires the recipient's auth. With N providers, that would mean collecting N signatures per batch. | **Permissionless** submission; every payout recipient comes from storage. Safe because nobody can redirect funds; tested by `redeem_batch_is_permissionless_but_pays_only_stored_provider`. |
| S3 | §5 "reject stale or replayed commitments" combined with atomic batches | A rejection reverts the whole batch, so one stale voucher blocks the other providers' settlement (a liveness cost). | Kept strict rejection (`StaleVoucher`), as required. The coordinator simulates before submitting. Documented as a known limitation. |
| S4 | §6 providers verify "using authenticated channel information retrieved from Stellar" | RPC responses are not cryptographically authenticated, and channel data from a contract with different code proves nothing. | Providers pin the contract **WASM hash and token** before trusting channel data (`assertTrustedDeployment`), and verify signatures with exactly the host's `verify_strict` rule (see review finding B-1). Reliance on the RPC remains, documented in security assumptions. |
| S5 | §6 payload fields | Including `signer` and `owner` is redundant with the stored channel, but binds them explicitly at negligible cost. | Implemented exactly as listed, using the one-way channel's `ScMap` convention (ordered keys, `Symbol` domain). |
| S6 | §7 "token balance must be sufficient to cover recorded liabilities" | The contract cannot prevent an asset issuer from clawing back or freezing balances. | Solvency holds for contract logic (tested). Dependence on the issuer is documented. AUSD sets no auth flags. |
| S7 | §7 unsolicited transfers | Must not be credited. | `available` changes only through `deposit`. Surplus is reported as `unaccounted_balance` and cannot be recovered in the PoC (no sweep function). |
| S8 | §9 "Do not use `mock_all_auths()` for authentication-security tests" | soroban-sdk 27 `mock_auths` rejects **G-account** addresses. | Owner auth tests use enforcing `mock_auths` with contract-type addresses and exact invocation trees. There are two exceptions, neither of them a negative authorization test: the cross-language vector fixture (G-account owner), which uses `mock_all_auths` only to set up channels (its signatures are real and are verified by the host), and the positive constructor control test, which uses `mock_all_auths_allowing_non_root_auth` and asserts that the owner's authorization was recorded. |
| S9 | §9 "failed asset transfer causing whole-batch revert" | Requires a transfer that fails inside the SAC. | The issuer sets `AUTH_REVOCABLE` and deauthorizes provider C; the batch reverts with no payout to A or B (`failed_asset_transfer_reverts_whole_batch`). |
| S10 | §10 compare against three separate redemptions with equal starting state | Testnet state cannot be rewound. | Two deployments of the same WASM with identical deposits, channels and amounts. |
| S11 | §10 "do not claim 66%" | — | Measured −32.2% fee and −30.7% declared instructions for three vouchers (latest run). |
| S12 | §11 no closure, so unused collateral stays locked | — | Documented; test assets only. |
| S13 | §8 provider vouchers and the 17 AUSD incremental step | The agent must continue from the redeemed amount after settlement. | `ChannelSpender` starts from the on-chain `redeemed`; the provider rechecks against both its store and the on-chain amount. |

## Scope check

Implemented: exactly the six mutating and view functions in §5, plus one
read-only helper (`voucher_message`) used for the encoding parity check
against the deployed contract. Nothing from §11 (excluded features) was
implemented.
