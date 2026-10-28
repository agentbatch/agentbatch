# Evidence verification

`@agentbatch/evidence` checks public execution records without loading private
keys or importing the Testnet runner. Run commands from the repository root.

```bash
pnpm evidence:check
pnpm evidence:check --run deployments/testnet
pnpm evidence:verify
pnpm evidence:verify --run deployments/testnet --output /tmp/agentbatch-live-verification
```

`check` uses local files only. It checks the separate and embedded manifests,
reconstructs envelope hashes on Testnet, decodes transaction results, checks
statuses and fees, and validates three-provider and incremental SAC transfers.
Where a separate final demo withdrawal is archived, it also checks the final
token balance and reservation accounting from ledger changes. Regression tests reject altered transaction hashes, fees, statuses, payouts,
RPC envelopes and metadata.
These are consistency checks, not network authentication.

`verify` performs those checks, confirms the RPC network passphrase, reads the
deployed contract instance and WASM code, hashes the actual code bytes, and
fetches every archived transaction again. Envelopes and results must match
exactly. Metadata comparison excludes diagnostics and sorts ledger-change
arrays, whose ordering may differ between RPC nodes. Operation and event order
remain significant. Success still depends on trusting the selected RPC endpoint.

The transport uses `curl` and standard HTTPS proxy settings for read-only RPC
methods. Live access requires network connectivity and records within the
endpoint's [transaction retention window](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getTransaction).
Unavailable records fail verification. No transaction is submitted or restored.

The original committed archive is the default. An optional local
`deployments/testnet/index.json` selects other reviewed runs.
Offline checks include all indexed and completed new runs. `--run` accepts a
repository-relative or absolute directory containing `manifest.json` and
`evidence.json`. Reports print to stdout. `--output` reserves a new directory
and writes reports there; an existing directory is refused. Archived records
are never refreshed in place.
