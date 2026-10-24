import { Address, hash, nativeToScVal, xdr } from "@stellar/stellar-sdk";

/** Signature-domain separator; must equal `DOMAIN` in the contract. */
export const VOUCHER_DOMAIN = "AGENTBATCH_POC_V1";

/**
 * Everything a voucher signature binds to, except the amount.
 *
 * `owner`, `provider` and `signer` must come from the on-chain channel record;
 * `networkPassphrase` and `contract` from the deployment the caller trusts.
 */
export interface VoucherContext {
  networkPassphrase: string;
  /** AgentBatchPoC contract address (C...). */
  contract: string;
  /** Treasury owner address (G... or C...). */
  owner: string;
  channelId: bigint;
  /** Provider address registered on the channel. */
  provider: string;
  /** Raw 32-byte Ed25519 public key registered on the channel. */
  signer: Uint8Array;
}

export interface SignedVoucher {
  channelId: bigint;
  /** Cumulative amount in base units (7 decimals). */
  amount: bigint;
  /** 64-byte Ed25519 signature over {@link encodeVoucherMessage}. */
  signature: Uint8Array;
}

const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

export function networkId(networkPassphrase: string): Uint8Array {
  return hash(Buffer.from(networkPassphrase, "utf8"));
}

/**
 * Builds the exact bytes the contract verifies: the XDR of an `ScVal::Map`
 * holding the `VoucherPayload` fields. Soroban maps are ordered by key, so the
 * entries below are listed in ascending symbol order:
 * amount, channel_id, contract, domain, network, owner, provider, signer.
 */
export function encodeVoucherMessage(ctx: VoucherContext, amount: bigint): Uint8Array {
  if (amount < I128_MIN || amount > I128_MAX) throw new RangeError("amount outside i128");
  if (ctx.channelId < 0n || ctx.channelId > U64_MAX) throw new RangeError("channelId outside u64");
  if (ctx.signer.length !== 32) throw new RangeError("signer must be a 32-byte Ed25519 public key");

  const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry("amount", nativeToScVal(amount, { type: "i128" })),
    entry("channel_id", nativeToScVal(ctx.channelId, { type: "u64" })),
    entry("contract", Address.fromString(ctx.contract).toScVal()),
    entry("domain", xdr.ScVal.scvSymbol(VOUCHER_DOMAIN)),
    entry("network", xdr.ScVal.scvBytes(networkId(ctx.networkPassphrase))),
    entry("owner", Address.fromString(ctx.owner).toScVal()),
    entry("provider", Address.fromString(ctx.provider).toScVal()),
    entry("signer", xdr.ScVal.scvBytes(Buffer.from(ctx.signer))),
  ]).toXDR();
}
