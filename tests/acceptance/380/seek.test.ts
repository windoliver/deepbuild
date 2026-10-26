// #380.b40177b9: every shipped pass that uses noise seeds it from a hash of the pixel and the item's seed,
// never from a frame counter or the clock, so seeking to any time equals playing to it on the same machine's
// pixel hash for every shipped effect.
// Each shipped effect's scene (`effectScene(<effect>)`: the camera orbits at 60° a second, so frames
// differ; particles move by their closed form), or, for a shipped effect this suite has no scene for, the
// document its operator names as its fixture. Played: frames 0 … 90 at 60 fps in one process. Sought: a
// fresh process that opens the scene at frame 30, and another at frame 90 (`view3d`'s `from`), drawing that
// frame first. Each sought frame's pixel hash equals the played one's, a second play's frame 90 equals the
// first's, and frame 30 differs from frame 90 (the scene moves, so the check can see a frame drawn for the
// wrong time). For each shipped operator that draws seeded noise (`noise: true`), its scene at document
// seed 1 and seed 2 (the item's seed is a hash of the document's seed and the item's ID) differ, and seed 1
// in two processes is the same. Wrong programs: `noise_from_frame_counter` and `noise_from_clock`. At the
// base `deep-gpu` has no operators call, and view3d has no `from`.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EFFECTS, OPERATORS, REPO, effectScene, frameAt, look, operatorsReply, requireGpu, run1, shippedEffects, useBin, useOut, view3Reply,
  view3d, writeJson, type JsonObject, type Operator, type Scene, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();
const FPS = 60;
const LAST = 90;
const SOUGHT = [30, 90];

function shipped(startup: Startup = {}): { effects: Map<string, Operator>; ops: Operator[] } {
  const ops = operatorsReply(run1(bins.bin(), out(), OPERATORS, startup));
  return { effects: shippedEffects(ops, 'the operators call'), ops: ops.filter((o) => o.origin === 'shipped') };
}
/** The scene each shipped effect is checked on: the suite's, or the one its operator names. */
function sceneOf(effect: string, op: Operator, seed?: number): Scene {
  if ((EFFECTS as readonly string[]).includes(effect)) return effectScene(effect as (typeof EFFECTS)[number], seed === undefined ? {} : { seed });
  expect(op.fixture, `the shipped effect ${effect} (${op.name}) names the document it's checked on, since this suite has none for it`).not.toBeNull();
  const doc = JSON.parse(readFileSync(isAbsolute(op.fixture!) ? op.fixture! : join(REPO, op.fixture!), 'utf8')) as JsonObject;
  return { doc: seed === undefined ? doc : { ...doc, seed }, look: look(), selection: [] };
}
function hashes(scene: Scene, name: string, from: number, frames: number, startup: Startup = {}): Map<number, string> {
  const doc = writeJson(out(), `${name}.json`, scene.doc);
  const v = view3Reply(run1(bins.bin(), out(), view3d({ doc, look: scene.look, size: scene.doc['size'] as [number, number], fps: FPS, from, frames, selection: scene.selection }), startup), name);
  const want = Array.from({ length: frames }, (_, i) => from + i);
  expect(v.frames.map((f) => f.frame), `${name}: the frames from ${from}, in order`).toEqual(want);
  return new Map(want.map((n) => { const f = frameAt(v, n, name); expect(f.pixel_hash, `${name}: frame ${n} has a pixel hash`).not.toBeNull(); return [n, f.pixel_hash!]; }));
}
/** Seek against play for one effect's scene; each problem names the effect and the frame. */
function seekProblems(effect: string, scene: Scene, startup: Startup = {}): string[] {
  const problems: string[] = [];
  const play = hashes(scene, `${effect}-play`, 0, LAST + 1, startup);
  const again = hashes(scene, `${effect}-play-again`, 0, LAST + 1, startup);
  if (play.get(30) === play.get(LAST)) problems.push(`${effect}: frames 30 and ${LAST} are the same, so the scene doesn't move and seeking can't be told from playing`);
  for (const n of SOUGHT) {
    const sought = hashes(scene, `${effect}-seek-${n}`, n, 1, startup).get(n);
    if (sought !== play.get(n)) problems.push(`${effect}: seeking to frame ${n} draws ${sought?.slice(0, 12)}, playing to it ${play.get(n)?.slice(0, 12)}`);
  }
  if (again.get(LAST) !== play.get(LAST)) problems.push(`${effect}: two plays differ at frame ${LAST}`);
  return problems;
}

describe('#380.b40177b9 every shipped pass that uses noise seeds it from a hash of the pixel and the item\'s seed, never a frame counter or the clock, so seeking equals playing on the pixel hash for every shipped effect', () => {
  it('#380.b40177b9 for every shipped effect, seeking to frames 30 and 90 equals playing to them on this machine\'s pixel hash, and two plays are the same', () => {
    requireGpu();
    const { effects } = shipped();
    const problems = [...effects].flatMap(([effect, op]) => seekProblems(effect, sceneOf(effect, op)));
    expect(problems, `seek against play for ${[...effects.keys()].join(', ')}`).toEqual([]);
  }, 3_600_000);

  it('#380.b40177b9 every shipped operator that draws noise is seeded by the item\'s seed: its scene differs between two seeds and repeats at one', () => {
    requireGpu();
    const { effects, ops } = shipped();
    const noisy = ops.filter((o) => o.noise);
    expect(noisy.length, 'the shipped library has operators that draw seeded noise (particles\' draws at least)').toBeGreaterThan(0);
    for (const op of noisy) {
      const effect = op.effect && effects.has(op.effect) ? op.effect : 'all';
      const scene = (seed: number): Scene => (effect === 'all' ? effectScene('all', { seed }) : sceneOf(effect, op, seed));
      const one = hashes(scene(1), `${op.name}-seed-1`, 30, 1).get(30);
      const two = hashes(scene(2), `${op.name}-seed-2`, 30, 1).get(30);
      const oneAgain = hashes(scene(1), `${op.name}-seed-1-again`, 30, 1).get(30);
      expect(one, `${op.name}: its scene at seed 1 differs from seed 2 (its noise follows the item's seed)`).not.toBe(two);
      expect(oneAgain, `${op.name}: its scene at seed 1 is the same in two processes`).toBe(one);
    }
  }, 3_600_000);

  for (const planted of ['noise_from_frame_counter', 'noise_from_clock'] as const) {
    it(`#380.b40177b9 a planted program that seeds the shipped noise from ${planted === 'noise_from_frame_counter' ? 'the session\'s frame counter' : 'the clock'} (--planted ${planted}) fails seek against play, naming the effect`, () => {
      requireGpu();
      const { effects } = shipped({ planted });
      const problems = [...effects].flatMap(([effect, op]) => seekProblems(effect, sceneOf(effect, op), { planted }));
      expect(problems.length, 'the planted program breaks seek against play for some shipped effect').toBeGreaterThan(0);
      expect(problems.join('\n'), 'each failure names its effect').toMatch(/^(glow|shadow|outline|grid|particles|[a-z_]+): /m);
    }, 3_600_000);
  }
});
