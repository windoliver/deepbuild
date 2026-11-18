// Binary floating point from first principles (IEEE 754: round to nearest, ties to even), for nn.mlp@1's table and
// the no_fma oracle. Every finite float is a dyadic rational m × 2^e; sums and products of them are kept exact as
// BigInts and rounded once to binary32 (24 bits) or binary64 (53 bits), the subnormal grid included. Nothing here
// runs a library or a WebAssembly engine: these are the values a library must give, worked out by hand's rules.

export type Precision = 24 | 53;
/** The exponent of the smallest subnormal's one bit: binary32's 2^-149, binary64's 2^-1074. */
const MIN_LSB: Record<Precision, number> = { 24: -149, 53: -1074 };

/** m × 2^e, exactly. */
export interface Exact { m: bigint; e: number }

/** A finite number as m × 2^e, exactly. */
export function exact(x: number): Exact {
  if (!Number.isFinite(x)) throw Error(`${x} isn't finite`);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return biased === 0 ? { m: sign * fraction, e: -1074 } : { m: sign * ((1n << 52n) | fraction), e: biased - 1075 };
}
export const times = (a: Exact, b: Exact): Exact => ({ m: a.m * b.m, e: a.e + b.e });
export function plus(a: Exact, b: Exact): Exact {
  const e = Math.min(a.e, b.e);
  return { m: (a.m << BigInt(a.e - e)) + (b.m << BigInt(b.e - e)), e };
}

/** `x` rounded once to the nearest value of `p` bits, ties to the even one (within the format's range). */
export function round(x: Exact, p: Precision): number {
  if (x.m === 0n) return 0;
  const negative = x.m < 0n;
  const a = negative ? -x.m : x.m;
  const lsb = Math.max(x.e + a.toString(2).length - p, MIN_LSB[p]);
  let q: bigint;
  if (lsb <= x.e) q = a << BigInt(x.e - lsb);
  else {
    const drop = BigInt(lsb - x.e);
    q = a >> drop;
    const rest = a - (q << drop);
    const half = 1n << (drop - 1n);
    if (rest > half || (rest === half && (q & 1n) === 1n)) q += 1n;
  }
  const v = Number(q) * 2 ** lsb;
  return negative ? -v : v;
}

// Binary32: one rounding per operation. `mul32` and `add32` are WebAssembly's f32.mul and f32.add; `fma32` is a
// multiply and an add fused into one rounding.
export const mul32 = (a: number, b: number): number => round(times(exact(a), exact(b)), 24);
export const add32 = (a: number, b: number): number => round(plus(exact(a), exact(b)), 24);
export const fma32 = (a: number, b: number, c: number): number => round(plus(times(exact(a), exact(b)), exact(c)), 24);
// Binary64 likewise.
export const mul64 = (a: number, b: number): number => round(times(exact(a), exact(b)), 53);
export const add64 = (a: number, b: number): number => round(plus(exact(a), exact(b)), 53);
export const fma64 = (a: number, b: number, c: number): number => round(plus(times(exact(a), exact(b)), exact(c)), 53);

/** A binary32 value's bits, as an unsigned 32-bit integer. */
export function bits32(x: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, x);
  return view.getUint32(0);
}
/** The binary32 value of these bits. */
export function fromBits32(b: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, b >>> 0);
  return view.getFloat32(0);
}
/** A binary64 value's bits. */
export function bits64(x: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}
/** Binary32 values that are equal bit for bit (so +0 and -0 differ). */
export const same32 = (a: number, b: number): boolean => Math.fround(a) === a && Math.fround(b) === b && bits32(a) === bits32(b);
/** How many binary32 steps (units in the last place) lie between two finite values of one sign. */
export const ulps32 = (a: number, b: number): number => Math.abs(bits32(a) - bits32(b));

/** A WebAssembly text hex float (`-0x1.a78402p+124`), exactly. */
export function hexFloat(text: string): number {
  const m = /^(-?)0x([0-9a-f]+)(?:\.([0-9a-f]*))?p([+-]?\d+)$/i.exec(text);
  if (!m) throw Error(`not a hex float: ${text}`);
  const [, sign, whole, fraction = '', power] = m;
  const digits = BigInt(`0x${whole}${fraction}`);
  const value: Exact = { m: sign === '-' ? -digits : digits, e: Number(power) - 4 * fraction.length };
  const v = round(value, 53);
  if (round(exact(v), 53) !== v || plus(exact(v), { m: -value.m, e: value.e }).m !== 0n) throw Error(`${text} isn't a binary64 value`);
  return v;
}
