import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRun } from "../src/runs.js";
import { write } from "../src/support.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "agentbatch-runs-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("immutable evidence runs", () => {
  it("isolates public evidence, private keys and provider state by run", () => {
    const first = createRun(root, "first");
    const second = createRun(root, "second");
    expect(first.directory).not.toBe(second.directory);
    expect(first.manifest).toBe(join(root, "deployments/testnet/runs/first/manifest.json"));
    expect(first.keys).toBe(join(root, ".secrets/testnet/first.json"));
    expect(first.state).toBe(join(root, ".state/testnet/first"));
  });

  it("refuses an existing run and leaves its evidence intact", () => {
    const run = createRun(root, "existing");
    writeFileSync(run.evidence, "historical record");
    expect(() => createRun(root, "existing")).toThrow(/EEXIST/);
    expect(readFileSync(run.evidence, "utf8")).toBe("historical record");
  });

  it("never overwrites an artifact inside a run", () => {
    const run = createRun(root, "write-once");
    write(run.manifest, { original: true });
    expect(() => write(run.manifest, { original: false })).toThrow(/EEXIST/);
    expect(JSON.parse(readFileSync(run.manifest, "utf8"))).toEqual({ original: true });
  });

  it("generates distinct run IDs by default", () => {
    expect(createRun(root).id).not.toBe(createRun(root).id);
  });

  it.each(["../escape", "/absolute", "", "a/b", "a\\b", "a".repeat(97)])("rejects unsafe run ID %j", (id) => {
    expect(() => createRun(root, id)).toThrow(/invalid run ID/);
  });
});
