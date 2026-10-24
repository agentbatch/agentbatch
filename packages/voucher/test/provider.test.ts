import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentSigner,
  assertTrustedDeployment,
  ChannelSpender,
  FileVoucherStore,
  MemoryVoucherStore,
  ProviderVerifier,
  type ChannelInfo,
  type VoucherContext,
} from "../src/index.js";

const UNIT = 10_000_000n;
const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 8));
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const PROVIDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const OTHER_PROVIDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const SCOPE = { networkPassphrase: PASSPHRASE, contract: CONTRACT };
const CONFIG = { networkPassphrase: PASSPHRASE, contract: CONTRACT, provider: PROVIDER };

function fixture(redeemed = 0n) {
  const agent = AgentSigner.fromSeed(Buffer.alloc(32, 7));
  const channel: ChannelInfo = {
    channelId: 1n,
    owner: OWNER,
    provider: PROVIDER,
    signer: agent.publicKey,
    allocation: 40n * UNIT,
    redeemed,
  };
  // The agent builds its own context from the deployment and channel it pays,
  // independently of ProviderVerifier.context().
  const agentCtx: VoucherContext = {
    networkPassphrase: PASSPHRASE,
    contract: CONTRACT,
    owner: OWNER,
    channelId: 1n,
    provider: PROVIDER,
    signer: agent.publicKey,
  };
  const verifier = new ProviderVerifier(CONFIG, new MemoryVoucherStore(SCOPE));
  const spender = new ChannelSpender(agent, agentCtx, channel.allocation, redeemed);
  return { agent, agentCtx, channel, verifier, spender };
}

describe("ProviderVerifier", () => {
  it("builds the same context the agent signs over", () => {
    const { agentCtx, channel, verifier } = fixture();
    expect(verifier.context(channel)).toEqual(agentCtx);
  });

  it("accepts increasing cumulative vouchers and tracks the highest", () => {
    const { channel, verifier, spender } = fixture();
    for (const price of [2n, 3n, 4n, 3n]) {
      const r = verifier.accept(channel, spender.pay(price * UNIT), price * UNIT);
      expect(r).toEqual({ ok: true, increment: price * UNIT, cumulative: spender.cumulative });
    }
    expect(verifier.highest(channel)).toBe(12n * UNIT);
  });

  it("rejects replayed and older vouchers", () => {
    const { channel, verifier, spender } = fixture();
    const v1 = spender.pay(3n * UNIT);
    const v2 = spender.pay(4n * UNIT);
    expect(verifier.accept(channel, v2, UNIT).ok).toBe(true);
    expect(verifier.accept(channel, v2, UNIT)).toEqual({ ok: false, reason: "not-increasing" });
    expect(verifier.accept(channel, v1, UNIT)).toEqual({ ok: false, reason: "not-increasing" });
  });

  it("rejects vouchers already covered by on-chain redemption", () => {
    const { channel, verifier, agent, agentCtx } = fixture(12n * UNIT);
    expect(verifier.accept(channel, agent.sign(agentCtx, 10n * UNIT), UNIT)).toEqual({ ok: false, reason: "not-increasing" });
    expect(verifier.accept(channel, agent.sign(agentCtx, 13n * UNIT), UNIT)).toEqual({ ok: true, increment: UNIT, cumulative: 13n * UNIT });
  });

  it("rejects payments that do not cover the price", () => {
    const { channel, verifier, spender } = fixture();
    expect(verifier.accept(channel, spender.pay(UNIT), 2n * UNIT)).toEqual({ ok: false, reason: "insufficient-payment" });
  });

  it("refuses a non-positive price", () => {
    const { channel, verifier, spender } = fixture();
    const v = spender.pay(UNIT);
    expect(() => verifier.accept(channel, v, 0n)).toThrow(/price/);
    expect(() => verifier.accept(channel, v, -5n)).toThrow(/price/);
  });

  it("rejects amounts above the allocation even if validly signed", () => {
    const { channel, verifier, agent, agentCtx } = fixture();
    const v = agent.sign(agentCtx, channel.allocation + 1n);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "exceeds-allocation" });
  });

  it("rejects vouchers from another signer", () => {
    const { channel, verifier, agentCtx } = fixture();
    const rogue = AgentSigner.fromSeed(Buffer.alloc(32, 8));
    const v = rogue.sign({ ...agentCtx, signer: rogue.publicKey }, UNIT);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects vouchers signed for another owner", () => {
    const { channel, verifier, agent, agentCtx } = fixture();
    const v = agent.sign({ ...agentCtx, owner: OTHER_PROVIDER }, UNIT);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects channels registered to another provider", () => {
    const { channel, verifier, agent, agentCtx } = fixture();
    const v = agent.sign({ ...agentCtx, provider: OTHER_PROVIDER }, UNIT);
    expect(verifier.accept({ ...channel, provider: OTHER_PROVIDER }, v, UNIT)).toEqual({ ok: false, reason: "not-my-channel" });
  });

  it("rejects a voucher presented for a different channel", () => {
    const { channel, verifier, spender } = fixture();
    const v = { ...spender.pay(UNIT), channelId: 2n };
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "channel-mismatch" });
  });

  it("refuses channels whose signer key is not a safe prime-order point", () => {
    const { channel, verifier, spender } = fixture();
    const v = spender.pay(UNIT);
    expect(verifier.accept({ ...channel, signer: new Uint8Array(32) }, v, UNIT)).toEqual({ ok: false, reason: "unsafe-signer-key" });
  });

  it("validates its configuration and the store's deployment", () => {
    expect(() => new ProviderVerifier({ ...CONFIG, contract: OWNER }, new MemoryVoucherStore(SCOPE))).toThrow(/contract address/);
    expect(() => new ProviderVerifier({ ...CONFIG, provider: "garbage" }, new MemoryVoucherStore(SCOPE))).toThrow(/provider/);
    expect(() => new ProviderVerifier(CONFIG, new MemoryVoucherStore({ ...SCOPE, contract: OTHER_CONTRACT }))).toThrow(/different deployment/);
  });
});

