// AC6 #419.fe6b20a9: A mesh sequence whose frames 10 and 11 differ in vertex count, under velocity blur with a shutter
// spanning the change, raises `velocity_topology` naming the item, and every blurred pixel stays inside the item's
// bounds swept over the shutter; a planted velocity pass that pairs vertices by index across the change streaks
// pixels outside those bounds and fails, naming the item.
//
// The flag: a `mesh.sequence@1` (README: Assumed surfaces 9) of 24 per-frame glTF meshes at 24 frames a second from
// 0 s, white unlit, still at the origin, orthographic at 200 px/m on 640 × 480. Frames 0–10 are a 4-vertex bar over
// x ∈ [−1.2, −0.2] m, frames 11–23 a 6-vertex bar over x ∈ [0.2, 1.2] m, both y ∈ [−0.2, 0.2] m, so vertex i < 4 of
// frame 11 lies 0.4–2.4 m (80–480 px) to the right of vertex i of frame 10; the bar's right end (x = 1.2 m) is vertex 2,
// whose index partner in frame 10 sits at x = −1.2 m. The view's frame 11 (t = 11/24 s) under velocity blur at
// 180° and 24 fps has its shutter [t − 1/96, t + 1/96] spanning the change. That frame's notices include
// {code: velocity_topology, item: flag}; at least 14,000 pixels are lit (the bar is 200 × 80 px); and no pixel with
// linear luminance over 1/256 lies outside the bounds swept over the shutter (the union of both frames' boxes,
// x ∈ [80, 560), y ∈ [200, 280) px) by more than 2 px. `--planted velocity_pairs_by_index` pairs vertex i across the
// change (up to a 480 px velocity, capped at 32 px), smearing the bar's right end up to 16 px past x = 560: it fails,
// naming `flag`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, blur, failsNaming, framesOf, gltf, look, lum, none, ortho, readLinear, requireMetal, runGpu, sessionDoc, shown, unlit, useDir,
  useGpu, view3dCall, writeJson, type GpuPlanted, type Mesh,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const SWEPT = { x0: 80, x1: 560, y0: 200, y1: 280 };
const MARGIN = 2;
/** A bar from x0 to x1 at y ∈ [−0.2, 0.2], in `cols` cells: (cols + 1) × 2 vertices, bottom row first. */
function bar(x0: number, x1: number, cols: number): Mesh {
  const positions: Mesh['positions'] = [];
  for (const y of [-0.2, 0.2]) for (let i = 0; i <= cols; i++) positions.push([x0 + ((x1 - x0) * i) / cols, y, 0]);
  const triangles: Mesh['triangles'] = [];
  for (let i = 0; i < cols; i++) triangles.push([i, i + 1, cols + 2 + i], [i, cols + 2 + i, cols + 1 + i]);
  return { positions, triangles };
}

function problems(out: string, planted?: GpuPlanted): string[] {
  const a = gltf(bar(-1.2, -0.2, 1)); const b = gltf(bar(0.2, 1.2, 2));
  const assets: Record<string, string> = {};
  for (const g of [a, b]) { const p = join(out, `${g.sha}.gltf`); writeFileSync(p, g.bytes); assets[g.sha] = p; }
  const doc = sessionDoc('flag-419', SIZE, {
    cam: ortho([0, 0, 0], 3.2), sky: DARK_SKY, white: unlit([1, 1, 1]),
    flag: { kind: 'mesh.sequence@1', at: { pos: [0, 0, 0] }, material: 'white', params: { frames: Array.from({ length: 24 }, (_, f) => (f < 11 ? a.sha : b.sha)), frame_rate: 24, start: '0s', interpolate: 'linear' } },
  });
  const [reply] = runGpu(bin(), out, [view3dCall({
    doc: writeJson(out, 'flag', doc), look: look({ motionBlur: blur('velocity') }), size: SIZE, class: 'export', fps: 24, from: 11, frames: 1, targets: ['linear'], assets,
  })], planted);
  const f = framesOf(reply!, 'the flag at frame 11')[0]!;
  const failures: string[] = [];
  if (!f.notices.some((n) => n['code'] === 'velocity_topology' && n['item'] === 'flag')) failures.push(`flag: frame 11 raises no velocity_topology naming it; notices ${shown(f.notices)}`);
  const lin = readLinear(out, f, SIZE, 'the flag at frame 11');
  let lit = 0; let outside = 0; let first = '';
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    if (lum(lin.at(x, y)) <= 1 / 256) continue;
    lit++;
    if (x < SWEPT.x0 - MARGIN || x >= SWEPT.x1 + MARGIN || y < SWEPT.y0 - MARGIN || y >= SWEPT.y1 + MARGIN) { outside++; if (!first) first = `(${x}, ${y})`; }
  }
  console.log(`${AC[6]}: ${lit} lit px, ${outside} outside the swept bounds${first ? `, first ${first}` : ''}`);
  if (lit < 14_000) failures.push(`flag: only ${lit} px lit at frame 11; the bar covers 16,000`);
  if (outside) failures.push(`flag: ${outside} blurred px lie outside its bounds swept over the shutter, the first at ${first}`);
  return failures;
}

describe(`${AC[6]} velocity never pairs vertices across a topology change`, () => {
  it(`${AC[6]} the change inside the shutter raises velocity_topology naming the flag, and every blurred pixel stays inside its swept bounds`, () => {
    requireMetal();
    none(problems(dir()), 'the flag across its topology change');
  }, 1_800_000);

  it(`${AC[6]} the planted velocity pass that pairs vertices by index streaks past the bounds and fails, naming the item`, () => {
    requireMetal();
    failsNaming(problems(dir(), 'velocity_pairs_by_index'), ['flag: ', 'outside its bounds'], '--planted velocity_pairs_by_index');
  }, 1_800_000);
});
