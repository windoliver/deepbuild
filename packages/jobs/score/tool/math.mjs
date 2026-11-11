// The renderer's own math (#154; canvas primitives: Score, As built): sine, cosine and powers of two from + − × ÷
// only, so every machine computes the same bytes. JavaScript rounds each of those operations to nearest-even and
// never fuses them; the platform's Math.sin, Math.exp and Math.pow carry no such promise, and nothing here calls them.

const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;

/** sin(x) for |x| ≤ π/2, by its Taylor series to x^15 (error below 1e-12). */
function sinCore(x) {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k <= 7; k++) {
    term = (-term * x2) / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

/** sin(x) for any finite x: reduced to [−π, π], then folded onto [−π/2, π/2]. */
export function sin(x) {
  let r = x - TAU * Math.round(x / TAU);
  if (r > HALF_PI) r = Math.PI - r;
  else if (r < -HALF_PI) r = -Math.PI - r;
  return sinCore(r);
}

export const cos = (x) => sin(x + HALF_PI);

/** 2^n for a whole n, exactly, by doubling or halving. */
function pow2int(n) {
  let p = 1;
  if (n >= 0) for (let i = 0; i < n; i++) p *= 2;
  else for (let i = 0; i < -n; i++) p /= 2;
  return p;
}

/** 2^x: 2^floor(x) exactly times e^(f·ln 2) for f in [0, 1), by its series to the 16th term. */
export function exp2(x) {
  const n = Math.floor(x);
  const y = (x - n) * LN2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 16; k++) {
    term = (term * y) / k;
    sum += term;
  }
  return sum * pow2int(n);
}

/** 10^(dB/20): an amplitude from decibels. */
export const amp = (db) => exp2((db / 20) * 3.321928094887362);
/** A MIDI pitch's frequency in Hz, A4 = 69 = 440 Hz. */
export const hz = (midi) => 440 * exp2((midi - 69) / 12);
export { TAU };
