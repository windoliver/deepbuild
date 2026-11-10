// AC6: "20 hits of one pair within 30 ms play one voice, while a hit of another pair in that window plays its own;
// with max_voices 8 and steal oldest, a ninth voice stops the earliest-started one, the same whether the film is played
// or seeked; a planted spawn that ignores cooldown plays 20 voices and fails, naming the pair"
//
// Through `media_mix` (README: The surface under test). A 2D document with one spawn, `knock` (cooldown 30 ms,
// max_voices 8, steal oldest), playing a 3 s stereo noise burst for each hit of one baked list: 20 hits of pair (1, 2)
// 1.5 ms apart from 0.5 s (28.5 ms in all), a hit of pair (3, 4) 10 ms in, and from 4 s nine hits of nine other pairs
// 100 ms apart. The voices are read twice: from the reply's `voices`, and from the samples, which must be exactly the
// sum of the voices the criterion leaves sounding (fitted with one gain per channel, since a stereo strip's pan law is
// #499's, not this criterion's): over [0.6 s, 1 s) the two first voices, over [4.9 s, 5 s) the last eight of the nine.
// "The same whether played or seeked": four 50 ms windows, over the burst, the ninth start and after it, played straight
// through and then seeked to, hash alike, and the seeking run starts the same voices.
import { describe, expect, it } from 'vitest';
import {
  AC, MS, RATE, SAMPLE, TIMEOUT, asset, atSample, fit, mix, noise, pcmOf, playThenSeek, sOf, secs, seeded, useEvidence,
  useShow, type MediaDoc, type Mix, type Pcm, type Planted, type Row, type Voice,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const LIST = 'lab.occurrences';
const BURST = 24_000; // 0.5 s
const STEAL = 192_000; // 4 s
const LEN = 3 * RATE;

function rows(): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < 20; k++) out.push({ t: atSample(BURST + 72 * k), kind: 'hit', a: 1, b: 2 });
  out.push({ t: atSample(BURST + 480), kind: 'hit', a: 3, b: 4 });
  for (let i = 0; i < 9; i++) out.push({ t: atSample(STEAL + 4800 * i), kind: 'hit', a: 10 + i, b: 30 + i });
  return out.sort((p, q) => p.t - q.t || p.a - q.a);
}

function world(evidence: string): { doc: MediaDoc; x: Float32Array[] } {
  const { sha, samples } = asset(evidence, [noise(LEN, 0.02, 61), noise(LEN, 0.02, 62)]);
  const doc: MediaDoc = {
    transport: { sample_rate: RATE, span: secs(8) },
    occurrences: { [LIST]: rows() },
    spawns: { knock: { on: { list: LIST, kinds: ['hit'] }, play: { asset: sha, in: 0, out: atSample(LEN) }, cooldown: 30 * MS, max_voices: 8, steal: 'oldest' } },
  };
  return { doc, x: samples };
}

const pairOf = (v: Voice): string => `pair (${v.pair[0]}, ${v.pair[1]})`;

