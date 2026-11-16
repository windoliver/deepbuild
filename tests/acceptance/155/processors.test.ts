// AC5 #155.dfb89544: "shaper, crush and modulate each match an f64 reference within −120 dBFS on a fixture, and seeking
// equals playing on the same build and architecture"
//
// Through `deep-show run`'s `media_mix`: one media document of 9 s in which each fixture is a stereo float WAV strip
// routed to a bus of its own whose one processor is under test (Processor: `{kind, …fields}`, #499's form), the bus at
// −6 dB after its processor so the master's limiter never acts, and the strips apart in time so each window holds one
// fixture. The references are written here in f64 from the design's laws (Processor: shaper, crush and modulate; the
// synth's shaper and crush laws in Synth As built, the processor's curves being the same *(reading)*), each sample
// within 10⁻⁶ of full scale (−120 dBFS) of the master:
//   - shaper, three fixtures: `tanh` (drive 6 dB, mix 1, oversample 4), `soft_clip` (6 dB, mix 0.5, oversample 2) and
//     `fold` (12 dB, mix 1, oversample 4) on a staircase of 16 levels from −0.45 to 0.45 (−levels on the right), each
//     held 2,048 samples. The curve is memoryless, so on each level's steady part (512 samples in from each step,
//     wherever the oversampling filters ring) the output is (1 − mix)·x + mix·c(g·x), g = 10^(drive ÷ 20), exactly.
//   - crush, two fixtures on 0.5 s of a 440 Hz sine at 0.6 (left) and a 1 kHz sine at 0.35 (right): bits 8, no hold,
//     mix 1; and bits 6, hold_hz 4,000 (12 samples), mix 0.5, its strip starting on a sample that is a multiple of 12
//     and of 128, so a hold grid counted from the transport's start or from the strip's agrees. Every sample: the
//     mid-tread quantizer q = 2^(1 − bits), halves away from 0, each held sample the first of its period.
//   - modulate (wow 0.5 Hz, flutter 8 Hz, depth 10 cents, seed 155) on a 3 s ramp (left −0.6 to 0.6, right 0.3 to
//     −0.3): a fractional delay read of a straight line is exact for any Lagrange order, so the output is the line read
//     at n − D(n), and D(n) is read back from it. The reference is the line read at D's fit to the design's "two
//     periodic curves of t and the seed" taken as two sinusoids at wow_hz and flutter_hz *(reading)*, their amplitudes
//     and phases (the seed's) fitted with a constant (the base delay and any latency) by least squares over 2 s; the
//     output is held to it on every sample of that window, and both curves must move the pitch (each over 0.1 cent).
//   - Seeking equals playing: in the same transport, after the whole 9 s is played, seeks into each kind's window
//     (0.3 s, 3.2 s, 4.1003 s inside a hold, 6.37 s) equal the played samples bit for bit.
// The wrong program is the merge base, whose processors are eq, compressor, limiter, delay, reverb and pitch only
// (`bad_media`: kind "shaper" isn't built).
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, SAMPLE, TIMEOUT, at, firstDiff, mixCall, mixOf, pcmOf, proof, putSignal, runShow, sampleAt, scenario, secs, tempDir, useShow,
  type JsonObject, type Pcm, type SegmentAsk,
} from './helpers.ts';

const bin = useShow();
const SPAN = secs(9);
const BUS_GAIN_DB = -6;
const BUS = 10 ** (BUS_GAIN_DB / 20);
const LIMIT = 1e-6;

// ---- Fixtures
const LEVELS = Array.from({ length: 16 }, (_, k) => -0.45 + 0.06 * k);
const HOLD = 2048;
function stair(): Float32Array[] {
  const l = new Float32Array(LEVELS.length * HOLD);
  const r = new Float32Array(LEVELS.length * HOLD);
  LEVELS.forEach((v, k) => { l.fill(v, k * HOLD, (k + 1) * HOLD); r.fill(-v, k * HOLD, (k + 1) * HOLD); });
  return [l, r];
}
function sines(): Float32Array[] {
  const n = RATE / 2;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / RATE); r[i] = 0.35 * Math.sin((2 * Math.PI * 1000 * i) / RATE); }
  return [l, r];
}
const RAMP = { n: 3 * RATE, l: [-0.6, 1.2], r: [0.3, -0.6] } as const;
function ramp(): Float32Array[] {
  const l = new Float32Array(RAMP.n);
  const r = new Float32Array(RAMP.n);
  for (let i = 0; i < RAMP.n; i++) { l[i] = RAMP.l[0] + (RAMP.l[1] * i) / RAMP.n; r[i] = RAMP.r[0] + (RAMP.r[1] * i) / RAMP.n; }
  return [l, r];
}

