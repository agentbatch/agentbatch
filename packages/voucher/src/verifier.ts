import { StrKey } from "@stellar/stellar-sdk";

import { isSafeSignerKey, verifyStrict } from "./ed25519.js";
import { assertAccountOrContract, assertContract, encodeVoucherMessage, type SignedVoucher, type VoucherContext } from "./payload.js";
import type { VoucherStore } from "./store.js";

/**
 * Returns true iff `signature` by `ctx.signer` over the voucher message is
 * accepted by the same rule as the contract (ed25519-dalek `verify_strict`,
 * see {@link verifyStrict}).
 */
export function verifyVoucherSignature(ctx: VoucherContext, amount: bigint, signature: Uint8Array): boolean {
  return verifyStrict(ctx.signer, encodeVoucherMessage(ctx, amount), signature);
}

/**
 * What a provider pins before trusting any channel data read from a contract:
 * the reviewed AgentBatchPoC code and the payment asset. Channel records read
 * from an unpinned contract prove nothing; a look-alike contract could report
 * any allocation and never pay.
 */
export interface TrustedDeployment {
  /** Hex SHA-256 of the AgentBatchPoC WASM the provider has reviewed. */
  wasmHash: string;
  /** Stellar Asset Contract address of the expected payment asset. */
  token: string;
}

const HASH = /^[0-9a-f]{64}$/;

/** Throws unless the observed contract code and token match the pinned values. */
export function assertTrustedDeployment(observed: TrustedDeployment, expected: TrustedDeployment): void {
  if (!HASH.test(expected.wasmHash) || !StrKey.isValidContract(expected.token)) {
    throw new Error("pinned deployment must be a lowercase 64-hex WASM hash and a C... token address");
  }
  if (observed.wasmHash.toLowerCase() !== expected.wasmHash) {
    throw new Error(`untrusted contract code: wasm ${observed.wasmHash} != pinned ${expected.wasmHash}`);
  }
  if (observed.token !== expected.token) {
    throw new Error(`untrusted payment asset: token ${observed.token} != pinned ${expected.token}`);
  }
}

/** Channel state as read from the AgentBatchPoC contract. */
export interface ChannelInfo {
  channelId: bigint;
  owner: string;
  provider: string;
  signer: Uint8Array;
  allocation: bigint;
  redeemed: bigint;
}

export interface ProviderConfig {
  networkPassphrase: string;
  /** The AgentBatchPoC deployment this provider trusts. */
  contract: string;
  /** This provider's own address. */
  provider: string;
}

export type RejectReason =
  | "channel-mismatch"
  | "not-my-channel"
  | "unsafe-signer-key"
  | "bad-signature"
  | "exceeds-allocation"
  | "not-increasing"
  | "insufficient-payment";

export type AcceptResult = { ok: true; increment: bigint; cumulative: bigint } | { ok: false; reason: RejectReason };

/**
 * Provider-side, off-chain voucher acceptance. No Soroban call per request:
 * channel state is read from Stellar once and passed in.
 *
 * A voucher is accepted only if the channel belongs to this provider and its
 * signer key is a safe (prime-order) Ed25519 key, the signature passes the
 * contract's own verification rule over this provider's channel on the
 * trusted contract and network, the amount stays within the allocation, and
 * it raises the highest accepted or redeemed amount by at least the request
 * price. The contract reserves the full allocation for the channel and the
 * PoC cannot reduce it, so every accepted voucher is payable on redemption as
 * long as the token transfer itself succeeds.
 */
export class ProviderVerifier {
  readonly #safeKeys = new Set<string>();

  constructor(
    private readonly config: ProviderConfig,
    private readonly store: VoucherStore,
  ) {
    if (!config.networkPassphrase) throw new TypeError("networkPassphrase is required");
    assertContract("contract", config.contract);
    assertAccountOrContract("provider", config.provider);
    if (store.scope.networkPassphrase !== config.networkPassphrase || store.scope.contract !== config.contract) {
      throw new Error("voucher store belongs to a different deployment");
    }
  }

  context(channel: ChannelInfo): VoucherContext {
    return {
      networkPassphrase: this.config.networkPassphrase,
      contract: this.config.contract,
      owner: channel.owner,
      channelId: channel.channelId,
      provider: this.config.provider,
      signer: channel.signer,
    };
  }

  /** Highest cumulative amount this provider can already claim on `channel`. */
  highest(channel: ChannelInfo): bigint {
    const stored = this.store.get(channel.channelId)?.amount ?? 0n;
    return stored > channel.redeemed ? stored : channel.redeemed;
  }

  accept(channel: ChannelInfo, voucher: SignedVoucher, price: bigint): AcceptResult {
    if (price <= 0n) throw new RangeError("price must be positive");
    if (voucher.channelId !== channel.channelId) return { ok: false, reason: "channel-mismatch" };
    if (channel.provider !== this.config.provider) return { ok: false, reason: "not-my-channel" };
    if (!this.safeKey(channel.signer)) return { ok: false, reason: "unsafe-signer-key" };
    if (!verifyVoucherSignature(this.context(channel), voucher.amount, voucher.signature)) {
      return { ok: false, reason: "bad-signature" };
    }
    if (voucher.amount > channel.allocation) return { ok: false, reason: "exceeds-allocation" };
    const previous = this.highest(channel);
    if (voucher.amount <= previous) return { ok: false, reason: "not-increasing" };
    const increment = voucher.amount - previous;
    if (increment < price) return { ok: false, reason: "insufficient-payment" };

    this.store.put(voucher);
    return { ok: true, increment, cumulative: voucher.amount };
  }

  private safeKey(key: Uint8Array): boolean {
    const hex = Buffer.from(key).toString("hex");
    if (this.#safeKeys.has(hex)) return true;
    if (!isSafeSignerKey(key)) return false;
    this.#safeKeys.add(hex);
    return true;
  }
}
