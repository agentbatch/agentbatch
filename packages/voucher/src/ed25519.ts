import { createHash } from "node:crypto";

import { Point } from "@noble/ed25519";

/** Order of the Ed25519 prime-order subgroup. */
const L = Point.CURVE().n;

const le = (bytes: Uint8Array): bigint => {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
};

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function decode(bytes: Uint8Array): Point | undefined {
  try {
    return Point.fromBytes(bytes, false); // rejects non-canonical encodings
  } catch {
    return undefined;
  }
}

/**
 * Ed25519 verification with the same acceptance rule as the Soroban host,
 * which calls ed25519-dalek `verify_strict`:
 *
 * - `s` must be canonical (`s < L`);
 * - `R` and the public key `A` must decode and must not be of small order;
 * - the cofactorless equation must hold: `encode([s]B − [k]A) == R` with
 *   `k = SHA-512(R ‖ A ‖ M) mod L`.
 *
 * Generic Ed25519 libraries often use the cofactored equation instead, which
 * accepts signatures the contract rejects (e.g. an `R` with a torsion
 * component). A provider must never accept a voucher the contract would
 * reject, so this function is the only verifier used for vouchers. It is at
 * least as strict as the host: it also rejects non-canonical point encodings.
 */
export function verifyStrict(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const rBytes = signature.subarray(0, 32);
  const A = decode(publicKey);
  const R = decode(rBytes);
  if (!A || !R || A.isSmallOrder() || R.isSmallOrder()) return false;
  const s = le(signature.subarray(32));
  if (s >= L) return false;
  const k = le(createHash("sha512").update(rBytes).update(publicKey).update(message).digest()) % L;
  const expected = Point.BASE.multiplyUnsafe(s).subtract(A.multiplyUnsafe(k));
  return equal(expected.toBytes(), rBytes);
}

/**
 * True iff `publicKey` is a canonical encoding of a point in the prime-order
 * subgroup. Keys with a torsion component (mixed order) make most honestly
 * produced signatures fail `verify_strict`, so providers refuse channels
 * registered with such keys.
 */
export function isSafeSignerKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32) return false;
  const A = decode(publicKey);
  return !!A && !A.isSmallOrder() && A.isTorsionFree();
}
