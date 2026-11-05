// AC7 #428.b8f33c38: Flakes sparkle in place: a 1 m panel with `flakes: {weight: 1, size: 0.01 m, tilt: 15°}` under a sun
// shows bright cells (above half the flake lobe's peak) exactly where a CPU evaluation in f64 of each cell's hashed flake
// normal puts the half vector inside the lobe's half maximum, apart from cells within 0.1° of that edge; the same cells
// shine seeked or played and after the camera dollies along its axis; at weight 0 the panel draws byte for byte as with
// no flakes; and a planted flake hashed by pixel moves its sparkles with the dolly and fails, naming a cell.
//
// Test 1: the panel (`FLAKE_PAINT`: base color black, specular_level 0, coat 0, coat_roughness 0.3, pattern_seed 428,
// white flakes of 1 cm tilted up to 15°) at 1,100 × 1,100 under a π lx sun 20° off its normal, the camera on its axis
// dollying from 3.3 m to 3.0 m over 1 s (about 9 to 10 px a cell). For frames 0 and 30 of one run, and frame 30 of a
// fresh process seeking there: each of the 10,000 cells' centre pixel is bright when its linear luminance is above half
// the brightest cell's; the CPU, in f64 (`reference.ts`: `flakeNormal`, the base shader's `hash3` of the cell and the
// pattern seed's FNV-1a), puts each cell's flake normal m and the half vector h between the sun and that cell's centre
// as seen from the frame's camera, and predicts bright where angle(m, h) is under the GGX half-maximum angle at α =
// 0.3² (3.33°); cells within 0.1° of it aren't judged. Bright cells equal predicted ones in all three frames, and the
// seeked frame's bright cells equal the played frame's. `--planted flakes_by_pixel` fails naming a cell.
// Test 2: the same panel with `flakes: {weight: 0, size: 0.01, tilt: 15}` and with no `flakes`, both on a red paint
// (base color [0.6, 0.1, 0.1], roughness 0.4) at frames 0 and 30: final and linear targets byte for byte equal.
// Wrong programs: the base (no flakes); flakes hashed by pixel, by world position (they'd move under a moved part) or
// by frame; a lobe of another width; a hash other than the one named (README: Assumed surfaces); flakes that draw at 0.
import { describe, expect, it } from 'vitest';
import {
  AC, FLAKE_FPS, FLAKE_PAINT, FLAKE_SEED, FLAKE_SUN, PLAIN_LOOK, SHA, failsNaming, flakeCamZ, flakeDoc, flakeFov, frameAt, framesOf, none, readLinear,
  requireMetal, runGpu, useDir, useGpu, view3dCall, writeJson, type GpuPlanted,
} from './helpers.ts';
import { add, deg, dot, flakeNormal, fnv1a, halfMaxAngle, lum, project, rad, sub, towardSun, unit, type Pinhole, type V3 } from './reference.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const SIZE = 1100;
const FRAMES = [0, FLAKE_FPS];
const HALF = halfMaxAngle(0.3 * 0.3);
const EDGE = rad(0.1);

