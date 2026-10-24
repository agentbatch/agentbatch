/**
 * AgentBatch PoC — Stellar Testnet demonstration.
 *
 *   pnpm demo:testnet          # build, deploy, simulate, settle, attack, benchmark, write evidence
 *
 * Outcomes, balances and fees are read back from Testnet during the run.
 * Resource figures are the limits declared by simulation; envelope sizes are
 * computed locally. Raw base64 transaction XDR is archived in the evidence.
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { encodeVoucherMessage, type SignedVoucher } from "@agentbatch/voucher";
import { Address, Asset, Operation, scValToNative } from "@stellar/stellar-sdk";

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

/** Resolved soroban-sdk version from Cargo.lock (the version compiled into the WASM). */
function sorobanSdkVersion(): string {
  const lock = readFileSync(`${ROOT}/Cargo.lock`, "utf8");
  return /\[\[package\]\]\nname = "soroban-sdk"\nversion = "([^"]+)"/.exec(lock)?.[1] ?? "unknown";
}

/** Installed @stellar/stellar-sdk version, as resolved by the demo. */
function stellarSdkVersion(): string {
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

interface Deployment {
  asset: { code: string; issuer: string; sac: string };
  wasmHash: string;
  wasmSizeBytes: number;
  demoContract: string;
  baselineContract: string;
}

async function setup(chain: Chain, keys: DemoKeys, wasm: Buffer): Promise<Deployment> {
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
  return `deposited ${formatAusd(t.totalDeposited)}, paid ${formatAusd(t.totalPaid)}, withdrawn ${formatAusd(t.totalWithdrawn)}, available ${formatAusd(t.available)}, reserved ${formatAusd(t.totalReserved)}, contract balance ${formatAusd(t.tokenBalance)}`;
}

async function balances(chain: Chain, keys: DemoKeys, sac: string) {
  return Promise.all(keys.providers.map((p) => tokenBalance(chain, keys.owner, sac, p.publicKey())));
}

/** Runs a simulation that must fail with `expected` (e.g. "Error(Contract, #109)"); returns the error found. */
async function expectSimulationRejects(label: string, run: () => Promise<unknown>, expected: string) {
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

function checkFailedOnChain(r: TxRecord, expected: string, label: string) {
  check(r.status === "FAILED" && (r.errors ?? []).includes(expected), `${label}: submitted on-chain, FAILED with ${expected} (tx ${r.hash.slice(0, 12)}…)`);
  return { method: "sendTransaction", hash: r.hash, ledger: r.ledger, status: r.status, errors: r.errors, feeCharged: r.feeCharged };
}

function checkInvariants(t: TreasuryState) {
  check(t.totalDeposited - t.totalPaid - t.totalWithdrawn === t.available + t.totalReserved, "conservation: deposits - payouts - withdrawals = available + reserved");
  check(t.tokenBalance >= t.available + t.totalReserved, "solvency: token balance covers liabilities");
}

const STALE = "Error(Contract, #109)";
const EXCEEDS_ALLOCATION = "Error(Contract, #110)";
const INSUFFICIENT_AVAILABLE = "Error(Contract, #102)";
const BAD_SIGNATURE = "Error(Crypto, InvalidInput)";

async function demo(chain: Chain, keys: DemoKeys, d: Deployment) {
  const client = new AgentBatchClient(chain, d.demoContract, keys.owner);
  const providerStart = await balances(chain, keys, d.asset.sac);

  step("1. Shared treasury funding: one deposit");
  await client.deposit(keys.owner, SCENARIO.deposit, "demo: deposit 100 AUSD");

  step("2. Independent virtual channels: three storage records in the same contract");
  const ids = await openThreeChannels(client, keys, "demo");
  const afterSetup = await client.getTreasury();
  const channelsAfterSetup = await Promise.all(ids.map((id) => client.getChannel(id)));
  const channelEntries = await Promise.all(ids.map((id) => client.channelEntry(id)));
  log(`   ${treasuryLine(afterSetup)}`);
  check(afterSetup.tokenBalance === ausd(100) && afterSetup.available === ausd(10) && afterSetup.totalReserved === ausd(90), "100 AUSD deposited once: 90 reserved across 3 channels, 10 unallocated");
  check(
    channelsAfterSetup.every((c, i) => c.allocation === SCENARIO.providers[i]!.allocation && c.provider === keys.providers[i]!.publicKey()),
    "each channel reserves its own allocation for its own provider (40 / 35 / 15)",
  );
  check(
    channelEntries.every((e) => e.contract === d.demoContract && e.liveUntilLedger !== null),
    "each channel is a persistent DataKey::Channel(id) entry of the one treasury contract; no channel contract deployed",
  );

  step("3. Channel isolation on Testnet");
  const isolation = {
    overAllocation: await expectSimulationRejects(
      "open a 4th channel for 10 AUSD + 1 base unit (only 10 AUSD unallocated)",
      () => chain.simulate("over-allocation", keys.owner, client.openOp(keys.providers[0]!.publicKey(), keys.agents[0]!.publicKey, ausd(10) + 1n)),
      INSUFFICIENT_AVAILABLE,
    ),
    reservedWithdrawal: await expectSimulationRejects(
      "withdraw 10 AUSD + 1 base unit (the rest is reserved for providers)",
      () => chain.simulate("reserved withdrawal", keys.owner, client.withdrawOp(ausd(10) + 1n)),
      INSUFFICIENT_AVAILABLE,
    ),
  };

  step("4. Voucher encoding parity: TypeScript bytes == deployed contract bytes");
  const ch0 = channelsAfterSetup[0]!;
  const local = encodeVoucherMessage(
    { networkPassphrase: NETWORK.passphrase, contract: d.demoContract, owner: ch0.owner, channelId: ch0.channelId, provider: ch0.provider, signer: ch0.signer },
    ausd(3),
  );
  const onchain = await client.voucherMessage(ids[0]!, ausd(3));
  check(Buffer.from(local).equals(Buffer.from(onchain)), `voucher_message(${ids[0]}, 3 AUSD) matches local encoding (${onchain.length} bytes)`);

  step("5. Off-chain micropayments: agents sign, providers verify locally");
  // Each provider pins the WASM hash it built from reviewed source and the AUSD
  // SAC, and compares them with the code and token actually on-chain.
  const trusted = { wasmHash: d.wasmHash, token: d.asset.sac };
  const providers = keys.providers.map(
    (p, i) => new SimulatedProvider(SCENARIO.providers[i]!.name, p, d.demoContract, `${d.demoContract}-provider-${i}`, trusted),
  );
  for (const [i, p] of providers.entries()) await p.sync(chain, client, ids[i]!);
  log("   ✓ providers checked the on-chain WASM hash and payment asset before reading their channels");
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
  const submittedDuringSimulation = chain.submitted - submittedBefore;
  log(`   ${requests.length} paid requests; transactions submitted meanwhile (submission counter): ${submittedDuringSimulation}`);

  const latestA = providers[0]!.latest();
  const offchainRejections = {
    replay: providers[0]!.handle(latestA, 1n),
    crossChannel: providers[1]!.handle(latestA, 1n),
    tampered: providers[2]!.handle({ ...providers[2]!.latest(), amount: providers[2]!.latest().amount + ausd(1) }, 1n),
  };
  const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? "accepted" : r.reason);
  check(
    reason(offchainRejections.replay) === "not-increasing" &&
      reason(offchainRejections.crossChannel) === "channel-mismatch" &&
      reason(offchainRejections.tampered) === "bad-signature",
    "providers reject locally: replay (not-increasing), A's voucher shown to B (channel-mismatch), altered amount (bad-signature)",
  );

  step("6. Batched multi-provider settlement: one atomic redeem_batch for three providers");
  const finals = providers.map((p) => p.latest());
  finals.forEach((v, i) => log(`   ${SCENARIO.providers[i]!.name.padEnd(20)} final voucher ${formatAusd(v.amount)}`));
  const batch = await client.redeemBatch(keys.coordinator, finals, "demo: redeem_batch (3 vouchers, 3 providers)");
  log(`   tx ${batch.record.hash}`);
  const afterBatch = await client.getTreasury();
  const paid = (await balances(chain, keys, d.asset.sac)).map((b, i) => b - providerStart[i]!);
  log(`   ${treasuryLine(afterBatch)}`);
  check(batch.totalPaid === ausd(25), "batch paid 25 AUSD in total");
  check(paid[0] === ausd(12) && paid[1] === ausd(8) && paid[2] === ausd(5), "providers received 12 / 8 / 5 AUSD from the same treasury");
  check(afterBatch.tokenBalance === ausd(75), "contract retains 75 AUSD");
  check(afterBatch.available === ausd(10) && afterBatch.totalReserved === ausd(65), "available 10 AUSD, reserved 65 AUSD");
  checkInvariants(afterBatch);
  const channelsAfterBatch = await Promise.all(ids.map((id) => client.getChannel(id)));

  step("7. Isolation attacks submitted on-chain (each reverts with no transfer)");
  // A voucher validly signed by agent C, but above channel C's 15 AUSD allocation.
  const chC = providers[2]!.channel;
  const overC = keys.agents[2]!.sign(
    { networkPassphrase: NETWORK.passphrase, contract: d.demoContract, owner: chC.owner, channelId: chC.channelId, provider: chC.provider, signer: chC.signer },
    ausd(16),
  );
  // Provider A's voucher re-addressed to provider B's channel.
  const crossChannel: SignedVoucher = { ...latestA, channelId: ids[1]! };
  const voucherAboveAllocation = {
    simulation: await expectSimulationRejects("voucher for 16 AUSD on the 15 AUSD channel", () => chain.simulate("above allocation", keys.coordinator, client.redeemOp([overC])), EXCEEDS_ALLOCATION),
    onchain: checkFailedOnChain(
      await chain.sorobanExpectingFailure("attack: voucher above channel allocation", keys.coordinator, client.redeemOp([overC]), batch.data),
      EXCEEDS_ALLOCATION,
      "voucher above allocation",
    ),
  };
  const crossChannelReplay = {
    simulation: await expectSimulationRejects("provider A's voucher redeemed on provider B's channel", () => chain.simulate("cross channel", keys.coordinator, client.redeemOp([crossChannel])), BAD_SIGNATURE),
    onchain: checkFailedOnChain(
      await chain.sorobanExpectingFailure("attack: cross-channel voucher replay", keys.coordinator, client.redeemOp([crossChannel]), batch.data),
      BAD_SIGNATURE,
      "cross-channel replay",
    ),
  };

  step("8. Incremental redemption: cumulative 17 AUSD pays only the 5 AUSD increment");
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

  step("9. Replay protection on Testnet");
  const replaySimulation = {
    cumulative17: await expectSimulationRejects("resubmit the 17 AUSD voucher", () => chain.simulate("replay", keys.coordinator, client.redeemOp([v17])), STALE),
    originalBatch: await expectSimulationRejects("resubmit the original three-voucher batch", () => chain.simulate("replay", keys.coordinator, client.redeemOp(finals)), STALE),
  };
  const replayOnchain = checkFailedOnChain(
    await chain.sorobanExpectingFailure("attack: replay of the original batch", keys.coordinator, client.redeemOp(finals), batch.data),
    STALE,
    "replay of the original batch",
  );
  const afterReplay = await client.getTreasury();
  const finalPayouts = (await balances(chain, keys, d.asset.sac)).map((b, i) => b - providerStart[i]!);
  check(
    finalPayouts.every((b, i) => b === paidAfterInc[i]) && afterReplay.totalPaid === afterInc.totalPaid,
    "no payout from the failed attack and replay transactions (balances read after they were applied)",
  );

  return {
    channelIds: ids,
    afterSetup: { treasury: afterSetup, channels: channelsAfterSetup, channelEntries },
    isolation: { ...isolation, voucherAboveAllocation, crossChannelReplay },
    parity: { channelId: ids[0], amount: ausd(3), bytes: onchain.length, equal: true },
    offchain: { requests, transactionsSubmittedDuringSimulation: submittedDuringSimulation, rejections: offchainRejections },
    afterBatch: { treasury: afterBatch, providerPayouts: paid, channels: channelsAfterBatch },
    afterIncremental: { treasury: afterInc, providerPayouts: paidAfterInc },
    replay: { simulation: replaySimulation, onchain: replayOnchain, providerPayoutsAfter: finalPayouts },
    batchTx: batch.record.hash,
    incrementalTx: inc.record.hash,
  };
}

async function benchmark(chain: Chain, keys: DemoKeys, d: Deployment, batchTx: string) {
  step("10. Benchmark baseline: same starting state, three separate one-voucher redemptions");
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
    declaredInstructions: sum(rs, (r) => r.soroban!.declared.instructions),
    declaredDiskReadBytes: sum(rs, (r) => r.soroban!.declared.diskReadBytes),
    declaredWriteBytes: sum(rs, (r) => r.soroban!.declared.writeBytes),
    readOnlyEntries: sum(rs, (r) => r.soroban!.declared.readOnlyEntries),
    readWriteEntries: sum(rs, (r) => r.soroban!.declared.readWriteEntries),
    envelopeBytes: sum(rs, (r) => r.soroban!.envelopeBytes),
  });
  const comparison = { baselineThreeTransactions: totals(singles), agentBatchOneTransaction: totals([batch]) };
  log(`   baseline: ${comparison.baselineThreeTransactions.transactions} tx, ${comparison.baselineThreeTransactions.feeChargedStroops} stroops`);
  log(`   batch:    ${comparison.agentBatchOneTransaction.transactions} tx, ${comparison.agentBatchOneTransaction.feeChargedStroops} stroops`);

  step("11. Withdrawal limited to unallocated funds (baseline treasury, after its benchmark)");
  const before = await client.getTreasury();
  const ownerBefore = await tokenBalance(chain, keys.owner, d.asset.sac, keys.owner.publicKey());
  const withdrawTx = await client.withdraw(keys.owner, before.available, `baseline: withdraw_available(${formatAusd(before.available)})`);
  const after = await client.getTreasury();
  const ownerAfter = await tokenBalance(chain, keys.owner, d.asset.sac, keys.owner.publicKey());
  log(`   ${treasuryLine(after)}`);
  check(ownerAfter - ownerBefore === before.available && after.available === 0n, `owner withdrew the ${formatAusd(before.available)} unallocated; nothing unallocated remains`);
  check(after.totalReserved === before.totalReserved, `reserved collateral untouched (${formatAusd(after.totalReserved)})`);
  checkInvariants(after);
  const rejectedExtra = await expectSimulationRejects(
    "withdraw 1 more base unit (all remaining funds are reserved)",
    () => chain.simulate("reserved withdrawal", keys.owner, client.withdrawOp(1n)),
    INSUFFICIENT_AVAILABLE,
  );

  return {
    comparison,
    baselineTxs: singles.map((r) => r.hash),
    withdrawal: { tx: withdrawTx.hash, amount: before.available, treasuryBefore: before, treasuryAfter: after, ownerReceived: ownerAfter - ownerBefore, rejectedExtra },
  };
}

async function main() {
  const command = process.argv[2] ?? "all";
  if (command !== "all") throw new Error(`unknown command ${command}; use "all"`);

  // Fail before any transaction if the contract has not been built.
  const wasm = readFileSync(PATHS.wasm);

  const chain = new Chain();
  const keys = loadOrCreateKeys();
  const rpcVersion = await chain.server.getVersionInfo();
  const network = await chain.server.getNetwork();
  log(`AgentBatch PoC on Stellar ${NETWORK.name} (protocol ${network.protocolVersion}, RPC ${rpcVersion.version})`);

  const deployment = await setup(chain, keys, wasm);
  const demoResult = await demo(chain, keys, deployment);
  const bench = await benchmark(chain, keys, deployment, demoResult.batchTx);

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
  write(PATHS.manifest, manifest);
  write(PATHS.evidence, { manifest, transactions: chain.records, demo: demoResult, benchmark: bench });
  write(PATHS.benchmark, {
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
  step("Done");
  log(`   manifest  ${PATHS.manifest}`);
  log(`   evidence  ${PATHS.evidence}`);
  log(`   benchmark ${PATHS.benchmark}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

