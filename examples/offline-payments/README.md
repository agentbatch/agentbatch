# Offline payments example

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm example:offline
```

The example creates an in-memory agent signer and illustrative channel,
issues three cumulative vouchers, verifies each request price, and rejects
duplicate vouchers. It uses the public `@agentbatch/voucher` exports, submits
no transactions and writes no key files.

The channel metadata and contract address are local examples. A real provider
must verify its deployment, token, network and channel state before accepting
payments and retain its highest accepted voucher durably. See
[security assumptions](../../docs/security-assumptions.md) and the
[Testnet provider implementation](../../tools/testnet/src/provider.ts).