interface Cell { i: number; j: number; centre: V3; m: V3 }
const CELLS: Cell[] = [];
for (let i = -50; i < 50; i++) for (let j = -50; j < 50; j++) {
  // The panel's own space: metres from its centre along its axes; its front face at z = 1 mm, in the cells z = 0.
  CELLS.push({ i, j, centre: [(i + 0.5) * 0.01, (j + 0.5) * 0.01, 0.001], m: flakeNormal([i, j, 0], fnv1a(JSON.stringify(FLAKE_SEED)), 15, [0, 0, 1]) });
}
const camAt = (frame: number): Pinhole => ({ position: [0, 0, flakeCamZ(frame)], target: [0, 0, 0], fov: flakeFov(SIZE), size: [SIZE, SIZE] });
/** The CPU's call per cell for the view at `frame`: bright, dark, or too near the edge to judge. */
function predicted(frame: number): Map<string, boolean> {
  const l = towardSun(FLAKE_SUN); const cam = camAt(frame).position;
  const out = new Map<string, boolean>();
  for (const c of CELLS) {
    const h = unit(add(l, unit(sub(cam, c.centre))));
    const a = Math.acos(Math.min(1, dot(c.m, h)));
    if (Math.abs(a - HALF) >= EDGE) out.set(`${c.i},${c.j}`, a < HALF);
  }
  return out;
}
/** Each cell's centre pixel in the frame, bright when above half the brightest cell's luminance. */
function observed(lin: ReturnType<typeof readLinear>, frame: number): Map<string, boolean> {
  const cam = camAt(frame);
  const l = CELLS.map((c) => { const [x, y] = project(cam, c.centre); return lum(lin.at(Math.floor(x), Math.floor(y))); });
  const peak = Math.max(...l);
  return new Map(CELLS.map((c, k) => [`${c.i},${c.j}`, l[k]! > peak / 2]));
}
function sparkles(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'flakes', flakeDoc(SIZE, FLAKE_PAINT));
  const [played, seeked] = runGpu(bin(), out, [
    view3dCall({ doc, look: PLAIN_LOOK, size: [SIZE, SIZE], fps: FLAKE_FPS, frames: FLAKE_FPS + 1, capture: FRAMES, targets: ['linear'] }),
    view3dCall({ doc, look: PLAIN_LOOK, size: [SIZE, SIZE], fps: FLAKE_FPS, from: FLAKE_FPS, frames: FLAKE_FPS + 1, capture: [FLAKE_FPS], targets: ['linear'] }),
  ], planted);
  const failures: string[] = [];
  const seen = new Map<string, Map<string, boolean>>();
  for (const [what, reply, frame] of [['played', played!, 0], ['played', played!, FLAKE_FPS], ['seeked', seeked!, FLAKE_FPS]] as const) {
    const lin = readLinear(out, frameAt(framesOf(reply, `${what} frame ${frame}`), frame, `${what} frame ${frame}`).linear, [SIZE, SIZE], `${what} frame ${frame}`);
    const obs = observed(lin, frame); const want = predicted(frame);
    seen.set(`${what} ${frame}`, obs);
    expect([...want.values()].filter(Boolean).length, `the CPU predicts bright cells at frame ${frame}`).toBeGreaterThan(100);
    let wrong = 0;
    for (const [cell, bright] of want) {
      if (obs.get(cell) === bright) continue;
      wrong++;
      if (wrong <= 10) failures.push(`cell (${cell}) at ${what} frame ${frame} (camera at ${flakeCamZ(frame).toFixed(2)} m): ${obs.get(cell) ? 'shines' : 'is dark'}, the CPU says ${bright ? 'bright' : 'dark'} (angle(m, h) against the half maximum ${deg(HALF).toFixed(3)}°)`);
    }
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${what} frame ${frame}: ${[...obs.values()].filter(Boolean).length} bright cells, ${wrong} of ${want.size} judged cells off the CPU's call`);
  }
  const a = seen.get(`played ${FLAKE_FPS}`)!; const b = seen.get(`seeked ${FLAKE_FPS}`)!;
  const moved = [...a.keys()].filter((k) => a.get(k) !== b.get(k));
  if (moved.length) failures.push(`cell (${moved[0]}): frame ${FLAKE_FPS} shines differently seeked than played (${moved.length} cells)`);
  return failures;
}

describe(`${ID} flakes sparkle in place`, () => {
  it(`${ID} bright cells are exactly where the CPU's f64 flake normals put the half vector inside the lobe's half maximum, at frame 0, after the dolly, and seeked; a planted flake hashed by pixel fails, naming a cell`, () => {
    requireMetal();
    none(sparkles(), 'the flake panel against the CPU');
    failsNaming(sparkles('flakes_by_pixel'), ['cell ('], '--planted flakes_by_pixel');
  }, 3_600_000);

  it(`${ID} at weight 0 the panel draws byte for byte as with no flakes`, () => {
    requireMetal();
    const out = dir();
    const red = { base_color: [0.6, 0.1, 0.1, 1], metallic: 0, roughness: 0.4, pattern_seed: FLAKE_SEED };
    const calls = [{ ...red, flakes: { weight: 0, size: 0.01, tilt: 15 } }, red].map((paint, i) =>
      view3dCall({ doc: writeJson(out, `paint-${i}`, flakeDoc(SIZE, paint)), look: PLAIN_LOOK, size: [SIZE, SIZE], fps: FLAKE_FPS, frames: FLAKE_FPS + 1, capture: FRAMES, targets: ['final', 'linear'] }));
    const [zero, bare] = runGpu(bin(), out, calls).map((r, i) => framesOf(r, i === 0 ? 'weight 0' : 'no flakes'));
    for (const frame of FRAMES) {
      const a = frameAt(zero!, frame, 'weight 0'); const b = frameAt(bare!, frame, 'no flakes');
      expect([a.final, a.linear, b.final, b.linear].every((h) => h !== null && SHA.test(h)), `frame ${frame}: both runs write their targets, named by SHA-256`).toBe(true);
      expect(a.final, `frame ${frame}: the final target at weight 0 is byte for byte the one with no flakes`).toBe(b.final);
      expect(a.linear, `frame ${frame}: the linear target at weight 0 is byte for byte the one with no flakes`).toBe(b.linear);
    }
  }, 3_600_000);
});
