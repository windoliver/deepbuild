// AC2: "On a glTF terrain fixture with 40 m of relief, a 64 × 64 cell heatmap projected straight down puts every cell's
// centre within one inset texel of its x and z on slopes up to 60°; its unlit cells read their legend swatches' 8-bit
// values within 1 code value with the sun at 10°, 45° and 80° and at two exposures 2 EV apart; and the pixels of a tree
// outside `onto`, and of the terrain outside the box, equal those of the same frame drawn without the projection"
//
// The fixture (helpers.ts: TERRAIN, terrainDoc): the terrain is a JSON glTF written here, 128 m square on a 1 m grid,
// y = 20 sin(kx) sin(kz) with k = tan 60° ÷ 20 (checked from the mesh: 40 m of relief within 0.5 m, its steepest
// triangle between 59° and 61°). The heatmap is a projected inset, `from: down`, onto `terrain`, over a 64 m box
// centred on the origin: 64 × 64 cells of role `data` at 4 px a metre (a texel is 0.25 m), cell (i, j) painted
// `heat-((i + 3j) mod 8)`, so every neighbour of a cell has another swatch and a shift of a cell shows. A tree stands
// in the box, outside `onto`. Two views look down 65° from +Z (A) and from −Z (B), 800 × 600, so a slope that turns
// away from one faces the other.
//
// The reference: for each pixel, rays through its four corners against the mesh's own f32 triangles (and the tree's
// box). A pixel is judged where all four land on the terrain in one cell, each at least one texel inside it, so a
// heatmap within one texel of its cells' places reads that cell's swatch there whatever the slope; a screen-space
// projection, one along the surface normal, or one by the mesh's own parameterisation misplaces cells on the slopes.
//
// asserts, through `view3d` (final and object-ID targets):
//   - view A under the sun at 10°, 45° and 80° (3 lx, with a day sky), each at the look's exposure and 2 EV brighter,
//     and view B at 45°: every judged pixel reads its cell's swatch (the look's role color) within 1 code value on
//     each channel; every one of the 4,096 cells has a judged pixel in A or B;
//   - view A at 45° with and without the heatmap: every pixel of the tree (the tree in it and its eight neighbours),
//     and every pixel whose four corners land on the terrain at least a texel outside the box, are equal;
//   - guards: at least 50 tree pixels and 2,000 pixels outside the box; the brighter exposure moves those pixels
//     (so the cells' steadiness isn't a look that ignores exposure).
// Wrong programs: the base (no projected inset); a lit heatmap (it moves with the sun and the exposure); a projection
// that lands on the tree or past the box; a misplaced or stretched grid.
import { describe, expect, it } from 'vitest';
import {
  HEAT, ROLES, TERRAIN, TERRAIN_SIZE, TIMEOUT, TREE, ac, cellRole, codeOff, finalOf, fmt, frameAt, framesOf, hexRgb, hitBox, idAround, idsOf, look, none,
  px, rayOf, requireGpu, rgbText, runGpu, terrainCam, terrainDoc, terrainHit, terrainMesh, terrainShape, useBins, useDir, view3d, writeJson, writeTerrain,
  type Cam, type Image, type JsonObject, type Terrain,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const [W, H] = TERRAIN_SIZE;
const HALF = TERRAIN.box / 2;

/** What each pixel corner's ray meets first: 0 nothing, 1 the terrain at (x, z), 2 the tree. */
interface Corners { kind: Uint8Array; x: Float64Array; z: Float64Array }
function corners(t: Terrain, cam: Cam): Corners {
  const n = (W + 1) * (H + 1);
  const out: Corners = { kind: new Uint8Array(n), x: new Float64Array(n), z: new Float64Array(n) };
  for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
    const k = cy * (W + 1) + cx;
    const { o, d } = rayOf(cam, cx, cy);
    const hit = terrainHit(t, o, d);
    const tree = hitBox(o, d, TREE.pos, TREE.size);
    if (tree && (!hit || tree[0] < hit.dist)) { out.kind[k] = 2; continue; }
    if (!hit) continue;
    out.kind[k] = 1; out.x[k] = hit.p[0]; out.z[k] = hit.p[2];
  }
  return out;
}
const cornerIndex = (x: number, y: number): number[] => [y * (W + 1) + x, y * (W + 1) + x + 1, (y + 1) * (W + 1) + x, (y + 1) * (W + 1) + x + 1];
/** The cell every corner of pixel (x, y) lands in, at least a texel inside it, or null. */
function judgedCell(c: Corners, x: number, y: number): [number, number] | null {
  let cell: [number, number] | null = null;
  for (const k of cornerIndex(x, y)) {
    if (c.kind[k] !== 1) return null;
    const u = c.x[k]! + HALF; const v = c.z[k]! + HALF;
    const i = Math.floor(u); const j = Math.floor(v);
    if (i < 0 || j < 0 || i >= TERRAIN.n || j >= TERRAIN.n) return null;
    const fu = u - i; const fv = v - j;
    if (fu < TERRAIN.texel || fu > 1 - TERRAIN.texel || fv < TERRAIN.texel || fv > 1 - TERRAIN.texel) return null;
    if (cell && (cell[0] !== i || cell[1] !== j)) return null;
    cell = [i, j];
  }
  return cell;
}
/** Whether every corner of pixel (x, y) lands on the terrain at least a texel outside the box, past one of its sides. */
function outsideBox(c: Corners, x: number, y: number): boolean {
  const ks = cornerIndex(x, y);
  if (!ks.every((k) => c.kind[k] === 1)) return false;
  const lim = HALF + TERRAIN.texel;
  return ks.every((k) => c.x[k]! >= lim) || ks.every((k) => c.x[k]! <= -lim) || ks.every((k) => c.z[k]! >= lim) || ks.every((k) => c.z[k]! <= -lim);
}
/** Each judged pixel that doesn't read its cell's swatch within 1 code, and the cells judged. */
function swatchFailures(im: Image, c: Corners, what: string, seen: Set<number>): string[] {
  const failures: string[] = [];
  let bad = 0; let first = ''; let judged = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cell = judgedCell(c, x, y);
    if (!cell) continue;
    judged++;
    seen.add(cell[1] * TERRAIN.n + cell[0]);
    const role = cellRole(cell[0], cell[1]);
    const want = hexRgb(ROLES[role]!);
    const got = px(im, x, y);
    if (codeOff(got, want) > 1) { bad++; if (!first) first = `pixel (${x}, ${y}) in cell (${cell[0]}, ${cell[1]}) reads ${rgbText(got)}, its swatch ${role} is ${rgbText(want)}`; }
  }
  if (judged < 20_000) failures.push(`${what}: only ${judged} judged pixels (the fixture judges tens of thousands)`);
  if (bad) failures.push(`${what}: ${bad} of ${judged} judged pixels are off their cell's swatch by more than 1 code value; first ${first}`);
  return failures;
}

