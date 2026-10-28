import { NETWORK, SCENARIO } from "./config.js";
import type { Chain } from "./chain.js";
import type { DemoKeys } from "./keys.js";
import type { RunPaths } from "./runs.js";
import type { Deployment } from "./workflows/deploy.js";
import type { demo } from "./workflows/settle.js";
import type { benchmark } from "./workflows/benchmark.js";
import { version, sorobanSdkVersion, stellarSdkVersion, write } from "./support.js";

export function writeReport(chain: Chain, keys: DemoKeys, deployment: Deployment,
  demoResult: Awaited<ReturnType<typeof demo>>, bench: Awaited<ReturnType<typeof benchmark>>,
  rpcVersion: { version: string }, network: { protocolVersion: unknown }, run: RunPaths): void {
  const tools = {
    node: process.version,
    rustc: version("rustc --version"),
    stellarCli: version("stellar --version"),
    sorobanSdk: sorobanSdkVersion(),
    stellarSdkJs: stellarSdkVersion(),
    rpc: rpcVersion.version,
    protocolVersion: network.protocolVersion,
  };
  const manifest = {
    runId: run.id,
    network: NETWORK.name,
    networkPassphrase: NETWORK.passphrase,
    rpcUrl: NETWORK.rpcUrl,
    generatedAt: new Date().toISOString(),
    asset: { ...deployment.asset, note: "Synthetic Testnet asset issued for this PoC. Not Circle USDC." },
    contract: { name: "AgentBatchPoC", wasmHash: deployment.wasmHash, wasmSizeBytes: deployment.wasmSizeBytes, build: "stellar contract build --optimize" },
    deployments: { demo: deployment.demoContract, baseline: deployment.baselineContract },
    accounts: {
      issuer: keys.issuer.publicKey(),
      owner: keys.owner.publicKey(),
      coordinator: keys.coordinator.publicKey(),
      providers: keys.providers.map((p, i) => ({ name: SCENARIO.providers[i]!.name, address: p.publicKey() })),
      agentSignerPublicKeys: keys.agents.map((a) => Buffer.from(a.publicKey).toString("hex")),
    },
    channels: demoResult.channelIds,
    tools,
  };
  write(run.manifest, manifest);
  write(run.evidence, { manifest, transactions: chain.records, demo: demoResult, benchmark: bench });
  write(run.benchmark, {
    source:
      "Stellar Testnet. feeChargedStroops and charged.* come from transaction results and meta read back via RPC; declared.* are the resource limits set from simulation (not metered consumption); envelopeBytes is computed locally.",
    generatedAt: manifest.generatedAt,
    tools,
    wasmSizeBytes: deployment.wasmSizeBytes,
    operations: Object.fromEntries(
      chain.records
        .filter((r) => r.soroban && /upload|deploy AgentBatchPoC \(demo|demo: deposit|demo: open channel A|redeem_batch|withdraw/.test(r.label))
        .map((r) => [r.label, { hash: r.hash, feeChargedStroops: r.feeCharged, ...r.soroban }]),
    ),
    comparison: bench.comparison,
  });
  write(run.completion, { runId: run.id, status: "complete", transactions: chain.records.length });
}
