# Architecture decision records

These records explain the target choices in [architecture](ARCHITECTURE.md) and the [production specification](production-specification.md).
“Proposed” means selected for this design and still requiring implementation and
release review. Existing historical decisions remain in
[poc-spec-review.md](poc-spec-review.md); historical findings remain separate.

## ADR-001: Isolate treasury custody per organization and asset

**Status:** proposed production topology; one treasury per deployment is already
implemented in the PoC.

Use separate immutable contract instances sharing reviewed code. Channels remain
persistent records within a treasury. This supports many organizations without
placing their custody or accounting in one global mutable map. The asset and owner
stay immutable, and a catalog has no spending authority. Costs include per-treasury
instance rent and writes serializing within a treasury. Cross-treasury atomic
batching and global budgets are excluded pending a separate router/policy design.

## ADR-002: Reserve worst-case claims and cumulative budget exposure

**Status:** per-channel collateral implemented; aggregate budgets proposed.

Reserve each channel's ceiling. Track spent+remaining reservations in one agent
and one provider budget per channel, resolved internally by their canonical
subjects. Duplicate budgets for a subject and counter resets are forbidden in
the first version. Redemption converts reserved to spent and
cannot replenish a lifetime spending cap. Closing releases only unused reservation.
This prevents multiple channels or key rotation from multiplying a nominal cap.
Calendar budgets, cross-treasury caps and complex policy hierarchies require
additional protocols; a UI label cannot implement them.

## ADR-003: Protect closure through a fixed ledger deadline

**Status:** proposed; no closure exists in the PoC.

Use Open→Closing→Closed, require valid cumulative claims to execute successfully
at or before the immutable deadline ledger, and release remaining collateral
afterward. RPC acceptance before the deadline does not preserve an unexecuted claim. Vouchers do not prove their
issuance time, so the protocol cannot distinguish signatures made before and after
close-start. Providers must monitor and submit; key compromise remains bounded by
allocation during the window. Rotation creates a replacement channel and retains
old claims. An instant revocation or an allocation decrease would expose providers
to unpaid service. The numerical window is a release-blocking operational decision.

## ADR-004: Preserve atomic settlement and offer provider self-submission

**Status:** atomic permissionless batches implemented; resilient coordination proposed.

Keep 1–4 distinct channels per invocation until requalified. Stored payout addresses
prevent redirection. One invalid or restricted transfer reverts all payouts; the
coordinator must re-read, quarantine and rebuild candidates, with deadlines ahead
of batch occupancy. Providers can bypass an unavailable coordinator and fund their
own submission. No mandatory reward or claim haircut is introduced.

## ADR-005: Index history outside the custody boundary

**Status:** proposed for the completed product; unnecessary for the PoC demo.

Use a transactional read model plus durable raw metadata archive for discovery,
exports, reconciliation and scheduling beyond RPC retention. Projections never
authorize spending; fresh chain reads and signatures do. Retention gaps remain
visible and must not be silently skipped. State snapshots can repair present
balances, but cannot invent lost history or recover private unredeemed vouchers.

## ADR-006: Replace deployments rather than upgrade custody in place

**Status:** no upgrade entry point implemented; replacement release policy proposed.

Publish new immutable code/contract identities for protocol changes. Stop new
exposure on old deployments, close them under their original claim rules, and
withdraw only eligible available funds. The PoC's unused reservations cannot be
migrated automatically because it has no close function. This adds operational
coordination but prevents a release administrator from rewriting provider rights.
