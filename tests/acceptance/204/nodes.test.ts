// AC15 #204.a523543e: "The shaper node at its defaults and the crush node at 8 bits each match an f64 reference within
// −120 dBFS on a fixture, and seeking equals playing on one build and architecture; a planted crush that quantizes to 7
// bits fails, naming the node"
//
// Through `media_mix` (README: The surface under test), against the laws the Synth row's As built paragraph writes out:
//
// - `nodes.shaped@1`: a 220 Hz sine (sin 2πp, p advancing 220 ÷ 48,000 a sample from 0) times 0.25 into a shaper at
//   its defaults (tanh, drive 6 dB, mix 1): tanh(10^(6 ÷ 20) × u), unnormalized.
// - `nodes.crushed@1`: a triangle at 46.875 Hz (p advances 2^−10 a sample, exactly; 1 − 4|p′ − ½| with p′ = p + ¼
//   mod 1, so it starts at 0 rising) into a crush at 8 bits (hold off, mix 1): the nearest multiple of q = 2^−7, halves
//   rounded away from 0; then times 0.25. Every triangle sample is a multiple of 2^−8, so half of them sit exactly
//   between two steps and the rounding rule decides them.
//
// Each strip plays 1 s; over its second (less its last 20 ms, the span's fade), each channel is fitted to the f64
// reference with one gain (the mix's pan law), and the residual, at the node's own output scale, must be at most 10^−6
// (−120 dBFS) on every sample. Seeking: one transport plays into each strip, seeks back and plays the same span again;
// the master and both nodes' taps hash alike. The planted `crush_7_bits` quantizes to 2^−6: the failure names `crush`.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, SEC, TIMEOUT, gain, mediaDoc, mixes, none, osc, pcmOf, presetOf, sampleAt, secs, synthStrip, useShow, useTemp, writePack, type MixReply,
  type PackFixture, type Pcm, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Cost: osc 4 + gain 1 + shaper 10. */
const SHAPED: Preset = {
  nodes: { tone: osc('sine', 220), pre: gain(0.25), shaper: { kind: 'shaper' } },
  edges: [['tone', 'pre', 'in'], ['pre', 'shaper', 'in']], out: 'shaper', params: {}, cost: 15,
};
/** Cost: osc 4 + crush 2 + gain 1. */
const CRUSHED: Preset = {
  nodes: { tri: osc('triangle', 46.875), crush: { kind: 'crush', bits: 8, hold_hz: 0, mix: 1 }, post: gain(0.25) },
  edges: [['tri', 'crush', 'in'], ['crush', 'post', 'in']], out: 'post', params: {}, cost: 7,
};
const SHAPED_AT = secs(0.25);
const CRUSHED_AT = secs(1.5);
const END = secs(3);

/** The shaper's reference at voice sample n. */
function shaperRef(n: number): number {
  const p = (n * 220) / RATE;
  const u = 10 ** (6 / 20) * 0.25 * Math.sin(2 * Math.PI * (p - Math.floor(p)));
  return Math.tanh(u);
}
/** The crush's reference at voice sample n (before the 0.25 after it). */
function crushRef(n: number): number {
  const p = ((n % 1024) + 1024) % 1024 / 1024;
  const q = (p + 0.25) % 1;
  const x = 1 - 4 * Math.abs(q - 0.5);
  const step = 2 ** -7;
  return Math.sign(x) * Math.floor(Math.abs(x) / step + 0.5) * step;
}

function doc(pack: PackFixture) {
  return mediaDoc({
    span: END, packs: [pack],
    strips: {
      shaped: synthStrip(0, { preset: presetOf(pack, 'shaped') }, SHAPED_AT, SEC),
      crushed: synthStrip(1, { preset: presetOf(pack, 'crushed') }, CRUSHED_AT, SEC),
    },
  });
}

