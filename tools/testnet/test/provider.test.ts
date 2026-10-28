import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentSigner } from "@agentbatch/voucher";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ state: "" }));
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, PATHS: { ...actual.PATHS, get state() { return settings.state; } } };
});

import { Chain } from "../src/chain.js";
import { NETWORK } from "../src/config.js";
import { AgentBatchClient, type ChannelState, type TreasuryState } from "../src/contract.js";
import { SimulatedProvider } from "../src/provider.js";

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 11));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 12));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 13));
const WASM = Buffer.from([0, 97, 115, 109]);
const TRUSTED = { wasmHash: createHash("sha256").update(WASM).digest("hex"), token: TOKEN };
const STORE = "provider";

beforeEach(() => { settings.state = mkdtempSync(join(tmpdir(), "agentbatch-provider-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(settings.state, { recursive: true, force: true }); });

function fixture() {
  const account = Keypair.random();
  const agent = AgentSigner.random();
  const owner = Keypair.random().publicKey();
  const chain = new Chain();
  const client = new AgentBatchClient(chain, CONTRACT, account);
  const channel: ChannelState = { channelId: 1n, owner, provider: account.publicKey(), signer: agent.publicKey,
    allocation: 100n, redeemed: 0n, remaining: 100n, createdLedger: 1 };
  const treasury: TreasuryState = { owner, token: TOKEN, totalDeposited: 100n, totalPaid: 0n, totalWithdrawn: 0n,
    available: 0n, totalReserved: 100n, nextChannelId: 2n, tokenBalance: 100n, unaccountedBalance: 0n };
  const network = vi.spyOn(chain.server, "getNetwork").mockResolvedValue({ passphrase: NETWORK.passphrase, protocolVersion: "29", friendbotUrl: NETWORK.friendbotUrl });
  const wasm = vi.spyOn(chain.server, "getContractWasmByContractId").mockResolvedValue(WASM);
  const readTreasury = vi.spyOn(client, "getTreasury").mockResolvedValue(treasury);
  const readChannel = vi.spyOn(client, "getChannel").mockResolvedValue(channel);
  const provider = (createStore = false) => new SimulatedProvider("audit", account, CONTRACT, STORE, TRUSTED, { createStore });
  const voucher = agent.sign({ networkPassphrase: NETWORK.passphrase, contract: CONTRACT, owner,
    channelId: 1n, provider: account.publicKey(), signer: agent.publicKey }, 10n);
  return { account, chain, client, channel, treasury, network, wasm, readTreasury, readChannel, provider, voucher };
}

describe("provider storage lifecycle", () => {
  it("requires explicit first-time provisioning", () => {
    const f = fixture();
    expect(() => f.provider()).toThrow(/ENOENT/);
    expect(() => f.provider(true)).not.toThrow();
    expect(() => f.provider(true)).toThrow(/EEXIST/);
  });

  it("refuses an old unredeemed voucher after an ordinary restart", async () => {
    const f = fixture();
    const first = f.provider(true);
    await first.sync(f.chain, f.client, 1n);
    expect(first.handle(f.voucher, 10n).ok).toBe(true);
    const restarted = f.provider();
    await restarted.sync(f.chain, f.client, 1n);
    expect(restarted.handle(f.voucher, 10n)).toEqual({ ok: false, reason: "not-increasing" });
    expect(restarted.latest()).toEqual(f.voucher);
  });

  it("fails closed if an accepted voucher's store is lost before restart", async () => {
    const f = fixture();
    const first = f.provider(true);
    await first.sync(f.chain, f.client, 1n);
    expect(first.handle(f.voucher, 10n).ok).toBe(true);
    rmSync(join(settings.state, `${STORE}.json`));
    expect(() => f.provider()).toThrow(/ENOENT/);
  });
});

describe("provider deployment binding", () => {
  it("rejects a different contract client before any network or channel read", async () => {
    const f = fixture();
    const wrong = new AgentBatchClient(f.chain, OTHER_CONTRACT, f.account);
    vi.spyOn(wrong, "getTreasury").mockResolvedValue(f.treasury);
    const read = vi.spyOn(wrong, "getChannel").mockResolvedValue(f.channel);
    await expect(f.provider(true).sync(f.chain, wrong, 1n)).rejects.toThrow(/contract/);
    expect(f.network).not.toHaveBeenCalled();
    expect(f.wasm).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a client using another chain connection", async () => {
    const f = fixture();
    const wrong = new AgentBatchClient(new Chain(), CONTRACT, f.account);
    vi.spyOn(wrong, "getTreasury").mockResolvedValue(f.treasury);
    vi.spyOn(wrong, "getChannel").mockResolvedValue(f.channel);
    await expect(f.provider(true).sync(f.chain, wrong, 1n)).rejects.toThrow(/connection/);
    expect(f.network).not.toHaveBeenCalled();
    expect(f.wasm).not.toHaveBeenCalled();
  });

  it("rejects the wrong network before fetching code or reading collateral", async () => {
    const f = fixture();
    f.network.mockResolvedValue({ passphrase: "wrong network", protocolVersion: "29", friendbotUrl: NETWORK.friendbotUrl });
    await expect(f.provider(true).sync(f.chain, f.client, 1n)).rejects.toThrow(/network/);
    expect(f.wasm).not.toHaveBeenCalled();
    expect(f.readTreasury).not.toHaveBeenCalled();
  });

  it("refuses unexpected code before reading channel state", async () => {
    const f = fixture();
    f.wasm.mockResolvedValue(Buffer.from([1, 2, 3]));
    await expect(f.provider(true).sync(f.chain, f.client, 1n)).rejects.toThrow(/untrusted contract code/);
    expect(f.readChannel).not.toHaveBeenCalled();
  });

  it("refuses an unexpected payment token before reading channel state", async () => {
    const f = fixture();
    f.readTreasury.mockResolvedValue({ ...f.treasury, token: OTHER_CONTRACT });
    await expect(f.provider(true).sync(f.chain, f.client, 1n)).rejects.toThrow(/untrusted payment asset/);
    expect(f.readChannel).not.toHaveBeenCalled();
  });

  it("refuses another channel without publishing it as synchronized state", async () => {
    const f = fixture();
    const provider = f.provider(true);
    f.readChannel.mockResolvedValue({ ...f.channel, channelId: 2n });
    await expect(provider.sync(f.chain, f.client, 1n)).rejects.toThrow(/channel/);
    expect(provider.channel).toBeUndefined();
  });

  it("pins the deployment once and verifies requests without RPC calls", async () => {
    const f = fixture();
    const provider = f.provider(true);
    await provider.sync(f.chain, f.client, 1n);
    expect(provider.handle(f.voucher, 10n)).toEqual({ ok: true, increment: 10n, cumulative: 10n });
    expect(f.network).toHaveBeenCalledTimes(1);
    expect(f.wasm).toHaveBeenCalledTimes(1);
    expect(f.readTreasury).toHaveBeenCalledTimes(1);
    expect(f.readChannel).toHaveBeenCalledTimes(1);
  });

  it("refuses another provider without publishing its channel", async () => {
    const f = fixture();
    const provider = f.provider(true);
    f.readChannel.mockResolvedValue({ ...f.channel, provider: Keypair.random().publicKey() });
    await expect(provider.sync(f.chain, f.client, 1n)).rejects.toThrow(/not registered/);
    expect(provider.channel).toBeUndefined();
  });
});