describe("ChannelSpender", () => {
  it("never signs beyond the allocation", () => {
    const { spender } = fixture();
    spender.pay(40n * UNIT);
    expect(() => spender.pay(1n)).toThrow(/exceed/);
    expect(() => spender.pay(0n)).toThrow(/positive/);
  });

  it("validates its starting state", () => {
    const { agent, agentCtx } = fixture();
    expect(() => new ChannelSpender(agent, agentCtx, 10n, -1n)).toThrow(/alreadyAuthorized/);
    expect(() => new ChannelSpender(agent, agentCtx, 10n, 11n)).toThrow(/alreadyAuthorized/);
    expect(() => new ChannelSpender(agent, agentCtx, 0n)).toThrow(/allocation/);
  });
});

describe("MemoryVoucherStore", () => {
  it("stores copies, so callers cannot mutate accepted vouchers", () => {
    const { spender } = fixture();
    const store = new MemoryVoucherStore(SCOPE);
    const v = spender.pay(5n * UNIT);
    store.put(v);
    v.amount = 1n;
    v.signature[0] = (v.signature[0]! + 1) % 256;
    expect(store.get(1n)!.amount).toBe(5n * UNIT);
    expect(store.get(1n)!.signature).not.toEqual(v.signature);
  });
});

describe("FileVoucherStore", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tempPath = () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbatch-store-"));
    dirs.push(dir);
    return join(dir, "store.json");
  };

  it("persists the highest voucher across restarts", () => {
    const path = tempPath();
    const { channel, spender } = fixture();
    const verifier = new ProviderVerifier(CONFIG, new FileVoucherStore(path, SCOPE, { create: true }));
    const v = spender.pay(5n * UNIT);
    expect(verifier.accept(channel, v, UNIT).ok).toBe(true);

    const reopened = new FileVoucherStore(path, SCOPE);
    expect(reopened.get(1n)).toEqual({ channelId: 1n, amount: 5n * UNIT, signature: Uint8Array.from(v.signature) });
    expect(() => reopened.put(v)).toThrow(/increasing/);
  });

  it("fails closed when the file is missing unless creation is requested", () => {
    expect(() => new FileVoucherStore(tempPath(), SCOPE)).toThrow(/ENOENT/);
  });

  it("refuses a store written for another deployment", () => {
    const path = tempPath();
    new FileVoucherStore(path, SCOPE, { create: true });
    expect(() => new FileVoucherStore(path, { ...SCOPE, contract: OTHER_CONTRACT })).toThrow(/belongs to/);
  });

  it("refuses malformed or duplicate records", () => {
    const path = tempPath();
    const write = (vouchers: unknown) =>
      writeFileSync(path, JSON.stringify({ version: 1, networkPassphrase: PASSPHRASE, contract: CONTRACT, vouchers }));
    const sig = "ab".repeat(64);
    write([{ channelId: "1", amount: "100", signature: sig }, { channelId: "1", amount: "5", signature: sig }]);
    expect(() => new FileVoucherStore(path, SCOPE)).toThrow(/duplicate/);
    write([{ channelId: "1", amount: "100", signature: "zz" }]);
    expect(() => new FileVoucherStore(path, SCOPE)).toThrow(/malformed/);
    write([{ channelId: "1", amount: "-5", signature: sig }]);
    expect(() => new FileVoucherStore(path, SCOPE)).toThrow(/malformed/);
    writeFileSync(path, "null");
    expect(() => new FileVoucherStore(path, SCOPE)).toThrow(/version 1/);
  });

  it("writes the deployment scope into the file", () => {
    const path = tempPath();
    new FileVoucherStore(path, SCOPE, { create: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1, contract: CONTRACT, networkPassphrase: PASSPHRASE });
  });
});

describe("assertTrustedDeployment", () => {
  const pinned = { wasmHash: "ab".repeat(32), token: CONTRACT };

  it("accepts the pinned code and token", () => {
    expect(() => assertTrustedDeployment({ ...pinned, wasmHash: pinned.wasmHash.toUpperCase() }, pinned)).not.toThrow();
  });

  it("rejects a contract running different code", () => {
    expect(() => assertTrustedDeployment({ ...pinned, wasmHash: "cd".repeat(32) }, pinned)).toThrow(/untrusted contract code/);
  });

  it("rejects a treasury paying in another token", () => {
    expect(() => assertTrustedDeployment({ ...pinned, token: OTHER_CONTRACT }, pinned)).toThrow(/untrusted payment asset/);
  });

  it("rejects malformed pinned values instead of matching them", () => {
    expect(() => assertTrustedDeployment({ wasmHash: "", token: "" }, { wasmHash: "", token: "" })).toThrow(/pinned deployment/);
  });
});
