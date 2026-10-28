import type { SignedVoucher } from "@agentbatch/voucher";
import type { Chain, TxRecord } from "../chain.js";
import { SCENARIO, formatAusd, ausd } from "../config.js";
import { AgentBatchClient, tokenBalance } from "../contract.js";
import type { DemoKeys } from "../keys.js";
import { agentFor } from "../provider.js";
import { log, step, check, openThreeChannels, treasuryLine, expectSimulationRejects, checkInvariants, INSUFFICIENT_AVAILABLE } from "../support.js";
import type { Deployment } from "./deploy.js";

export async function benchmark(chain: Chain, keys: DemoKeys, d: Deployment, batchTx: string) {
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
