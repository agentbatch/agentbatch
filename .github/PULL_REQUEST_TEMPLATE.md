## Summary

<!-- What does this change and why? -->

## Scope

- [ ] Contract (`contracts/`)
- [ ] Libraries (`packages/`)
- [ ] Operational tools (`tools/`)
- [ ] Runnable examples (`examples/`)
- [ ] Docs / tooling

## Security checklist (contract changes)

- [ ] Authorization: administrative calls require exact owner authorization; permissionless redemption pays only stored providers
- [ ] Arithmetic: amounts validated (> 0) and checked; no silent overflow
- [ ] Collateral invariant still holds and is covered by tests
- [ ] Provider address read from storage, never from caller input
- [ ] Storage TTL policy and every code/data/asset dependency are accounted for
- [ ] Lifecycle/compatibility changes preserve outstanding claims and document migration

## Testing

<!-- Commands run and results. Do not claim Testnet results without tx hashes. -->
