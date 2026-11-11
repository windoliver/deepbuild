// The score renderer's voices (#154; canvas primitives: Score, As built): a library take repitched from its zone's
// measured root, a plucked string, and the synth presets sine, triangle, saw, square and pad. Each writes one note
// into a mono buffer from its onset, through its own envelope; the stem pans and sums them. Every number comes from
// the note, its draws and this file's math: nothing reads a clock or a shared random stream.
import { TAU, exp2, hz, sin } from './math.mjs';

/** Each preset's attack and release in seconds when the event gives none. */
export const DEFAULTS = {
  sampled: { attack: 0, release: 0.05 },
  pluck: { attack: 0, release: 0.08 },
  sine: { attack: 0.005, release: 0.05 },
  triangle: { attack: 0.005, release: 0.05 },
  saw: { attack: 0.005, release: 0.05 },
  square: { attack: 0.005, release: 0.05 },
  pad: { attack: 0.3, release: 0.8 },
};
const PLUCKS = {
  nylon: { damping: 0.55, brightness: 0.35 },
  steel: { damping: 0.3, brightness: 0.75 },
  harp: { damping: 0.4, brightness: 0.55 },
};
export const SYNTHS = ['sine', 'triangle', 'saw', 'square', 'pad'];
export const PLUCK_PRESETS = Object.keys(PLUCKS);

/** A note's level at sample `n` after its onset: a linear attack, held to its duration, then a linear release. */
export function envelope(n, attack, dur, release) {
  const rise = attack > 0 ? Math.min(1, n / attack) : 1;
  if (n < dur) return rise;
  const top = attack > 0 ? Math.min(1, dur / attack) : 1;
  return release > 0 ? Math.max(0, top * (1 - (n - dur) / release)) : 0;
}

/** The note's pitch offset in semitones `t` seconds after its onset: its bend's line, plus its vibrato once it starts. */
export function offset(e, t) {
  let semis = 0;
  const bend = Array.isArray(e.bend) ? e.bend : [];
  if (bend.length) {
    const pts = bend[0][0] > 0 ? [[0, 0], ...bend] : bend;
    if (t >= pts[pts.length - 1][0]) semis = pts[pts.length - 1][1];
    else {
      for (let i = 1; i < pts.length; i++) {
        if (t < pts[i][0]) {
          const [t0, v0] = pts[i - 1];
          const [t1, v1] = pts[i];
          semis = t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
          break;
        }
      }
    }
  }
  const vib = e.vib;
  if (vib && vib.hz > 0 && vib.depth && t >= (vib.from ?? 0)) semis += vib.depth * sin(TAU * vib.hz * (t - (vib.from ?? 0)));
  return semis;
}
const moves = (e) => (Array.isArray(e.bend) && e.bend.length > 0) || (e.vib && e.vib.hz > 0 && e.vib.depth);

/** A 32-bit xorshift seeded from a draw: the noise of one note only. */
function noise(seed) {
  let s = Number(seed & 0xffffffffn) | 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 2147483648 - 1;
  };
}

/** A take read at fractional position `p` by 4-point Hermite interpolation. */
function hermite(x, p) {
  const i = Math.floor(p);
  const f = p - i;
  const xm1 = x[i - 1] ?? 0, x0 = x[i] ?? 0, x1 = x[i + 1] ?? 0, x2 = x[i + 2] ?? 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/**
 * One note into `out` (mono, the note's own length): `src` its source as the params name it, `e` the event with its
 * envelope in samples, `rate` the stem's, `draws` its hashed draws, `take` the decoded take a sampled note plays.
 */
export function voice(out, src, e, rate, draws, take) {
  const len = out.length;
  const level = e.level;
  const env = (n) => envelope(n, e.attackN, e.durN, e.releaseN) * level;
  if (src.sampled) {
    const base = exp2((e.pitch - take.root) / 12) * (take.rate / rate);
    const x = take.samples;
    let p = 0;
    for (let n = 0; n < len && p < x.length - 1; n++) {
      out[n] = hermite(x, p) * env(n);
      p += moves(e) ? base * exp2(offset(e, n / rate) / 12) : base;
    }
    return;
  }
  if (src.pluck) {
    const preset = { ...PLUCKS[src.pluck.preset], ...(src.pluck.overrides ?? {}) };
    // The loop's delay is N whole samples, half a sample in its two-point average, and d in an allpass tuned at the
    // fundamental, so the string sounds at the note's pitch to a fraction of a cent.
    const f = hz(e.pitch);
    const period = rate / f;
    const N = Math.max(2, Math.floor(period - 0.5 - 0.1));
    const d = period - 0.5 - N;
    const w = (TAU * f) / rate;
    const C = sin(((1 - d) * w) / 2) / sin(((1 + d) * w) / 2);
    // Loop gain from damping: a note decays by 60 dB in 6 s at none and in 0.6 s at full.
    const t60 = 6 * exp2(-3.3219280948873626 * preset.damping);
    const g = exp2((-60 / 20) * 3.321928094887362 * (period / rate / t60));
    const line = new Float64Array(N);
    const rnd = noise(draws.noise);
    // The excitation: the note's own noise through a one-pole low-pass set by brightness, its mean taken out.
    const a = 0.1 + 0.9 * preset.brightness;
    let lp = 0;
    let mean = 0;
    for (let i = 0; i < N; i++) { lp += a * (rnd() - lp); line[i] = lp; mean += lp; }
    mean /= N;
    let peak = 0;
    for (let i = 0; i < N; i++) { line[i] -= mean; peak = Math.max(peak, Math.abs(line[i])); }
    if (peak > 0) for (let i = 0; i < N; i++) line[i] /= peak;
    let idx = 0;
    let prev = 0;
    let apIn = 0;
    let apOut = 0;
    for (let n = 0; n < len; n++) {
      const x = line[idx];
      const avg = 0.5 * (x + prev);
      prev = x;
      const y = C * avg + apIn - C * apOut;
      apIn = avg;
      apOut = y;
      line[idx] = g * y;
      idx = idx + 1 === N ? 0 : idx + 1;
      out[n] = x * env(n);
    }
    return;
  }
  const preset = src.synth.preset;
  const f0 = hz(e.pitch);
  // A pad is two saws, detuned apart by 6 to 12 cents by the note's draw, through a one-pole low-pass at 2.4 kHz.
  const cents = preset === 'pad' ? 6 + 6 * (Number(draws.detune % 1000n) / 1000) : 0;
  const ratios = preset === 'pad' ? [exp2(-cents / 2400), exp2(cents / 2400)] : [1];
  const phases = ratios.map(() => 0);
  const k = 1 - exp2((-TAU * 2400) / rate / 0.6931471805599453);
  let lp = 0;
  for (let n = 0; n < len; n++) {
    const bend = moves(e) ? exp2(offset(e, n / rate) / 12) : 1;
    let s = 0;
    for (let v = 0; v < ratios.length; v++) {
      const inc = (f0 * bend * ratios[v]) / rate;
      const ph = phases[v];
      if (preset === 'sine') s += sin(TAU * ph);
      else if (preset === 'triangle') s += 1 - 4 * Math.abs(ph - 0.5);
      else if (preset === 'square') s += (ph < 0.5 ? 1 : -1) + blep(ph, inc) - blep((ph + 0.5) % 1, inc);
      else s += 2 * ph - 1 - blep(ph, inc);
      phases[v] = (ph + inc) % 1;
    }
    s /= ratios.length;
    if (preset === 'pad') { lp += k * (s - lp); s = lp; }
    out[n] = s * env(n);
  }
}

/** The polynomial correction at a saw's or square's step, so its edges alias less. */
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}
