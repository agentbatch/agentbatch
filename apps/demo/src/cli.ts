/**
 * AgentBatch PoC — Stellar Testnet demonstration.
 *
 *   pnpm demo:testnet          # build, deploy, simulate, settle, benchmark, write evidence
 *
 * Every figure written to deployments/testnet/ and docs/benchmarks/ is read
 * back from Testnet during the run.
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { encodeVoucherMessage, type SignedVoucher } from "@agentbatch/voucher";
import { Address, Asset, Keypair, Operation, scValToNative } from "@stellar/stellar-sdk";

import { Chain, SimulationFailed, type TxRecord } from "./chain.js";
import { ASSET_CODE, NETWORK, PATHS, ROOT, SCENARIO, formatAusd, ausd } from "./config.js";
import { AgentBatchClient, tokenBalance, type TreasuryState } from "./contract.js";
import { loadOrCreateKeys, type DemoKeys } from "./keys.js";
import { agentFor, SimulatedProvider, type RequestLog } from "./sim.js";

const log = (msg = "") => console.log(msg);
const step = (msg: string) => log(`\n== ${msg}`);

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`check failed: ${msg}`);
  log(`   ✓ ${msg}`);
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x), 2) + "\n";

function write(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json(value));
}

function version(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8" }).split("\n")[0]!.trim();
  } catch {
    return "unavailable";
  }
}

interface Deployment {
  asset: { code: string; issuer: string; sac: string };
  wasmHash: string;
  wasmSizeBytes: number;
  demoContract: string;
  baselineContract: string;
}

async function setup(chain: Chain, keys: DemoKeys): Promise<Deployment> {
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
  await chain.classic(
    "trustlines: owner and providers",
    holders,
    holders.map((h) => Operation.changeTrust({ asset, source: h.publicKey() })),
  );
  await chain.classic("issue 200 AUSD to owner", [keys.issuer], [Operation.payment({ destination: keys.owner.publicKey(), asset, amount: "200" })]);

  const sac = asset.contractId(NETWORK.passphrase);
  try {
    await chain.simulate("sac exists", keys.owner, chain.invoke(sac, "decimals", []));
    log(`   SAC already deployed: ${sac}`);
  } catch {
    await chain.soroban("deploy AUSD Stellar Asset Contract", keys.owner, Operation.createStellarAssetContract({ asset }));
    log(`   SAC deployed: ${sac}`);
  }

  step("Contract upload and deployment");
  const wasm = readFileSync(PATHS.wasm);
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

async function openThreeChannels(client: AgentBatchClient, keys: DemoKeys, tag: string) {
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

function treasuryLine(t: TreasuryState) {
  return `deposited ${formatAusd(t.totalDeposited)}, paid ${formatAusd(t.totalPaid)}, available ${formatAusd(t.available)}, reserved ${formatAusd(t.totalReserved)}, contract balance ${formatAusd(t.tokenBalance)}`;
}

async function balances(chain: Chain, keys: DemoKeys, sac: string) {
  return Promise.all(keys.providers.map((p) => tokenBalance(chain, keys.owner, sac, p.publicKey())));
}

async function expectRejected(label: string, run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (err) {
    if (err instanceof SimulationFailed && err.detail.includes(code)) return err.detail.match(/Error\(Contract, #\d+\)/)?.[0] ?? code;
    throw err;
  }
  throw new Error(`${label}: expected rejection ${code}`);
}

async function demo(chain: Chain, keys: DemoKeys, d: Deployment) {
  const client = new AgentBatchClient(chain, d.demoContract, keys.owner);
  const providerStart = await balances(chain, keys, d.asset.sac);

  step("1. Single treasury deposit");
  await client.deposit(keys.owner, SCENARIO.deposit, "demo: deposit 100 AUSD");
  step("2. Three virtual channels with isolated collateral (no channel contracts deployed)");
  const ids = await openThreeChannels(client, keys, "demo");
  const funded = await client.getTreasury();
  log(`   ${treasuryLine(funded)}`);
  check(funded.available === ausd(10) && funded.totalReserved === ausd(90), "100 deposited: 90 reserved across 3 channels, 10 unallocated");

  step("3. Voucher encoding parity: TypeScript bytes == deployed contract bytes");
  const ch0 = await client.getChannel(ids[0]!);
  const local = encodeVoucherMessage(
    { networkPassphrase: NETWORK.passphrase, contract: d.demoContract, owner: ch0.owner, channelId: ch0.channelId, provider: ch0.provider, signer: ch0.signer },
    ausd(3),
  );
  const onchain = await client.voucherMessage(ids[0]!, ausd(3));
  check(Buffer.from(local).equals(Buffer.from(onchain)), `voucher_message(${ids[0]}, 3 AUSD) matches local encoding (${onchain.length} bytes)`);

  step("4. Off-chain micropayments: agents sign, providers verify locally");
  // Providers pin the reviewed WASM hash and the AUSD SAC before trusting channel data.
  const trusted = { wasmHash: d.wasmHash, token: d.asset.sac };
  const providers = keys.providers.map(
    (p, i) => new SimulatedProvider(SCENARIO.providers[i]!.name, p, d.demoContract, `${d.demoContract}-provider-${i}`, trusted),
  );
  for (const [i, p] of providers.entries()) await p.sync(chain, client, ids[i]!);
  log("   ✓ providers verified the contract WASM hash and payment asset before reading channels");
  const agents = providers.map((p, i) => agentFor(keys.agents[i]!, p.channel, d.demoContract));
  const submittedBefore = chain.submitted;
  const requests: RequestLog[] = [];
  for (const [i, spec] of SCENARIO.providers.entries()) {
    for (const [n, price] of spec.requests.entries()) {
      const voucher = agents[i]!.pay(price);
      const r = providers[i]!.handle(voucher, price);
      requests.push({ provider: spec.name, request: n + 1, price: formatAusd(price), cumulative: formatAusd(voucher.amount), accepted: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
      log(`   ${spec.name.padEnd(20)} #${n + 1}  pay ${formatAusd(price).padStart(12)}  cumulative ${formatAusd(voucher.amount).padStart(10)}  ${r.ok ? "served" : "REJECTED " + r.reason}`);
      if (!r.ok) throw new Error(`provider rejected an honest voucher: ${r.reason}`);
    }
  }
  const onchainDuringSimulation = chain.submitted - submittedBefore;
  check(onchainDuringSimulation === 0, `${requests.length} paid requests, 0 on-chain transactions`);

  // Off-chain adversarial checks.
  const replay = providers[0]!.handle(providers[0]!.latest(), 1n);
  const crossProvider = providers[1]!.handle({ ...providers[0]!.latest(), channelId: ids[1]! }, 1n);
  const tampered = providers[2]!.handle({ ...providers[2]!.latest(), amount: providers[2]!.latest().amount + ausd(1) }, 1n);
  check(!replay.ok && !crossProvider.ok && !tampered.ok, "provider rejects replayed, cross-channel and tampered vouchers locally");
  const offchainRejections = { replay, crossProvider, tampered };

  step("5. One atomic batch redemption paying three providers (submitted by a third-party coordinator)");
  const finals = providers.map((p) => p.latest());
  finals.forEach((v, i) => log(`   ${SCENARIO.providers[i]!.name.padEnd(20)} final voucher ${formatAusd(v.amount)}`));
  const batch = await client.redeemBatch(keys.coordinator, finals, "demo: redeem_batch (3 vouchers, 3 providers)");
  log(`   tx ${batch.record.hash}`);
  const afterBatch = await client.getTreasury();
  const paid = (await balances(chain, keys, d.asset.sac)).map((b, i) => b - providerStart[i]!);
  log(`   ${treasuryLine(afterBatch)}`);
  check(batch.totalPaid === ausd(25), "batch paid 25 AUSD in total");
  check(paid[0] === ausd(12) && paid[1] === ausd(8) && paid[2] === ausd(5), "providers received 12 / 8 / 5 AUSD");
  check(afterBatch.tokenBalance === ausd(75), "contract retains 75 AUSD");
  check(afterBatch.available === ausd(10) && afterBatch.totalReserved === ausd(65), "available 10 AUSD, reserved 65 AUSD");
  checkInvariants(afterBatch);
  const channelsAfterBatch = await Promise.all(ids.map((id) => client.getChannel(id)));

  step("6. Incremental redemption: cumulative 17 AUSD pays only the 5 AUSD increment");
  await providers[0]!.sync(chain, client, ids[0]!);
  const agentA = agentFor(keys.agents[0]!, providers[0]!.channel, d.demoContract);
  const v17 = agentA.pay(SCENARIO.incrementalCumulative - providers[0]!.channel.redeemed);
  const accepted = providers[0]!.handle(v17, ausd(5));
  check(accepted.ok && v17.amount === ausd(17), "provider A accepts cumulative 17 AUSD voucher off-chain");
  const inc = await client.redeemBatch(keys.coordinator, [v17], "demo: redeem_batch (provider A cumulative 17)");
  const afterInc = await client.getTreasury();
  const paidAfterInc = (await balances(chain, keys, d.asset.sac)).map((b, i) => b - providerStart[i]!);
  log(`   ${treasuryLine(afterInc)}`);
  check(inc.totalPaid === ausd(5) && paidAfterInc[0] === ausd(17), "additional payout exactly 5 AUSD (provider A total 17)");
  check(afterInc.totalPaid === ausd(30) && afterInc.tokenBalance === ausd(70), "total payouts 30 AUSD, contract balance 70 AUSD");
  check(afterInc.totalReserved === ausd(60) && afterInc.available === ausd(10), "reserved 60 AUSD, available 10 AUSD");
  checkInvariants(afterInc);

  step("7. Replay protection on Testnet");
  const replay17 = await expectRejected("replay v17", () => chain.simulate("replay", keys.coordinator, client.redeemOp([v17])), "#9");
  const replayBatch = await expectRejected("replay batch", () => chain.simulate("replay", keys.coordinator, client.redeemOp(finals)), "#9");
  const finalBalances = (await balances(chain, keys, d.asset.sac)).map((b, i) => b - providerStart[i]!);
  check(replay17 === "Error(Contract, #9)" && replayBatch === "Error(Contract, #9)", "resubmitted vouchers rejected with StaleVoucher");
  check(finalBalances.every((b, i) => b === paidAfterInc[i]), "no additional payout after replay attempts");

  return {
    channelIds: ids,
    requests,
    onchainTransactionsDuringSimulation: onchainDuringSimulation,
    offchainRejections,
    parity: { channelId: ids[0], amount: ausd(3), bytes: onchain.length, equal: true },
    afterBatch: { treasury: afterBatch, providerPayouts: paid, channels: channelsAfterBatch },
    afterIncremental: { treasury: afterInc, providerPayouts: paidAfterInc },
    replay: { cumulative17: replay17, originalBatch: replayBatch },
    batchTx: batch.record.hash,
    incrementalTx: inc.record.hash,
  };
}

function checkInvariants(t: TreasuryState) {
  check(t.totalDeposited - t.totalPaid - t.totalWithdrawn === t.available + t.totalReserved, "conservation: deposits - payouts - withdrawals = available + reserved");
  check(t.tokenBalance >= t.available + t.totalReserved, "solvency: token balance covers liabilities");
}

async function benchmark(chain: Chain, keys: DemoKeys, d: Deployment, batchTx: string) {
  step("8. Benchmark baseline: same starting state, three separate one-voucher redemptions");
  const client = new AgentBatchClient(chain, d.baselineContract, keys.owner);
  await client.deposit(keys.owner, SCENARIO.deposit, "baseline: deposit 100 AUSD");
  const ids = await openThreeChannels(client, keys, "baseline");
  const amounts = [ausd(12), ausd(8), ausd(5)];
  const singles: TxRecord[] = [];
  for (const [i, id] of ids.entries()) {
    const ch = await client.getChannel(id);
    const v: SignedVoucher = agentFor(keys.agents[i]!, ch, d.baselineContract).pay(amounts[i]!);
    singles.push((await client.redeemBatch(keys.coordinator, [v], `baseline: redeem_batch (1 voucher, provider ${String.fromCharCode(65 + i)})`)).record);
  }
  const t = await client.getTreasury();
  check(t.totalPaid === ausd(25) && t.totalReserved === ausd(65), "baseline settled the same 25 AUSD");

  const batch = chain.records.find((r) => r.hash === batchTx)!;
  const sum = (rs: TxRecord[], f: (r: TxRecord) => number | string) => rs.reduce((a, r) => a + BigInt(f(r)), 0n);
  const totals = (rs: TxRecord[]) => ({
    transactions: rs.length,
    feeChargedStroops: sum(rs, (r) => r.feeCharged),
    instructions: sum(rs, (r) => r.soroban!.instructions),
    diskReadBytes: sum(rs, (r) => r.soroban!.diskReadBytes),
    writeBytes: sum(rs, (r) => r.soroban!.writeBytes),
    readOnlyEntries: sum(rs, (r) => r.soroban!.readOnlyEntries),
    readWriteEntries: sum(rs, (r) => r.soroban!.readWriteEntries),
    envelopeBytes: sum(rs, (r) => r.soroban!.envelopeBytes),
  });
  const comparison = { baselineThreeTransactions: totals(singles), agentBatchOneTransaction: totals([batch]) };
  log(`   baseline: ${comparison.baselineThreeTransactions.transactions} tx, ${comparison.baselineThreeTransactions.feeChargedStroops} stroops`);
  log(`   batch:    ${comparison.agentBatchOneTransaction.transactions} tx, ${comparison.agentBatchOneTransaction.feeChargedStroops} stroops`);
  return { comparison, baselineTxs: singles.map((r) => r.hash) };
}

async function main() {
  const command = process.argv[2] ?? "all";
  if (command !== "all") throw new Error(`unknown command ${command}; use "all"`);

  const chain = new Chain();
  const keys = loadOrCreateKeys();
  const rpcVersion = await chain.server.getVersionInfo();
  const network = await chain.server.getNetwork();
  log(`AgentBatch PoC on Stellar ${NETWORK.name} (protocol ${network.protocolVersion}, RPC ${rpcVersion.version})`);

  const deployment = await setup(chain, keys);
  const demoResult = await demo(chain, keys, deployment);
  const bench = await benchmark(chain, keys, deployment, demoResult.batchTx);

  const pkg = (p: string) => (JSON.parse(readFileSync(`${ROOT}/${p}`, "utf8")) as { version?: string; dependencies?: Record<string, string> });
  const tools = {
    node: process.version,
    rustc: version("rustc --version"),
    stellarCli: version("stellar --version"),
    sorobanSdk: "27.0.6",
    stellarSdkJs: pkg("packages/voucher/package.json").dependencies?.["@stellar/stellar-sdk"],
    rpc: rpcVersion.version,
    protocolVersion: network.protocolVersion,
  };
  const manifest = {
    network: NETWORK.name,
    networkPassphrase: NETWORK.passphrase,
    rpcUrl: NETWORK.rpcUrl,
    generatedAt: new Date().toISOString(),
    asset: { ...deployment.asset, note: "Synthetic Testnet asset issued for this PoC. Not Circle USDC." },
    contract: { name: "AgentBatchPoC", wasmHash: deployment.wasmHash, wasmSizeBytes: deployment.wasmSizeBytes },
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
  write(PATHS.manifest, manifest);
  write(PATHS.evidence, { manifest, transactions: chain.records, demo: demoResult, benchmark: bench });
  write(PATHS.benchmark, {
    source: "Stellar Testnet transaction results read back via RPC during the demo run",
    generatedAt: manifest.generatedAt,
    tools,
    wasmSizeBytes: deployment.wasmSizeBytes,
    operations: Object.fromEntries(
      chain.records
        .filter((r) => r.soroban && /deposit|open channel A|redeem_batch/.test(r.label))
        .map((r) => [r.label, { hash: r.hash, feeChargedStroops: r.feeCharged, ...r.soroban }]),
    ),
    comparison: bench.comparison,
  });
  step("Done");
  log(`   manifest  ${PATHS.manifest}`);
  log(`   evidence  ${PATHS.evidence}`);
  log(`   benchmark ${PATHS.benchmark}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
