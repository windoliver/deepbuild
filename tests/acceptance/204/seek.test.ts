// AC2 #204.a92b7fff: "Played straight from 0 to 10 s, seeked to 9 s then played to 10 s, and seeked to 9 s plus 37
// samples then played to 10 s, at 48 kHz and at 44.1 kHz, the PCM after each seek point is the same bit for bit on one
// build and architecture; a planted oscillator that keeps its phase in f32 fails this, naming the node and the first
// sample that differs, and so does a planted renderer whose block grid starts at the seek"
//
// Through `media_mix` (README: The surface under test). The seek fixture: one synth strip `motor` over [0, 10 s) playing
// `motors.motor@1`, a saw at 110 Hz and pink noise mixed, through a lowpass whose cutoff follows the channel `sweep`
// (keys at odd times, so the cutoff bends inside blocks), a feedback delay and a gain: oscillator phase, noise draws,
// filter, delay line and the block grid all carry state across the seek. For each rate (48 kHz, 44.1 kHz) and each
// seek point S (9 s, 9 s + 37 samples) one `media_mix` in one process plays [0, S), then [S, 10 s), then seeks back to
// S and plays [S, 10 s) again (#499's seek: in the same transport, after playing past it, so checkpoints exist). The two
// [S, 10 s) segments must hash alike at the master and at every node's tap (`taps["motor/<node>"]`); the seek must be
// reported as restoring a checkpoint at or before S and rendering at most 1 s forward. A failure names the first node,
// in signal order, whose output after the seek differs, and the first sample that differs at the master.
import { describe, expect, it } from 'vitest';
import {
  AC, SEC, TIMEOUT, biquad, channel, delay, failsNaming, firstDiff, gain, mediaDoc, mix, mixes, noise, none, osc, pcmOf, peak, presetOf, sOf, secs,
  synthStrip, useShow, useTemp, writePack, type MixReply, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** The seek fixture's preset; cost: osc 4 + pink 8 + gain 1 + mix 2 + biquad 5 + delay 3 + gain 1. */
const MOTOR: Preset = {
  nodes: {
    tone: osc('saw', 110), hiss: noise('pink'), hush: gain(0.2), blend: mix(),
    filter: biquad('lowpass', 'cutoff', 2), echo: delay(0.3, 0.4, 0.3), level: gain(0.2),
  },
  edges: [['tone', 'blend', 'in'], ['hiss', 'hush', 'in'], ['hush', 'blend', 'in'], ['blend', 'filter', 'in'], ['filter', 'echo', 'in'], ['echo', 'level', 'in']],
  out: 'level',
  params: { cutoff: { unit: 'Hz', range: [200, 4000], default: 1000 } },
  cost: 24,
};
/** The nodes in signal order, as a failure names the first that differs. */
const ORDER = ['tone', 'hiss', 'hush', 'blend', 'filter', 'echo', 'level'] as const;
const SWEEP = channel('items/gauge/params/box/2', [[0, 0], [secs(1.3), 0.9], [secs(2.9), -0.6], [secs(4.1), 0.4], [secs(5.77), -0.9], [secs(7.3), 0.7], [secs(8.61), -0.4], [secs(9.43), 0.95], [secs(10), 0]]);
const RATES = [48_000, 44_100] as const;
const seekPoints = (rate: number): { name: string; at: number }[] => [
  { name: '9 s', at: secs(9) },
  { name: '9 s + 37 samples', at: secs(9) + (37 * SEC) / rate },
];

interface Case { rate: number; name: string; at: number; m: MixReply; evidence: string }
function run(planted?: Planted): Case[] {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'motors', { motor: MOTOR });
  const asks = RATES.flatMap((rate) => seekPoints(rate).map((s) => ({
    rate, name: s.name, at: s.at,
    doc: mediaDoc({ rate, span: secs(10), packs: [pack], channels: { sweep: SWEEP }, strips: { motor: synthStrip(0, { preset: presetOf(pack, 'motor'), params: { cutoff: '1000 + 800 * sweep' } }, 0, secs(10)) } }),
    segments: [{ from: 0, to: s.at }, { from: s.at, to: secs(10), write: true }, { from: s.at, to: secs(10), write: true }],
  })));
  const ms = mixes(bin(), evidence, [pack], asks, 'the seek fixture, played to 10 s and seeked back', planted);
  return asks.map((a, i) => ({ rate: a.rate, name: a.name, at: a.at, m: ms[i]!, evidence }));
}

