import { BASE_FEE, Keypair, Operation, rpc, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";

import { NETWORK } from "./config.js";

/**
 * Resource and fee figures for one Soroban transaction, grouped by where each
 * number comes from.
 */
export interface SorobanMetrics {
  /** Resource limits declared in the transaction, taken from simulation (not metered consumption). */
  declared: {
    instructions: number;
    diskReadBytes: number;
    writeBytes: number;
    readOnlyEntries: number;
    readWriteEntries: number;
    resourceFee: string;
  };
  /** Minimum resource fee reported by simulation. */
  simulatedMinResourceFee: string;
  /** Charged by the network, from the transaction result and meta. */
  charged: {
    nonRefundableResourceFee: string;
    refundableResourceFee: string;
    rentFee: string;
  };
  /** Contract events in the transaction result. */
  contractEvents: number;
  /** Size of the signed envelope, computed locally. */
  envelopeBytes: number;
}

/** Raw base64 XDR as returned by RPC `getTransaction`, archived for independent re-verification. */
export interface RawTransaction {
  envelopeXdr: string;
  resultXdr: string;
  resultMetaXdr: string;
  diagnosticEventsXdr: string[];
}

export interface TxRecord {
  label: string;
  hash: string;
  ledger: number;
  /** SUCCESS, or FAILED for transactions that were submitted expecting rejection. */
  status: string;
  /** Total fee charged in stroops (inclusion + resource fees), from the transaction result. */
  feeCharged: string;
  explorer: string;
  /** Errors found in the diagnostic events of a failed transaction. */
  errors?: string[];
  soroban?: SorobanMetrics;
  raw: RawTransaction;
}

export class SimulationFailed extends Error {
  constructor(
    readonly label: string,
    readonly detail: string,
  ) {
    super(`${label}: simulation failed: ${detail}`);
  }
}

const str = (v: unknown) => (v === undefined || v === null ? "0" : String(v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Collects every Soroban error found anywhere in a decoded XDR value, as
 * `Error(Contract, #n)` or `Error(<Type>, <Code>)`.
 */
function errorsIn(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== "object") return out;
  const node = value as Record<string, unknown>;
  if (typeof node.contractCode === "number") out.push(`Error(Contract, #${node.contractCode})`);
  else if (typeof node.type === "string" && node.type.startsWith("sce") && node.code !== undefined) {
    const code = node.code as { name?: string } | string;
    const name = typeof code === "string" ? code : (code.name ?? String(code));
    out.push(`Error(${node.type.slice(3)}, ${name.replace(/^scec/, "")})`);
  }
  for (const v of Object.values(node)) errorsIn(v, out);
  return out;
}

export class Chain {
  readonly server = new rpc.Server(NETWORK.rpcUrl);
  readonly records: TxRecord[] = [];
  /** Count of transactions submitted by this process. */
  submitted = 0;

  async accountExists(publicKey: string): Promise<boolean> {
    try {
      await this.server.getAccount(publicKey);
      return true;
    } catch (err) {
      if (/not found/i.test(String((err as Error)?.message ?? err))) return false;
      throw err;
    }
  }

  async fund(publicKey: string): Promise<void> {
    if (await this.accountExists(publicKey)) return;
    const res = await fetch(`${NETWORK.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
    if (!res.ok) throw new Error(`friendbot failed for ${publicKey}: ${res.status} ${await res.text()}`);
    for (let i = 0; i < 30; i++) {
      if (await this.accountExists(publicKey)) return;
      await sleep(1000);
    }
    throw new Error(`${publicKey} funded by friendbot but not visible via RPC after 30s`);
  }

  /**
   * Loads an account that must exist. Load-balanced RPC nodes occasionally
   * answer "not found" for a live account, so a few retries are allowed.
   */
  async account(publicKey: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.server.getAccount(publicKey);
      } catch (err) {
        if (attempt >= 5 || !/not found/i.test(String((err as Error)?.message ?? err))) throw err;
        await sleep(2000);
      }
    }
  }

  async build(source: Keypair, op: xdr.Operation): Promise<Transaction> {
    const account = await this.account(source.publicKey());
    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
      .addOperation(op)
      .setTimeout(120)
      .build();
  }

  /** Submits classic operations signed by `signers` (first signer is the source). */
  async classic(label: string, signers: Keypair[], ops: xdr.Operation[]): Promise<TxRecord> {
    const source = signers[0]!;
    const account = await this.account(source.publicKey());
    const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase }).setTimeout(120);
    ops.forEach((op) => builder.addOperation(op));
    const tx = builder.build();
    signers.forEach((s) => tx.sign(s));
    return (await this.send(label, tx, "SUCCESS")).record;
  }

  /** Simulates without submitting; returns the result value or throws SimulationFailed. */
  async simulate(label: string, source: Keypair, op: xdr.Operation): Promise<xdr.ScVal> {
    const sim = await this.server.simulateTransaction(await this.build(source, op));
    if (rpc.Api.isSimulationError(sim)) throw new SimulationFailed(label, sim.error);
    if (!sim.result) throw new SimulationFailed(label, "no result");
    return sim.result.retval;
  }

  /** Simulates, assembles, signs and submits one Soroban operation. */
  async soroban(
    label: string,
    source: Keypair,
    op: xdr.Operation,
  ): Promise<{ record: TxRecord; returnValue: xdr.ScVal | undefined; data: xdr.SorobanTransactionData }> {
    const raw = await this.build(source, op);
    const sim = await this.server.simulateTransaction(raw);
    if (rpc.Api.isSimulationError(sim)) throw new SimulationFailed(label, sim.error);
    if (rpc.Api.isSimulationRestore(sim)) throw new SimulationFailed(label, "archived entries need restoration first");
    const tx = rpc.assembleTransaction(raw, sim).build();
    tx.sign(source);
    const data = sim.transactionData.build();
    const { record, returnValue } = await this.send(label, tx, "SUCCESS", { data, minResourceFee: sim.minResourceFee });
    return { record, returnValue, data };
  }

  /**
   * Submits an operation that simulation rejects, so the network itself
   * records the rejection. Simulation cannot produce a footprint for a failing
   * call, so `data` (resources and footprint) is reused from a successful
   * transaction touching the same entries.
   */
  async sorobanExpectingFailure(label: string, source: Keypair, op: xdr.Operation, data: xdr.SorobanTransactionData): Promise<TxRecord> {
    const account = await this.account(source.publicKey());
    const fee = (BigInt(BASE_FEE) + BigInt(str(data.resourceFee))).toString();
    const tx = new TransactionBuilder(account, { fee, networkPassphrase: NETWORK.passphrase })
      .addOperation(op)
      .setSorobanData(data)
      .setTimeout(120)
      .build();
    tx.sign(source);
    return (await this.send(label, tx, "FAILED")).record;
  }

  private async send(
    label: string,
    tx: Transaction,
    expect: "SUCCESS" | "FAILED",
    soroban?: { data: xdr.SorobanTransactionData; minResourceFee: string },
  ): Promise<{ record: TxRecord; returnValue: xdr.ScVal | undefined }> {
    const sent = await this.server.sendTransaction(tx);
    this.submitted++;
    if (sent.status === "ERROR" || sent.status === "DUPLICATE" || sent.status === "TRY_AGAIN_LATER") {
      throw new Error(`${label}: send failed (${sent.status}) ${JSON.stringify(sent.errorResult ?? "")}`);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 120, sleepStrategy: () => 1000 });
    if (res.status === "NOT_FOUND") {
      throw new Error(`${label}: outcome of ${sent.hash} unknown after 120s; check it before re-running to avoid duplicate effects`);
    }
    if (res.status !== expect) throw new Error(`${label}: transaction ${sent.hash} ${res.status}, expected ${expect}`);

    const raw = await this.rawTransaction(sent.hash);
    const record: TxRecord = {
      label,
      hash: sent.hash,
      ledger: res.ledger,
      status: res.status,
      feeCharged: str(res.resultXdr.feeCharged),
      explorer: `${NETWORK.explorer}/tx/${sent.hash}`,
      raw,
    };
    if (res.status === "FAILED") {
      const found = raw.diagnosticEventsXdr.flatMap((e) => errorsIn(xdr.DiagnosticEvent.fromXDR(e, "base64")));
      record.errors = [...new Set(found)];
    }
    if (soroban && res.status === "SUCCESS") record.soroban = metrics(soroban.data, soroban.minResourceFee, res, tx);
    this.records.push(record);
    return { record, returnValue: res.status === "SUCCESS" ? res.returnValue : undefined };
  }

  /** Raw JSON-RPC `getTransaction`, keeping the base64 XDR exactly as served. */
  private async rawTransaction(hash: string): Promise<RawTransaction> {
    const res = await fetch(NETWORK.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }),
    });
    const body = (await res.json()) as { result?: Partial<RawTransaction> };
    const r = body.result ?? {};
    return {
      envelopeXdr: r.envelopeXdr ?? "",
      resultXdr: r.resultXdr ?? "",
      resultMetaXdr: r.resultMetaXdr ?? "",
      diagnosticEventsXdr: r.diagnosticEventsXdr ?? [],
    };
  }

  invoke(contract: string, method: string, args: xdr.ScVal[]): xdr.Operation {
    return Operation.invokeContractFunction({ contract, function: method, args });
  }
}

function metrics(
  data: xdr.SorobanTransactionData,
  minResourceFee: string,
  res: rpc.Api.GetSuccessfulTransactionResponse,
  tx: Transaction,
): SorobanMetrics {
  const r = data.resources;
  // TransactionMeta v4 (protocol 23+): charged resource fees live in sorobanMeta.ext.v1.
  const meta = res.resultMetaXdr as unknown as { v4?: { sorobanMeta?: { ext?: { v1?: Record<string, unknown> } } } };
  const charged = meta.v4?.sorobanMeta?.ext?.v1 ?? {};
  return {
    declared: {
      instructions: Number(r.instructions),
      diskReadBytes: Number(r.diskReadBytes),
      writeBytes: Number(r.writeBytes),
      readOnlyEntries: r.footprint.readOnly.length,
      readWriteEntries: r.footprint.readWrite.length,
      resourceFee: str(data.resourceFee),
    },
    simulatedMinResourceFee: minResourceFee,
    charged: {
      nonRefundableResourceFee: str(charged.totalNonRefundableResourceFeeCharged),
      refundableResourceFee: str(charged.totalRefundableResourceFeeCharged),
      rentFee: str(charged.rentFeeCharged),
    },
    contractEvents: res.events?.contractEventsXdr?.flat().length ?? 0,
    envelopeBytes: tx.toEnvelope().toXDR().length,
  };
}