interface Fixture { id: string; at: number; signal: 'stair' | 'sines' | 'ramp'; processor: JsonObject }
const FIXTURES: Fixture[] = [
  { id: 'tanh', at: 0, signal: 'stair', processor: { kind: 'shaper', curve: 'tanh', drive: 6, mix: 1, oversample: 4 } },
  { id: 'soft', at: RATE, signal: 'stair', processor: { kind: 'shaper', curve: 'soft_clip', drive: 6, mix: 0.5, oversample: 2 } },
  { id: 'fold', at: 2 * RATE, signal: 'stair', processor: { kind: 'shaper', curve: 'fold', drive: 12, mix: 1, oversample: 4 } },
  { id: 'crush8', at: 3 * RATE, signal: 'sines', processor: { kind: 'crush', bits: 8, hold_hz: 0, mix: 1 } },
  { id: 'crush6', at: 4 * RATE, signal: 'sines', processor: { kind: 'crush', bits: 6, hold_hz: 4000, mix: 0.5 } },
  { id: 'wow', at: 5 * RATE, signal: 'ramp', processor: { kind: 'modulate', wow_hz: 0.5, flutter_hz: 8, depth: 10, seed: 155 } },
];

function doc(assets: Record<string, string>): JsonObject {
  const strips: JsonObject = {};
  const buses: JsonObject = {};
  const processors: JsonObject = {};
  FIXTURES.forEach((f, i) => {
    strips[f.id] = { track: i, src: { asset: assets[f.signal]! }, start: f.at * SAMPLE, in: 0, bus: `bus_${f.id}` };
    buses[`bus_${f.id}`] = { processors: [`p_${f.id}`], gain: BUS_GAIN_DB, out: 'master' };
    processors[`p_${f.id}`] = f.processor;
  });
  return { transport: { sample_rate: RATE, span: SPAN }, strips, buses, processors };
}

// ---- The laws, in f64
const curves: Record<string, (u: number) => number> = {
  tanh: Math.tanh,
  soft_clip: (u) => (Math.abs(u) <= 1 ? 1.5 * u - 0.5 * u * u * u : Math.sign(u)),
  fold: (u) => { let v = u; while (v > 1 || v < -1) v = v > 1 ? 2 - v : -2 - v; return v; },
};
const quantize = (x: number, bits: number): number => { const q = 2 ** (1 - bits); return Math.sign(x) * Math.floor(Math.abs(x) / q + 0.5) * q; };

