import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, loadArchive, type Archive } from "../src/archive.js";
import { checkArchive, checkRecord } from "../src/check.js";
import { normalizeMetadata } from "../src/metadata.js";
import { compareTransaction, type RpcTransaction } from "../src/network.js";

const original = loadArchive(resolve(ROOT, "deployments/testnet"));
const copy = (): Archive => structuredClone(original);

describe("archived transaction evidence", () => {
  it("decodes and reconciles the original archive without a network connection", () => {
    expect(checkArchive(original)).toMatchObject({ transactions: 22 });
  });

  it("checks provider payouts, incremental settlement and charged fee totals", () => {
    expect(checkArchive(original)).toMatchObject({ transactions: 22, separateFeeStroops: "32898", batchFeeStroops: "22294" });
  });

  it("rejects an RPC envelope returned for a different transaction", () => {
    const [first, second] = original.evidence.transactions;
    expect(() => compareTransaction(first!, { ...first!.raw, status: first!.status, ledger: first!.ledger,
      envelopeXdr: second!.raw.envelopeXdr })).toThrow(/envelope mismatch/);
  });

  it("rejects an envelope hash unrelated to the saved envelope", () => {
    const record = structuredClone(original.evidence.transactions[0]!);
    record.hash = "0".repeat(64);
    expect(() => checkRecord(record)).toThrow(/envelope hash mismatch/);
  });

  it("rejects fees that differ from the transaction result", () => {
    const record = structuredClone(original.evidence.transactions[0]!);
    record.feeCharged = (BigInt(record.feeCharged) + 1n).toString();
    expect(() => checkRecord(record)).toThrow(/fee mismatch/);
  });

  it("rejects relabeling a success as a failure", () => {
    const record = structuredClone(original.evidence.transactions[0]!);
    record.status = "FAILED";
    expect(() => checkRecord(record)).toThrow(/result status mismatch/);
  });

  it("rejects duplicate transactions", () => {
    const archive = copy(); archive.evidence.transactions.push(archive.evidence.transactions[0]!);
    expect(() => checkArchive(archive)).toThrow(/duplicate transaction/);
  });

  it("rejects a missing batch transaction", () => {
    const archive = copy();
    archive.evidence.transactions = archive.evidence.transactions.filter((r) => r.hash !== archive.evidence.demo.batchTx);
    expect(() => checkArchive(archive)).toThrow(/missing settlement/);
  });

  it("binds recorded payouts to the declared providers", () => {
    const archive = copy(); archive.evidence.manifest.accounts.providers[0]!.address = archive.evidence.manifest.deployments.demo;
    expect(() => checkArchive(archive)).toThrow(/provider payout mismatch/);
  });

  it("rejects a misleading benchmark total", () => {
    const archive = copy(); archive.evidence.benchmark.comparison.agentBatchOneTransaction.feeChargedStroops = "1";
    expect(() => checkArchive(archive)).toThrow();
  });

  it("rejects a non-Testnet archive", () => {
    const archive = copy(); archive.evidence.manifest.networkPassphrase = "Public Global Stellar Network ; September 2015";
    expect(() => checkArchive(archive)).toThrow();
  });

  it("fails when RPC no longer has a transaction", () => {
    const record = original.evidence.transactions[0]!;
    expect(() => compareTransaction(record, { status: "NOT_FOUND" } as RpcTransaction)).toThrow(/outside RPC retention/);
  });

  it("rejects altered RPC transaction metadata", () => {
    const [first, second] = original.evidence.transactions;
    expect(() => compareTransaction(first!, { ...first!.raw, status: first!.status, ledger: first!.ledger,
      resultMetaXdr: second!.raw.resultMetaXdr })).toThrow(/metadata mismatch/);
  });
});

describe("metadata comparison policy", () => {
  it("ignores diagnostics and ledger-change ordering", () => {
    const left = { changes: [{ balance: 2 }, { balance: 1 }], diagnostic_events: ["node A"], operations: [1, 2] };
    const right = { changes: [{ balance: 1 }, { balance: 2 }], diagnostic_events: [], operations: [1, 2] };
    expect(normalizeMetadata(left)).toEqual(normalizeMetadata(right));
  });

  it("preserves operation and event order and changed balances", () => {
    expect(normalizeMetadata({ operations: [1, 2] })).not.toEqual(normalizeMetadata({ operations: [2, 1] }));
    expect(normalizeMetadata({ events: [1, 2] })).not.toEqual(normalizeMetadata({ events: [2, 1] }));
    expect(normalizeMetadata({ changes: [{ balance: 1 }] })).not.toEqual(normalizeMetadata({ changes: [{ balance: 2 }] }));
  });
});
