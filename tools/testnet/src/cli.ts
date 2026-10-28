/** Testnet-only end-to-end runner. Each invocation reserves a new evidence directory. */
import { readFileSync } from "node:fs";
import { Chain } from "./chain.js";
import { NETWORK, PATHS, ROOT } from "./config.js";
import { loadOrCreateKeys } from "./keys.js";
import { createRun } from "./runs.js";
import { writeReport } from "./report.js";
import { log, step } from "./support.js";
import { setup } from "./workflows/deploy.js";
import { demo } from "./workflows/settle.js";
import { benchmark } from "./workflows/benchmark.js";

async function main() {
  const command = process.argv[2] ?? "all";
  if (command !== "all") throw new Error('use "all" to run the Testnet demonstration');
  const wasm = readFileSync(PATHS.wasm);
  const run = createRun(ROOT, process.env.AGENTBATCH_RUN_ID);
  const chain = new Chain();
  const keys = loadOrCreateKeys(run.keys);
  const rpcVersion = await chain.server.getVersionInfo();
  const network = await chain.server.getNetwork();
  if (network.passphrase !== NETWORK.passphrase) throw new Error("RPC endpoint is not Stellar Testnet");
  log(`AgentBatch on Stellar Testnet (protocol ${network.protocolVersion}, RPC ${rpcVersion.version})`);
  log(`Evidence run: ${run.id}`);
  const deployment = await setup(chain, keys, wasm);
  const result = await demo(chain, keys, deployment, run);
  const comparison = await benchmark(chain, keys, deployment, result.batchTx);
  writeReport(chain, keys, deployment, result, comparison, rpcVersion, network, run);
  step("Done");
  log(`   manifest  ${run.manifest}`);
  log(`   evidence  ${run.evidence}`);
  log(`   benchmark ${run.benchmark}`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
