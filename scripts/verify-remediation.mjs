#!/usr/bin/env node
// Compatibility entry point. Implementation lives in the evidence workspace.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const directory = args[0] && !args[0].startsWith("--") ? args.shift() : undefined;
const result = spawnSync("pnpm", ["evidence:verify", ...(directory ? ["--run", directory] : []), ...args], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit",
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
