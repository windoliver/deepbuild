// AC9 #204.33127906: "With the engine fixture's checkpoint budget forced to 20 checkpoints' bytes, after 60 s of play
// its ring is within that budget with checkpoints 4 s apart, and seeks to 30.5 s and 59.9 s each render at most 4 s
// forward and match playing bit for bit; a planted ring that drops its oldest checkpoint instead renders the seek to
// 30.5 s from the start and fails, naming the seek"
//
// Through `media_mix` (README: The surface under test): the engine fixture played for 60 s, its synth strip `engine`'s
// `byte_budget` set to 20 of its own checkpoints' bytes (one checkpoint's bytes read from the same synth's ring on a
// short play). A ring that checkpoints every second and doubles its spacing whenever the next would pass its budget
// holds 0 … 19 s at 20 s, then every 2 s, and from 40 s every 4 s. One transport plays [0, 30.5 s), [30.5, 31.5 s),
// [31.5, 59.9 s) and [59.9, 60 s), then seeks back to 30.5 s and plays [30.5, 31.5 s), then seeks to 59.9 s and plays
// [59.9, 60 s): the ring (`mix.synths.engine.ring`) must hold at most the budget with checkpoints 4 s apart, each seek
// (`seek.engine`) must restore one of them at or before its time and render at most 4 s forward, and the two seeks'
// samples must equal playing's, at the master and at the engine's nodes. The planted `synth_ring_drops_oldest` keeps
// only the last 20 seconds, so the seek to 30.5 s finds no checkpoint and renders from 0: its failure names that seek.
import { describe, expect, it } from 'vitest';
import {
  AC, ENGINE, SEC, TIMEOUT, engineFilm, failsNaming, firstDiff, mixes, none, pcmOf, RATE, ringOf, secs, synthOf, useShow, useTemp, writePack,
  type MixReply, type Planted,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

const SPACING = 4 * SEC;
const SEGMENTS = [
  { from: 0, to: secs(30.5) },
  { from: secs(30.5), to: secs(31.5), write: true },
  { from: secs(31.5), to: secs(59.9) },
  { from: secs(59.9), to: secs(60), write: true },
  { from: secs(30.5), to: secs(31.5), write: true },
  { from: secs(59.9), to: secs(60), write: true },
];

/** One checkpoint's bytes, from the engine's own ring on a short play. */
function oneCheckpoint(): number {
  const root = temp();
  const pack = writePack(root, 'engines', { engine: ENGINE });
  const [m] = mixes(bin(), temp(), [pack], [{ doc: engineFilm(pack, { seconds: 6 }), segments: [{ from: 0, to: secs(5) }] }], 'a short play, for one checkpoint\'s bytes');
  const ring = ringOf(synthOf(m!, 'engine', 'the short play'), 'mix.synths.engine');
  expect(ring.checkpoints.length, `the engine checkpoints every second on a short play: ${JSON.stringify(ring)}`).toBeGreaterThanOrEqual(4);
  const one = Math.max(...ring.checkpoints.map((c) => c.bytes));
  expect(one > 0, 'a synth checkpoint holds its nodes\' state, so it has bytes').toBe(true);
  return one;
}

function play(budget: number, planted?: Planted): { m: MixReply; evidence: string } {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'engines', { engine: ENGINE });
  const [m] = mixes(bin(), evidence, [pack], [{ doc: engineFilm(pack, { seconds: 60, byteBudget: budget }), segments: SEGMENTS }], '60 s of the engine on a forced budget, then two seeks', planted);
  return { m: m!, evidence };
}

