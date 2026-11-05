# Testnet tooling

`@agentbatch/testnet` runs the disposable end-to-end scenario against Stellar
Testnet using synthetic AUSD. It consumes `@agentbatch/voucher` and the compiled
contract; it is not a reusable SDK or a production provider service.

From the repository root:

```bash
pnpm testnet:demo
# Optional: choose a fresh run name or an alternative HTTPS Testnet RPC endpoint.
AGENTBATCH_RUN_ID=my-test-run pnpm testnet:demo
```

`AGENTBATCH_RPC_URL` overrides the default Testnet RPC endpoint. The runner
checks its network passphrase before deployment. It uses friendbot for fresh
disposable accounts and keeps keys outside public evidence.

| Module | Purpose |
|---|---|
| `src/cli.ts` | Orchestration and Testnet network check |
| `src/workflows/deploy.ts` | Account funding, synthetic asset and contract deployment |
| `src/workflows/settle.ts` | Three-provider payments, isolation attacks, batch and incremental settlement |
| `src/workflows/benchmark.ts` | Equivalent separate settlements and withdrawal checks |
| `src/provider.ts` | Provider pinning, channel synchronization and voucher acceptance |
| `src/chain.ts`, `src/contract.ts` | RPC transaction handling and contract interaction |
| `src/runs.ts`, `src/report.ts` | Run isolation and write-once public artifacts |

Every invocation uses `deployments/testnet/runs/<run-id>/`,
`.secrets/testnet/<run-id>.json` and `.state/testnet/<run-id>/`. Reusing a run ID
fails. Provider stores are explicitly provisioned for these newly created
channels; ordinary provider startup must reopen durable state and fail if it
is missing. Completion is recorded only after the scenario and reports finish.

Full workspace commands, evidence selection and compatibility notes are in the
[contributing guide](../../CONTRIBUTING.md). Decode and independently
reconcile public records with the [evidence tool](../evidence/README.md).

## Transaction and recovery limits

The runner uses source-as-fee-payer Keypair signing and a 120-second timeout. It
aborts on restoration preambles, duplicate/try-later submission responses and
unknown outcomes; it does not implement production wallet authorization,
restoration, source leases or durable retry intents. Inspect any reported hash
before taking another economic action. `agentFor` initializes from redeemed only
for the controlled sequential scenario; real agents must recover the highest ever
signed amount. See [production transaction design](../../docs/architecture.md#7-networks-releases-and-transaction-execution)
and [recovery](../../docs/production-operations.md).
