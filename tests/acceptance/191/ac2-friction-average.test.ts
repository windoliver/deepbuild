// Criterion 2: a test backend that wraps Rapier but combines friction by the average while its world declares the
// geometric mean fails the geometric slide fixture, naming the backend, the fixture, the answer 3.186 m, the 3% tolerance
// and the 2.548 m it slid, while it still passes the average slide fixture and every golden recorded on it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  AC, EXPECTED, TIMEOUT, box, failFailures, kitCall, kitReport, none, obj, one, passFailures, physics, prebuild, resultOf,
  show, statesOf, str, toleranceOf, use, world, type JsonObject,
} from './helpers.ts';

prebuild(['test']);
const BACKEND = 'friction_average';

/** A box sliding from 5 m/s on flat ground, friction 0.2 against 0.8 under `rule`; and a ball bouncing, restitution 0.5 against 0.9. */
function slideWorld(rule: string): JsonObject {
  return world({
    combine: { friction: rule, restitution: 'max' },
    contact_materials: { low: { friction: 0.2, restitution: 0, density: 1000 }, high: { friction: 0.8, restitution: 0, density: 1000 } },
    shapes: { block: box([0.25, 0.25, 0.25]), floor: box([50, 0.1, 50]) },
    bodies: {
      block: { kind: 'dynamic', shapes: [use('block', 'low')], pose: { pos: [0, 0.25, 0] }, velocity: { linear: [5, 0, 0] } },
      floor: { kind: 'static', shapes: [use('floor', 'high')], pose: { pos: [0, -0.1, 0] } },
    },
  });
}

describe(`${AC[2]} a backend that averages friction while its world declares the geometric mean`, () => {
  test(`${AC[2]} fails slide_geometric naming ${BACKEND}, the fixture, 3.186 m, 3% and the 2.548 m it slid, and passes slide_average`, () => {
    const k = kitReport(one(kitCall(), { backend: BACKEND }), `behavior_kit on ${BACKEND}`);
    const geo = resultOf(k, 'slide_geometric', BACKEND);
    const failures = failFailures(geo, BACKEND);
    if (geo.answer === null || Math.abs(geo.answer - 3.186) > 0.0005) failures.push(`slide_geometric names answer ${show(geo.answer)}, not 3.186 m`);
    const t = toleranceOf(geo.tolerance, 'slide_geometric.tolerance');
    if (t.unit !== 'relative' || t.value !== 0.03) failures.push(`slide_geometric names tolerance ${show(geo.tolerance ?? null)}, not 3%`);
    // The distance it slid: the average's v² ÷ 2μg, 2.548 m, within the fixtures' 3%.
    if (geo.measured === null || Math.abs(geo.measured - 2.548) > 0.03 * 2.548) failures.push(`slide_geometric names ${show(geo.measured)} m slid, not the average's 2.548 m (within 3%)`);
    none(failures, `${BACKEND}'s slide_geometric`);
    none(passFailures(resultOf(k, 'slide_average', BACKEND), EXPECTED.find((e) => e.name === 'slide_average')!, undefined), `${BACKEND} still passes slide_average`);
    expect(k.verdict, `${BACKEND}'s kit verdict`).toBe('fail');
  }, TIMEOUT);

  test(`${AC[2]} every golden recorded on ${BACKEND} still passes when replayed on it`, () => {
    const store = mkdtempSync(join(tmpdir(), 'deep-191-goldens-'));
    try {
      const worlds = [slideWorld('geometric'), slideWorld('average')];
      const goldens = physics(worlds.map((w) => ({ call: 'golden', world: w, steps: 240, store, verify_on: ['aarch64-apple-darwin'] })), { backend: BACKEND });
      const verifies = physics(goldens.map((g, i) => {
        expect(g['ok'], `golden ${i} recorded on ${BACKEND}: ${show(g)}`).toBe(true);
        return { call: 'golden_verify', golden: obj(g['golden'], `golden ${i}`), world: worlds[i]!, steps: 240 };
      }), { backend: BACKEND });
      verifies.forEach((v, i) => {
        expect(str(v['verdict'], `golden_verify ${i}: verdict`), `the golden ${i} recorded on ${BACKEND} replays on it: ${show(v)}`).toBe('PASS');
      });
      // The goldens hash the wrong slide, so they hold: the geometric world's block really slid the average's distance.
      const states = statesOf(one({ call: 'bake', world: worlds[0]!, steps: 240, read: ['block'] }, { backend: BACKEND }), 'block', `the geometric slide on ${BACKEND}`);
      const slid = states.at(-1)!.pos[0] - states[0]!.pos[0];
      expect(Math.abs(slid - 2.548) <= 0.03 * 2.548, `on ${BACKEND} the geometric world's block slides the average's 2.548 m (got ${slid})`).toBe(true);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
