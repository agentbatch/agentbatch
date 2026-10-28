import assert from "node:assert/strict";
import { scValToNative, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { TESTNET, type Archive, type TxRecord } from "./archive.js";

export function allRecords(archive: Archive): TxRecord[] {
  return archive.finalWithdrawal ? [...archive.evidence.transactions, archive.finalWithdrawal] : [...archive.evidence.transactions];
}

export function checkRecord(record: TxRecord): void {
  assert.match(record.hash, /^[a-f0-9]{64}$/);
  assert(record.status === "SUCCESS" || record.status === "FAILED", "invalid transaction status");
  assert(Number.isInteger(record.ledger) && record.ledger > 0, "invalid ledger");
  assert.match(record.feeCharged, /^(0|[1-9][0-9]*)$/);
  const tx = TransactionBuilder.fromXDR(record.raw.envelopeXdr, TESTNET);
  assert.equal(Buffer.from(tx.hash()).toString("hex"), record.hash, `${record.label}: envelope hash mismatch`);
  const result = xdr.TransactionResult.fromXDR(record.raw.resultXdr, "base64");
  assert.equal(result.feeCharged.toString(), record.feeCharged, `${record.label}: fee mismatch`);
  assert.equal(result.result.type, record.status === "SUCCESS" ? "txSuccess" : "txFailed", `${record.label}: result status mismatch`);
  xdr.TransactionMeta.fromXDR(record.raw.resultMetaXdr, "base64");
}

export function checkArchive(archive: Archive) {
  const { evidence } = archive;
  assert.equal(evidence.manifest.networkPassphrase, TESTNET);
  const records = allRecords(archive);
  const hashes = new Set<string>();
  for (const record of records) {
    assert(!hashes.has(record.hash), "duplicate transaction record"); hashes.add(record.hash);
    checkRecord(record);
  }
  const batch = records.find((r) => r.hash === evidence.demo.batchTx);
  const incremental = records.find((r) => r.hash === evidence.demo.incrementalTx);
  assert(batch && incremental, "missing settlement transaction");
  assert.equal(batch.status, "SUCCESS"); assert.equal(incremental.status, "SUCCESS");
  const meta = xdr.TransactionMeta.fromXDR(batch.raw.resultMetaXdr, "base64");
  assert(meta.type === "v4", "unsupported batch metadata version");
  const operation = meta.v4.operations[0]; assert(operation, "missing batch operation");
  const transfers = operation.events.filter((event) => {
    assert(event.body.type === "v0");
    const first = event.body.v0.topics[0]; return first && scValToNative(first) === "transfer";
  }).map((event) => {
    assert(event.contractId && event.body.type === "v0");
    return { token: StrKey.encodeContract(event.contractId.value), topics: event.body.v0.topics.map(scValToNative), amount: scValToNative(event.body.v0.data) as unknown };
  });
  assert.equal(transfers.length, 3, "expected three provider transfers");
  assert.equal(evidence.manifest.accounts.providers.length, 3);
  for (let i = 0; i < 3; i++) {
    const provider = evidence.manifest.accounts.providers[i]; assert(provider);
    assert(transfers.some((t) => t.token === evidence.manifest.asset.sac && t.topics[1] === evidence.manifest.deployments.demo
      && t.topics[2] === provider.address && t.amount === [120000000n, 80000000n, 50000000n][i]), "provider payout mismatch");
  }
  const incMeta = xdr.TransactionMeta.fromXDR(incremental.raw.resultMetaXdr, "base64");
  assert(incMeta.type === "v4");
  const inc = incMeta.v4.operations[0]; assert(inc);
  const payouts = inc.events.filter((event) => {
    assert(event.body.type === "v0"); const first = event.body.v0.topics[0];
    return first && scValToNative(first) === "transfer";
  });
  assert.equal(payouts.length, 1);
  const payout = payouts[0]; assert(payout?.body.type === "v0" && payout.contractId);
  assert.equal(StrKey.encodeContract(payout.contractId.value), evidence.manifest.asset.sac);
  assert.equal(scValToNative(payout.body.v0.topics[1]!), evidence.manifest.deployments.demo);
  assert.equal(scValToNative(payout.body.v0.topics[2]!), evidence.manifest.accounts.providers[0]!.address);
  assert.equal(scValToNative(payout.body.v0.data), 50000000n);

  if (archive.finalWithdrawal) checkFinalWithdrawal(archive);
  const singles = records.filter((r) => /^baseline: redeem_batch/.test(r.label));
  assert.equal(singles.length, 3, "expected three baseline transactions");
  const separateFee = singles.reduce((n, r) => n + BigInt(r.feeCharged), 0n);
  const batchFee = BigInt(batch.feeCharged);
  assert.equal(separateFee.toString(), evidence.benchmark.comparison.baselineThreeTransactions.feeChargedStroops);
  assert.equal(batchFee.toString(), evidence.benchmark.comparison.agentBatchOneTransaction.feeChargedStroops);
  return { transactions: records.length, separateFeeStroops: separateFee.toString(), batchFeeStroops: batchFee.toString(),
    feeSavingPercent: 100 * Number(separateFee - batchFee) / Number(separateFee),
    scope: "Offline consistency and payout checks; this does not authenticate local files against the network." };
}

function checkFinalWithdrawal(archive: Archive): void {
  const record = archive.finalWithdrawal!;
  const { manifest } = archive.evidence;
  assert.equal(record.status, "SUCCESS");
  const meta = xdr.TransactionMeta.fromXDR(record.raw.resultMetaXdr, "base64"); assert(meta.type === "v4");
  const operation = meta.v4.operations[0]; assert(operation);
  let balance: unknown, treasury: Record<string, unknown> | undefined;
  for (const change of operation.changes) {
    const entry = change.type === "ledgerEntryUpdated" ? change.updated : change.type === "ledgerEntryCreated" ? change.created : undefined;
    if (entry?.data.type !== "contractData") continue;
    const data = entry.data.contractData;
    const key = scValToNative(data.key) as unknown;
    const contract = scValToNative(xdr.ScVal.scvAddress(data.contract)) as string;
    if (contract === manifest.asset.sac && Array.isArray(key) && key[0] === "Balance" && key[1] === manifest.deployments.demo)
      balance = (scValToNative(data.val) as { amount: bigint }).amount;
    if (contract !== manifest.deployments.demo) continue;
    if (data.val.type !== "scvContractInstance") continue;
    for (const item of data.val.instance.storage ?? []) {
      const storageKey = scValToNative(item.key) as unknown;
      if (Array.isArray(storageKey) && storageKey[0] === "Treasury") treasury = scValToNative(item.val) as Record<string, unknown>;
    }
  }
  assert.equal(balance, 600000000n); assert(treasury);
  assert.equal(treasury.available, 0n); assert.equal(treasury.total_reserved, 600000000n);
  assert.equal(treasury.total_paid, 300000000n); assert.equal(treasury.total_withdrawn, 100000000n);
}
