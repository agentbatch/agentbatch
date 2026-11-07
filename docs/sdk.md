# SDK and integration reference

[Architecture](ARCHITECTURE.md) and the [production specification](production-specification.md) own protocol behavior. This document separates
the current private voucher library from the proposed production SDK. All
workspace packages are private; no registry publication or browser compatibility
is established by their package names.

## Available package

`@agentbatch/voucher` 0.1.0 is an ESM Node package built from
[`src/index.ts`](../packages/voucher/src/index.ts). The repository baseline is
Node 22.13.1 (engines ≥22.12), pnpm 10.19.0, TypeScript 6.0.3,
`@stellar/stellar-sdk` 17.2.1 and `@noble/ed25519` 3.2.0. Exact lockfiles own
transitive versions. The root export includes filesystem persistence and Node
crypto/Buffer dependencies. It is not a ready-made browser entry.

| Export | Implemented contract |
|---|---|
| `networkId(passphrase)` | SHA-256 of UTF-8 passphrase |
| `encodeVoucherMessage(context, amount)` | Exact v1 XDR; i128 amount/u64 channel bounds, 32-byte key, G/C owner/provider and C deployment validation. Encoding accepts channel zero and negative amounts for protocol fixtures; redemption does not. |
| `AgentSigner.fromSeed/random`, `.publicKey`, `.sign` | Raw Ed25519 signing. Does not enforce allocation or verify key/context equality. Never expose a treasury key as an agent seed. |
| `ChannelSpender(..., alreadyAuthorized).pay(price)` | Positive incremental price, cumulative ≤ allocation; memory-only state. Pass highest ever signed, not just redeemed, after restart. |
| `verifyStrict`, `isSafeSignerKey`, `verifyVoucherSignature` | Host-compatible strict signature verification with additional canonical/safe-key restrictions; see [wire format](voucher-format.md). |
| `ProviderVerifier(config, store)` | Deployment-scoped local verification and monotonic store update; caller supplies trusted channel state. Does not fetch/pin the network or enforce a production lifecycle. |
| `assertTrustedDeployment(observed, expected)` | Compares code hash and token pins; does not authenticate the RPC observation. |
| `MemoryVoucherStore`, `FileVoucherStore` | Highest voucher per channel within network/contract scope; sequential writers only. File creation requires explicit `{create: true}` and refuses replacement. |
| Address validators and exported types | See index; addresses reject muxed M forms. Values use bigint/Uint8Array. |

`AcceptResult` is `{ok:true, increment:bigint, cumulative:bigint}` or
`{ok:false, reason:RejectReason}`. Reasons are `channel-mismatch`, `not-my-channel`,
`unsafe-signer-key`, `bad-signature`, `exceeds-allocation`, `not-increasing`,
`insufficient-payment`. Invalid configuration/encoding can throw `TypeError` or
`RangeError`; persistence and deployment validation throw errors; callers must
handle both rejection results and exceptions. The package has no general typed
transaction/RPC error hierarchy today. A store validates structure, not the
cryptographic authenticity of every stored voucher; verify recovered claims
against pinned context before settlement.

The handwritten `AgentBatchClient` in
[`tools/testnet/src/contract.ts`](../tools/testnet/src/contract.ts) is an internal
Testnet tool, not a public SDK export. It uses Keypair-based source signing and
simulation reads. Do not import its hardcoded network/keys/funding configuration
into a production application.

## Exact amounts and existing example

Use bigint for base units, canonical decimal strings in JSON, and byte arrays
for signatures. For seven decimals, `"1.25"` corresponds to `12_500_000n`.
Reject >7 decimal places and values beyond signed i128. Never use floating point
or `Number` to represent money or u64 channel IDs. The demo `ausd(number)` helper
uses rounding on fixed scenario literals; it is not a production amount parser.
Format exact units for display without changing stored amounts.

The [offline example](../examples/offline-payments/src/index.ts) exercises the
public exports with illustrative, untrusted channel metadata:

```bash
pnpm install --frozen-lockfile
pnpm example:offline
```

It creates a signer, signs increments of `10_000_000n`, `20_000_000n` and
`5_000_000n`, verifies the cumulative 35_000_000 claim, and rejects duplicate
vouchers without submitting transactions. Copying its metadata into a real
provider does not provision collateral. Real providers must pin network,
contract, code and asset, read their channel and retain acceptance history.

## Proposed package boundaries

These names and interfaces are design targets, not available imports:

| Boundary | Responsibilities | Excluded dependency |
|---|---|---|
| `protocol` | Types, exact amount parser/formatter, PoC v1 and proposed `AGENTBATCH_V1` codecs, pure verifier interfaces, shared vectors | Filesystem, wallets, RPC URL globals |
| `bindings` | Generated client/spec for each admitted WASM ABI | Deployment secrets and auto-selected contract identities |
| `sdk` | Validated deployment config, read/preflight/submit/reconcile, stable errors and transaction intents | Raw private keys or implicit network switching |
| `sdk/node` | File/database adapters and remote signer integration | Browser bundle |
| `sdk/wallet` | Capability-based wallet transaction/auth-entry signing | Agent signing counter custody |
| Payment adapters | Pinned MPP/x402 challenges, request IDs and receipts | Claims of interoperability without conformance tests |

