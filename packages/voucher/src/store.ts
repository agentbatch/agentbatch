import { readFileSync, renameSync, writeFileSync } from "node:fs";

import type { SignedVoucher } from "./payload.js";

/**
 * Highest accepted voucher per channel.
 *
 * PoC: requests are processed sequentially per channel. A production
 * provider must make "read highest, verify, write new highest" atomic (e.g. a
 * database transaction or compare-and-set), or concurrent requests could both
 * be accepted against the same previous amount.
 */
export interface VoucherStore {
  get(channelId: bigint): SignedVoucher | undefined;
  put(voucher: SignedVoucher): void;
  all(): SignedVoucher[];
}

export class MemoryVoucherStore implements VoucherStore {
  protected readonly vouchers = new Map<bigint, SignedVoucher>();

  get(channelId: bigint): SignedVoucher | undefined {
    return this.vouchers.get(channelId);
  }

  put(voucher: SignedVoucher): void {
    const current = this.vouchers.get(voucher.channelId);
    if (current && voucher.amount <= current.amount) throw new Error("store only accepts increasing vouchers");
    this.vouchers.set(voucher.channelId, voucher);
  }

  all(): SignedVoucher[] {
    return [...this.vouchers.values()];
  }
}

interface StoredRecord {
  channelId: string;
  amount: string;
  signature: string;
}

/** JSON-file store; each write replaces the file atomically via rename. */
export class FileVoucherStore extends MemoryVoucherStore {
  constructor(private readonly path: string) {
    super();
    let records: StoredRecord[] = [];
    try {
      records = JSON.parse(readFileSync(path, "utf8")) as StoredRecord[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (const r of records) {
      this.vouchers.set(BigInt(r.channelId), {
        channelId: BigInt(r.channelId),
        amount: BigInt(r.amount),
        signature: Buffer.from(r.signature, "hex"),
      });
    }
  }

  override put(voucher: SignedVoucher): void {
    super.put(voucher);
    const records: StoredRecord[] = this.all().map((v) => ({
      channelId: v.channelId.toString(),
      amount: v.amount.toString(),
      signature: Buffer.from(v.signature).toString("hex"),
    }));
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}
