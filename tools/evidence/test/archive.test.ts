import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registeredRuns } from "../src/archive.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "agentbatch-index-")); mkdirSync(join(root, "deployments/testnet"), { recursive: true }); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function index(runs = [{ id: "original", directory: "." }], selected = "original") {
  writeFileSync(join(root, "deployments/testnet/index.json"), JSON.stringify({ version: 1, default: selected, runs }));
}

describe("run selection", () => {
  it("uses the original archive when no optional run index is present", () => {
    expect(registeredRuns(root)).toEqual({ selected: join(root, "deployments/testnet"), directories: [join(root, "deployments/testnet")] });
  });

  it("selects an explicitly indexed default", () => {
    index(); expect(registeredRuns(root)).toEqual({ selected: join(root, "deployments/testnet"), directories: [join(root, "deployments/testnet")] });
  });

  it("discovers completed runs and excludes interrupted runs", () => {
    index();
    const completed = join(root, "deployments/testnet/runs/complete");
    mkdirSync(completed, { recursive: true });
    writeFileSync(join(completed, "complete.json"), '{"status":"complete"}');
    mkdirSync(join(root, "deployments/testnet/runs/interrupted"));
    expect(registeredRuns(root).directories).toEqual([join(root, "deployments/testnet"), completed]);
  });

  it("rejects a default that is not registered", () => {
    index(undefined, "missing"); expect(() => registeredRuns(root)).toThrow(/default run/);
  });

  it("rejects duplicate IDs", () => {
    index([{ id: "original", directory: "." }, { id: "original", directory: "another" }]);
    expect(() => registeredRuns(root)).toThrow(/duplicate indexed run ID/);
  });

  it("rejects duplicate directories", () => {
    index([{ id: "original", directory: "." }, { id: "duplicate", directory: "." }]);
    expect(() => registeredRuns(root)).toThrow(/duplicate indexed run directory/);
  });

  it.each(["../outside", "/tmp/outside"])("rejects an escaping indexed path %s", (directory) => {
    index([{ id: "original", directory }]); expect(() => registeredRuns(root)).toThrow(/escapes/);
  });
});
