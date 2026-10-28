## Summary

<!-- What does this change and why? -->

## Scope

- [ ] Contract (`contracts/`)
- [ ] Libraries (`packages/`)
- [ ] Operational tools (`tools/`)
- [ ] Runnable examples (`examples/`)
- [ ] Docs / tooling

## Security checklist (contract changes)

- [ ] Authorization: every state-changing entry point requires the correct `require_auth`
- [ ] Arithmetic: amounts validated (> 0) and checked; no silent overflow
- [ ] Collateral invariant still holds and is covered by tests
- [ ] Provider address read from storage, never from caller input
- [ ] Storage TTLs extended where entries are touched

## Testing

<!-- Commands run and results. Do not claim Testnet results without tx hashes. -->
