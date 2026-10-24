# PoC Architecture and Design Decisions

The PoC proves three things on Stellar Testnet:

1. **Shared treasury funding.** One deposit into one Soroban contract funds
   several providers.
2. **Independent virtual channels.** Channels are storage records with
   isolated collateral, not separate contract deployments.
3. **Batched multi-provider settlement.** Independent cumulative vouchers for
   different providers settle atomically in one transaction.

Anything beyond that (closure, revocation, rotation, reallocation,
multi-tenancy, adapters, console) is reserved for the grant-funded roadmap.

## Components

```text
contracts/agentbatch-poc   Soroban contract AgentBatchPoC (Rust, no_std)
packages/voucher           @agentbatch/voucher: voucher encoding, agent signing,
                           provider verification, highest-voucher store
apps/demo                  Testnet runner: asset issuance, deployment, three-provider
                           simulation, batch settlement, benchmarks, evidence
test-vectors/              Rust-generated vectors that the TypeScript tests must match
```

## Contract interface

| Function | Auth | Effect |
|---|---|---|
| `__constructor(owner, token)` | `owner` | Binds owner and token permanently. Runs once, at deployment. Requires a 7-decimal token. |
| `deposit(amount)` | owner | Transfers tokens from the owner; `available += amount`. Fails with `TransferMismatch` unless the contract's balance rose by exactly `amount`. |
| `open_channel(provider, signer_key, allocation)` | owner | Moves `allocation` from `available` into a new channel reservation; returns the channel ID (1, 2, 3, …). |
| `redeem_batch(vouchers)` | none | For 1–4 vouchers on distinct channels: verifies each, pays `amount − redeemed` to the stored provider. Atomic. |
| `withdraw_available(amount)` | owner | Withdraws unallocated funds only. |
| `get_treasury()` | — | Totals, actual token balance, unaccounted balance. |
| `get_channel(id)` | — | Provider, signer, allocation, redeemed, remaining. |
| `voucher_message(id, amount)` | — | The exact bytes to sign; used for cross-implementation parity checks. |

There is no initializer, setter, upgrade, close, revoke or rotate function.

Error codes are 101–113 (`InvalidAmount` 101 … `TransferMismatch` 113; see
[`error.rs`](../contracts/agentbatch-poc/src/error.rs)). They start above the
Stellar Asset Contract's own codes (1–15), so a token failure inside a batch,
such as `BalanceDeauthorizedError` (11), is never mistaken for a contract error.

## Storage

| Data | Storage | Key | TTL policy |
|---|---|---|---|
| `Config { owner, token }` | instance | `DataKey::Config` | On every state-changing call, extended back to 30 days if its TTL has fallen below 7 days. Only the instance is extended, never the shared WASM code entry. |
| `Treasury { totals, next_channel_id }` | instance | `DataKey::Treasury` | Same as above. |
| `Channel` | persistent, one entry per channel | `DataKey::Channel(u64)` | At least 30 days on open, whatever the network minimum; on each redemption that touches it, extended back to 30 days if its TTL has fallen below 7 days. |

Persistent entries are archived, never deleted, when their TTL lapses. Since
protocol 23, transactions restore archived entries automatically, so an
archived channel returns with its `redeemed` counter intact
(`storage::archived_channel_restores_with_full_state`). Replay protection
therefore survives archival. A missing key is always `ChannelNotFound`, never
an empty channel. Read-only views do not extend TTLs. Anyone can extend or
restore entries with `ExtendFootprintTTLOp` / `RestoreFootprintOp` without a
contract function.

The 30-day extension is the main cost of opening a channel (see
[benchmarks](benchmarks.md)). It is a tunable constant (`TTL_EXTEND_TO`).

The WASM code entry is shared by every deployment of the code and is by far
the largest entry, so the contract never extends it: `instance().extend_ttl()`
would make every call pay rent on 17 KB of code. The code's TTL is maintained
separately with `ExtendFootprintTTLOp`; if it lapses, protocol 23+ restores it
automatically on the next invocation.

## Settlement flow