/** What is wrong with the voices and the samples, each line naming its pair. */
function judge(m: Mix, p: Pcm | null, x: Float32Array[]): string[] {
  const f: string[] = [];
  const byPair = (a: number, b: number): Voice[] => m.voices.filter((v) => v.pair[0] === a && v.pair[1] === b);
  const one = (a: number, b: number, start: number, why: string): void => {
    const vs = byPair(a, b);
    if (vs.length !== 1) f.push(`pair (${a}, ${b}) plays ${vs.length} voices, not 1 (${why})`);
    else if (vs[0]!.start !== atSample(start)) f.push(`pair (${a}, ${b})'s voice starts at ${sOf(vs[0]!.start)}, not at its hit's ${sOf(atSample(start))}`);
  };
  one(1, 2, BURST, 'its 20 hits fall within 30 ms');
  one(3, 4, BURST + 480, 'another pair, inside that window');

  const nine = Array.from({ length: 9 }, (_, i) => byPair(10 + i, 30 + i));
  nine.forEach((vs, i) => { if (vs.length !== 1) f.push(`pair (${10 + i}, ${30 + i}) plays ${vs.length} voices, not 1`); });
  if (nine.every((vs) => vs.length === 1)) {
    const v = nine.map((vs) => vs[0]!);
    const ninth = m.voices.indexOf(v[8]!);
    v.forEach((w, i) => { if (w.start !== atSample(STEAL + 4800 * i)) f.push(`${pairOf(w)}'s voice starts at ${sOf(w.start)}, not at its hit's ${sOf(atSample(STEAL + 4800 * i))}`); });
    if (v[0]!.stolen_by !== ninth) f.push(`${pairOf(v[0]!)}, the earliest-started of nine voices over max_voices 8, is stolen by ${JSON.stringify(v[0]!.stolen_by)}, not by the ninth voice (voices[${ninth}], ${pairOf(v[8]!)})`);
    else if (!(v[0]!.end >= v[8]!.start && v[0]!.end <= v[8]!.start + 50 * MS)) f.push(`${pairOf(v[0]!)}'s stolen voice ends at ${sOf(v[0]!.end)}, not within 50 ms of the ninth's start ${sOf(v[8]!.start)}`);
    v.slice(1).forEach((w) => {
      if (w.stolen_by !== null) f.push(`${pairOf(w)}'s voice is stolen by voices[${w.stolen_by}], though it is not the earliest-started`);
      else if (w.end !== w.start + atSample(LEN)) f.push(`${pairOf(w)}'s voice ends at ${sOf(w.end)}, not at its template's end ${sOf(w.start + atSample(LEN))}`);
    });
  }
  if (p === null) return f;

  // The samples: exactly the voices that sound, each its template from its start, one gain per channel.
  const sum = (starts: number[], c: number) => (n: number): number => starts.reduce((s, at) => s + (n >= at && n - at < LEN ? x[c]![n - at]! : 0), 0);
  const heard = (from: number, to: number, starts: number[], what: string): void => {
    for (let c = 0; c < 2; c++) {
      const g = fit(p, c, from, to, sum(starts, c));
      if (!(g.k > 0.25 && g.k < 4 && g.residual <= 1e-4)) f.push(`${what}: channel ${c} over ${sOf(atSample(from))} to ${sOf(atSample(to))} is not those voices alone (gain ${g.k.toFixed(6)}, relative residual ${g.residual.toExponential(3)})`);
    }
  };
  heard(28_800, 48_000, [BURST, BURST + 480], 'pair (1, 2) and pair (3, 4), one voice each');
  heard(235_200, 240_000, Array.from({ length: 8 }, (_, i) => STEAL + 4800 * (i + 1)), 'the eight voices after the ninth stole pair (10, 30)\'s');
  return f;
}

describe('AC6 cooldown per pair, max_voices and steal oldest, played and seeked', () => {
  it(`${AC[6]} 20 hits of pair (1, 2) within 30 ms play one voice and pair (3, 4)'s hit plays its own; with max_voices 8 and steal oldest the ninth voice stops the earliest-started one, by the reply and by the samples; four windows played and then seeked hash alike; a planted spawn that ignores cooldown plays 20 voices and fails, naming pair (1, 2)`, () => {
    const evidence = evidenceDir();
    const { doc, x } = world(evidence);
    const span = doc.transport.span;
    const m = mix(show(), evidence, doc, [{ from: 0, to: span, write: true }], 'one spawn over a burst and nine pairs');
    const f = judge(m, pcmOf(evidence, m.segments[0]!, 'the whole mix'), x);

    // Played and seeked: windows over the burst, after it, across the ninth start (4.8 s) and after it, none on a block's
    // first sample, played straight through and then seeked to in a seeded order.
    const W = 2400;
    const windows: [number, number][] = [23_950, 47_000, 230_350, 235_237].map((n) => [n * SAMPLE, (n + W) * SAMPLE]);
    const { segments, played } = playThenSeek(windows, span, seeded(500_006));
    const s = mix(show(), evidence, doc, segments, 'the same spawn, played and then seeked');
    const heard = new Map(s.segments.slice(0, played).map((g) => [g.from, g.sha256]));
    for (const g of s.segments.slice(played)) if (g.sha256 !== heard.get(g.from)) f.push(`the seek to ${sOf(g.from)} renders other samples than playing, by hash`);
    const plan = (vs: Voice[]): string => JSON.stringify(vs.map((v) => [v.occurrence, v.start, v.end, v.stolen_by]));
    if (plan(s.voices) !== plan(m.voices)) f.push('the run that seeks starts or stops other voices than the run that plays straight through');
    expect(f, 'cooldown, max_voices and steal hold, played and seeked').toEqual([]);

    // Wrong program: a spawn that ignores cooldown, so every hit of pair (1, 2) starts a voice.
    const planted: Planted = 'spawn_ignores_cooldown';
    const other = evidenceDir();
    const w = judge(mix(show(), other, world(other).doc, [{ from: 0, to: span }], 'one spawn over a burst and nine pairs', planted), null, x);
    expect(w.some((l) => l.startsWith('pair (1, 2) plays 20 voices')), `planted ${planted} plays 20 voices and fails, naming pair (1, 2); got ${JSON.stringify(w)}`).toBe(true);
  }, TIMEOUT);
});
