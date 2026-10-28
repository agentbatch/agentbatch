import { xdr } from "@stellar/stellar-sdk";

export function normalizeMetadata(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    const array = value.map((v: unknown) => normalizeMetadata(v));
    return ["changes", "tx_changes_before", "tx_changes_after"].includes(key)
      ? array.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : array;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "diagnostic_events")
      .map(([name, v]: [string, unknown]) => [name, normalizeMetadata(v, name)]));
  }
  return value;
}

export function decodedMetadata(raw: string): unknown {
  return JSON.parse(JSON.stringify(xdr.TransactionMeta.fromXDR(raw, "base64"))) as unknown;
}
