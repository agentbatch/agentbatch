# Security Assumptions and Threat Model

**Status: proof of concept. Not audited by an independent third party. Test
assets on Stellar Testnet only. Do not deposit funds of value.**

## Actors and powers

| Actor | Can | Cannot |
|---|---|---|
| Treasury owner | deposit, open channels, withdraw *unallocated* funds | withdraw or reassign reserved collateral; change a channel's provider, signer or allocation; change the owner or token |
| Agent (delegated Ed25519 key) | authorize cumulative payments up to its channel's allocation, to that channel's provider only | move treasury funds, open channels, pay any other address |
| Provider | redeem vouchers for its own channel | redeem another channel's vouchers; receive more than its allocation; receive the same amount twice |
| Coordinator / any account | submit `redeem_batch` | choose or change a payout recipient |
| Token issuer (SAC admin) | freeze or claw back balances, if the asset's flags allow it | — (outside the contract's control; see below) |

## What the contract guarantees

- Only the owner can deposit, open channels and withdraw; owner authorization
  covers the exact arguments.
- Owner and token are fixed at deployment; the constructor cannot run again.
- Each channel's collateral is reserved exclusively for it. The sum of
  reservations never exceeds deposits, and reserved funds cannot be withdrawn.
- A payout goes only to the provider stored on the channel, is at most
  `allocation − redeemed`, and requires a valid signature by the stored signer
  over a message bound to this network, contract, owner, channel, provider and
  signer.
- A batch is all-or-nothing, including token transfers.
- Arithmetic is checked; negative and zero amounts are rejected.
- A missing channel is an error. Archived persistent state retains its counters,
  but network use requires a correctly prepared restoration and sufficient resources.
  The native testutils restoration check is not an end-to-end network restore test.
- A deposit is credited only for the balance the contract actually received.
- Current contract error codes (101–113) differ from the pinned SAC codes
  (1–15); decoding still needs failing-contract context. Arbitrary contracts and
  future versions do not have a guaranteed globally unique numeric namespace.

## What the off-chain verifier guarantees

- It accepts a subset of the signatures the pinned host accepts: it applies
  the host's `verify_strict` rule with additional canonical-point checks and
  refuses channels with unsafe signer keys.
- It never accepts a voucher above the allocation, at or below the highest
  accepted or redeemed amount, or below the request price.
- Its store is bound to one deployment and fails closed on missing, malformed,
  duplicate or foreign data.
- Initial store creation is explicit and exclusive. Ordinary provider startup
  never creates missing state. If accepted-voucher history is lost, stop
  serving until it is recovered; the redeemed counter alone is insufficient.

## Assumptions

1. **Agent keys are generated for, and controlled by, the treasury's agents.**
   The contract rejects only the all-zero key. Registering a key that nobody
   controls, or a weak key, harms only the owner's own channel.
2. **Providers pin the deployment.** A provider must check the contract's WASM
   hash and payment token before it trusts channel data
   (`assertTrustedDeployment`). A contract with different code could report
   any allocation and never pay. The demo rejects a client using another
   contract or chain connection and checks the RPC network passphrase before
   reading channel state.
3. **Providers trust their RPC endpoint.** Channel state is read by
   simulation. A dishonest RPC could overstate an allocation, and the provider
   would then serve requests it cannot redeem. Use your own or several
   independent RPC endpoints.
4. **Asset behavior and issuer powers.** The constructor checks only seven
   decimals, not that the token is an authentic SAC. Deposit checks incoming
   balance delta, but payouts assume exact outgoing transfer behavior. Production
   admission must pin the actual issuer/SAC and inspect its controls.
   If the issuer can freeze or claw back balances, it
   can block payouts (making a batch revert) or reduce the contract's balance
   below its recorded liabilities. The PoC's AUSD issuer sets no
   authorization flags. Production use with a regulated asset must take the
   issuer's controls into account.
5. **Sequential processing.** Each provider handles one request at a time per
   channel, and each agent signs from one process. Concurrent production
   deployments need an atomic provider store and a single signing counter per
   channel.
