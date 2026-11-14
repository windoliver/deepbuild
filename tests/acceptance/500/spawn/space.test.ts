// AC7: "In a 3D document, a spawn with `at: point` gives a hit at a point 2 m left of and 2 m ahead of the camera the
// pan the Emitter's equal-power law gives that direction within 1e-6, and with `distance: none` keeps the spawn's gain;
// a planted spawn that pans from its item's origin instead of the occurrence's point fails, naming the occurrence"
//
// Through `media_mix` (README: The surface under test). The camera sits at the origin looking down −z, so "2 m left and
// 2 m ahead" is (−2, 0, −2), azimuth −45°. One spawn, `knock` (`at: point`, `distance: none`, no gain of its own, so its
// gain is 0 dB), plays a mono 1 kHz tone for each of two hits of a baked list: occurrence 0 at (2, 0, −2), where the
// items showing its bodies 7 and 9 stand (the control: there point and origin agree), and occurrence 1 at (−2, 0, −2),
// while its bodies' items stand at (2, 0, −2) and (0, 0, −3). Each voice's left and right gains are fitted on the
// rendered samples against the tone (least squares, over 0.3 s inside the voice) and held to the W3C equal-power pan of
// a mono source in the hit's direction (helpers.ts `equalPower`) within 1e-6 each; their power sum is the spawn's
// gain, 1, within 1e-6.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, TIMEOUT, asset, atSample, equalPower, fit, mix, pcmOf, secs, tone, useEvidence, useShow,
  type MediaDoc, type Pcm, type Planted, type Row,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const LIST = 'lab.occurrences';
const CAMERA = { position: [0, 0, 0] as [number, number, number], forward: [0, 0, -1] as [number, number, number] };
const STARTS = [24_000, 72_000]; // 0.5 s and 1.5 s
const POINTS: [number, number, number][] = [[2, 0, -2], [-2, 0, -2]];
const LEN = RATE / 2;

function world(evidence: string): { doc: MediaDoc; x: Float32Array } {
  const { sha, samples } = asset(evidence, [tone(1000, LEN, 0.25)]);
  const rows: Row[] = [
    { t: atSample(STARTS[0]!), kind: 'hit', a: 7, b: 9, point: POINTS[0]!, speed: 2, impulse: 0.5, tags: ['wood'] },
    { t: atSample(STARTS[1]!), kind: 'hit', a: 7, b: 8, point: POINTS[1]!, speed: 2, impulse: 0.5, tags: ['wood'] },
  ];
  const doc: MediaDoc = {
    transport: { sample_rate: RATE, span: secs(2.5) },
    occurrences: { [LIST]: rows },
    spawns: { knock: { on: { list: LIST, kinds: ['hit'] }, play: { asset: sha, in: 0, out: atSample(LEN) }, at: 'point', distance: 'none' } },
    scene: {
      camera: CAMERA,
      items: { plank: { position: [2, 0, -2], body: 7 }, peg: { position: [2, 0, -2], body: 9 }, floor: { position: [0, 0, -3], body: 8 } },
    },
  };
  return { doc, x: samples[0]! };
}

/** Each occurrence's fitted pan against the equal-power law for its point, each line naming the occurrence. */
function judge(p: Pcm, x: Float32Array): string[] {
  const f: string[] = [];
  STARTS.forEach((s, k) => {
    const want = equalPower(CAMERA, POINTS[k]!);
    const g = [0, 1].map((c) => fit(p, c, s + 4800, s + 19_200, (n) => x[n - s]!));
    const got = g.map((q) => q.k);
    if (g.some((q) => q.residual > 1e-4)) f.push(`occurrence ${k}: its voice is not the tone from its hit's sample ${s} (relative residuals ${g.map((q) => q.residual.toExponential(3)).join(', ')})`);
    else if (got.some((v, c) => Math.abs(v - want[c]!) > 1e-6)) f.push(`occurrence ${k} at (${POINTS[k]!.join(', ')}): pans [${got.map((v) => v.toFixed(7)).join(', ')}], not the equal-power law's [${want.map((v) => v.toFixed(7)).join(', ')}] within 1e-6`);
    else if (Math.abs(got[0]! ** 2 + got[1]! ** 2 - 1) > 1e-6) f.push(`occurrence ${k}: its gain is ${Math.sqrt(got[0]! ** 2 + got[1]! ** 2).toFixed(7)}, not the spawn's 1 (distance: none) within 1e-6`);
  });
  return f;
}

describe('AC7 a spawn in 3D is heard from its occurrence\'s point', () => {
  it(`${AC[7]} with at: point and distance: none, a hit 2 m left of and 2 m ahead of the camera pans by the equal-power law for azimuth −45° within 1e-6 and keeps the spawn's gain, as does a hit at (2, 0, −2); a planted spawn that pans from its item's origin fails, naming occurrence 1`, () => {
    // The law's values for these two directions (checked here, so a wrong value in this file fails, not the program).
    const [l, r] = [Math.cos(Math.PI / 8), Math.sin(Math.PI / 8)];
    expect(equalPower(CAMERA, POINTS[1]!).map((v, i) => Math.abs(v - [l, r][i]!) < 1e-12), 'azimuth −45° pans [cos π/8, sin π/8]').toEqual([true, true]);
    expect(equalPower(CAMERA, POINTS[0]!).map((v, i) => Math.abs(v - [r, l][i]!) < 1e-12), 'azimuth +45° pans [sin π/8, cos π/8]').toEqual([true, true]);

    const evidence = evidenceDir();
    const { doc, x } = world(evidence);
    const m = mix(show(), evidence, doc, [{ from: 0, to: doc.transport.span, write: true }], 'two hits heard from their points');
    expect(judge(pcmOf(evidence, m.segments[0]!, 'the mix'), x), 'each voice pans from its occurrence\'s point and keeps the spawn\'s gain').toEqual([]);

    // Wrong program: each voice panned from the origin of the item that shows its body, not from the hit's point.
    const planted: Planted = 'spawn_pans_from_item_origin';
    const other = evidenceDir();
    const w = world(other);
    const pm = mix(show(), other, w.doc, [{ from: 0, to: w.doc.transport.span, write: true }], 'two hits heard from their points', planted);
    const wrong = judge(pcmOf(other, pm.segments[0]!, `the mix (planted ${planted})`), w.x);
    expect(wrong.length > 0 && wrong.every((line) => line.startsWith('occurrence 1')), `planted ${planted} fails, naming occurrence 1 only (occurrence 0's point is its items' origin); got ${JSON.stringify(wrong)}`).toBe(true);
  }, TIMEOUT);
});
