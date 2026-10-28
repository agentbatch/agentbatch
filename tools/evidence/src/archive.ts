import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const TESTNET = "Test SDF Network ; September 2015";

export interface TxRecord {
  label: string;
  hash: string;
  ledger: number;
  status: "SUCCESS" | "FAILED";
  feeCharged: string;
  raw: { envelopeXdr: string; resultXdr: string; resultMetaXdr: string; diagnosticEventsXdr: string[] };
}
export interface Evidence {
  manifest: {
    networkPassphrase: string; rpcUrl: string;
    contract: { wasmHash: string; wasmSizeBytes: number };
    deployments: { demo: string; baseline: string };
    asset: { sac: string };
    accounts: { providers: { address: string }[] };
  };
  transactions: TxRecord[];
  demo: { batchTx: string; incrementalTx: string };
  benchmark: { comparison: {
    baselineThreeTransactions: { feeChargedStroops: string };
    agentBatchOneTransaction: { feeChargedStroops: string };
  } };
}
export interface Archive { directory: string; evidence: Evidence; finalWithdrawal?: TxRecord }

export function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
export function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
}

export function loadArchive(directory: string): Archive {
  const evidence = readJson(resolve(directory, "evidence.json")) as Evidence;
  assert(evidence && typeof evidence === "object", "invalid evidence document");
  assert(Array.isArray(evidence.transactions) && evidence.transactions.length > 0, "empty transaction archive");
  assert.equal(evidence.manifest.networkPassphrase, TESTNET, "only Testnet archives are supported");
  assert.match(evidence.manifest.contract.wasmHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(readJson(resolve(directory, "manifest.json")), evidence.manifest, "manifest/evidence mismatch");
  const withdrawal = resolve(directory, "final-withdrawal.json");
  if (existsSync(withdrawal)) {
    const finalWithdrawal = (readJson(withdrawal) as { record: TxRecord }).record;
    assert(finalWithdrawal?.raw, "invalid final withdrawal record");
    return { directory, evidence, finalWithdrawal };
  }
  return { directory, evidence };
}

/** Resolve indexed directories inside Testnet storage; reject traversal in the index. */
export function registeredRuns(root = ROOT): { selected: string; directories: string[] } {
  const base = resolve(root, "deployments/testnet");
  const indexPath = resolve(base, "index.json");
  const index = existsSync(indexPath)
    ? readJson(indexPath) as { version: number; default: string; runs: { id: string; directory: string }[] }
    : { version: 1, default: "initial", runs: [{ id: "initial", directory: "." }] };
  assert.equal(index.version, 1);
  const ids = new Set<string>();
  const paths = new Set<string>();
  let selected: string | undefined;
  for (const run of index.runs) {
    assert(!ids.has(run.id), "duplicate indexed run ID"); ids.add(run.id);
    const directory = resolve(base, run.directory);
    const rel = relative(base, directory);
    assert(!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"), "run index escapes Testnet directory");
    assert(!paths.has(directory), "duplicate indexed run directory"); paths.add(directory);
    if (run.id === index.default) selected = directory;
  }
  assert(selected, "default run is not registered");
  const runs = resolve(base, "runs");
  if (existsSync(runs)) {
    for (const entry of readdirSync(runs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(runs, entry.name);
      const completion = resolve(directory, "complete.json");
      if (existsSync(completion)) {
        assert.equal((readJson(completion) as { status: string }).status, "complete");
        paths.add(directory);
      }
    }
  }
  return { selected, directories: [...paths] };
}

export function directoryFromArgument(argument?: string): string {
  return argument ? resolve(ROOT, argument) : registeredRuns().selected;
}

export function archiveLabel(archive: Archive): string { return relative(ROOT, dirname(resolve(archive.directory, "evidence.json"))); }
