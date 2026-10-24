import type { ChannelInfo, SignedVoucher } from "@agentbatch/voucher";
import { Address, Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

import type { Chain, TxRecord } from "./chain.js";

export interface TreasuryState {
  owner: string;
  token: string;
  totalDeposited: bigint;
  totalPaid: bigint;
  totalWithdrawn: bigint;
  available: bigint;
  totalReserved: bigint;
  nextChannelId: bigint;
  tokenBalance: bigint;
  unaccountedBalance: bigint;
}

export interface ChannelState extends ChannelInfo {
  remaining: bigint;
  createdLedger: number;
}

const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u64 = (v: bigint) => nativeToScVal(v, { type: "u64" });
const address = (a: string) => Address.fromString(a).toScVal();

/** `Voucher` contract type: an ScMap with keys in ascending order. */
export function voucherScVal(v: SignedVoucher): xdr.ScVal {
  const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry("amount", i128(v.amount)),
    entry("channel_id", u64(v.channelId)),
    entry("signature", xdr.ScVal.scvBytes(Buffer.from(v.signature))),
  ]);
}

/** Typed calls to one AgentBatchPoC deployment. Reads are simulations; writes are transactions. */
export class AgentBatchClient {
  constructor(
    private readonly chain: Chain,
    readonly contractId: string,
    /** Any funded account; used as the simulation source for reads. */
    private readonly reader: Keypair,
  ) {}

  static constructorArgs(owner: string, token: string): xdr.ScVal[] {
    return [address(owner), address(token)];
  }

  private op(method: string, args: xdr.ScVal[]) {
    return this.chain.invoke(this.contractId, method, args);
  }

  async deposit(owner: Keypair, amount: bigint, label = "deposit"): Promise<TxRecord> {
    return (await this.chain.soroban(label, owner, this.op("deposit", [i128(amount)]))).record;
  }

  async openChannel(owner: Keypair, provider: string, signer: Uint8Array, allocation: bigint, label: string) {
    const { record, returnValue } = await this.chain.soroban(
      label,
      owner,
      this.op("open_channel", [address(provider), xdr.ScVal.scvBytes(Buffer.from(signer)), i128(allocation)]),
    );
    return { record, channelId: BigInt(scValToNative(returnValue!) as bigint) };
  }

  async redeemBatch(submitter: Keypair, vouchers: SignedVoucher[], label: string) {
    const { record, returnValue } = await this.chain.soroban(label, submitter, this.redeemOp(vouchers));
    return { record, totalPaid: BigInt(scValToNative(returnValue!) as bigint) };
  }

  redeemOp(vouchers: SignedVoucher[]) {
    return this.op("redeem_batch", [xdr.ScVal.scvVec(vouchers.map(voucherScVal))]);
  }

  async getTreasury(): Promise<TreasuryState> {
    const t = scValToNative(await this.chain.simulate("get_treasury", this.reader, this.op("get_treasury", []))) as Record<string, unknown>;
    return {
      owner: String(t.owner),
      token: String(t.token),
      totalDeposited: BigInt(t.total_deposited as bigint),
      totalPaid: BigInt(t.total_paid as bigint),
      totalWithdrawn: BigInt(t.total_withdrawn as bigint),
      available: BigInt(t.available as bigint),
      totalReserved: BigInt(t.total_reserved as bigint),
      nextChannelId: BigInt(t.next_channel_id as bigint),
      tokenBalance: BigInt(t.token_balance as bigint),
      unaccountedBalance: BigInt(t.unaccounted_balance as bigint),
    };
  }

  /** Channel record as stored on-chain (provider-side source of truth). */
  async getChannel(channelId: bigint): Promise<ChannelState> {
    const c = scValToNative(await this.chain.simulate("get_channel", this.reader, this.op("get_channel", [u64(channelId)]))) as Record<
      string,
      unknown
    >;
    return {
      channelId: BigInt(c.id as bigint),
      owner: String(c.owner),
      provider: String(c.provider),
      signer: new Uint8Array(c.signer as Uint8Array),
      allocation: BigInt(c.allocation as bigint),
      redeemed: BigInt(c.redeemed as bigint),
      remaining: BigInt(c.remaining as bigint),
      createdLedger: Number(c.created_ledger),
    };
  }

  async voucherMessage(channelId: bigint, amount: bigint): Promise<Uint8Array> {
    const v = await this.chain.simulate("voucher_message", this.reader, this.op("voucher_message", [u64(channelId), i128(amount)]));
    return new Uint8Array(scValToNative(v) as Uint8Array);
  }
}

/** SEP-41 balance read through the Stellar Asset Contract. */
export async function tokenBalance(chain: Chain, reader: Keypair, token: string, holder: string): Promise<bigint> {
  const v = await chain.simulate("balance", reader, chain.invoke(token, "balance", [address(holder)]));
  return BigInt(scValToNative(v) as bigint);
}
