import { Keypair } from "@stellar/stellar-sdk";

import { encodeVoucherMessage, type SignedVoucher, type VoucherContext } from "./payload.js";

/**
 * A delegated agent signing key: a raw Ed25519 key that is not a Stellar
 * account and cannot authorize transactions or treasury operations.
 */
export class AgentSigner {
  readonly #keypair: Keypair;

  private constructor(keypair: Keypair) {
    this.#keypair = keypair;
  }

  static fromSeed(seed: Uint8Array): AgentSigner {
    if (seed.length !== 32) throw new RangeError("seed must be 32 bytes");
    return new AgentSigner(Keypair.fromRawEd25519Seed(Buffer.from(seed)));
  }

  static random(): AgentSigner {
    return new AgentSigner(Keypair.random());
  }

  get publicKey(): Uint8Array {
    return new Uint8Array(this.#keypair.rawPublicKey());
  }

  sign(ctx: VoucherContext, amount: bigint): SignedVoucher {
    const signature = new Uint8Array(this.#keypair.sign(encodeVoucherMessage(ctx, amount)));
    return { channelId: ctx.channelId, amount, signature };
  }
}

/**
 * Agent-side spending state for one channel: issues monotonically increasing
 * cumulative vouchers and never signs beyond the channel allocation.
 *
 * `alreadyAuthorized` must be the highest cumulative amount this agent has
 * ever signed on the channel (not merely the redeemed amount), or the next
 * voucher will not exceed what the provider already holds.
 *
 * PoC: one sequential signer per channel. Concurrent agent processes sharing
 * a key would need a single serialized counter.
 */
export class ChannelSpender {
  #cumulative: bigint;

  constructor(
    private readonly signer: AgentSigner,
    private readonly ctx: VoucherContext,
    private readonly allocation: bigint,
    alreadyAuthorized = 0n,
  ) {
    if (allocation <= 0n) throw new RangeError("allocation must be positive");
    if (alreadyAuthorized < 0n || alreadyAuthorized > allocation) throw new RangeError("alreadyAuthorized must be within [0, allocation]");
    this.#cumulative = alreadyAuthorized;
  }

  get cumulative(): bigint {
    return this.#cumulative;
  }

  /** Signs a voucher authorizing `price` more than the previous one. */
  pay(price: bigint): SignedVoucher {
    if (price <= 0n) throw new RangeError("price must be positive");
    const next = this.#cumulative + price;
    if (next > this.allocation) throw new RangeError(`payment would exceed channel allocation (${next} > ${this.allocation})`);
    const voucher = this.signer.sign(this.ctx, next);
    this.#cumulative = next;
    return voucher;
  }
}
