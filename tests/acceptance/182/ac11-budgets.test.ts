// Criterion 11: budgets, on the reference Mac in the local preflight, compared with the merge base: 16 character bodies
// moving through a level of 500 static shapes add under 1 ms of CPU to a 120 Hz step, and a world without one gains no
// work per step.
//
// The level is a floor and 499 pillars; the 16 bodies walk through it at 2 m/s, angled so they meet pillars and slide.
// Each run is the base's `time` call over 600 steps of a world (README: `time` takes `track`): the 16 bodies' cost is
// the mean step of the level with them less the mean step of the level alone; "a world without one" is the level with
// 16 dynamic balls in their place, timed here and in the merge base's release build (`git archive` into
// target/acceptance-182-base/), here within the base's median + 5%. Each test runs its structural part everywhere,
// then skips as INCONCLUSIVE off a reference Mac fit to judge (#191's gate), never a pass.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, arr, bake, binOf, characterWorld, gate, heroBody, judgeRuns, median, mergeBase, mergeBasePhysics,
  num, physics, prebuild, settle, show, slab, standing, statesOf, walk, type JsonObject, type Static,
} from './helpers.ts';

prebuild(['release']);
const STEPS = 600;
const BODIES = 16;
const PILLARS = 499;

/** The level: the floor and 499 pillars 0.4 m wide on a 2 m grid from x 2 and z −19, the last of 25 × 20 left out. */
function level(): Record<string, Static> {
  const out: Record<string, Static> = { floor: slab(-5, 60, -1, 0, 25) };
  for (let i = 0; i < PILLARS; i++) {
    const x = 2 + 2 * (i % 25);
    const z = -19 + 2 * Math.floor(i / 25);
    out[`p${String(i).padStart(3, '0')}`] = { ...slab(x - 0.2, x + 0.2, 0, 1, 0.2), pos: [x, 0.5, z] };
  }
  return out;
}
const lanes = Array.from({ length: BODIES }, (_, i) => -15 + 2 * i);
const ids = lanes.map((_, i) => `c${String(i).padStart(2, '0')}`);
const capacity: JsonObject = { bodies: 1024, shapes: 1024, joints: 0, contacts: 8192, particles: 0 };
function withCharacters(): JsonObject {
  const movers: Record<string, JsonObject> = {};
  lanes.forEach((z, i) => { movers[ids[i]!] = heroBody([0, standing(0), z]); });
  return characterWorld({ statics: level(), movers, inputs: { walk: { kind: 'move', targets: ids } }, capacity });
}
const track = (): JsonObject[] => ids.map((id) => ({ ...walk(0, [2, 0, 0.5]), target: id }));
function withBalls(): JsonObject {
  const movers: Record<string, JsonObject> = {};
  lanes.forEach((z, i) => { movers[`b${String(i).padStart(2, '0')}`] = { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: [0, 0.3, z] }, velocity: { linear: [2, 0, 0.5] } }; });
  return characterWorld({ statics: level(), movers, inputs: {}, capacity, shapes: { ball: { kind: 'sphere', radius: 0.3 } } });
}
const alone = (): JsonObject => characterWorld({ statics: level(), movers: {}, inputs: {}, capacity });
const timeCall = (w: JsonObject, t: JsonObject[] = []): JsonObject => ({ call: 'time', world: w, steps: STEPS, ...(t.length ? { track: t } : {}) });
/** The mean of a `time` reply's per-step milliseconds. */
function meanStep(reply: JsonObject, what: string): number {
  expect(reply['ok'], `${what} was timed: ${show(reply)}`).toBe(true);
  const ms = arr(reply['ms'], `${what}: ms`).map((x, i) => num(x, `${what}: ms[${i}]`));
  expect(ms.length, `${what}: one time per step`).toBe(STEPS);
  return ms.reduce((a, b) => a + b, 0) / ms.length;
}

describe(`${AC[11]} budgets on the reference Mac, compared with the merge base`, () => {
  test(`${AC[11]} 16 character bodies moving through a level of 500 static shapes add under 1 ms of CPU to a 120 Hz step`, (ctx) => {
    const [baked] = physics([bake(withCharacters(), 120, { track: track(), read: ['c00', 'c15'] })], { build: 'release' });
    const s = statesOf(baked!, 'c00', 'the level with 16 bodies');
    expect(s[120]!.pos[0] - s[0]!.pos[0], 'the bodies move through the level').toBeGreaterThan(0.5);
    gate(ctx);
    const pair = (): number => {
      const [a, b] = physics([timeCall(withCharacters(), track()), timeCall(alone())], { build: 'release' });
      return meanStep(a!, 'the level with 16 character bodies') - meanStep(b!, 'the level alone');
    };
    pair();
    settle(ctx, [judgeRuns('ms a step the 16 character bodies add', Array.from({ length: 5 }, pair), 1)]);
  }, TIMEOUT);

  test(`${AC[11]} a world without a character body gains no work per step: its steps take no longer than the merge base's`, (ctx) => {
    // The build under test carries the character body; a world without one is timed against the merge base's.
    const [chars, baked] = physics([bake(withCharacters(), 60, { track: track(), read: ['c00'] }), bake(withBalls(), 60, { read: ['b00'] })], { build: 'release' });
    expect(statesOf(chars!, 'c00', 'the level with 16 character bodies').length, 'this build bakes a world with character bodies').toBe(61);
    expect(statesOf(baked!, 'b00', 'the level with 16 balls').length, 'the world without a character body bakes').toBe(61);
    gate(ctx);
    const dir = mkdtempSync(join(tmpdir(), 'deep-182-base-'));
    try {
      const base = join(dir, 'deep-physics-base');
      expect(mergeBasePhysics(mergeBase(), base), 'the merge base builds deep-physics (release)').toBe('');
      const time = (bin: string): number => {
        const r = spawnSync(bin, [], { input: `${JSON.stringify(timeCall(withBalls()))}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
        expect(r.status, `${bin} times the world`).toBe(0);
        return meanStep(JSON.parse(r.stdout.trim()) as JsonObject, bin);
      };
      const here = binOf('release');
      time(base); time(here);
      const baseRuns = Array.from({ length: 5 }, () => time(base));
      const hereRuns = Array.from({ length: 5 }, () => time(here));
      settle(ctx, [judgeRuns('ms a step here against the merge base\'s median + 5%', hereRuns, median(baseRuns) * 1.05)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
