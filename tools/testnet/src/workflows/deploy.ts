import { createHash, randomBytes } from "node:crypto";
import { Address, Asset, Operation, scValToNative } from "@stellar/stellar-sdk";
import { Chain, SimulationFailed } from "../chain.js";
import { ASSET_CODE, NETWORK, SCENARIO } from "../config.js";
import { AgentBatchClient } from "../contract.js";
import type { DemoKeys } from "../keys.js";
import { log, step } from "../support.js";

export interface Deployment {
  asset: { code: string; issuer: string; sac: string };
  wasmHash: string;
  wasmSizeBytes: number;
  demoContract: string;
  baselineContract: string;
}

export async function setup(chain: Chain, keys: DemoKeys, wasm: Buffer): Promise<Deployment> {
  step("Accounts (friendbot)");
  const accounts = [keys.issuer, keys.owner, keys.coordinator, ...keys.providers];
  for (const kp of accounts) await chain.fund(kp.publicKey());
  log(`   issuer ${keys.issuer.publicKey()}`);
  log(`   owner  ${keys.owner.publicKey()}`);
  log(`   coordinator ${keys.coordinator.publicKey()}`);
  keys.providers.forEach((p, i) => log(`   provider ${String.fromCharCode(65 + i)} ${p.publicKey()} (${SCENARIO.providers[i]!.name})`));

  step(`Synthetic asset ${ASSET_CODE} (Testnet only, not USDC)`);
  const asset = new Asset(ASSET_CODE, keys.issuer.publicKey());
  const holders = [keys.owner, ...keys.providers];
  // Idempotent: re-applies existing trustlines when keys are reused.
  await chain.classic(
    "trustlines: owner and providers (idempotent)",
    holders,
    holders.map((h) => Operation.changeTrust({ asset, source: h.publicKey() })),
  );
  await chain.classic("issue 200 AUSD to owner", [keys.issuer], [Operation.payment({ destination: keys.owner.publicKey(), asset, amount: "200" })]);

  const sac = asset.contractId(NETWORK.passphrase);
  let sacExists = true;
  try {
    await chain.simulate("sac exists", keys.owner, chain.invoke(sac, "decimals", []));
  } catch (err) {
    if (!(err instanceof SimulationFailed)) throw err;
    sacExists = false;
  }
  if (sacExists) log(`   SAC already deployed by an earlier run: ${sac}`);
  else {
    await chain.soroban("deploy AUSD Stellar Asset Contract", keys.owner, Operation.createStellarAssetContract({ asset }));
    log(`   SAC deployed: ${sac}`);
  }

  step("Contract upload and deployment");
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  log(`   wasm ${wasm.length} bytes, sha256 ${wasmHash}`);
  await chain.soroban("upload AgentBatchPoC wasm", keys.owner, Operation.uploadContractWasm({ wasm }));

  const deploy = async (label: string) => {
    const { returnValue } = await chain.soroban(
      label,
      keys.owner,
      Operation.createCustomContract({
        address: Address.fromString(keys.owner.publicKey()),
        wasmHash: Buffer.from(wasmHash, "hex"),
        constructorArgs: AgentBatchClient.constructorArgs(keys.owner.publicKey(), sac),
        salt: randomBytes(32),
      }),
    );
    return String(scValToNative(returnValue!));
  };
  const demoContract = await deploy("deploy AgentBatchPoC (demo treasury)");
  const baselineContract = await deploy("deploy AgentBatchPoC (baseline treasury)");
  log(`   demo contract     ${demoContract}`);
  log(`   baseline contract ${baselineContract}`);
  return { asset: { code: ASSET_CODE, issuer: keys.issuer.publicKey(), sac }, wasmHash, wasmSizeBytes: wasm.length, demoContract, baselineContract };
}
