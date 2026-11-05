# @agentbatch/voucher

Private ESM Node package for AgentBatch PoC cumulative payment vouchers. Not a
production settlement SDK. Requires Node ≥22.12; tested baseline 22.13.1.

The package exports exact XDR encoding, delegated Ed25519 signing, strict voucher
verification, provider acceptance and sequential memory/file stores. Amounts and
channel IDs use bigint; signatures use Uint8Array. One token has 10,000,000 base
units. Do not use floating point for money.

```ts
import { AgentSigner, ChannelSpender, MemoryVoucherStore, ProviderVerifier } from "@agentbatch/voucher";
// scope = {networkPassphrase, contract}; channel comes from a pinned deployment.
// Do not trust illustrative or caller-supplied channel metadata as collateral.
const signer = AgentSigner.random();
// An owner must register signer.publicKey on the actual channel before payment.
```

In this repository, run `pnpm example:offline` for the complete local signing and
verification example. See the repository's `docs/sdk.md`, `docs/voucher-format.md`
and `docs/security-assumptions.md` for interfaces, encoding and trust boundaries.
The repository is https://github.com/agentbatch/agentbatch.

Providers must pin network/contract/code/asset and validate channel state, then
retain the highest accepted voucher before serving. File stores require explicit
first-time creation and fail closed if an existing store is missing or corrupt.
They support one sequential writer, not concurrent production processes. Agent
spending counters are memory-only: a restart must recover the highest ever signed
amount, not only the on-chain redeemed amount. Lost unredeemed claims cannot be
recovered from chain state alone.

The root export imports Node filesystem and crypto facilities and is not an
unmodified browser entry. The package is private; packing it locally does not
publish it or establish a supported production version. Source is included so
shipped source maps can resolve to the matching implementation. No private keys,
provider state, test fixtures or deployment evidence belong in the package.

Licensed under Apache-2.0; the complete unchanged license is in LICENSE.
Dependencies retain their own licenses. See the repository's SECURITY.md for
vulnerability reporting availability and limitations.
