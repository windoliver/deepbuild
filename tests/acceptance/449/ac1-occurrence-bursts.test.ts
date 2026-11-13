// AC1: "Bursts come only from a baked occurrence list, and a count past its cap is refused naming the peak"
//
// The lab: a world `lab` (rapier3d, 120 Hz) drops three rubber balls of radius 0.1 m from 1.0, 1.6 and 2.2 m onto a
// static plane, so they bounce several times over the 2 s span. A particles item `sparks` bursts on
// `{list: "lab.occurrences", kinds: ["hit"], where: "speed > 1", count: 16}`. `deep-physics` bakes the same world on
// its own (240 steps, #2009 and #1918's `occurrences`), which gives the list the bursts must come from. The
// `particles` call's CPU closed form lists every particle born over the span: each must be born at a matching hit's
// time (its step ÷ 120 s, within 1e-9 s) and point (within 1e-6 m), every matching hit gives exactly 16, and nothing
// else is born. A list no world of the document bakes (`nowhere.occurrences`) is refused at check, naming the item;
// and `count: "speed * 100"`, whose largest value over the matching hits passes the cap of 256, is refused at check,
// naming that peak (`actual.peak`, within 1 of 100 × the fastest matching hit's speed, for a count rounded either way)
// and the cap. The criterion names no planted program.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, arr, flicks, fmt, fmtV, gap, isObject, markBox, none, num, obj, particlesCall, particlesItem, passed, reading,
  refusalsNaming, runGpu, runPhysics, sessionDoc, show, camera, checkOf, useBins, useDir, writeJson, SPARK_LOOK,
  type JsonObject, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu', 'deep-physics']);
const dir = useDir();
const STEP_RATE = 120;
const STEPS = 240;
const PER_BURST = 16;
const CAP = 256;

/** The world: three balls bouncing on a plane (#2009's world fields, #1918's occurrence list). */
function labWorld(): JsonObject {
  const ball = (pos: V3): JsonObject => ({ kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos } });
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: STEP_RATE, substeps: 4, gravity: [0, -9.81, 0], seed: 449, mode: 'dynamic',
    capacity: { bodies: 8, shapes: 8, joints: 0, contacts: 256, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { ground: { friction: 0.5, restitution: 0.6 }, rubber: { friction: 0.5, restitution: 0.7, density: 500 } },
    shapes: { plane: { kind: 'plane', normal: [0, 1, 0] }, ball: { kind: 'sphere', radius: 0.1 } },
    bodies: {
      ground: { kind: 'static', shapes: [{ shape: 'plane', contact_material: 'ground' }] },
      a: ball([-0.6, 1.0, 0]), b: ball([0, 1.6, 0]), c: ball([0.6, 2.2, 0]),
    },
  };
}
function labDoc(on: JsonObject, worlds: JsonObject = { lab: labWorld() }): JsonObject {
  return sessionDoc('Lab sparks', {
    cam: camera([0, 1.2, 4], [0, 0.4, 0], 50),
    plate: markBox([3, 0.02, 1.5], [0, -0.01, 0], 'floor'),
    sparks: particlesItem({
      count: 2048, emit: { shape: 'point', on }, life: [0.5, 0.5],
      motion: { ballistic: { v0: [1, 2], gravity: [0, -9.81, 0], drag: 0 } }, draw: 'spark', ...SPARK_LOOK,
    }),
  }, { transport: { span: '2s', frame_rate: [60, 1] }, worlds });
}
const ON = { list: 'lab.occurrences', kinds: ['hit'], where: 'speed > 1', count: PER_BURST };

interface Hit { step: number; t: number; point: V3; speed: number; pair: string }
/** The baked list's hits whose speed passes `where`, as deep-physics bakes the world on its own. */
function matchingHits(): Hit[] {
  const [baked] = runPhysics(bins.bin('deep-physics'), [{ call: 'bake', world: labWorld(), steps: STEPS }]);
  expect(baked!['ok'], `deep-physics bakes the lab: ${show(baked)}`).toBe(true);
  const rows = arr(baked!['occurrences'], 'the lab\'s occurrence list');
  return rows.filter((r): r is JsonObject => isObject(r) && r['kind'] === 'hit').map((r) => ({
    step: num(r['step'], 'a hit\'s step'), t: num(r['step'], 'a hit\'s step') / STEP_RATE,
    point: arr(r['point'], 'a hit\'s point').map((x, i) => num(x, `a hit's point[${i}]`)) as V3,
    speed: num(r['speed'], 'a hit\'s speed'), pair: `${String(r['a'])}|${String(r['b'])}`,
  })).filter((h) => h.speed > 1 && h.step < STEPS);
}

