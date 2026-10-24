import {
  BASE_FEE,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";

import { NETWORK } from "./config.js";

/** Resource and fee figures for one Soroban transaction, as reported by Testnet. */
export interface SorobanMetrics {
  /** Declared in the transaction (from simulation). */
  instructions: number;
  diskReadBytes: number;
  writeBytes: number;
  readOnlyEntries: number;
  readWriteEntries: number;
  declaredResourceFee: string;
  /** From simulation. */
  minResourceFee: string;
  /** Charged, from transaction meta. */
  nonRefundableResourceFeeCharged: string;
  refundableResourceFeeCharged: string;
  rentFeeCharged: string;
  contractEvents: number;
  envelopeBytes: number;
}

export interface TxRecord {
  label: string;
  hash: string;
  ledger: number;
  status: string;
  /** Total fee charged in stroops (inclusion + resource fees). */
  feeCharged: string;
  explorer: string;
  soroban?: SorobanMetrics;
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

export class Chain {
  readonly server = new rpc.Server(NETWORK.rpcUrl);
  readonly records: TxRecord[] = [];
  /** Count of transactions submitted by this process. */
  submitted = 0;

  async fund(publicKey: string): Promise<void> {
    try {
      await this.server.getAccount(publicKey);
      return;
    } catch {
      // Not found: fund it.
    }
    const res = await fetch(`${NETWORK.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
    if (!res.ok) throw new Error(`friendbot failed for ${publicKey}: ${res.status} ${await res.text()}`);
  }

  async build(source: Keypair, op: xdr.Operation): Promise<Transaction> {
    const account = await this.server.getAccount(source.publicKey());
    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
      .addOperation(op)
      .setTimeout(120)
      .build();
  }

  /** Submits classic operations signed by `signers` (first signer is the source). */
  async classic(label: string, signers: Keypair[], ops: xdr.Operation[]): Promise<TxRecord> {
    const source = signers[0]!;
    const account = await this.server.getAccount(source.publicKey());
    const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase }).setTimeout(120);
    ops.forEach((op) => builder.addOperation(op));
    const tx = builder.build();
    signers.forEach((s) => tx.sign(s));
    return (await this.send(label, tx)).record;
  }

  /** Simulates without submitting; returns the result value or throws SimulationFailed. */
  async simulate(label: string, source: Keypair, op: xdr.Operation): Promise<xdr.ScVal> {
    const sim = await this.server.simulateTransaction(await this.build(source, op));
    if (rpc.Api.isSimulationError(sim)) throw new SimulationFailed(label, sim.error);
    if (!sim.result) throw new SimulationFailed(label, "no result");
    return sim.result.retval;
  }

  /** Simulates, assembles, signs and submits one Soroban operation. */
  async soroban(label: string, source: Keypair, op: xdr.Operation): Promise<{ record: TxRecord; returnValue: xdr.ScVal | undefined }> {
    const raw = await this.build(source, op);
    const sim = await this.server.simulateTransaction(raw);
    if (rpc.Api.isSimulationError(sim)) throw new SimulationFailed(label, sim.error);
    if (rpc.Api.isSimulationRestore(sim)) throw new SimulationFailed(label, "archived entries need restoration first");
    const tx = rpc.assembleTransaction(raw, sim).build();
    tx.sign(source);
    const data = sim.transactionData.build();
    return this.send(label, tx, { data, minResourceFee: sim.minResourceFee });
  }

  private async send(
    label: string,
    tx: Transaction,
    soroban?: { data: xdr.SorobanTransactionData; minResourceFee: string },
  ): Promise<{ record: TxRecord; returnValue: xdr.ScVal | undefined }> {
    const sent = await this.server.sendTransaction(tx);
    this.submitted++;
    if (sent.status === "ERROR" || sent.status === "DUPLICATE" || sent.status === "TRY_AGAIN_LATER") {
      throw new Error(`${label}: send failed (${sent.status}) ${JSON.stringify(sent.errorResult ?? "")}`);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 60, sleepStrategy: () => 1000 });
    if (res.status !== "SUCCESS") throw new Error(`${label}: transaction ${sent.hash} ${res.status}`);

    const record: TxRecord = {
      label,
      hash: sent.hash,
      ledger: res.ledger,
      status: res.status,
      feeCharged: str(res.resultXdr.feeCharged),
      explorer: `${NETWORK.explorer}/tx/${sent.hash}`,
    };
    if (soroban) record.soroban = metrics(soroban.data, soroban.minResourceFee, res, tx);
    this.records.push(record);
    return { record, returnValue: res.returnValue };
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
  const meta = res.resultMetaXdr as unknown as { v4?: { sorobanMeta?: { ext?: { v1?: Record<string, unknown> } }; events?: unknown[] } };
  const charged = meta.v4?.sorobanMeta?.ext?.v1 ?? {};
  return {
    instructions: Number(r.instructions),
    diskReadBytes: Number(r.diskReadBytes),
    writeBytes: Number(r.writeBytes),
    readOnlyEntries: r.footprint.readOnly.length,
    readWriteEntries: r.footprint.readWrite.length,
    declaredResourceFee: str(data.resourceFee),
    minResourceFee,
    nonRefundableResourceFeeCharged: str(charged.totalNonRefundableResourceFeeCharged),
    refundableResourceFeeCharged: str(charged.totalRefundableResourceFeeCharged),
    rentFeeCharged: str(charged.rentFeeCharged),
    contractEvents: res.events?.contractEventsXdr?.flat().length ?? 0,
    envelopeBytes: tx.toEnvelope().toXDR().length,
  };
}
