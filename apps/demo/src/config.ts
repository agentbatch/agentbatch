import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Networks } from "@stellar/stellar-sdk";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const NETWORK = {
  name: "testnet",
  passphrase: Networks.TESTNET,
  rpcUrl: process.env.AGENTBATCH_RPC_URL ?? "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  explorer: "https://stellar.expert/explorer/testnet",
} as const;

export const PATHS = {
  wasm: join(ROOT, "target/wasm32v1-none/release/agentbatch_poc.wasm"),
  keys: join(ROOT, ".secrets/testnet-keys.json"),
  state: join(ROOT, ".state"),
  manifest: join(ROOT, "deployments/testnet/manifest.json"),
  evidence: join(ROOT, "deployments/testnet/evidence.json"),
  benchmark: join(ROOT, "docs/benchmarks/testnet-resources.json"),
} as const;

/** Synthetic Testnet-only asset. Not Circle USDC. */
export const ASSET_CODE = "AUSD";

/** One AUSD in base units (7 decimals). */
export const UNIT = 10_000_000n;

export const ausd = (whole: number) => BigInt(Math.round(whole * 1e7));

export interface ProviderSpec {
  name: string;
  allocation: bigint;
  /** Price of each simulated paid request, in base units. */
  requests: bigint[];
}

export const SCENARIO = {
  deposit: ausd(100),
  providers: [
    { name: "AI Inference API", allocation: ausd(40), requests: [ausd(1.5), ausd(2.5), ausd(3), ausd(5)] },
    { name: "AI Search API", allocation: ausd(35), requests: [ausd(0.75), ausd(1.25), ausd(2), ausd(4)] },
    { name: "Data Retrieval API", allocation: ausd(15), requests: [ausd(0.5), ausd(1.5), ausd(3)] },
  ] satisfies ProviderSpec[],
  /** Later cumulative voucher for provider A (incremental redemption). */
  incrementalCumulative: ausd(17),
} as const;

export function formatAusd(base: bigint): string {
  const sign = base < 0n ? "-" : "";
  const abs = base < 0n ? -base : base;
  const frac = (abs % UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return `${sign}${abs / UNIT}${frac ? "." + frac : ""} AUSD`;
}
