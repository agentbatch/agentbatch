# Voucher Format — `AGENTBATCH_POC_V1`

A voucher is an Ed25519 signature, by a channel's registered agent key, over a
deterministic XDR message. The message binds one **cumulative** amount to one
channel of one AgentBatchPoC deployment on one network.

## Signed message

The message is the XDR serialization of a Soroban `ScVal::Map` produced by
`VoucherPayload::to_xdr` in the contract
([`contracts/agentbatch-poc/src/types.rs`](../contracts/agentbatch-poc/src/types.rs),
[`voucher.rs`](../contracts/agentbatch-poc/src/voucher.rs)). Soroban maps are
ordered by key, so entries appear in ascending symbol order:

| # | Key (`ScSymbol`) | Value type | Source during on-chain verification |
|---|---|---|---|
| 1 | `amount` | `ScVal::I128` | caller (`Voucher.amount`) |
| 2 | `channel_id` | `ScVal::U64` | caller (`Voucher.channel_id`), then the stored channel record |
| 3 | `contract` | `ScVal::Address` (contract) | `env.current_contract_address()` |
| 4 | `domain` | `ScVal::Symbol` = `AGENTBATCH_POC_V1` | contract constant |
| 5 | `network` | `ScVal::Bytes` (32) = SHA-256(network passphrase) | `env.ledger().network_id()` |
| 6 | `owner` | `ScVal::Address` | stored channel record |
| 7 | `provider` | `ScVal::Address` | stored channel record |
| 8 | `signer` | `ScVal::Bytes` (32), raw Ed25519 public key | stored channel record |

Only `channel_id`, `amount` and the 64-byte `signature` are submitted to
`redeem_batch`. The contract rebuilds every other field from its own storage
and the executing ledger, so a caller cannot substitute a network, contract,
owner, provider or signer.

`signature = Ed25519.sign(agent_secret_key, message)` (RFC 8032, pure Ed25519,
no pre-hash). The contract checks it with `env.crypto().ed25519_verify`, which
aborts the whole invocation on failure.

## Submitted voucher

`redeem_batch` takes `Vec<Voucher>`, where `Voucher` is also a contract type
encoded as an ordered map:

| Key | Type |
|---|---|
| `amount` | `i128` |
| `channel_id` | `u64` |
| `signature` | `BytesN<64>` |

## Example

Channel 1, cumulative 3 AUSD (`30000000` base units), from
[`test-vectors/vouchers.json`](../test-vectors/vouchers.json) (Testnet network
ID, contract `CAAQCAIB…C526`, G-account owner and provider):

```text
00000011 00000001 00000008                 ScVal::Map, present, 8 entries
  0000000f 00000006 616d6f756e740000       Symbol "amount"
  0000000a 0000…0000 0000000001c9c380      I128 30000000
  0000000f 0000000a 6368616e6e656c5f6964…  Symbol "channel_id"
  00000005 0000000000000001                U64 1
  …                                        contract, domain, network, owner, provider, signer
```

Full hex for every case, with the matching signatures, is in the vector file.

## Cross-language guarantee

- **Rust (source of truth):** `test::vectors` builds the messages with the
  contract's own `voucher_message`, signs them with `ed25519-dalek`, checks the
  signatures with the Soroban host, and compares the result with the committed
  file.
- **TypeScript:** `packages/voucher/test/vectors.test.ts` rebuilds every
  message with `encodeVoucherMessage` and every signature with `AgentSigner`,
  and requires byte-for-byte equality. It also checks that the map keys are
  sorted.
- **Testnet:** the demo compares local bytes with the deployed contract's
  `voucher_message` view before any payment (412 bytes, equal).

Regenerate the vectors only on an intentional format change:
`AGENTBATCH_UPDATE_VECTORS=1 cargo test voucher_vectors`. A format change
requires a new domain value.

## Binding properties

| Attack | Defeated by | Tests |
|---|---|---|
| Replay on another network | `network` from the ledger | `wrong_network_rejected`, `voucher_signed_for_testnet_rejected_on_other_network`, TS `rejects wrong network` |
| Replay on another deployment | `contract` from the environment | `wrong_contract_rejected`, `voucher_for_other_deployment_rejected` |
| Replay on another channel, even with the same key and provider | `channel_id` | `cross_channel_replay_rejected` |
| Payment to another provider | `provider` from storage; payout goes to the stored provider | `wrong_provider_rejected` |
| Signing with an unregistered key | `signer` from storage | `incorrect_signer_rejected`, `signer_field_substitution_rejected` |
| Confusion with other signed payloads | `domain` symbol | `wrong_domain_rejected` |
| Amount tampering | `amount` is signed | `amount_substitution_rejected` |
| Re-redeeming an old voucher | cumulative accounting: `amount > redeemed` | `cumulative_vouchers_pay_only_increment` |

## Relationship to Stellar's one-way channel commitments

The encoding follows the convention of
[`stellar-experimental/one-way-channel`](https://github.com/stellar-experimental/one-way-channel)
commitments (an XDR-serialized `#[contracttype]` struct with a `Symbol` domain,
a network ID and a contract address), which the Stellar MPP SDK also builds
locally. AgentBatch adds the fields a shared-treasury design needs: the channel
ID, because many channels share one contract; and the owner, provider and
signer, which are bound explicitly instead of being implied by a dedicated
contract instance.
