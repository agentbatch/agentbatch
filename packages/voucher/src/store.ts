import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SignedVoucher } from "./payload.js";

/**
 * The deployment a store's vouchers belong to. Channel IDs are only unique
 * within one contract on one network, so a store is bound to exactly one.
 */
export interface StoreScope {
  networkPassphrase: string;
  contract: string;
}

/**
 * Highest accepted voucher per channel of one deployment.
 *
 * PoC: requests are processed sequentially per channel. A production
 * provider must make "read highest, verify, write new highest" atomic (e.g. a
 * database transaction or compare-and-set), or concurrent requests could both
 * be accepted against the same previous amount.
 */
export interface VoucherStore {
  readonly scope: StoreScope;
  get(channelId: bigint): SignedVoucher | undefined;
  put(voucher: SignedVoucher): void;
  all(): SignedVoucher[];
}

const copy = (v: SignedVoucher): SignedVoucher => ({ channelId: v.channelId, amount: v.amount, signature: Uint8Array.from(v.signature) });
const U64_MAX = (1n << 64n) - 1n;
const I128_MAX = (1n << 127n) - 1n;

export class MemoryVoucherStore implements VoucherStore {
  protected readonly vouchers = new Map<bigint, SignedVoucher>();

  constructor(readonly scope: StoreScope) {}

  get(channelId: bigint): SignedVoucher | undefined {
    const v = this.vouchers.get(channelId);
    return v && copy(v);
  }

  put(voucher: SignedVoucher): void {
    const v = copy(voucher);
    if (v.channelId < 1n || v.channelId > U64_MAX || v.amount > I128_MAX) throw new RangeError("voucher outside channel u64 or amount i128 bounds");
    if (v.amount <= 0n || v.signature.length !== 64) throw new Error("store only accepts positive, signed vouchers");
    const current = this.vouchers.get(v.channelId);
    if (current && v.amount <= current.amount) throw new Error("store only accepts increasing vouchers");
    this.vouchers.set(v.channelId, v);
  }

  all(): SignedVoucher[] {
    return [...this.vouchers.values()].map(copy);
  }
}

interface StoreFile {
  version: 1;
  networkPassphrase: string;
  contract: string;
  vouchers: { channelId: string; amount: string; signature: string }[];
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const SIGNATURE = /^[0-9a-f]{128}$/;

/**
 * JSON-file store. Reopening fails closed on a missing file. `create: true`
 * explicitly provisions a new store and refuses an existing path. Malformed,
 * duplicate or foreign records throw instead of resetting accepted state.
 * Writes are flushed to disk; updates atomically replace the existing file.
 */
export class FileVoucherStore extends MemoryVoucherStore {
  constructor(
    private readonly path: string,
    scope: StoreScope,
    options: { create?: boolean } = {},
  ) {
    super(scope);
    if (options.create) {
      // Provision exactly once. Never silently reopen or overwrite another
      // process's store, and never use provisioning as missing-state recovery.
      this.writeAndSync(openSync(path, "wx", 0o600));
      this.syncDirectory();
      return;
    }
    const text = readFileSync(path, "utf8");
    const file = JSON.parse(text) as Partial<StoreFile> | null;
    if (file === null || typeof file !== "object" || file.version !== 1 || !Array.isArray(file.vouchers)) throw new Error(`${path}: not a version 1 voucher store`);
    if (file.networkPassphrase !== scope.networkPassphrase || file.contract !== scope.contract) {
      throw new Error(`${path}: store belongs to ${file.contract} on "${file.networkPassphrase}", not ${scope.contract}`);
    }
    for (const r of file.vouchers) {
      if (typeof r?.channelId !== "string" || typeof r?.amount !== "string" || typeof r?.signature !== "string" ||
          !DECIMAL.test(r.channelId) || !DECIMAL.test(r.amount) || !SIGNATURE.test(r.signature)) {
        throw new Error(`${path}: malformed voucher record ${JSON.stringify(r)}`);
      }
      const channelId = BigInt(r.channelId);
      const amount = BigInt(r.amount);
      if (channelId < 1n || channelId > U64_MAX || amount < 1n || amount > I128_MAX) {
        throw new RangeError(`${path}: voucher outside channel u64 or amount i128 bounds`);
      }
      if (this.vouchers.has(channelId)) throw new Error(`${path}: duplicate record for channel ${channelId}`);
      super.put({ channelId, amount, signature: Buffer.from(r.signature, "hex") });
    }
  }

  override put(voucher: SignedVoucher): void {
    super.put(voucher);
    this.flush();
  }

  private writeAndSync(fd: number): void {
    const file: StoreFile = {
      version: 1,
      networkPassphrase: this.scope.networkPassphrase,
      contract: this.scope.contract,
      vouchers: this.all().map((v) => ({
        channelId: v.channelId.toString(),
        amount: v.amount.toString(),
        signature: Buffer.from(v.signature).toString("hex"),
      })),
    };
    try {
      writeFileSync(fd, JSON.stringify(file, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private flush(): void {
    const tmp = `${this.path}.tmp`;
    this.writeAndSync(openSync(tmp, "w", 0o600));
    renameSync(tmp, this.path);
    this.syncDirectory();
  }

  private syncDirectory(): void {
    const dir = openSync(dirname(this.path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}
