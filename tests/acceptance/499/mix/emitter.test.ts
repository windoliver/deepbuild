// AC15: "With `distance: {model: linear, ref: 1, max: 10, rolloff: 1}`, a still source 5.5 m from the listener plays
// at gain 0.5 and one at 12 m at gain 0, each within 0.05 dB on the rendered samples' RMS against the unattenuated
// source; with `model: exponential, ref: 1, rolloff: 1`, a source at 4 m plays at gain 0.25 within 0.05 dB. A planted
// emitter that always uses the inverse model fails both, naming the emitter"
//
// AC16: "With `cone: {inner: 60, outer: 120, outer_gain: 0.25}`, the gain is 1 with the source facing the listener,
// 0.625 at 45° off and 0.25 at 90° and 180°, within 0.05 dB, by the W3C cone formula; seeking to 10 sampled times in a
// cone sweep renders the same samples as playing, by hash. A planted cone with the angle's sign reversed plays 0.25
// facing the listener and fails"
//
// Through `media_mix` (README: The surface under test). The listener is the camera, at the origin looking down −z; each
// source is an item straight ahead of it, so every emitter pans the same way. "The unattenuated source" is the same
// strip through an emitter at the reference distance, 1 m, with the default cone: gain 1 under every distance model and
// the same pan, so a measured gain is the square root of the ratio of mean powers (summed over the two channels, which
// an equal-power pan keeps). Gain 0 is read as silence: every sample within 2^−20 (−120 dBFS) of 0. Each emitter's strip
// sounds alone, over its own second of the document.
import { describe, expect, it } from 'vitest';
import {
  RATE, SEC, SILENCE, asset, coneGain, distanceGain, loudest, mix, pcmOf, power, sampleAt, secs, seeded, toDb, tone,
  useEvidence, useShow, type Emitter, type MediaDoc, type Pcm, type Planted, type Segment, type Strip,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const CAMERA = { position: [0, 0, 0] as [number, number, number], forward: [0, 0, -1] as [number, number, number] };
const DB_TOL = 0.05;

interface Case { id: string; d: number; yaw: number; distance?: Emitter['distance']; cone?: Emitter['cone']; want: number }

/** One document: the reference emitter `ref` at 1 m, then each case's emitter, each strip sounding alone for 1 s
 * starting every 1.5 s. Its source item faces +z (yaw 0, toward the camera) turned by `yaw` degrees about +y. */
function placed(src: string, cases: Case[]): { doc: MediaDoc; at: Record<string, number> } {
  const all: Case[] = [{ id: 'ref', d: 1, yaw: 0, want: 1 }, ...cases];
  const strips: Record<string, Strip> = {};
  const emitters: Record<string, Emitter> = {};
  const items: Record<string, { position: [number, number, number]; yaw: number }> = {};
  const at: Record<string, number> = {};
  all.forEach((c, i) => {
    const start = Math.round(i * 1.5 * RATE);
    at[c.id] = start;
    strips[`s_${c.id}`] = { track: 0, asset: src, start: start * (SEC / RATE), in: 0, out: SEC };
    items[`item_${c.id}`] = { position: [0, 0, -c.d], yaw: c.yaw };
    emitters[c.id] = { item: `item_${c.id}`, src: { strip: `s_${c.id}` }, ...(c.distance ? { distance: c.distance } : {}), ...(c.cone ? { cone: c.cone } : {}) };
  });
  return { doc: { transport: { sample_rate: RATE, span: secs(all.length * 1.5) }, strips, emitters, scene: { camera: CAMERA, items } }, at };
}

/** Each case's measured gain against the reference over the middle of its second, and what is wrong with it. */
function gains(p: Pcm, at: Record<string, number>, cases: Case[]): { f: string[]; g: Record<string, number> } {
  const f: string[] = [];
  const g: Record<string, number> = {};
  const win = (id: string): [number, number] => [at[id]! + RATE / 5, at[id]! + (4 * RATE) / 5];
  const ref = power(p, ...win('ref'));
  expect(ref > 1e-4, `the reference emitter at 1 m sounds (mean power ${ref})`).toBe(true);
  for (const c of cases) {
    g[c.id] = Math.sqrt(power(p, ...win(c.id)) / ref);
    if (c.want === 0) {
      const peak = loudest(p, at[c.id]!, at[c.id]! + RATE);
      if (peak > SILENCE) f.push(`the emitter \`${c.id}\` at ${c.d} m plays at gain ${g[c.id]!.toFixed(4)} (peak ${peak}), not 0 (silence)`);
    } else if (!(Math.abs(toDb(g[c.id]!) - toDb(c.want)) <= DB_TOL)) {
      f.push(`the emitter \`${c.id}\` at ${c.d} m, yaw ${c.yaw}° plays at gain ${g[c.id]!.toFixed(4)} (${toDb(g[c.id]!).toFixed(3)} dB), not ${c.want} (${toDb(c.want).toFixed(3)} dB) within 0.05 dB`);
    }
  }
  return { f, g };
}

function render(cases: Case[], what: string, planted?: Planted): { f: string[]; g: Record<string, number> } {
  const evidence = evidenceDir();
  const src = asset(evidence, [tone(1000, RATE, 0.25)]).sha;
  const { doc, at } = placed(src, cases);
  const span = doc.transport!.span!;
  const m = mix(show(), evidence, doc, [{ from: 0, to: span, write: true }], what, planted);
  return gains(pcmOf(evidence, m.segments[0]!, what), at, cases);
}

describe('AC15 every distance model is held to its formula', () => {
  it('AC15 linear {ref 1, max 10, rolloff 1} plays a still source at 5.5 m at gain 0.5 and at 12 m at gain 0, exponential {ref 1, rolloff 1} at 4 m at gain 0.25, each within 0.05 dB against the unattenuated source; a planted emitter that always uses the inverse model fails both linear readings, naming each emitter', () => {
    const linear = { model: 'linear' as const, ref: 1, max: 10, rolloff: 1 };
    const exponential = { model: 'exponential' as const, ref: 1, rolloff: 1 };
    const cases: Case[] = [
      { id: 'lin_5m5', d: 5.5, yaw: 0, distance: linear, want: 0.5 },
      { id: 'lin_12m', d: 12, yaw: 0, distance: linear, want: 0 },
      { id: 'exp_4m', d: 4, yaw: 0, distance: exponential, want: 0.25 },
    ];
    // The expected values are the W3C formulas' (checked here, so a wrong value in this file fails, not the program).
    expect([distanceGain('linear', 5.5, 1, 10, 1), distanceGain('linear', 12, 1, 10, 1), distanceGain('exponential', 4, 1, 10_000, 1)]).toEqual([0.5, 0, 0.25]);
    const { f } = render(cases, 'three emitters at their distances');
    expect(f, 'each distance model plays its formula\'s gain').toEqual([]);

    // Wrong program: an emitter that always uses the inverse model (1/5.5 and 1/12 here; at 4 m with ref 1 and rolloff
    // 1 the inverse model's 1/4 is the exponential's too, so only the linear readings can tell them apart).
    const w = render(cases, 'three emitters at their distances', 'emitter_always_inverse');
    expect(w.f.some((x) => x.startsWith('the emitter `lin_5m5`')), `planted emitter_always_inverse fails at 5.5 m, naming \`lin_5m5\`; got ${JSON.stringify(w.f)}`).toBe(true);
    expect(w.f.some((x) => x.startsWith('the emitter `lin_12m`')), `planted emitter_always_inverse fails at 12 m, naming \`lin_12m\`; got ${JSON.stringify(w.f)}`).toBe(true);
  }, 1_800_000);
});

describe('AC16 the cone is held to the W3C cone formula, and seeking a cone sweep equals playing it', () => {
  it('AC16 with cone {inner 60, outer 120, outer_gain 0.25} a source at 1 m plays at gain 1 facing the listener, 0.625 at 45° off, 0.25 at 90° and at 180°, each within 0.05 dB; seeking to 10 seeded times in a 10 s sweep of the source\'s yaw renders the same samples as playing, by hash; a planted cone with the angle\'s sign reversed plays 0.25 facing the listener and fails', () => {
    const cone = { inner: 60, outer: 120, outer_gain: 0.25 };
    const cases: Case[] = [0, 45, 90, 180].map((yaw) => ({ id: `yaw_${yaw}`, d: 1, yaw, cone, want: coneGain(yaw, 60, 120, 0.25) }));
    expect(cases.map((c) => c.want), 'the W3C cone formula gives 1, 0.625, 0.25 and 0.25').toEqual([1, 0.625, 0.25, 0.25]);
    const { f } = render(cases, 'four emitters turned 0°, 45°, 90° and 180° from the listener');

    // The sweep: the item's yaw runs 0° to 360° over 10 s; one 50 ms window in each 0.9 s bin from 0.5 s, at a seeded
    // sample that isn't a block's first, played straight through, then each seeked to, in a seeded order.
    const evidence = evidenceDir();
    const hum = asset(evidence, [tone(440, 10 * RATE, 0.25)]).sha;
    const r = seeded(499_16);
    const W = 2400;
    const starts = Array.from({ length: 10 }, (_, i) => {
      const n = 24_000 + i * 43_200 + Math.floor(r() * 38_400);
      return n % 128 === 0 ? n + 37 : n;
    });
    const T = (n: number): number => n * (SEC / RATE);
    const straight: Segment[] = [];
    let at = 0;
    for (const n of starts) { straight.push({ from: at, to: T(n) }, { from: T(n), to: T(n + W) }); at = T(n + W); }
    straight.push({ from: at, to: secs(10) });
    const order = starts.map((n) => ({ n, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.n);
    const seeks: Segment[] = order.map((n) => ({ from: T(n), to: T(n + W) }));
    const sweep: MediaDoc = {
      transport: { sample_rate: RATE, span: secs(10) },
      strips: { hum: { track: 0, asset: hum, start: 0, in: 0, out: secs(10) } },
      emitters: { sweep: { item: 'spin', src: { strip: 'hum' }, cone } },
      scene: { camera: CAMERA, items: { spin: { position: [0, 0, -1], yaw: { keys: [{ t: 0, value: 0, interp: 'linear' }, { t: secs(10), value: 360 }] } } } },
    };
    const m = mix(show(), evidence, sweep, [...straight, ...seeks], 'a 10 s cone sweep, played and then seeked');
    const played = new Map(m.segments.slice(0, straight.length).map((s) => [s.from, s.sha256]));
    const windows = starts.map((n) => played.get(T(n)));
    expect(new Set(windows).size, 'the sweep changes what is heard: the 10 played windows hash apart').toBe(10);
    m.segments.slice(straight.length).forEach((s) => {
      if (s.sha256 !== played.get(s.from)) f.push(`the emitter \`sweep\`: the seek to ${(s.from / SEC).toFixed(6)} s (sample ${sampleAt(s.from)}) renders other samples than playing, by hash`);
    });
    expect(f, 'the cone plays its formula\'s gain, and seeking the sweep equals playing it').toEqual([]);

    // Wrong program: the cone's angle taken from listener to source (the sign reversed): facing the listener reads 180°.
    const w = render(cases, 'four emitters turned 0°, 45°, 90° and 180° from the listener', 'cone_sign_reversed');
    const facing = w.g['yaw_0']!;
    expect(Math.abs(toDb(facing) - toDb(0.25)) <= DB_TOL, `planted cone_sign_reversed plays 0.25 facing the listener; got gain ${facing}`).toBe(true);
    expect(w.f.some((x) => x.startsWith('the emitter `yaw_0`')), `planted cone_sign_reversed fails facing the listener, naming \`yaw_0\`; got ${JSON.stringify(w.f)}`).toBe(true);
  }, 1_800_000);
});