/** What is wrong with the seek in segment `seek` against the play in segment `played`; each line names the seek. */
function seekProblems(r: { m: MixReply; evidence: string }, played: number, seek: number, times: number[]): string[] {
  const p = r.m.segments[played]!;
  const s = r.m.segments[seek]!;
  const label = `the seek to ${s.from / SEC} s`;
  const f: string[] = [];
  const e = s.seek?.['engine'];
  if (!e) return [`${label}: it reports nothing for the synth strip \`engine\` (seek.engine missing): ${JSON.stringify(s.seek)}`];
  if (e.restored === null) f.push(`${label}: it restored no checkpoint and rendered from ${e.rendered_from / SEC} s, ${(s.from - e.rendered_from) / SEC} s forward`);
  else {
    if (!times.includes(e.restored)) f.push(`${label}: it restored a checkpoint at ${e.restored / SEC} s that the ring doesn't hold (${JSON.stringify(times.map((t) => t / SEC))})`);
    if (e.restored > s.from) f.push(`${label}: it restored a checkpoint at ${e.restored / SEC} s, after the seek`);
  }
  if (s.from - e.rendered_from > SPACING) f.push(`${label}: it rendered ${(s.from - e.rendered_from) / SEC} s forward (from ${e.rendered_from / SEC} s), more than 4 s`);
  for (const n of ['tone', 'level']) if (p.taps[`engine/${n}`] === undefined || p.taps[`engine/${n}`] !== s.taps[`engine/${n}`]) f.push(`${label}: the node \`${n}\` renders other samples than playing (taps["engine/${n}"])`);
  const d = firstDiff(pcmOf(r.evidence, p, RATE, `playing from ${s.from / SEC} s`), pcmOf(r.evidence, s, RATE, label));
  if (p.sha256 !== s.sha256 || d !== null) f.push(`${label}: its samples differ from playing's, first at ${d === null ? 'no sample' : `sample ${d}`}`);
  return f;
}

describe(`${AC[9]} on a forced budget the engine's ring doubles its spacing to 4 s, and seeks from it equal playing`, () => {
  it(`${AC[9]} with its budget at 20 checkpoints' bytes, after 60 s the engine's ring is within it, 4 s apart; seeks to 30.5 s and 59.9 s render at most 4 s forward and equal playing; a planted ring that drops its oldest checkpoint renders the seek to 30.5 s from the start and fails, naming the seek`, () => {
    const one = oneCheckpoint();
    const budget = 20 * one;
    const r = play(budget);
    const ring = ringOf(synthOf(r.m, 'engine', 'the 60 s play'), 'mix.synths.engine');
    const f: string[] = [];
    if (ring.budget !== budget) f.push(`the engine's ring's budget is ${ring.budget} bytes, not the forced ${budget} (20 checkpoints of ${one})`);
    if (ring.peak_bytes > budget || ring.bytes > budget) f.push(`the engine's ring reached ${ring.peak_bytes} bytes and holds ${ring.bytes}, over its budget of ${budget}`);
    const held = ring.checkpoints.reduce((a, c) => a + c.bytes, 0);
    if (held > budget) f.push(`the engine's checkpoints add up to ${held} bytes, over its budget of ${budget}`);
    if (ring.spacing !== SPACING) f.push(`the engine's checkpoints are ${ring.spacing / SEC} s apart, not 4 s`);
    const times = ring.checkpoints.map((c) => c.t);
    const onGrid = times.length >= 14 && times.every((t, k) => t % SPACING === 0 && (k === 0 || t - times[k - 1]! === SPACING)) && times[0]! <= SPACING && times[times.length - 1]! >= 56 * SEC;
    if (!onGrid) f.push(`the engine's checkpoints are at ${JSON.stringify(times.map((t) => t / SEC))} s, not every 4 s to 56 s or 60 s`);
    f.push(...seekProblems(r, 1, 4, times), ...seekProblems(r, 3, 5, times));
    none(f, 'the ring within its budget, 4 s apart, and both seeks equal to playing');

    // Wrong program: past its budget the ring drops its oldest checkpoint instead of doubling its spacing.
    const w = play(budget, 'synth_ring_drops_oldest');
    const wt = ringOf(synthOf(w.m, 'engine', 'the planted play'), 'mix.synths.engine').checkpoints.map((c) => c.t);
    const ws = seekProblems(w, 1, 4, wt);
    expect(w.m.segments[4]!.seek?.['engine']?.rendered_from, `planted synth_ring_drops_oldest renders the seek to 30.5 s from the start (seek.engine: ${JSON.stringify(w.m.segments[4]!.seek?.['engine'])})`).toBe(0);
    failsNaming(ws, /^the seek to 30\.5 s: it rendered 30\.5 s forward/, 'planted synth_ring_drops_oldest');
  }, TIMEOUT);
});