/** Each fixture judged on the played PCM; each failure names the fixture, the channel and the sample. */
function judge(p: Pcm, sig: Record<string, Float32Array[]>): { failures: string[]; worst: Record<string, number>; wow: Record<string, number[]> } {
  const failures: string[] = [];
  const worst: Record<string, number> = {};
  const wow: Record<string, number[]> = {};
  const hold = (id: string, c: number, n: number, got: number, want: number) => {
    const e = Math.abs(got - want);
    worst[id] = Math.max(worst[id] ?? 0, e);
    if (e > LIMIT && failures.filter((f) => f.startsWith(`${id} `)).length < 3) failures.push(`${id} channel ${c} sample ${n}: ${got} against the f64 reference ${want} (off by ${e.toExponential(2)}, over −120 dBFS)`);
  };
  for (const f of FIXTURES) {
    const x = sig[f.signal]!;
    if (f.processor['kind'] === 'shaper') {
      const g = 10 ** (Number(f.processor['drive']) / 20);
      const mix = Number(f.processor['mix']);
      const c = curves[String(f.processor['curve'])]!;
      LEVELS.forEach((_, k) => {
        for (let i = k * HOLD + 512; i < (k + 1) * HOLD - 512; i++) for (let ch = 0; ch < 2; ch++) {
          const v = x[ch]![i]!;
          hold(f.id, ch, f.at + i, at(p, ch, f.at + i), BUS * ((1 - mix) * v + mix * c(g * v)));
        }
      });
    } else if (f.processor['kind'] === 'crush') {
      const bits = Number(f.processor['bits']);
      const mix = Number(f.processor['mix']);
      const period = Number(f.processor['hold_hz']) > 0 ? RATE / Number(f.processor['hold_hz']) : 1;
      for (let i = 0; i < x[0]!.length; i++) for (let ch = 0; ch < 2; ch++) {
        const held = quantize(x[ch]![Math.floor(i / period) * period]!, bits);
        hold(f.id, ch, f.at + i, at(p, ch, f.at + i), BUS * ((1 - mix) * x[ch]![i]! + mix * held));
      }
    } else {
      // modulate: D(n) read from the line, fitted to c0 + two sinusoids at wow_hz and flutter_hz.
      const from = Math.round(0.25 * RATE);
      const to = from + 2 * RATE;
      const omegas = [Number(f.processor['wow_hz']), Number(f.processor['flutter_hz'])].map((hz) => (2 * Math.PI * hz) / RATE);
      const basis = (n: number): number[] => [1, ...omegas.flatMap((w) => [Math.sin(w * n), Math.cos(w * n)])];
      for (let ch = 0; ch < 2; ch++) {
        const [b0, span] = ch === 0 ? RAMP.l : RAMP.r;
        const a = span / RAMP.n;
        const delays: number[] = [];
        for (let i = from; i < to; i++) delays.push(i - (at(p, ch, f.at + i) / BUS - b0) / a);
        const coef = leastSquares(Array.from({ length: to - from }, (_, k) => basis(f.at + from + k)), delays);
        wow[`${f.id}/${ch}`] = coef;
        for (let i = from; i < to; i++) {
          const d = basis(f.at + i).reduce((s, v, k) => s + v * coef[k]!, 0);
          hold(f.id, ch, f.at + i, at(p, ch, f.at + i), BUS * (b0 + a * (i - d)));
        }
        omegas.forEach((w, k) => {
          const amp = Math.hypot(coef[1 + 2 * k]!, coef[2 + 2 * k]!);
          const cents = 1200 * Math.log2(1 + w * amp);
          if (!(cents > 0.1)) failures.push(`${f.id} channel ${ch}: its ${k === 0 ? 'wow' : 'flutter'} moves the pitch ${cents.toFixed(4)} cents, so the curve isn't there`);
        });
      }
    }
  }
  return { failures, worst, wow };
}
/** Least squares by the normal equations (Gaussian elimination with partial pivoting). */
function leastSquares(rows: number[][], y: number[]): number[] {
  const k = rows[0]!.length;
  const m = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  rows.forEach((r, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) m[a]![b]! += r[a]! * r[b]!; m[a]![k]! += r[a]! * y[i]!; } });
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const q = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= q * m[c]![j]!;
    }
  }
  return m.map((row, i) => row[k]! / row[i]!);
}

describe(`${AC[5]} shaper, crush and modulate against f64 references, and seeking into each equals playing`, () => {
  it(`${AC[5]} three shaper curves, two crushes and a modulate each match their f64 reference within −120 dBFS, and seeks into each equal playing`, () => {
    const evidence = tempDir();
    // Float32Array: the references read exactly the f32 samples the float WAVs hold.
    const sig = { stair: stair(), sines: sines(), ramp: ramp() };
    const assets = { stair: putSignal(evidence, sig.stair), sines: putSignal(evidence, sig.sines), ramp: putSignal(evidence, sig.ramp) };
    const seeks = [secs(0.3), secs(3.2), secs(4.1003), secs(6.37)];
    const asks: SegmentAsk[] = [{ from: 0, to: SPAN, write: true }, ...seeks.map((t) => ({ from: t, to: t + secs(0.25), write: true }))];
    const [reply] = runShow(bin(), scenario(evidence, [mixCall(doc(assets), asks)]), 'the processors\' fixtures, played then sought into');
    const m = mixOf(reply, asks, 'the processors\' fixtures');
    const played = pcmOf(evidence, m.segments[0]!, 'the fixtures, played');
    const judged = judge(played, sig);
    const seekFailures: string[] = [];
    seeks.forEach((t, i) => {
      const sought = pcmOf(evidence, m.segments[1 + i]!, `the seek to sample ${sampleAt(t)}`);
      const d = firstDiff(played, sought);
      if (d !== null) seekFailures.push(`the seek to sample ${sampleAt(t)} differs from playing at sample ${d}`);
    });
    proof('ac5-processors.json', { worst: judged.worst, modulate_fit: judged.wow, failures: judged.failures, seeks: seekFailures });
    expect(judged.failures, `each processor against its f64 reference: ${judged.failures.slice(0, 9).join(' | ')}`).toEqual([]);
    expect(seekFailures, `seeking equals playing: ${seekFailures.join(' | ')}`).toEqual([]);
  }, TIMEOUT);
});
