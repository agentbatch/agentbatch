import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RunPaths {
  id: string;
  directory: string;
  manifest: string;
  evidence: string;
  benchmark: string;
  completion: string;
  keys: string;
  state: string;
}

/** Reserve a fresh run before submitting any transaction. Existing runs are never reused. */
export function createRun(root: string, id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`): RunPaths {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id)) throw new Error("invalid run ID; use 1-96 letters, digits, underscores or hyphens");
  const parent = join(root, "deployments/testnet/runs");
  mkdirSync(parent, { recursive: true });
  const directory = join(parent, id);
  mkdirSync(directory); // EEXIST is intentional: never replace historical evidence.
  return {
    id, directory,
    manifest: join(directory, "manifest.json"),
    evidence: join(directory, "evidence.json"),
    benchmark: join(directory, "benchmark.json"),
    completion: join(directory, "complete.json"),
    keys: join(root, ".secrets/testnet", `${id}.json`),
    state: join(root, ".state/testnet", id),
  };
}
