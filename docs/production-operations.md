# Production operations and recovery

This is the operational specification for the proposed
[production architecture](ARCHITECTURE.md) and [specification](production-specification.md), not evidence of running services.
The current runner deploys disposable Testnet contracts; it does not install a
coordinator, indexer, keeper, monitoring system or production signer.

## Responsibilities and service objectives

Before admitting production funds, the release record must name an accountable
organization and primary/backup operator for each role below, including escalation
and funded coverage. This document assigns responsibilities to roles without
inventing people or granting hosting permissions. Release and repository governance
are defined in [maintenance](maintenance.md).

| Role | Responsibilities |
|---|---|
| Treasury administrator | Owner wallet policy, agent/provider budgets, funding, closure approval and asset-risk acceptance |
| Provider operator | Authenticated service/client identity, durable acceptance journal, receipts/outbox, deadline monitoring and independent redemption |
| Signer operator | Durable highest-signed counters, key isolation, request idempotency, access revocation and recovery |
| Settlement operator | Candidate leases, source sequences, fee budget, submission reconciliation and deadline prioritization |
| Data operator | RPC/feed qualification, ingestion completeness, immutable archive, database migrations and backups |
| Maintenance operator | Dependency TTL inventory, rent reserve, restoration jobs and claim-watch coverage |
| Security/release authority | Incident coordination, artifact verification, independent review gates and release approval |

Select and publish numeric service objectives per environment before launch:
maximum accepted state age, ingestion lag, candidate wait, unknown-outcome age,
alert acknowledgment/recovery time, backup recovery point (RPO), restore duration
(RTO), minimum fee/rent balance and operating reserve. Derive values from the
claim window and measured load; unspecified objectives block production acceptance.
A proposed safety relation is:

```text
W > maximum accepted observation lag
    + incident detection/response/recovery ledgers
    + restoration and signing/submission allowance
    + tested congestion safety margin
```

Ledger counts govern the contract; wall-clock projections are estimates. A network
halt may stop both ledger deadlines and progress, while provider clocks continue.
Service admission must stop on stale observations even if deadlines are not advancing.

For acknowledged provider claims and issued signatures, require zero loss of
acknowledged state: use synchronous durable journal/replication before acknowledgment.
A daily backup alone cannot meet that RPO. A read model can tolerate rebuildable
loss within its raw archive coverage; publish a distinct objective. Backup restore
and failover drills must demonstrate the selected RTO within the claim safety
margin. No present SLA or achieved recovery measurement is claimed. Queueing a claim
before D is insufficient: its successful execution must be confirmed in ledger
≤ D. Reserve enough margin to recover from a failed invocation and still execute
another attempt by D.

## Deployment acceptance

1. Verify release authority, independent security assessment scope/remediation,
   artifact checksums, lockfiles, build environment, optimized WASM/spec, package
   contents and source reproducibility. Record any accepted residual risks.
2. Verify network passphrase/protocol, reset generation, endpoint versions, observed
   ledger identity, RPC history bounds, archive coverage and rate limits. Keep
   production/Testnet keys, databases, queues and configuration separate.
3. Admit the exact asset code/issuer/SAC and observe admin, issuer flags and
   treasury/provider authorization. Test G-account trustline headroom and C-address
   balances; verify seven decimals and transfers. Record asset-specific failures.
4. Deploy with owner-authorized constructor, fresh salt and recorded transaction
   evidence. Read back owner/token/claim window/budgets, fetch actual code bytes
   and match WASM hash. Catalog admission follows verification, not submission.
5. Exercise deposit→allocate→accept→redeem→top-up→close→finalize→withdraw on the
   production candidate in a qualified environment, including a provider redeeming
   without the coordinator. Confirm all accounting and event projections.
6. Exercise code/instance/channel/budget/SAC dependency restoration and rent payment,
   source expiration, portable owner-authorization expiry, nonce rollback, stale
   workers, wallet rejection and unknown-outcome resolution. Confirm no duplicate
   economic action and no counter reset.
7. Test a voucher/request copied onto another TLS client identity, altered quotes
   or bodies, duplicate authenticated retries and unauthorized result lookup.
   These must not deliver another client's service, disclose results or bill twice.
