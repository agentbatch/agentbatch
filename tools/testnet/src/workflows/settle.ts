import { encodeVoucherMessage, type SignedVoucher } from "@agentbatch/voucher";
import type { Chain } from "../chain.js";
import { NETWORK, SCENARIO, formatAusd, ausd } from "../config.js";
import { AgentBatchClient } from "../contract.js";
import type { DemoKeys } from "../keys.js";
import { agentFor, SimulatedProvider, type RequestLog } from "../provider.js";
import { log, step, check, openThreeChannels, treasuryLine, balances, expectSimulationRejects, checkFailedOnChain, checkInvariants, STALE, EXCEEDS_ALLOCATION, INSUFFICIENT_AVAILABLE, BAD_SIGNATURE } from "../support.js";
import type { Deployment } from "./deploy.js";
import type { RunPaths } from "../runs.js";

export async function demo(chain: Chain, keys: DemoKeys, d: Deployment, run: RunPaths) {
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
    // These contracts and channels were created in this run. Provision their
    // stores once; a resumed provider must omit createStore and fail on loss.
    (p, i) => new SimulatedProvider(SCENARIO.providers[i]!.name, p, d.demoContract, `${d.demoContract}-provider-${i}`, trusted, { createStore: true, stateDirectory: run.state }),
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