/** What is wrong with one seek against the play it repeats; each line names the case, and a differing output names the
 * first node in signal order that differs and the first sample at the master. */
function problems(c: Case): string[] {
  const label = `at ${c.rate} Hz, the seek to ${c.name}`;
  const f: string[] = [];
  const [, played, sought] = c.m.segments;
  const p = pcmOf(c.evidence, played!, c.rate, `${label}: playing on from ${c.name}`);
  const s = pcmOf(c.evidence, sought!, c.rate, `${label}: the seek`);
  if (!(peak(p, p.first, p.first + p.frames) > 0.01)) f.push(`${label}: the motor is silent after ${c.name}, so equality proves nothing`);
  if (played!.seek !== null) f.push(`${label}: playing on from ${c.name} is reported as a seek`);
  const r = sought!.seek?.['motor'];
  if (!r) f.push(`${label}: the seek reports nothing for the synth strip \`motor\` (seek.motor missing): ${JSON.stringify(sought!.seek)}`);
  else {
    if (r.restored === null) f.push(`${label}: the synth restored no checkpoint and rendered from ${r.rendered_from / SEC} s`);
    else if (r.restored > c.at) f.push(`${label}: the synth restored a checkpoint at ${r.restored / SEC} s, after the seek`);
    if (c.at - r.rendered_from > SEC) f.push(`${label}: the synth rendered ${(c.at - r.rendered_from) / SEC} s forward, more than a second`);
  }
  const node = ORDER.find((n) => played!.taps[`motor/${n}`] === undefined || sought!.taps[`motor/${n}`] === undefined || played!.taps[`motor/${n}`] !== sought!.taps[`motor/${n}`]);
  const d = firstDiff(p, s);
  if (node !== undefined && (played!.taps[`motor/${node}`] === undefined || sought!.taps[`motor/${node}`] === undefined)) f.push(`${label}: no output hash for the node \`${node}\` (taps["motor/${node}"]) on the play or the seek`);
  else if (node !== undefined) f.push(`${label}: node \`${node}\` is the first whose output after the seek differs from playing; the PCM first differs at ${d === null ? 'no sample' : `sample ${d}, ${sOf(d, c.rate)}`}`);
  if (played!.sha256 !== sought!.sha256 || d !== null) f.push(`${label}: the PCM after the seek differs from playing (${sought!.sha256} vs ${played!.sha256}), first at ${d === null ? 'no sample' : `sample ${d}`}`);
  return f;
}

describe(`${AC[2]} seeking equals playing, bit for bit, at 48 kHz and 44.1 kHz`, () => {
  it(`${AC[2]} the seek fixture played straight to 10 s, then seeked to 9 s and to 9 s + 37 samples and played to 10 s, at 48 kHz and at 44.1 kHz, gives the same PCM after each seek point, at the master and at every node`, () => {
    none(run().flatMap(problems), 'the PCM after each seek point equals playing\'s');
  }, TIMEOUT);

  it(`${AC[2]} a planted oscillator that keeps its phase in f32 fails, naming the node \`tone\` and the first sample that differs`, () => {
    failsNaming(run('osc_phase_f32').flatMap(problems), /node `tone` is the first .* first differs at sample \d+/, 'planted osc_phase_f32');
  }, TIMEOUT);

  it(`${AC[2]} a planted renderer whose block grid starts at the seek fails, naming the node \`filter\`, whose cutoff ramps per block, and the first sample that differs`, () => {
    const f = run('synth_grid_from_seek').flatMap(problems);
    failsNaming(f, /node `filter` is the first .* first differs at sample \d+/, 'planted synth_grid_from_seek');
    expect(f.some((x) => /node `(tone|hiss|hush|blend)`/.test(x)), `planted synth_grid_from_seek: the nodes before the filter, which no param moves, still equal playing; got ${JSON.stringify(f.slice(0, 6))}`).toBe(false);
  }, TIMEOUT);
});
