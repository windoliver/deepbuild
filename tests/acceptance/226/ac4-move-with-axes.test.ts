// AC4 #226.a8945cc1: "Moving the axes item by 1 m moves a surface and a point parented to it by 1 m, with no rebuild of
// the surface; a planted `mod.axes@1` that applies the axes' transform as well as their scales moves them by 2 m and
// fails, naming the modifier"
//
// The axes of criterion 1 at the origin, the point `pt` at (2, 3, 1) and the surface `surface` (a `plate@1` of 4 × 4
// cells, 25 vertices), both parented to the axes and carrying `mod.axes@1`. `view3d` draws two frames; a patch before
// frame 1 sets the axes' `at.pos` to (1, 0, 0), a move of 1 m along +X. Each frame reports both items' vertices in world
// space (`world`, README: Assumed surfaces 3) and its counters (`counts`). The judge: every vertex of each item moves by
// (1, 0, 0) within 1e-5 m, each failure naming the item, mod.axes@1 and how far it moved; frame 1 builds no mesh
// (`meshes_built` 0), while frame 0 built the surface. The second test runs the same scenario under
// `deep-gpu run --planted axes_mod_applies_transform` (README: The planted programs): the judge fails, naming
// mod.axes@1 and a move of 2 m.
// Wrong programs: the base (no axes3d@1, no `world`); items placed through the axes' scales but not parented to their
// transform (they stay put); the plant (2 m); a move that rebuilds the surface's mesh.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN, TIMEOUT, WRITER, axesDoc, fmt, framesOf, length, num, pointOnAxes, requireMetal, runGpu, set, sub, surfaceOnAxes, useBins, useOut,
  worldOf, writeJson, type JsonObject, type Planted, type V3,
} from './helpers.ts';

const ID = AC[4];
const NAME = `AC4 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const ITEMS = ['pt', 'surface'] as const;
const MOVE: V3 = [1, 0, 0];

/** Both frames of the move, drawn with or without a plant. */
function moved(planted?: Planted): JsonObject[] {
  const dir = out();
  const doc = writeJson(dir, 'move', axesDoc('move-226', [640, 360], { pt: pointOnAxes([2, 3, 1]), surface: surfaceOnAxes() }));
  const patches = [{ frame: 1, writer: WRITER, ops: [set('axes', 'at/pos', [...MOVE])] }];
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], frames: 2, patches, world: [...ITEMS], counts: true }], planted);
  return framesOf(reply!, 2, `the move${planted ? ` (--planted ${planted})` : ''}`);
}
/** Each item's vertices moved by exactly the axes' move, within 1e-5 m; each failure names the item and mod.axes@1. */
function moveFailures(frames: JsonObject[]): string[] {
  const failures: string[] = [];
  for (const id of ITEMS) {
    const [before, after] = [worldOf(frames[0]!, id, 'frame 0'), worldOf(frames[1]!, id, 'frame 1')];
    expect(after.length, `${id} has as many vertices after the move as before`).toBe(before.length);
    expect(before.length, `${id} has vertices`).toBeGreaterThan(0);
    let worst = 0; let at = 0;
    before.forEach((p, k) => { const off = length(sub(sub(after[k]!, p), MOVE)); if (off > worst) { worst = off; at = k; } });
    if (worst > 1e-5) {
      const d = sub(after[at]!, before[at]!);
      failures.push(`${id} (carrying mod.axes@1): vertex ${at} moved by ${fmt(d, 6)}, ${length(d).toFixed(6)} m, when the axes moved by 1 m along +X`);
    }
  }
  return failures;
}

describe(`${NAME} items on the axes move with them without a rebuild`, () => {
  it(`${NAME} moving the axes by 1 m moves the surface and the point parented to them by 1 m, with no rebuild of the surface`, () => {
    requireMetal();
    const frames = moved();
    expect(num(frames[0]!['meshes_built'], 'frame 0: meshes_built'), 'frame 0 builds the surface').toBeGreaterThan(0);
    expect(moveFailures(frames), 'the surface and the point move by the axes\' 1 m').toEqual([]);
    expect(num(frames[1]!['meshes_built'], 'frame 1: meshes_built'), 'the move rebuilds no mesh: the surface is not rebuilt').toBe(0);
  }, TIMEOUT);

  it(`${NAME} a planted mod.axes@1 that applies the axes' transform as well as their scales moves them by 2 m and fails, naming the modifier`, () => {
    requireMetal();
    const failures = moveFailures(moved('axes_mod_applies_transform'));
    expect(failures.length, 'the judge fails the plant').toBeGreaterThan(0);
    expect(failures.every((f) => f.includes('mod.axes@1')), `each failure names the modifier: ${failures.join('; ')}`).toBe(true);
    expect(failures.some((f) => /, 2\.0000\d\d m,/.test(f)), `the plant moves them by 2 m: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
