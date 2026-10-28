import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { Chain, SimulationFailed, type TxRecord } from "./chain.js";
import { ROOT, SCENARIO, formatAusd } from "./config.js";
import { AgentBatchClient, tokenBalance, type TreasuryState } from "./contract.js";
import type { DemoKeys } from "./keys.js";
export const log = (msg = "") => console.log(msg);
export const step = (msg: string) => log(`\n== ${msg}`);

export function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`check failed: ${msg}`);
  log(`   ✓ ${msg}`);
}

export const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x), 2) + "\n";

export function write(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json(value), { flag: "wx" });
}

export function version(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8" }).split("\n")[0]!.trim();
  } catch {
    return "unavailable";
  }
}

/** Resolved soroban-sdk version from Cargo.lock (the version compiled into the WASM). */
export function sorobanSdkVersion(): string {
  const lock = readFileSync(`${ROOT}/Cargo.lock`, "utf8");
  return /\[\[package\]\]\nname = "soroban-sdk"\nversion = "([^"]+)"/.exec(lock)?.[1] ?? "unknown";
}

/** Installed @stellar/stellar-sdk version, as resolved by the demo. */
export function stellarSdkVersion(): string {
  // The package does not export ./package.json, so walk up from its entry point.
  let dir = dirname(createRequire(import.meta.url).resolve("@stellar/stellar-sdk"));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { name?: string; version: string };
      if (pkg.name === "@stellar/stellar-sdk") return pkg.version;
    } catch {
      // no package.json at this level
    }
    const parent = dirname(dir);
    if (parent === dir) return "unknown";
    dir = parent;
  }
}
export async function openThreeChannels(client: AgentBatchClient, keys: DemoKeys, tag: string) {
  const ids: bigint[] = [];
  for (const [i, spec] of SCENARIO.providers.entries()) {
    const { channelId } = await client.openChannel(
      keys.owner,
      keys.providers[i]!.publicKey(),
      keys.agents[i]!.publicKey,
      spec.allocation,
      `${tag}: open channel ${String.fromCharCode(65 + i)} (${spec.name}, ${formatAusd(spec.allocation)})`,
    );
    ids.push(channelId);
  }
  return ids;
}

export function treasuryLine(t: TreasuryState) {
  return `deposited ${formatAusd(t.totalDeposited)}, paid ${formatAusd(t.totalPaid)}, withdrawn ${formatAusd(t.totalWithdrawn)}, available ${formatAusd(t.available)}, reserved ${formatAusd(t.totalReserved)}, contract balance ${formatAusd(t.tokenBalance)}`;
}

export async function balances(chain: Chain, keys: DemoKeys, sac: string) {
  return Promise.all(keys.providers.map((p) => tokenBalance(chain, keys.owner, sac, p.publicKey())));
}

/** Runs a simulation that must fail with `expected` (e.g. "Error(Contract, #109)"); returns the error found. */
export async function expectSimulationRejects(label: string, run: () => Promise<unknown>, expected: string) {
  try {
    await run();
  } catch (err) {
    if (err instanceof SimulationFailed && err.detail.includes(expected)) {
      log(`   ✓ ${label}: simulation rejected with ${expected}`);
      return { method: "simulateTransaction", error: expected };
    }
    throw err;
  }
  throw new Error(`${label}: expected simulation to fail with ${expected}`);
}

export function checkFailedOnChain(r: TxRecord, expected: string, label: string) {
  check(r.status === "FAILED" && (r.errors ?? []).includes(expected), `${label}: submitted on-chain, FAILED with ${expected} (tx ${r.hash.slice(0, 12)}…)`);
  return { method: "sendTransaction", hash: r.hash, ledger: r.ledger, status: r.status, errors: r.errors, feeCharged: r.feeCharged };
}

export function checkInvariants(t: TreasuryState) {
  check(t.totalDeposited - t.totalPaid - t.totalWithdrawn === t.available + t.totalReserved, "conservation: deposits - payouts - withdrawals = available + reserved");
  check(t.tokenBalance >= t.available + t.totalReserved, "solvency: token balance covers liabilities");
}

export const STALE = "Error(Contract, #109)";
export const EXCEEDS_ALLOCATION = "Error(Contract, #110)";
export const INSUFFICIENT_AVAILABLE = "Error(Contract, #102)";
export const BAD_SIGNATURE = "Error(Crypto, InvalidInput)";
