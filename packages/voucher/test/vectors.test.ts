import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { AgentSigner, encodeVoucherMessage, networkId, verifyVoucherSignature, VOUCHER_DOMAIN, type VoucherContext } from "../src/index.js";

interface VectorCase {
  note: string;
  channel_id: number;
  provider: string;
  signer_seed: string;
  signer_public_key: string;
  amount: string;
  message_xdr: string;
  signature: string;
}

interface Vectors {
  domain: string;
  network_passphrase: string;
  network_id: string;
  contract: string;
  owner: string;
  cases: VectorCase[];
}

// Produced by the Rust contract's own encoder (contracts/agentbatch-poc/src/test/vectors.rs).
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../test-vectors/vouchers.json", import.meta.url)), "utf8")) as Vectors;

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function context(c: VectorCase): VoucherContext {
  return {
    networkPassphrase: vectors.network_passphrase,
    contract: vectors.contract,
    owner: vectors.owner,
    channelId: BigInt(c.channel_id),
    provider: c.provider,
    signer: Buffer.from(c.signer_public_key, "hex"),
  };
}

describe("cross-language vectors", () => {
  it("share the domain and network id", () => {
    expect(vectors.domain).toBe(VOUCHER_DOMAIN);
    expect(hex(networkId(vectors.network_passphrase))).toBe(vectors.network_id);
  });

  for (const c of vectors.cases) {
    describe(c.note, () => {
      const signer = AgentSigner.fromSeed(Buffer.from(c.signer_seed, "hex"));
      const ctx = context(c);
      const amount = BigInt(c.amount);

      it("derives the same signer public key", () => {
        expect(hex(signer.publicKey)).toBe(c.signer_public_key);
      });

      it("encodes identical message bytes", () => {
        expect(hex(encodeVoucherMessage(ctx, amount))).toBe(c.message_xdr);
      });

      it("produces the identical Ed25519 signature", () => {
        expect(hex(signer.sign(ctx, amount).signature)).toBe(c.signature);
      });

      it("verifies the contract-side signature", () => {
        expect(verifyVoucherSignature(ctx, amount, Buffer.from(c.signature, "hex"))).toBe(true);
      });
    });
  }

  it("encodes map keys in ascending order", () => {
    const c = vectors.cases[0]!;
    const val = xdr.ScVal.fromXDR(Buffer.from(c.message_xdr, "hex"));
    if (val.type !== "scvMap" || !val.map) throw new Error("voucher message is not an ScMap");
    const keys = val.map.map((e) => (e.key.type === "scvSymbol" ? Buffer.from(e.key.sym.bytes).toString() : "?"));
    expect(keys).toEqual(["amount", "channel_id", "contract", "domain", "network", "owner", "provider", "signer"]);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("binding rejections", () => {
  const c = vectors.cases[2]!;
  const ctx = context(c);
  const amount = BigInt(c.amount);
  const sig = Buffer.from(c.signature, "hex");
  const other = vectors.cases[3]!;

  const cases: [string, VoucherContext, bigint, Uint8Array][] = [
    ["wrong network", { ...ctx, networkPassphrase: "Public Global Stellar Network ; September 2015" }, amount, sig],
    ["wrong contract", { ...ctx, contract: "CBWLJK3P6ECN2KZZPKGUIIJ6BCJPXNQTMHMJJGJPZ2ITUJFHPXHUQGBS" }, amount, sig],
    ["wrong provider", { ...ctx, provider: other.provider }, amount, sig],
    ["wrong signer", { ...ctx, signer: Buffer.from(other.signer_public_key, "hex") }, amount, sig],
    ["wrong owner", { ...ctx, owner: other.provider }, amount, sig],
    ["cross-channel replay", { ...ctx, channelId: BigInt(other.channel_id) }, amount, sig],
    ["altered amount", ctx, amount + 1n, sig],
    ["invalid signature", ctx, amount, Buffer.from(sig.map((b, i) => (i === 5 ? b ^ 1 : b)))],
    ["truncated signature", ctx, amount, sig.subarray(0, 63)],
  ];
  for (const [name, badCtx, badAmount, badSig] of cases) {
    it(`rejects ${name}`, () => {
      expect(verifyVoucherSignature(badCtx, badAmount, badSig)).toBe(false);
    });
  }
});
