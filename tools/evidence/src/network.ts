import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { Contract, xdr } from "@stellar/stellar-sdk";
import { TESTNET, type Archive, type TxRecord } from "./archive.js";
import { allRecords, checkArchive } from "./check.js";
import { decodedMetadata, normalizeMetadata } from "./metadata.js";

const execute = promisify(execFile);
type ReadMethod = "getNetwork" | "getLedgerEntries" | "getTransaction";
export interface RpcTransaction {
  status: string; ledger: number; envelopeXdr: string; resultXdr: string; resultMetaXdr: string;
}

/** Read-only transport. curl honors standard HTTPS proxy settings; no keys are loaded. */
async function request<T>(url: string, method: ReadMethod, params: object = {}): Promise<{ result: T }> {
  const endpoint = new URL(url);
  assert.equal(endpoint.protocol, "https:", "RPC must use HTTPS");
  assert(!endpoint.username && !endpoint.password, "RPC URL must not contain credentials");
  const { stdout } = await execute("curl", [
    "--proto", "=https", "--fail", "--silent", "--show-error", "--max-time", "30",
    "--retry", "1", "--retry-delay", "1", "--header", "Content-Type: application/json",
    "--header", "User-Agent: AgentBatch-Evidence/1.0",
    "--data-binary", JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), "--url", endpoint.href,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const payload = JSON.parse(stdout) as { result?: T; error?: unknown };
  assert(!payload.error, `${method}: ${JSON.stringify(payload.error)}`);
  assert(payload.result, `${method}: missing result`);
  return { result: payload.result };
}

export function compareTransaction(record: TxRecord, result: RpcTransaction): void {
  assert.equal(result.status, record.status, `${record.label}: status mismatch or transaction outside RPC retention`);
  assert.equal(result.ledger, record.ledger, `${record.label}: ledger mismatch`);
  assert.equal(result.envelopeXdr, record.raw.envelopeXdr, `${record.label}: envelope mismatch`);
  assert.equal(result.resultXdr, record.raw.resultXdr, `${record.label}: result mismatch`);
  assert.deepEqual(normalizeMetadata(decodedMetadata(result.resultMetaXdr)),
    normalizeMetadata(decodedMetadata(record.raw.resultMetaXdr)), `${record.label}: metadata mismatch`);
}

export async function verifyArchive(archive: Archive, progress: (message: string) => void = () => {}) {
  const offline = checkArchive(archive);
  const { manifest } = archive.evidence;
  const rpc = <T>(method: ReadMethod, params?: object) => request<T>(manifest.rpcUrl, method, params);
  const network = (await rpc<{ passphrase: string; protocolVersion: number }>("getNetwork")).result;
  assert.equal(network.passphrase, TESTNET, "RPC is not Stellar Testnet");

  const ledgerEntry = async (key: xdr.LedgerKey) => {
    const { result } = await rpc<{ entries: { xdr: string }[] }>("getLedgerEntries", { keys: [key.toXDR("base64")] });
    assert.equal(result.entries.length, 1, "ledger entry unavailable; it may require restoration");
    return xdr.LedgerEntryData.fromXDR(result.entries[0]!.xdr, "base64");
  };
  const deployed = await ledgerEntry(new Contract(manifest.deployments.demo).getFootprint());
  assert(deployed.type === "contractData" && deployed.contractData.val.type === "scvContractInstance");
  const executable = deployed.contractData.val.instance.executable;
  assert(executable.type === "contractExecutableWasm");
  const hash = executable.wasmHash.value;
  assert.equal(Buffer.from(hash).toString("hex"), manifest.contract.wasmHash, "deployed code hash mismatch");
  const entry = await ledgerEntry(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash })));
  assert(entry.type === "contractCode");
  const wasm = entry.contractCode.code;
  assert.equal(createHash("sha256").update(wasm).digest("hex"), manifest.contract.wasmHash, "WASM bytes hash mismatch");
  assert.equal(wasm.length, manifest.contract.wasmSizeBytes, "WASM size mismatch");
  progress(`Verified deployed WASM (${wasm.length} bytes)`);

  const authoritative = [];
  for (const record of allRecords(archive)) {
    const response = await rpc<RpcTransaction>("getTransaction", { hash: record.hash });
    compareTransaction(record, response.result);
    authoritative.push({ label: record.label, hash: record.hash, response });
    progress(`Verified ${authoritative.length}/${offline.transactions}: ${record.label}`);
  }
  return {
    report: { ...offline, scope: "Live read-only Testnet RPC reconciliation", verifiedAt: new Date().toISOString(),
      network, rpcUrl: manifest.rpcUrl, wasmHash: manifest.contract.wasmHash, wasmBytes: wasm.length,
      metadataComparison: "Envelope/result exact; diagnostics excluded and ledger-change array order normalized. Operation and event order preserved." },
    authoritative,
  };
}
