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
- A missing channel is an error; an archived channel is restored with its full
  state.
- A deposit is credited only for the balance the contract actually received.
- Contract error codes (101–113) cannot be confused with Stellar Asset
  Contract error codes (1–15).

## What the off-chain verifier guarantees

- It accepts exactly the signatures the contract accepts, or fewer: it applies
  the host's `verify_strict` rule and refuses channels with unsafe signer keys.
- It never accepts a voucher above the allocation, at or below the highest
  accepted or redeemed amount, or below the request price.
- Its store is bound to one deployment and fails closed on missing, malformed,
  duplicate or foreign data.

## Assumptions

1. **Agent keys are generated for, and controlled by, the treasury's agents.**
   The contract rejects only the all-zero key. Registering a key that nobody
   controls, or a weak key, harms only the owner's own channel.
2. **Providers pin the deployment.** A provider must check the contract's WASM
   hash and payment token before it trusts channel data
   (`assertTrustedDeployment`). A contract with different code could report
   any allocation and never pay.
3. **Providers trust their RPC endpoint.** Channel state is read by
   simulation. A dishonest RPC could overstate an allocation, and the provider
   would then serve requests it cannot redeem. Use your own or several
   independent RPC endpoints.
4. **Asset issuer powers.** If the issuer can freeze or claw back balances, it
   can block payouts (making a batch revert) or reduce the contract's balance
   below its recorded liabilities. The PoC's AUSD issuer sets no
   authorization flags. Production use with a regulated asset must take the
   issuer's controls into account.
5. **Sequential processing.** Each provider handles one request at a time per
   channel, and each agent signs from one process. Concurrent production
   deployments need an atomic provider store and a single signing counter per
   channel.
6. **Providers have trustlines.** A G-account provider needs an authorized
   AUSD trustline. Without one its transfer fails, and so does every batch
   that includes it.

## Known limitations (by design for the PoC)

- **Locked collateral.** There is no channel close or reallocation, so
  allocations that are never redeemed stay locked. Tokens sent directly to the
  contract are never credited and cannot be recovered.
- **Batch liveness.** One stale, invalid or unpayable voucher reverts the
  whole batch. Coordinators must simulate before they submit, which the demo
  does.
- **No revocation or rotation.** A compromised agent key can authorize
  payments up to its channel's remaining reservation, and only to that
  channel's provider.
- **Single treasury per deployment.** Multi-tenant isolation is not
  implemented.

## Out of scope

Channel closure and dispute periods, signer rotation, revocation, collateral
recycling, multi-tenancy, keeper incentives, netting, MPP and x402 adapters,
passkeys, upgradeability, and Mainnet deployment.

See [`audit-report.md`](audit-report.md) for the internal review findings.