Generate bindings from the reviewed optimized WASM's embedded contract spec with
a pinned official CLI/SDK generator. Record generator version, spec/WASM hashes,
options and generated output checksum; reproduce output and typecheck it in CI.
[Official bindings reference](https://stellar.github.io/js-stellar-sdk/reference/contracts-bindings/)
describes the binding facilities. A generated class supplies ABI encoding, not
trusted deployment configuration, lifecycle monitoring, signer policy or asset
admission. Wrap it behind stable public interfaces and golden XDR/vector tests.
Do not hand-edit generated bindings or generate from an unverified remote target.

Proposed configuration and interfaces:

```ts
// Design example only; no package with these exports exists yet.
type DeploymentConfig = Readonly<{
  networkPassphrase: string;
  generation: string;
  contractId: string;
  wasmHash: string;
  specHash: string;
  asset: { code: string; issuer: string; sac: string; decimals: 7 };
  rpcUrls: readonly string[];
  protocolVersion: number;
  voucherDomain: string;
}>;
interface TransactionPlan {
  intentId: string;
  networkId: string;
  contractId: string;
  unsignedXdr: string;
  simulatedLedger: number;
  maxFeeStroops: bigint;
  authorizationEntries: readonly string[];
}
interface WalletAdapter {
  address(): Promise<string>;
  networkPassphrase(): Promise<string>;
  signTransaction(xdr: string, networkPassphrase: string): Promise<string>;
  // Optional capability; callers must check availability.
  signAuthorizationEntry?(xdr: string, networkPassphrase: string): Promise<string>;
}
// Client methods: readTreasury/readChannel/readBudget, prepare(intent),
// authorize(plan, wallet), submit(signedPlan), reconcile(intentId).
```

The actual implementation must bind intent IDs to immutable request digests and
return observable state transitions, not a single boolean. Persist separately
issued owner auth entries before any later envelope is built; track their
authorizer, nonce, invocation digest and expiration independently of transaction
bounds. Re-enveloping with another source does not cancel that authority, and
reissuing it with a new nonce can execute a second non-idempotent action. See the
[transaction authorization rules](production-specification.md#transaction-source-payer-and-authorizers). Separate read-only
transport from signing; allow caller-provided fetch, abort signal, bounded retry
policy and endpoint configuration. Validate endpoint network before using it;
never fall back to a different network or contract silently. Caller-supplied
RPC URLs must not leak credentials in telemetry or permit server-side SSRF.

Normalize production errors into `Validation`, `DeploymentMismatch`,
`WalletRejected`, `WalletCapabilityMissing`, `Authorization`, `Contract`,
`AssetTransfer`, `RestorationRequired`, `ResourceLimit`, `SequenceConflict`,
`SubmissionRejected`, `OutcomeUnknown`, `HistoryGap` and `Transport`. Preserve
contract/error number, failing contract and method, simulation ledger, hash and
retry classification where available. Do not interpret a bare contract numeric
code independently of invocation provenance. An unknown outcome must expose
reconciliation controls and cannot mean “safe to pay again.”

Production payment adapters must verify the separate authenticated request
message and its TLS client-identity binding defined in the
[service protocol](production-specification.md#authenticated-service-requests). A valid
payment voucher, request ID or replayed request signature alone is not authority
to receive a service result. This additional protocol does not change the
current voucher codec and requires its own canonical quote/request vectors.

For provider databases, the public acceptance method must perform a durable
compare-and-set transaction for highest amount, request deduplication, voucher,
receipt and service outbox. An async adapter cannot be substituted for today's
synchronous `VoucherStore` while retaining the same correctness claim; design a
new transactional acceptance API. For signers, use a durable atomic
reserve-and-sign interface with request idempotency and key isolation. A generic
wallet `signMessage` capability is not a substitute for pure Ed25519 voucher
signing with the exact required message.

## Compatibility and distribution

Publish a compatibility matrix per release: SDK, Node/browser/runtime, wallet and
its signing capabilities, contract ABI/code hashes, voucher domains, supported
asset, network protocols, RPC versions and schema. Reject unknown ABIs/domains;
preserve v1 vectors and decoder for historical evidence. Protocol 27+ Soroban
authorization changes and SDK v17 immutable XDR classes require their own wallet
fixtures; they do not change the PoC voucher message automatically. Use the
[official SDK migration reference](https://stellar.github.io/js-stellar-sdk/migration/protocol-27-soroban-auth/)
and pinned installed types rather than assuming current web examples match all
older releases.

Packaging includes `dist`, matching `src` for source maps, the unchanged root
Apache-2.0 license and package-specific usage documentation. A pack check must
inspect what is actually included. Before publishing, verify applicable notices,
declarations, JS and the reviewed source-map policy. Scan the tarball for keys/state/evidence and import it
in a fresh consumer outside the workspace. Test browser subpaths without Node
polyfills once implemented. Private package metadata and a successful local
build are not evidence that a distributable is complete. See
[releases and supply chain](maintenance.md) for artifact checks and release gates.