/** The worst residual of a strip's node over its second, at the node's output scale. */
function residual(p: Pcm, start: number, ref: (n: number) => number, scale: number): number {
  const a = sampleAt(start);
  const len = RATE - RATE / 50;
  let worst = 0;
  for (const c of p.channels) {
    let yr = 0, rr = 0;
    for (let n = 0; n < len; n++) { const r = scale * ref(n); yr += c[a + n]! * r; rr += r * r; }
    const g = yr / rr;
    if (!(g > 0.5)) return Infinity;
    for (let n = 0; n < len; n++) worst = Math.max(worst, Math.abs(c[a + n]! / g - scale * ref(n)) / scale);
  }
  return worst;
}

function run(planted?: Planted): { straight: MixReply; sought: MixReply; evidence: string } {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'nodes', { shaped: SHAPED, crushed: CRUSHED });
  const [straight, sought] = mixes(bin(), evidence, [pack], [
    { doc: doc(pack), segments: [{ from: 0, to: END, write: true }] },
    { doc: doc(pack), segments: [
      { from: 0, to: secs(0.7) }, { from: secs(0.7), to: secs(1.1), write: true }, { from: secs(0.7), to: secs(1.1), write: true },
      { from: secs(1.1), to: secs(2.05) }, { from: secs(2.05), to: secs(2.4), write: true }, { from: secs(2.05), to: secs(2.4), write: true },
    ] },
  ], 'the shaper and the crush, played straight and seeked', planted);
  return { straight: straight!, sought: sought!, evidence };
}

/** Each node's reference check; a failure names the node. */
function referenceProblems(r: { straight: MixReply; evidence: string }): string[] {
  const p = pcmOf(r.evidence, r.straight.segments[0]!, RATE, 'the straight play');
  const f: string[] = [];
  const s = residual(p, SHAPED_AT, shaperRef, 1);
  if (!(s <= 1e-6)) f.push(`node \`shaper\`: its output differs from tanh(10^(6/20) × u) by ${s.toExponential(3)} at its worst sample, over −120 dBFS`);
  const c = residual(p, CRUSHED_AT, crushRef, 0.25);
  if (!(c <= 1e-6)) f.push(`node \`crush\`: its output differs from the 8-bit mid-tread quantizer by ${c.toExponential(3)} at its worst sample, over −120 dBFS`);
  return f;
}
function seekProblems(r: { sought: MixReply; evidence: string }): string[] {
  const f: string[] = [];
  for (const [played, seek, node] of [[1, 2, 'shaped/shaper'], [4, 5, 'crushed/crush']] as const) {
    const a = r.sought.segments[played]!;
    const b = r.sought.segments[seek]!;
    if (b.seek === null) f.push(`the seek to ${a.from / SEC} s isn't reported as a seek`);
    if (a.sha256 !== b.sha256) f.push(`the seek to ${a.from / SEC} s renders other samples than playing (${b.sha256} vs ${a.sha256})`);
    if (a.taps[node] === undefined || a.taps[node] !== b.taps[node]) f.push(`node \`${node.split('/')[1]}\`: after the seek to ${a.from / SEC} s its output differs from playing's (taps["${node}"])`);
  }
  return f;
}

describe(`${AC[15]} the shaper at its defaults and the crush at 8 bits match their f64 references, and seek as they play`, () => {
  it(`${AC[15]} the shaper at its defaults and the crush at 8 bits each match an f64 reference within −120 dBFS, and seeking into each equals playing; a planted crush that quantizes to 7 bits fails, naming the node \`crush\``, () => {
    const clean = run();
    none([...referenceProblems(clean), ...seekProblems(clean)], 'the shaper and the crush against their references and their seeks');

    // Wrong program: the crush quantizes to 7 bits.
    const w = referenceProblems(run('crush_7_bits'));
    expect(w.map((x) => /^node `(\w+)`/.exec(x)?.[1]), 'planted crush_7_bits fails, naming the node `crush` and no other').toEqual(['crush']);
  }, TIMEOUT);
});