8. Validate API tenant isolation, rate limits, metadata-fetch restrictions, redacted
   logs, signer method/target/fee policies and independent backup restoration.
9. Confirm funded XLM sources/reserves, on-call coverage, tested alerts, continuity
   ownership, published service objectives and an explicit go/no-go sign-off.

Production fees use real XLM; Friendbot is Testnet-only. Collateral tokens do not
pay network fees. Settlement and maintenance accounts must have authorized funding
and reserve headroom; depletion alerts need a runway longer than incident recovery.
Use simulated extension/restoration budgets and bounded operational ceilings;
never grant a worker owner authority to top itself up. Low-volume claims near a
deadline must be settled even when batching would be more economical.

## Observability

Record network/generation/contract, intent/job/transaction hashes, source and
sequence lease, relevant channel IDs, observation ledger, attempt number, status
and stable error category. Keep exact amounts and XLM fees in separate fields.
Do not log seeds, wallet secrets, full authorization payloads, service inputs or
unredacted vouchers. Restrict detailed signed envelopes to encrypted operational
storage until publication is appropriate.

| Signal | Alert/response |
|---|---|
| B < A+R, broken conservation, redeemed decreases at a common completed ledger | Critical: stop new exposure and automated accounting assumptions; preserve evidence and reconcile issuer/contract state |
| Provider pending claim close to D | Page provider/watchtower and settlement operator; restore dependencies and submit latest claim independently if needed |
| Minimum dependency live-until margin | Extend/restore in bounded chunks with funding; include shared code and SAC balances |
| RPC latest ledger lag, endpoint disagreement | Stop fresh payment acceptance above age policy; corroborate with controlled/independent RPC |
| Ingestion checkpoint approaching oldest retained ledger | Fail over feed or backfill before retention gap; label API history incomplete on gap |
| Unknown transaction or source sequence conflict | Lock the affected intent/source, reconcile exact hash; do not repeat a deposit/withdrawal |
| Batch simulation/token failure rate | Quarantine candidates, re-read and simulate smaller batches; cap retries/fees |
| WAL/replication failure or voucher-store I/O error | Stop acknowledgment/service acceptance for affected channels until durable state is restored |
| Fee balance, rent forecast or claim backlog | Replenish through approved funding and prioritize deadlines |
| Code/token pin mismatch, signer-policy failure | Deny service/signing, investigate deployment/configuration integrity |

Publish dashboards for settlement latency/error percentiles, claims at risk,
index lag/gaps, archive coverage, funding runway, rent consumption, and signer
availability. Never expose per-request secrets in public usage metrics. Alert
channels and thresholds require actual hosting configuration and operators.

## Incident procedures

### Key compromise or incorrect authorization

Disable affected signer/service credentials, preserve counter/journal state and
notify the treasury administrator through established contacts. Start protected
closure on affected production channels, monitor to D, and fund legitimate
provider claims. Open replacement channels only with distinct keys and budget
headroom; do not reuse old collateral before finalization. A compromised owner
requires the organization's account threshold/recovery mechanism; the PoC cannot
change its owner or revoke a delegated key. There is no magic contract rollback
or global pause in the deployed PoC.

### Unknown or stalled transaction

Recover the persisted signed envelope and hashes. Query the same hash via trusted
RPC/archive; record SUCCESS/FAILED and ledger before changing the intent. For a
fee bump, reconcile inner and outer hashes. If NOT_FOUND, determine whether its
bounds expired and whether the source sequence was consumed, then inspect
contract postconditions. Current state alone may not identify which transaction
deposited or withdrew money; retain transaction history. If evidence cannot
establish the outcome, keep it unknown and escalate instead of replaying.
For redemptions, reconcile each channel's redeemed counter and resubmit only
remaining eligible claims with a newly simulated transaction that can still
execute by D. For separately signed owner credentials, reconcile authorizer/nonce/
invocation/expiry across every possible envelope: original time-bound expiry or
source sequence consumption does not revoke a portable grant. Do not obtain a new
grant for the same unresolved deposit/open/withdraw until the old one is consumed
with reconciled effects or the trusted ledger is past its signature expiration
and history coverage establishes the outcome. Failed calls can roll back nonce
consumption; a missing nonce entry is not a sufficient outcome check. Store all
issued grants even if the wallet disconnects before envelope signing. Lease
expiry does not cancel already released credentials or envelopes.

