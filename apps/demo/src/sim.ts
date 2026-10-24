import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  assertTrustedDeployment,
  ChannelSpender,
  FileVoucherStore,
  ProviderVerifier,
  type AcceptResult,
  type AgentSigner,
  type SignedVoucher,
  type TrustedDeployment,
} from "@agentbatch/voucher";
import type { Keypair } from "@stellar/stellar-sdk";

import { NETWORK, PATHS } from "./config.js";
import type { Chain } from "./chain.js";
import type { AgentBatchClient, ChannelState } from "./contract.js";

export interface RequestLog {
  provider: string;
  request: number;
  price: string;
  cumulative: string;
  accepted: boolean;
  reason?: string;
}

/**
 * An AI-service provider. It reads its channel configuration from Stellar
 * once, then verifies each paid request's voucher locally.
 */
export class SimulatedProvider {
  readonly verifier: ProviderVerifier;
  readonly store: FileVoucherStore;
  channel!: ChannelState;

  constructor(
    readonly name: string,
    readonly account: Keypair,
    readonly contractId: string,
    storeName: string,
    /** Contract code and asset this provider has reviewed and accepts. */
    readonly trusted: TrustedDeployment,
  ) {
    mkdirSync(PATHS.state, { recursive: true });
    const scope = { networkPassphrase: NETWORK.passphrase, contract: contractId };
    this.store = new FileVoucherStore(join(PATHS.state, `${storeName}.json`), scope, { create: true });
    this.verifier = new ProviderVerifier({ ...scope, provider: account.publicKey() }, this.store);
  }

  /**
   * Reads channel configuration from Stellar (simulations, no transactions)
   * after checking the contract runs the pinned code and pays in the pinned asset.
   */
  async sync(chain: Chain, client: AgentBatchClient, channelId: bigint): Promise<void> {
    const wasm = await chain.server.getContractWasmByContractId(this.contractId);
    const wasmHash = createHash("sha256").update(wasm).digest("hex");
    assertTrustedDeployment({ wasmHash, token: (await client.getTreasury()).token }, this.trusted);
    this.channel = await client.getChannel(channelId);
    if (this.channel.provider !== this.account.publicKey()) throw new Error(`${this.name}: channel ${channelId} is not registered to this provider`);
  }

  /** Handles one paid API request; serves it only if the voucher is accepted. */
  handle(voucher: SignedVoucher, price: bigint): AcceptResult {
    return this.verifier.accept(this.channel, voucher, price);
  }

  latest(): SignedVoucher {
    const v = this.store.get(this.channel.channelId);
    if (!v) throw new Error(`${this.name}: no accepted voucher`);
    return v;
  }
}

/** The agent side of one channel: signs cumulative vouchers with its delegated key. */
export function agentFor(signer: AgentSigner, channel: ChannelState, contractId: string): ChannelSpender {
  const ctx = {
    networkPassphrase: NETWORK.passphrase,
    contract: contractId,
    owner: channel.owner,
    channelId: channel.channelId,
    provider: channel.provider,
    signer: channel.signer,
  };
  return new ChannelSpender(signer, ctx, channel.allocation, channel.redeemed);
}
