// #251.25f1d712: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 8 four-wheeled
// vehicle bodies on a level of 500 static shapes add under 1 ms of CPU to a 120 Hz step, and a world without one gains
// no work per step"
//
// The level: 500 static boxes, 4 m tiles in a 25 × 20 grid whose tops are y = 0. The vehicles: 8 of the car (README:
// The car), sleep off, set down settled in a row across the level and rolling at 5 m/s along +Z, so every ray meets a
// tile each step. Timings are the base's `time` call (each step's wall time on the runner's one thread, in ms) on release
// builds: this checkout's, and for the merge base's, the merge base built from `git archive` (#191's helpers). Each
// reading is the mean step over 600 steps; five runs after a warm-up are judged by #191's rule (PASS when every run is
// within the limit, FAIL when every one is past it by more than the margin, else INCONCLUSIVE). Vehicles: the level with
// them, less the level alone, under 1 ms. No vehicle: the level with 8 dynamic boxes of the chassis's size steps no
// slower than on the merge base's build (its median + 5%, #191's reading of "gains no work"). Off a reference Mac fit to
// judge, each test runs its structural part, then skips as INCONCLUSIVE, never a pass.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CRITERIA, HALF, MATERIALS, SETTLED_Y, TIMEOUT, arr, box, errorsOf, gate, judgeRuns, kart, median, mergeBase, mergeBasePhysics, num, obj,
  onTest, prebuildBuilds, settle, world, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[8];
const STEPS = 600;
const TILE = 2;
const LIMIT_MS = 1;

/** The level of 500 static tiles, and on it either 8 vehicles, 8 dynamic boxes of the chassis's size, or nothing. */
function level(on: 'vehicles' | 'boxes' | 'none'): JsonObject {
  const bodies: JsonObject = {};
  for (let i = 0; i < 25; i++) for (let j = 0; j < 20; j++) {
    bodies[`tile_${String(i).padStart(2, '0')}_${String(j).padStart(2, '0')}`] = { kind: 'static', shapes: [{ shape: 'tile', contact_material: 'ground' }], pose: { pos: [(i - 12) * 2 * TILE, -0.1, (j - 10) * 2 * TILE] } };
  }
  for (let n = 0; n < 8 && on !== 'none'; n++) {
    const pos: [number, number, number] = [(n - 3.5) * 8, SETTLED_Y, -30];
    bodies[`car_${n}`] = on === 'vehicles'
      ? kart(pos, { sleep: false, velocity: { linear: [0, 0, 5] } })
      : { kind: 'dynamic', shapes: [{ shape: 'chassis', contact_material: 'shell' }], pose: { pos: [pos[0], HALF[1], pos[2]] }, mass: 1000, sleep: false, velocity: { linear: [0, 0, 5] } };
  }
  return world({
    capacity: { bodies: 512, shapes: 512, joints: 0, contacts: 8192, particles: 0 },
    contact_materials: MATERIALS,
    shapes: { tile: box([TILE, 0.1, TILE]), chassis: box(HALF) },
    bodies,
  });
}
const timeCall = (w: JsonObject): JsonObject => ({ call: 'time', world: w, steps: STEPS });
/** A `time` reply's mean step, ms. */
function meanMs(reply: JsonValue | undefined, what: string): number {
  const ms = arr(obj(reply, what)['ms'], `${what}: ms`).map((x, i) => num(x, `${what}: ms[${i}]`));
  expect(ms.length, `${what}: one timing per step`).toBe(STEPS);
  return ms.reduce((a, b) => a + b, 0) / ms.length;
}

describe(`${ID} budgets on the reference Mac, compared with the merge base`, () => {
  it(`${ID} 8 four-wheeled vehicle bodies on a level of 500 static shapes add under 1 ms of CPU to a 120 Hz step`, (ctx) => {
    const [checked] = onTest([{ call: 'check', world: level('vehicles') }], { build: 'release' });
    expect(errorsOf(checked, 'the level with 8 vehicles'), 'the level with 8 vehicles is admitted').toEqual([]);
    const run = (): number => {
      const [withCars, alone] = onTest([timeCall(level('vehicles')), timeCall(level('none'))], { build: 'release' });
      return meanMs(withCars, 'the level with 8 vehicles') - meanMs(alone, 'the level alone');
    };
    run();
    gate(ctx);
    settle(ctx, [judgeRuns('8 vehicles on the level: ms added to a step', Array.from({ length: 5 }, run), LIMIT_MS)]);
  }, 4 * TIMEOUT);

  it(`${ID} a world without a vehicle body gains no work per step against the merge base`, (ctx) => {
    const w = level('boxes');
    const [checked, vehicles] = onTest([{ call: 'check', world: w }, { call: 'check', world: level('vehicles') }], { build: 'release' });
    expect(errorsOf(checked, 'the level with 8 boxes'), 'the level with 8 boxes is admitted').toEqual([]);
    expect(errorsOf(vehicles, 'the level with 8 vehicles'), 'this build runs vehicle bodies').toEqual([]);
    gate(ctx);
    const dir = mkdtempSync(join(tmpdir(), 'deep-251-base-'));
    try {
      const base = join(dir, 'deep-physics-base');
      expect(mergeBasePhysics(mergeBase(), base), 'the merge base builds deep-physics (release)').toBe('');
      const onBase = (): number => {
        const r = spawnSync(base, [], { input: `${JSON.stringify(timeCall(w))}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
        expect(r.status, `the merge base's deep-physics times the level: ${r.stderr}`).toBe(0);
        return meanMs(JSON.parse(r.stdout.trim()) as JsonValue, 'the level with 8 boxes on the merge base');
      };
      const here = (): number => meanMs(onTest([timeCall(w)], { build: 'release' })[0], 'the level with 8 boxes here');
      onBase(); here();
      const baseRuns = Array.from({ length: 5 }, onBase);
      const hereRuns = Array.from({ length: 5 }, here);
      console.log(`merge base: ${baseRuns.map((x) => x.toFixed(4)).join(', ')} ms a step; here: ${hereRuns.map((x) => x.toFixed(4)).join(', ')} ms a step`);
      settle(ctx, [judgeRuns('the level with 8 boxes: ms a step, against the merge base\'s median + 5%', hereRuns, median(baseRuns) * 1.05)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 4 * TIMEOUT);
});