### Archived dependency or depleted maintenance funds

Inventory treasury instance/code/channel/budget, relevant SAC balances and
contract-account dependencies. Simulate the intended action to discover required
restoration; fund fees through an approved account. Use automatic restore data
when supported and within limits, or separate `RestoreFootprintOp` transactions.
Confirm restores, reload sequences, re-simulate and submit the claim. Extend
remaining live dependencies where appropriate. Restore the original counters;
never initialize a replacement “empty” channel for a previously used ID.
Read-only simulation does not pay rent or persist state restoration. Recovery
must preserve the deadline priority and warn providers when the margin is lost.

### Provider state loss or signer counter loss

Stop new paid service or signing for affected channels. Recover the acceptance
journal, highest signed counter, receipts and outbox from durable replica/journal
and verified backups. Validate every recovered voucher against deployment context,
then reconcile redeemed state. The chain cannot recover outstanding unsubmitted
claims. Do not set a lost highest-accepted/signed value to redeemed and continue.
If acknowledged state cannot be recovered, keep acceptance disabled, redeem any
known valid claims, close affected channels and document loss/settlement obligations.

### Frozen provider, frozen treasury or asset clawback

Re-read issuer/admin and per-holder state; distinguish restricted transfer from a
contract arithmetic error. Exclude an unpayable provider from other batches and
notify it; do not change its immutable payout address. If treasury funds are
frozen or deficient, stop new acceptance/exposure, preserve claim records and
contact the actual issuer/admin through an established channel. A top-up must not
be credited as a repair without explicit accounting review: normal deposits add
liabilities as well as balance and cannot eliminate a deficit by themselves.
No insurance, recovery asset or haircut policy is implemented. Release approval
must define asset-specific deficit resolution without inventing provider payments.

### Indexer gap, corrupted projection or database failure

Compare checkpoint with feed health/oldest ledger, preserve raw archive/checksum
manifests, and stop publishing complete/fresh history. Recover missing metadata
from the qualified archive, replay into new tables with the pinned decoder,
reconcile deposits/payouts/withdrawals/releases against contract and SAC state at
one common completed ledger and hash, then switch readers. A channel scan across
different current RPC snapshots is inconclusive, not proof of insolvency. Use
qualified ledger metadata to reconstruct a common snapshot; ordinary RPC entry
reads do not select an arbitrary historical ledger. A current snapshot restores current discovery/totals,
not missing historical rows. Private provider acceptance history is recovered by
its owner independently. Apply migrations with reversible readers, backups and
checksum/version verification; do not mutate raw evidence to match a projection.

### Testnet reset or environment mismatch

Suspend old-generation jobs, cursors and payment acceptance. Archive public
results and private recovery material according to their separate policies.
Provision fresh treasury salts/keys, record the new generation and manifest,
verify network/code/asset and rerun acceptance. Never overwrite old manifests or
recreate the old signing context. Missing entries after a reset are not evidence
of an archival-only problem that restoration can solve.

## Backups, retention, and retirement

Back up provider acceptance journals/receipts/outbox, signer counter journals,
transaction intents/signed envelopes and issued portable owner credentials,
authenticated client identity mappings, deployment manifests, raw metadata,
checkpoints, projection schemas/migrations, signer policy and encrypted recovery
material. Separate public artifacts from secrets. Use encrypted replicas,
restricted restore access, immutable/versioned object storage, cross-failure-domain
copies, checksum verification and scheduled restore drills. Define actual
retention/access/deletion periods before launch; retain public release/evidence
artifacts durably beyond RPC and CI log retention. Never delete an unredeemed
claim merely because an analytics retention interval elapsed.

Retirement begins by stopping new allocations and acceptance, notifying users and
providers through configured channels, preserving independent redemption/TTL
funding through all claim deadlines, and reconciling finalization/withdrawals.
Retain terminal state, evidence, releases, decoders and security notices. Remove
private data only under the approved retention policy after outstanding duties
are resolved. PoC reservations lacking a closure path remain locked; retirement
does not create authority to sweep them.