describe(`${ac(1)} bursts come only from a baked occurrence list, and a count past its cap is refused naming the peak`, () => {
  it(`${ac(1)} every particle is born at a hit of the lab's baked list that passes where, 16 to each such hit and none elsewhere; a list no world bakes is refused at check naming the item; and a count expression that peaks past 256 is refused naming the peak`, () => {
    const hits = matchingHits();
    expect(hits.length, `the lab's baked list holds at least three hits faster than 1 m/s: ${show(hits)}`).toBeGreaterThanOrEqual(3);
    // The fixture keeps each pair's matching hits more than the default cooldown (30 ms) apart, so the cooldown drops none.
    const byPair = new Map<string, number[]>();
    for (const h of hits) byPair.set(h.pair, [...(byPair.get(h.pair) ?? []), h.t]);
    for (const [pair, ts] of byPair) for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!, `the fixture: ${pair}'s matching hits are more than 30 ms apart`).toBeGreaterThan(0.03);
    expect(hits.every((h) => Math.abs(h.speed - 1) > 1e-3), 'the fixture: no matching hit sits within 1 mm/s of where\'s bound').toBe(true);

    const calls = [
      particlesCall({ doc: writeJson(dir(), 'lab.json', labDoc(ON)), t: [flicks(1)] }),
      particlesCall({ doc: writeJson(dir(), 'unbaked.json', labDoc({ ...ON, list: 'nowhere.occurrences' })), t: [flicks(1)] }),
      particlesCall({ doc: writeJson(dir(), 'peak.json', labDoc({ ...ON, count: 'speed * 100' })), t: [flicks(1)] }),
    ];
    const [lab, unbaked, peak] = runGpu(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop' });

    const fails: string[] = [];
    const born = reading(passed(lab!, calls[0]!, 'the lab'), 'sparks', 'the lab').particles;
    const used = hits.map(() => 0);
    for (const p of born) {
      const k = hits.findIndex((h) => Math.abs(p.born - h.t) <= 1e-9 && gap(p.from, h.point) <= 1e-6);
      if (k < 0) fails.push(`particle row ${p.row} is born at ${fmt(p.born, 9)} s at ${fmtV(p.from)}, which matches no hit of the baked list that passes where`);
      else used[k]! += 1;
    }
    hits.forEach((h, k) => { if (used[k] !== PER_BURST) fails.push(`the hit at step ${h.step} (${fmt(h.t, 6)} s, ${fmtV(h.point)}, ${fmt(h.speed, 3)} m/s) bursts ${used[k]} particles, not ${PER_BURST}`); });
    none(fails, 'the lab\'s bursts against its baked list');

    const unbakedCheck = checkOf(unbaked!, calls[1]!, 'a list no world bakes');
    expect(unbakedCheck.outcome, `a burst on nowhere.occurrences, which no world of the document bakes, is refused at check: ${show(unbakedCheck.raw)}`).toBe('refused');
    expect(refusalsNaming(unbakedCheck, 'sparks').length, `its error issue names the item sparks: ${show(unbakedCheck.issues.map((i) => i.raw))}`).toBeGreaterThan(0);

    const want = 100 * Math.max(...hits.map((h) => h.speed));
    expect(want, 'the fixture: 100 × the fastest matching hit passes the cap').toBeGreaterThan(CAP + 1);
    const peakCheck = checkOf(peak!, calls[2]!, 'count: speed * 100');
    expect(peakCheck.outcome, `count: speed * 100 peaks at about ${fmt(want, 1)}, past ${CAP}, and is refused at check: ${show(peakCheck.raw)}`).toBe('refused');
    const named = refusalsNaming(peakCheck, 'sparks').filter((i) => isObject(i.actual) && typeof i.actual['peak'] === 'number');
    expect(named.length, `an error issue names sparks with actual.peak: ${show(peakCheck.issues.map((i) => i.raw))}`).toBeGreaterThan(0);
    const actual = obj(named[0]!.actual, 'the refusal\'s actual');
    expect(Math.abs(num(actual['peak'], 'actual.peak') - want), `the refusal names the peak: ${show(actual)}, the list's peak ${fmt(want, 3)}`).toBeLessThanOrEqual(1);
    expect(actual['cap'], 'the refusal names the cap of 256').toBe(CAP);
    expect(named[0]!.path, 'the refusal is at the burst count\'s path').toBe('items/sparks/params/emit/on/count');
  }, TIMEOUT);
});
