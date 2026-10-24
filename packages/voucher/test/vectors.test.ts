import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  AgentSigner,
  encodeVoucherMessage,
  isSafeSignerKey,
  networkId,
  verifyStrict,
  verifyVoucherSignature,
  VOUCHER_DOMAIN,
  type VoucherContext,
} from "../src/index.js";

interface VectorCase {
  note: string;
  channel_id: string;
  provider: string;
  signer_seed: string;
  signer_public_key: string;
  amount: string;
  message_xdr: string;
  signature: string;
}

interface InvalidCase extends Omit<VectorCase, "signer_seed"> {
  cofactored_valid: boolean;
}

interface Vectors {
  domain: string;
  network_passphrase: string;
  network_id: string;
  contract: string;
  owner: string;
  cases: VectorCase[];
  invalid_signatures: InvalidCase[];
}

// Produced by the Rust contract's own encoder (contracts/agentbatch-poc/src/test/vectors.rs).
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../test-vectors/vouchers.json", import.meta.url)), "utf8")) as Vectors;

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function context(c: Pick<VectorCase, "channel_id" | "provider" | "signer_public_key">): VoucherContext {
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

  it("cover account and contract providers and negative amounts", () => {
    expect(vectors.cases.some((c) => StrKey.isValidContract(c.provider))).toBe(true);
    expect(vectors.cases.some((c) => BigInt(c.amount) < 0n)).toBe(true);
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

  it("encodes map keys in ascending order (TypeScript encoder output)", () => {
    const c = vectors.cases[0]!;
    const val = xdr.ScVal.fromXDR(Buffer.from(encodeVoucherMessage(context(c), BigInt(c.amount))));
    if (val.type !== "scvMap" || !val.map) throw new Error("voucher message is not an ScMap");
    const keys = val.map.map((e) => (e.key.type === "scvSymbol" ? Buffer.from(e.key.sym.bytes).toString() : "?"));
    expect(keys).toEqual(["amount", "channel_id", "contract", "domain", "network", "owner", "provider", "signer"]);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("signatures the Soroban host rejects (verify_strict)", () => {
  for (const c of vectors.invalid_signatures) {
    describe(c.note, () => {
      const ctx = context(c);
      const msg = Buffer.from(c.message_xdr, "hex");
      const sig = Buffer.from(c.signature, "hex");
      const key = Buffer.from(c.signer_public_key, "hex");

      it("uses the message the Rust generator signed", () => {
        expect(hex(encodeVoucherMessage(ctx, BigInt(c.amount)))).toBe(c.message_xdr);
      });

      it("is rejected by the voucher verifier", () => {
        expect(verifyVoucherSignature(ctx, BigInt(c.amount), sig)).toBe(false);
        expect(verifyStrict(key, msg, sig)).toBe(false);
      });

      if (c.cofactored_valid) {
        it("would pass a cofactored verifier (the gap this guards against)", () => {
          const generic = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(key));
          expect(generic.verify(msg, sig)).toBe(true);
        });
      }
    });
  }

  it("flags mixed-order signer keys as unsafe and agent keys as safe", () => {
    const mixed = vectors.invalid_signatures.find((c) => c.note.startsWith("signer key"))!;
    expect(isSafeSignerKey(Buffer.from(mixed.signer_public_key, "hex"))).toBe(false);
    for (const c of vectors.cases) expect(isSafeSignerKey(Buffer.from(c.signer_public_key, "hex"))).toBe(true);
    expect(isSafeSignerKey(new Uint8Array(32))).toBe(false);
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

describe("encoder input validation", () => {
  const ctx = context(vectors.cases[0]!);
  const muxed = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ";

  it("rejects a non-contract deployment address", () => {
    expect(() => encodeVoucherMessage({ ...ctx, contract: vectors.owner }, 1n)).toThrow(/contract address/);
  });

  it("rejects muxed and malformed provider or owner addresses", () => {
    expect(() => encodeVoucherMessage({ ...ctx, provider: muxed }, 1n)).toThrow(/account .* or contract/);
    expect(() => encodeVoucherMessage({ ...ctx, owner: "garbage" }, 1n)).toThrow(/account .* or contract/);
  });

  it("rejects out-of-range integers", () => {
    expect(() => encodeVoucherMessage(ctx, 1n << 127n)).toThrow(/i128/);
    expect(() => encodeVoucherMessage({ ...ctx, channelId: 1n << 64n }, 1n)).toThrow(/u64/);
    expect(() => encodeVoucherMessage({ ...ctx, channelId: -1n }, 1n)).toThrow(/u64/);
  });

  it("encodes the u64 maximum channel id", () => {
    expect(() => encodeVoucherMessage({ ...ctx, channelId: (1n << 64n) - 1n }, 1n)).not.toThrow();
  });
});