```mermaid
sequenceDiagram
    participant O as Treasury owner
    participant C as AgentBatchPoC
    participant A as Agent (delegated Ed25519 key)
    participant P as Provider
    participant K as Coordinator (any account)

    O->>C: deposit(100)
    O->>C: open_channel(P, agent_key, 40)
    P->>C: get_channel / contract WASM hash (read-only, once)
    loop each paid API request (off-chain)
        A->>P: request + voucher(cumulative, sig)
        P->>P: verify sig, amount ≤ allocation, amount > highest, increment ≥ price
        P-->>A: service response
    end
    P->>K: latest voucher
    K->>C: redeem_batch([vA, vB, vC])
    C->>C: verify all, update all accounting
    C->>P: SAC transfer(incremental amount), one per provider
```

`redeem_batch` runs in two phases. First it validates every voucher and writes
all channel and treasury accounting; only then does it make the token
transfers. A failure anywhere reverts everything.

## Design decisions and deviations

| Decision | Choice | Rationale | Relation to existing Stellar implementations |
|---|---|---|---|
| Channel representation | Persistent records in one contract | Shared funding with no per-provider deployment; this is the core claim | one-way-channel deploys one contract per funder–recipient pair |
| Collateral | Explicit per-channel reservation from a shared pool | A provider's claim cannot be satisfied with another provider's funds | one-way-channel collateral is the channel contract's whole balance |
| Voucher signature | Raw Ed25519 over XDR `ScMap`, verified with `ed25519_verify` (ed25519-dalek `verify_strict`) | Long-lived cumulative commitments do not fit Soroban auth entries (nonces, expiry) | Same mechanism and encoding style as one-way-channel commitments and MPP |
| Voucher fields | Adds `channel_id`, `owner`, `provider`, `signer` | Many channels share one contract address, so the channel must be bound explicitly | one-way-channel binds only domain, network, contract and amount |
| Redemption auth | Permissionless; payout recipient comes from storage | A coordinator can settle many providers without collecting their signatures | one-way-channel `settle` requires `to.require_auth()` |
| Stale voucher | Error (`StaleVoucher`, 109), not a no-op | Makes replay attempts explicit; the spec requires rejection | one-way-channel transfers nothing and succeeds |
| Over-allocation voucher | Error (`ExceedsAllocation`, 110) | A provider can never be paid beyond its reservation | one-way-channel is bounded by the contract balance |
| Batch size | 1–4, distinct channels | Bounded, measured resource use; duplicates rejected | — |
| Token | Fixed at construction; 7 decimals required; deposits credited only for the balance actually received | Exact AUSD base-unit accounting; a fee-on-transfer token cannot break solvency | — |
| Unsolicited transfers | Never credited; reported as `unaccounted_balance` | `available` changes only through `deposit` | one-way-channel counts direct transfers as top-ups |
| Upgradeability | None | Out of PoC scope; immutable code is simpler to review | — |

## Off-chain components

- **`AgentSigner`** holds the agent's raw Ed25519 key and signs any amount;
  **`ChannelSpender`** wraps it, issues strictly increasing cumulative
  vouchers and refuses to sign beyond the allocation. Agent keys are not Stellar accounts and hold no treasury rights.
- **`verifyStrict`** applies exactly the host's Ed25519 rule (canonical `s`,
  no small-order `R` or key, cofactorless equation). A generic Ed25519 library
  can accept signatures the contract rejects, so it is the only verifier used
  for vouchers. Rust-generated vectors of host-rejected signatures keep the two
  in agreement.
- **`ProviderVerifier`** accepts a voucher only if the channel belongs to this
  provider and its signer key is a safe prime-order point (`isSafeSignerKey`),
  the signature passes `verifyStrict` over this provider's channel on the
  pinned contract and network, the amount stays within the allocation, and it
  exceeds the highest accepted or redeemed amount by at least the request
  price. Its configuration and store deployment are validated when it is
  constructed.
- **`assertTrustedDeployment`**: before reading any channel, the provider
  checks that the contract's on-chain WASM hash and payment token match the
  pinned values.
- **`FileVoucherStore`** keeps the highest accepted voucher per channel for
  one deployment (network and contract are recorded in the file). Loading fails
  closed on a missing, malformed, duplicate or foreign file. Each write is
  fsynced and atomically renamed. Requests in the PoC are sequential;
  production needs an atomic compare-and-set store.
- **Coordinator**: any funded account. It simulates `redeem_batch` and submits
  it only if simulation succeeds. It holds no treasury rights.
