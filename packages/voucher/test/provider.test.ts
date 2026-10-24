import { mkdtempSync, rmSync } from "node:fs";
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
} from "../src/index.js";

const UNIT = 10_000_000n;
const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const OWNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const PROVIDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const OTHER_PROVIDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();

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
  const verifier = new ProviderVerifier({ networkPassphrase: PASSPHRASE, contract: CONTRACT, provider: PROVIDER }, new MemoryVoucherStore());
  const spender = new ChannelSpender(agent, verifier.context(channel), channel.allocation, redeemed);
  return { agent, channel, verifier, spender };
}

describe("ProviderVerifier", () => {
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
    const { channel, verifier, agent } = fixture(12n * UNIT);
    const v = agent.sign(verifier.context(channel), 10n * UNIT);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "not-increasing" });
    const next = agent.sign(verifier.context(channel), 13n * UNIT);
    expect(verifier.accept(channel, next, UNIT)).toEqual({ ok: true, increment: UNIT, cumulative: 13n * UNIT });
  });

  it("rejects payments that do not cover the price", () => {
    const { channel, verifier, spender } = fixture();
    expect(verifier.accept(channel, spender.pay(UNIT), 2n * UNIT)).toEqual({ ok: false, reason: "insufficient-payment" });
  });

  it("rejects amounts above the allocation even if validly signed", () => {
    const { channel, verifier, agent } = fixture();
    const v = agent.sign(verifier.context(channel), channel.allocation + 1n);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "exceeds-allocation" });
  });

  it("rejects vouchers from another signer", () => {
    const { channel, verifier } = fixture();
    const rogue = AgentSigner.fromSeed(Buffer.alloc(32, 8));
    const v = rogue.sign({ ...verifier.context(channel), signer: rogue.publicKey }, UNIT);
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects channels registered to another provider", () => {
    const { channel, verifier, agent } = fixture();
    const foreign = { ...channel, provider: OTHER_PROVIDER };
    const v = agent.sign({ ...verifier.context(channel), provider: OTHER_PROVIDER }, UNIT);
    expect(verifier.accept(foreign, v, UNIT)).toEqual({ ok: false, reason: "not-my-channel" });
  });

  it("rejects a voucher presented for a different channel", () => {
    const { channel, verifier, spender } = fixture();
    const v = { ...spender.pay(UNIT), channelId: 2n };
    expect(verifier.accept(channel, v, UNIT)).toEqual({ ok: false, reason: "channel-mismatch" });
  });
});

describe("ChannelSpender", () => {
  it("never signs beyond the allocation", () => {
    const { spender } = fixture();
    spender.pay(40n * UNIT);
    expect(() => spender.pay(1n)).toThrow(/exceed/);
    expect(() => spender.pay(0n)).toThrow(/positive/);
  });
});

describe("FileVoucherStore", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("persists the highest voucher across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentbatch-store-"));
    dirs.push(dir);
    const path = join(dir, "store.json");
    const { channel, spender } = fixture();
    const verifier = new ProviderVerifier({ networkPassphrase: PASSPHRASE, contract: CONTRACT, provider: PROVIDER }, new FileVoucherStore(path));
    const v = spender.pay(5n * UNIT);
    expect(verifier.accept(channel, v, UNIT).ok).toBe(true);

    const reopened = new FileVoucherStore(path);
    expect(reopened.get(1n)).toEqual({ channelId: 1n, amount: 5n * UNIT, signature: Buffer.from(v.signature) });
    expect(() => reopened.put(v)).toThrow(/increasing/);
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
    const other = StrKey.encodeContract(Buffer.alloc(32, 4));
    expect(() => assertTrustedDeployment({ ...pinned, token: other }, pinned)).toThrow(/untrusted payment asset/);
  });
});