6. **Providers have trustlines.** A non-issuer G-account provider needs an authorized
   AUSD trustline with sufficient receiving headroom. Classic balance/transfer
   bounds are narrower than i128. The issuer is an exception without a
   self-trustline; paying it retires units. The PoC does not exclude it.

## Known limitations (by design for the PoC)

- **Per-channel caps only.** Allocations bound each channel's liability. The PoC
  has no aggregate per-agent or per-provider budget spanning several channels.
- **No protected closure yet.** The proposed claim period and safe
  release rules are specified in the production architecture but remain
  unimplemented and require adversarial validation.

- **Locked collateral.** There is no channel close or reallocation, so
  allocations that are never redeemed stay locked. Tokens sent directly to the
  contract are never credited and cannot be recovered.
- **Batch liveness.** One stale, invalid or unpayable voucher reverts the
  whole batch. Coordinators must simulate before they submit, which the demo
  does.
- **No revocation or rotation.** A compromised agent key can authorize
  payments up to its channel's remaining reservation, and only to that
  channel's provider.
- **Single treasury per deployment.** Separate deployments already isolate
  state, but multi-organization catalog, operations and access control are absent.

## Out of scope

Channel closure and dispute periods, signer rotation, revocation, collateral
recycling, multi-tenancy, keeper incentives, netting, MPP and x402 adapters,
passkeys, upgradeability, and Mainnet deployment.

See [`audit-report.md`](audit-report.md) for the internal review findings.

## Production threat model and residual risks

The [architecture](architecture.md) and [operations](production-operations.md)
specify required mitigations; these are not deployed protections:

| Abuse or failure | Required mitigation and remaining risk |
|---|---|
| Owner/agent/provider collusion | Exact authorization, immutable recipients, per-channel collateral and aggregate spent+reserved budgets. Authorized collusion can consume the entire allocation; no proof of service is enforced. |
| Owner closes while provider holds vouchers | Fixed monitored claim window, independent redemption, retained collateral. Claims must execute successfully by D; submission/queueing alone does not preserve them. |
| Key rotation or budget reset bypass | Canonical one-per-subject budgets, internally resolved immutable channel associations, stable agent identity, new channel IDs and old reservation retained; no epochs or counter resets in the first version. |
| Captured voucher or request used for service theft | Bind a separately signed request to the exact quote/body and TLS client identity; enforce that identity on every delivery/retrieval path. Current vouchers authenticate payment only. |
| Portable owner grant survives transaction expiry | Track owner nonce/expiry independently, reconcile all envelopes and never re-sign an unresolved economic intent merely because its original envelope expired. |
| Concurrent requests or process crash | Transactional acceptance/dedup/outbox and durable highest-signed journal before acknowledgment. Current sequential stores do not provide these guarantees. |
| False RPC/indexed state | Pin network/code/asset; controlled/corroborated state and age limits; stop acceptance on stale observations. A code hash obtained from a dishonest RPC is not a state proof. |
| Replay after Testnet reset | Fresh contract salts and keys; generation-scoped jobs/cursors/stores; never recreate identical signing context. |
| Coordinator censorship, stale batch or fee abuse | Provider self-submission, candidate quarantine, deadlines first, leases and bounded fees/retries. Atomic batches retain a liveness cost. |
| Malicious metadata/console/dependency | Validated fetches, SSRF limits, reviewed bundles, wallet signed-plan checks, lockfiles and artifact provenance. Hosting controls still require implementation. |
| External SAC restrictions or deficit | Asset admission, holder-state monitoring and issuer-aware incident response. No on-chain guarantee overrides freeze/clawback. |
| Lost archive/private voucher state | Independent durable backups and recovery drills. Current state cannot reconstruct history or outstanding claims. |

Do not treat the production scope as merely adding a user interface to the PoC.
Independent review must cover lifecycle, distributed acceptance, wallets,
transaction recovery, budget accounting and operational dependencies together.