describe(`${ac(2)} a heatmap projected down onto glTF terrain`, () => {
  it(`${ac(2)} every cell lands within a texel of its x and z on slopes to 60°, reads its swatch within 1 code under three suns and two exposures, and the tree and the terrain outside the box are untouched`, () => {
    requireGpu();
    const out = dir();
    const t = terrainMesh();
    const shape = terrainShape(t);
    expect(Math.abs(shape.relief - 40), `the fixture: 40 m of relief (the mesh has ${fmt(shape.relief, 3)} m)`).toBeLessThanOrEqual(0.5);
    expect(shape.steepest >= 59 && shape.steepest <= 61, `the fixture: slopes up to 60° (its steepest triangle is ${fmt(shape.steepest, 2)}°)`).toBe(true);
    const asset = writeTerrain(out, t);
    const assets = { [asset.sha]: asset.path };
    const doc = (view: 0 | 180, sun: number, heatmap: boolean): string => writeJson(out, `terrain-${view}-${sun}-${heatmap ? 'map' : 'bare'}`, terrainDoc(asset.sha, { view, sun, heatmap }));
    const call = (d: string, ev: number, ids = false): JsonObject => view3d({ doc: d, look: look(ev), size: TERRAIN_SIZE, assets, targets: ids ? ['final', 'ids'] : ['final'] });
    const a45 = doc(0, 45, true);
    const runs: [string, JsonObject][] = [
      ['view A, sun at 45°, the look\'s exposure', call(a45, 0, true)],
      ['view A without the heatmap, sun at 45°', call(doc(0, 45, false), 0, true)],
      ['view B, sun at 45°, the look\'s exposure', call(doc(180, 45, true), 0)],
      ['view A, sun at 10°, the look\'s exposure', call(doc(0, 10, true), 0)],
      ['view A, sun at 80°, the look\'s exposure', call(doc(0, 80, true), 0)],
      ['view A, sun at 10°, 2 EV brighter', call(doc(0, 10, true), 2)],
      ['view A, sun at 45°, 2 EV brighter', call(a45, 2)],
      ['view A, sun at 80°, 2 EV brighter', call(doc(0, 80, true), 2)],
    ];
    const replies = runGpu(bin('deep-gpu'), out, runs.map(([, c]) => c));
    const shot = (i: number) => frameAt(framesOf(replies[i]!, runs[i]![0]), 0, runs[i]![0]);
    const images = runs.map((r, i) => finalOf(out, shot(i), r[0]));
    const cornersA = corners(t, terrainCam(0));
    const cornersB = corners(t, terrainCam(180));

    const failures: string[] = [];
    const seen = new Set<number>();
    for (const i of [0, 3, 4, 5, 6, 7]) failures.push(...swatchFailures(images[i]!, cornersA, runs[i]![0], seen));
    failures.push(...swatchFailures(images[2]!, cornersB, runs[2]![0], seen));
    if (seen.size < TERRAIN.n * TERRAIN.n) {
      const missing: string[] = [];
      for (let j = 0; j < TERRAIN.n && missing.length < 8; j++) for (let i = 0; i < TERRAIN.n && missing.length < 8; i++) if (!seen.has(j * TERRAIN.n + i)) missing.push(`(${i}, ${j})`);
      failures.push(`only ${seen.size} of the ${TERRAIN.n * TERRAIN.n} cells have a judged pixel in view A or view B; first missing ${missing.join(', ')}`);
    }

    // The tree and the terrain outside the box, with and without the heatmap.
    const ids = idsOf(out, shot(0), runs[0]![0]);
    const bare = images[1]!; const mapped = images[0]!;
    let tree = 0; let treeBad = 0; let treeFirst = '';
    let outside = 0; let outsideBad = 0; let outsideFirst = ''; let brighter = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (idAround(ids, x, y, 'tree')) {
        tree++;
        if (codeOff(px(mapped, x, y), px(bare, x, y)) > 0) { treeBad++; if (!treeFirst) treeFirst = `(${x}, ${y}) reads ${rgbText(px(mapped, x, y))}, without the heatmap ${rgbText(px(bare, x, y))}`; }
      } else if (outsideBox(cornersA, x, y)) {
        outside++;
        if (codeOff(px(mapped, x, y), px(bare, x, y)) > 0) { outsideBad++; if (!outsideFirst) outsideFirst = `(${x}, ${y}) reads ${rgbText(px(mapped, x, y))}, without the heatmap ${rgbText(px(bare, x, y))}`; }
        const lo = px(mapped, x, y); const hi = px(images[6]!, x, y);
        if (hi[0] + hi[1] + hi[2] > lo[0] + lo[1] + lo[2] + 6) brighter++;
      }
    }
    expect(tree, 'the fixture: the tree covers at least 50 pixels of view A').toBeGreaterThanOrEqual(50);
    expect(outside, 'the fixture: at least 2,000 pixels of view A show the terrain outside the box').toBeGreaterThanOrEqual(2000);
    expect(brighter, 'the guard: 2 EV brighter lifts most of the terrain outside the box').toBeGreaterThan(outside / 2);
    if (treeBad) failures.push(`the tree, outside onto: ${treeBad} of ${tree} pixels differ from the same frame without the projection; first ${treeFirst}`);
    if (outsideBad) failures.push(`the terrain outside the box: ${outsideBad} of ${outside} pixels differ from the same frame without the projection; first ${outsideFirst}`);
    console.log(`${ac(2)}: ${seen.size} cells judged; ${tree} tree pixels; ${outside} pixels outside the box; swatches ${HEAT.map((r) => ROLES[r]).join(' ')}`);
    none(failures, 'the projected heatmap on the terrain');
  }, TIMEOUT);
});
