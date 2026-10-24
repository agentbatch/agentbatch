import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { encodeVoucherMessage, type SignedVoucher, type VoucherContext } from "./payload.js";
import type { VoucherStore } from "./store.js";

/** Returns true iff `signature` is a valid Ed25519 signature by `ctx.signer`. */
export function verifyVoucherSignature(ctx: VoucherContext, amount: bigint, signature: Uint8Array): boolean {
  if (signature.length !== 64 || ctx.signer.length !== 32) return false;
  try {
    const key = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(ctx.signer)));
    return key.verify(encodeVoucherMessage(ctx, amount), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * What a provider pins before trusting any channel data read from a contract:
 * the audited AgentBatchPoC code and the payment asset. Channel records read
 * from an unpinned contract prove nothing; a look-alike contract could report
 * any allocation and never pay.
 */
export interface TrustedDeployment {
  /** Hex SHA-256 of the AgentBatchPoC WASM the provider has reviewed. */
  wasmHash: string;
  /** Stellar Asset Contract address of the expected payment asset. */
  token: string;
}

/** Throws unless the observed contract code and token match the pinned values. */
export function assertTrustedDeployment(observed: TrustedDeployment, expected: TrustedDeployment): void {
  if (observed.wasmHash.toLowerCase() !== expected.wasmHash.toLowerCase()) {
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
  | "bad-signature"
  | "exceeds-allocation"
  | "not-increasing"
  | "insufficient-payment";

export type AcceptResult = { ok: true; increment: bigint; cumulative: bigint } | { ok: false; reason: RejectReason };

/**
 * Provider-side, off-chain voucher acceptance. No Soroban call per request:
 * channel state is read from Stellar once and passed in.
 *
 * A voucher is accepted only if it is signed by the channel's registered
 * signer over this provider's channel on the trusted contract and network,
 * stays within the allocation, and raises the highest accepted cumulative
 * amount by at least the request price. Because the contract reserves the
 * full allocation for the channel and the PoC has no withdrawal of reserved
 * collateral, every accepted voucher is fully collateralized.
 */
export class ProviderVerifier {
  constructor(
    private readonly config: ProviderConfig,
    private readonly store: VoucherStore,
  ) {}

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
    if (voucher.channelId !== channel.channelId) return { ok: false, reason: "channel-mismatch" };
    if (channel.provider !== this.config.provider) return { ok: false, reason: "not-my-channel" };
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
}
