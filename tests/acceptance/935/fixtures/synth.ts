// The #935 fixtures, written by the tests at run time, each with its truth by construction and never from an analyzer:
// a music bed (drums, a bass drone and a pad, each its own stem) on a grid of whole bars, looping with no seam, and a
// coin pickup's twelve takes in three levels. Every file is one channel of 32-bit float samples at 48 kHz, so its
// decoded PCM is its samples exactly (deep-codecs keeps IEEE floats as they are), and the test knows the PCM's bytes
// and hash before any bake does. Loudness is set by a BS.1770 meter written here, so a level the test asks for is the
// level the file has. Node built-ins only; no network, nothing committed.
import { createHash } from 'node:crypto';

export const RATE = 48_000;

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The PCM's bytes as the design hashes them: interleaved f32, little-endian (one channel here). */
export function pcmBytes(x: Float32Array): Uint8Array {
  const b = Buffer.alloc(x.length * 4);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i]!, 4 * i);
  return new Uint8Array(b);
}

/** One channel as a 32-bit IEEE-float WAVE file at 48 kHz. */
export function wavF32(x: Float32Array): Uint8Array {
  const data = pcmBytes(x);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([b, data]));
}

/** Seeded noise in [−1, 1) (xorshift32), so every run writes the same bytes. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Loudness, BS.1770 at 48 kHz on one channel: the K-weighting filter's two stages, then the mean square of each whole
// 10 ms sub-block. A file of 400 ms or more reads the gated integrated loudness of 400 ms blocks every 100 ms
// (absolute gate −70 LUFS, relative gate −10 LU); a take shorter than one block reads its whole sub-blocks' mean, as the
// design's row reads it.

const SUB = RATE / 100;

/** Each whole 10 ms sub-block's mean square of the K-weighted signal. */
function subPowers(x: Float32Array): Float64Array {
  const stages: [number[], number[]][] = [
    [[1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]],
    [[1.0, -2.0, 1.0], [-1.99004745483398, 0.99007225036621]],
  ];
  let y = Float64Array.from(x);
  for (const [b, a] of stages) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b[0]! * y[i]! + b[1]! * x1 + b[2]! * x2 - a[0]! * y1 - a[1]! * y2;
      x2 = x1; x1 = y[i]!; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  const p = new Float64Array(Math.floor(y.length / SUB));
  for (let k = 0; k < p.length; k++) {
    let s = 0;
    for (let i = k * SUB; i < (k + 1) * SUB; i++) s += y[i]! * y[i]!;
    p[k] = s / SUB;
  }
  return p;
}
const lufs = (power: number): number => -0.691 + 10 * Math.log10(power);

/** The file's loudness in LUFS, as audio.gen's row reads it. */
function loudness(x: Float32Array): number {
  const p = subPowers(x);
  if (x.length < 0.4 * RATE) return lufs(p.reduce((s, v) => s + v, 0) / p.length);
  const blocks: number[] = [];
  for (let k = 0; k + 40 <= p.length; k += 10) {
    let s = 0;
    for (let j = k; j < k + 40; j++) s += p[j]!;
    blocks.push(s / 40);
  }
  const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
  const loud = blocks.filter((b) => lufs(b) > -70);
  const gate = lufs(mean(loud)) - 10;
  return lufs(mean(loud.filter((b) => lufs(b) > gate)));
}

/** `x` times a gain that puts its loudness at `target`, as f64. */
function toTarget(x: Float64Array, target: number): number {
  return 10 ** ((target - loudness(Float32Array.from(x))) / 20);
}

// ---------------------------------------------------------------------------------------------------------------
// The music bed (AC1, AC2, AC3, AC5).

/** The music bus's loudness target, which every bed is set to. */
export const BED_TARGET = -23;

export interface Bed {
  bpm: number;
  bars: number;
  /** Samples: bars × 4 beats at `bpm`; the bed is exactly this long and loops whole. */
  length: number;
  mix: Float32Array;
  /** The mix's three stems, which sum to it sample by sample (to f32 rounding). */
  stems: { drums: Float32Array; bass: Float32Array; pad: Float32Array };
}

/** The drums' peak levels before the bed is set to its target: the kick, the snare's noise and the hat. */
const [KICK, SNARE, HAT] = [0.3, 0.2, 0.2];

/**
 * A 4/4 bed of `bars` bars at `bpm`: a kick on beats 1 and 3, a snare on 2 and 4 and a closed hat on every off-beat
 * eighth (the drums stem), a 50 Hz drone that starts at its peak (bass) and an A major chord (pad), each tone at a
 * whole number of cycles over the bed and each drum's tail wrapped from the end to the start, so the bed played twice
 * is the bed played on: its seam is as smooth as any bar line inside it. The join lands on a downbeat, where only the
 * kick starts, at phase 0; the snares' noise and the hats are the bed's sharpest moments. Set to BED_TARGET.
 */
export function bed(bpm: number, bars: number): Bed {
  const beat = (60 / bpm) * RATE;
  const n = Math.round(bars * 4 * beat);
  const seconds = n / RATE;
  const drums = new Float64Array(n);
  const bass = new Float64Array(n);
  const pad = new Float64Array(n);
  for (let i = 0; i < n; i++) bass[i] = 0.12 * Math.cos((2 * Math.PI * 50 * i) / RATE);
  for (const f0 of [220, 277.18, 329.63]) {
    const f = Math.round(f0 * seconds) / seconds;
    for (let i = 0; i < n; i++) pad[i]! += 0.04 * Math.sin((2 * Math.PI * f * i) / RATE);
  }
  const add = (at: number, length: number, shape: (t: number) => number): void => {
    for (let k = 0; k < Math.round(length * RATE); k++) drums[(at + k) % n]! += shape(k / RATE);
  };
  const kick = (t: number): number => KICK * Math.sin(2 * Math.PI * (70 * t + 110 * 0.025 * (1 - Math.exp(-t / 0.025)))) * Math.exp(-t / 0.05);
  for (let b = 0; b < bars * 4; b++) {
    const at = Math.round(b * beat);
    if (b % 2 === 0) add(at, 0.5, kick);
    else {
      const r = noise(935 + b);
      add(at, 0.35, (t) => 0.25 * (Math.sin(2 * Math.PI * 180 * t) + 0.6 * Math.sin(2 * Math.PI * 410 * t)) * Math.exp(-t / 0.04)
        + SNARE * r() * Math.exp(-t / 0.025) * Math.min(1, t / 0.001));
    }
    const h = noise(9350 + b);
    let last = 0;
    add(Math.round(at + beat / 2), 0.1, (t) => {
      const v = h();
      const hp = (v - last) / 2;
      last = v;
      return HAT * hp * Math.exp(-t / 0.008) * Math.min(1, t / 0.0005);
    });
  }
  const sum = new Float64Array(n);
  for (let i = 0; i < n; i++) sum[i] = drums[i]! + bass[i]! + pad[i]!;
  const g = toTarget(sum, BED_TARGET);
  const stems = { drums: new Float32Array(n), bass: new Float32Array(n), pad: new Float32Array(n) };
  const mix = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    stems.drums[i] = g * drums[i]!;
    stems.bass[i] = g * bass[i]!;
    stems.pad[i] = g * pad[i]!;
    mix[i] = stems.drums[i]! + stems.bass[i]! + stems.pad[i]!;
  }
  return { bpm, bars, length: n, mix, stems };
}

/** Samples in a bar of 4/4 at `bpm`. */
export const barSamples = (bpm: number): number => Math.round(4 * (60 / bpm) * RATE);

/** The bed with its last `ms` milliseconds cut away: the join now steps from 10 ms before the downbeat to it. */
export const cut = (x: Float32Array, ms: number): Float32Array => x.slice(0, x.length - Math.round((ms / 1000) * RATE));

/** A stem moved later by `ms` milliseconds, its length kept (silence in front, its last samples dropped). */
export function shifted(x: Float32Array, ms: number): Float32Array {
  const by = Math.round((ms / 1000) * RATE);
  const y = new Float32Array(x.length);
  y.set(x.subarray(0, x.length - by), by);
  return y;
}

/** 20 log10 of the RMS of mix − Σ stems over every sample, as the design's stems rule reads it (silence past a file's end). */
export function residualDbfs(mix: Float32Array, stems: Float32Array[]): { dbfs: number; rms: number } {
  let s = 0;
  for (let i = 0; i < mix.length; i++) {
    let r = mix[i]!;
    for (const x of stems) r -= i < x.length ? x[i]! : 0;
    s += r * r;
  }
  const rms = Math.sqrt(s / mix.length);
  return { dbfs: 20 * Math.log10(rms), rms };
}

// ---------------------------------------------------------------------------------------------------------------
// The coin pickup's takes (AC4, AC5).

/** Each level's loudness target, soft to loud (LUFS). */
export const LEVELS = [-28, -22, -16] as const;
const ROUND_ROBINS = 4;
/** +0.4 dBFS as a sample value: the peak of the planted variant. */
const PLUS_04_DB = 10 ** (0.4 / 20);

/**
 * A coin pickup: B5 for 60 ms, then E6 to the end, phase-continuous, with two quieter harmonics; a 2 ms attack, a
 * gentle decay and a 40 ms release. `cents` detunes the whole take, so every take has its own pitch.
 */
function coin(cents: number, seconds: number): Float64Array {
  const n = Math.round(seconds * RATE);
  const r = 2 ** (cents / 1200);
  const x = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = (t < 0.06 ? 987.77 : 1318.51) * r;
    const attack = Math.min(1, t / 0.002);
    const release = Math.min(1, (n - i) / (0.04 * RATE));
    x[i] = Math.sin(attack * Math.PI / 2) ** 2 * Math.sin(release * Math.PI / 2) ** 2 * Math.exp(-t / 0.35)
      * (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
    phase += (2 * Math.PI * f) / RATE;
  }
  return x;
}

/**
 * The clean result: 3 levels × 4 round robins. Take (i, j) is detuned by 30 × (4i + j) − 165 cents and lasts
 * 0.3 × (1 + 0.05 × (j − 1.5)) s (0.2775 to 0.3225 s, within 7.5% of the median), set to LEVELS[i].
 */
export function takes(): Float32Array[][] {
  return LEVELS.map((target, i) => Array.from({ length: ROUND_ROBINS }, (_, j) => {
    const x = coin(30 * (4 * i + j) - 165, 0.3 * (1 + 0.05 * (j - 1.5)));
    const g = toTarget(x, target);
    return Float32Array.from(x, (v) => g * v);
  }));
}

/**
 * Take (`level`, `rr`) with a 4 ms raised-cosine bump of peak +0.4 dBFS in front, its peak on a sample and its
 * spectrum far below 1 kHz, so its true peak is +0.4 dBTP; the take after it is set back so the whole stays on its
 * level's target.
 */
export function overPeak(clean: Float32Array[][], level: number, rr: number): Float32Array {
  const body = Float64Array.from(clean[level]![rr]!);
  const bump = Array.from({ length: 192 }, (_, k) => PLUS_04_DB * Math.sin((Math.PI * k) / 192) ** 2);
  const join = (g: number): Float32Array => Float32Array.from([...bump, ...Array.from(body, (v) => g * v)]);
  let g = 1;
  for (let pass = 0; pass < 3; pass++) g *= 10 ** ((LEVELS[level]! - loudness(join(g))) / 20);
  return join(g);
}
