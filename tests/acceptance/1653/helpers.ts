// Test-side tools for the #1653 acceptance tests. The binary, the JSON-lines driver, PNG reading and writing, the look
// and #467's terrain fixture come from ../467/helpers.ts by import; this file adds the documents this suite draws (the
// halo cards, the atlas tile sets, the status groups), typed columns, an asset store, and the layouts the issue and the
// design state (isometric, hex), computed here in f64. Nothing here stands in for the renderer.
// README: The surface under test.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  backdrop, decodePng, encodeRgbaPng, item, obj, px, render, sha256, shown, str, LOOK, REPO,
  type Image, type JsonObject, type JsonValue,
} from '../467/helpers.ts';

export {
  arr, atlasPng, check, describeErrors, errorsOf, failsNaming, fl, FLICKS, glyphsOf, item, LOOK, none, num, obj, px,
  refusalNames, render, role, seeded, shown, str, terrain, textEntry, tilesOf, useBin, useDir, type Image, type Issue, type JsonObject,
  type JsonValue,
} from '../467/helpers.ts';

/** The criteria's IDs: `#1653.` + the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1653.7cb93294',
  2: 'AC2 #1653.91f150e7',
  3: 'AC3 #1653.0a06a5ae',
  4: 'AC4 #1653.00cbd0dd',
} as const;

// ---------------------------------------------------------------------------------------------------
// Documents

/** The envelope every document here takes: one writer layer `main`, class figure (#373's, as #467's suite builds it). */
export function doc(id: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#1653 ${id}`, description: `The #1653 acceptance document ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}

/** A typed column `{dtype, len, data: base64}` (Mark set and columns). */
export function col(dtype: 'i32' | 'u16' | 'u8', values: number[]): JsonObject {
  const size = { i32: 4, u16: 2, u8: 1 }[dtype];
  const b = Buffer.alloc(size * values.length);
  values.forEach((v, i) => {
    if (dtype === 'i32') b.writeInt32LE(v, i * 4);
    else if (dtype === 'u16') b.writeUInt16LE(v, i * 2);
    else b.writeUInt8(v, i);
  });
  return { dtype, len: values.length, data: b.toString('base64') };
}

/** A content-addressed store under `dir`: each PNG written as a file named by its bare SHA-256, as `check`'s and `raster`'s `store` read it. */
export function putAssets(dir: string, pngs: Buffer[]): string[] {
  return pngs.map((png) => {
    const hash = sha256(png);
    writeFileSync(join(dir, hash), png);
    return hash;
  });
}

export interface Row { cx: number; cy: number; tile: number; flip?: number }
/**
 * An atlas tile set (Mark set: atlas tiles): `marks@1` with `mark: image`, an `atlas` on `asset` with cells of
 * `cell` px and padding 1, a `grid`, and one row per `rows` entry in the order given (`cx`, `cy`, `tile`, and `flip`
 * where any row sets it). `columns` adds columns such as `frames`.
 */
export function atlasSet(id: string, order: string, asset: string, cell: [number, number], grid: JsonObject, rows: Row[], columns: JsonObject = {}): JsonObject {
  const cols: JsonObject = { cx: col('i32', rows.map((r) => r.cx)), cy: col('i32', rows.map((r) => r.cy)), tile: col('u16', rows.map((r) => r.tile)) };
  if (rows.some((r) => r.flip !== undefined)) cols['flip'] = col('u8', rows.map((r) => r.flip ?? 0));
  return item(id, 'marks@1', order, { mark: 'image', n: rows.length, atlas: { asset, cell, padding: 1 }, grid, columns: { ...cols, ...columns } });
}

export type Rgb = [number, number, number];
/** An atlas of solid cells side by side, `cell` px each, cell k in `colors[k]`, opaque. */
export function solidAtlas(cell: [number, number], colors: Rgb[]): Buffer {
  return encodeRgbaPng(cell[0] * colors.length, cell[1], (x) => [...colors[Math.floor(x / cell[0])]!, 255]);
}

// ---------------------------------------------------------------------------------------------------
// Drawing and reading pixels

let rasters = 0;
/** A `raster` line drawing `d` at `t` flicks into a PNG under `dir`, with `extra` (`store`, `view`). */
export function rasterLine(dir: string, d: JsonObject, t = 0, extra: JsonObject = {}): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${process.pid}-${rasters}.png`), doc: d, look: LOOK, t, ...extra };
}
/** Each line through one `raster` process (a play), each answer accepted and its PNG read. */
export function rasterLines(bin: string, lines: JsonObject[], what: string): { answer: JsonObject; image: Image }[] {
  const answers = render(bin, 'raster', lines);
  return answers.map((a, i) => {
    expect(a['ok'], `raster ${what} [${i}] was drawn, not refused: ${shown(a)}`).toBe(true);
    return { answer: a, image: decodePng(readFileSync(str(lines[i]!['out'], 'out'))) };
  });
}

/** The largest per-channel difference between a pixel's RGB and `want`. */
export const rgbOff = (im: Image, x: number, y: number, want: Rgb): number => {
  const p = px(im, x, y);
  return Math.max(Math.abs(p[0] - want[0]), Math.abs(p[1] - want[1]), Math.abs(p[2] - want[2]));
};
export const sameBytes = (a: Image, b: Image): boolean => a.width === b.width && a.height === b.height && a.rgba.every((v, i) => v === b.rgba[i]);

// ---------------------------------------------------------------------------------------------------
// AC1: halos

export const CARD_SIZE: [number, number] = [360, 160];
/** A card: the paper backdrop and one text@1 `word`, "Paint" at 72 px in `title`, with `halo` when given. */
export function haloCard(id: string, halo?: JsonObject[]): JsonObject {
  return doc(id, CARD_SIZE, [
    backdrop(CARD_SIZE),
    item('word', 'text@1', 'a1', { text: 'Paint', font: 'body', size: 72, box: { w: 280, h: 100 }, paint: { fill: { role: 'title' } }, ...(halo ? { halo } : {}) }, { at: { pos: [40, 30, 0] } }),
  ]);
}
/**
 * A number that fits its box with room on every side: a story constant 8 at 20 px, centred both ways in a 40 × 40 u
 * box that doesn't grow (Honest numbers: a number that doesn't fit fails), with `halo` when given.
 */
export function haloNumber(id: string, halo?: JsonObject[]): JsonObject {
  return doc(id, [200, 120], [
    backdrop([200, 120]),
    item('fit', 'text@1', 'a1', { template: '{data/k}', font: 'body', size: 20, box: { w: 40, h: 40 }, autosize: 'none', max_lines: 1, align: 'center', valign: 'middle', paint: { fill: { role: 'title' } }, ...(halo ? { halo } : {}) }, { at: { pos: [80, 40, 0] } }),
  ], { data: { k: { value: 8, source: 'story' } } });
}

/** For each pixel, the distance in px from its centre to the nearest pixel `inside` holds, up to `limit` (Infinity past it). */
export function distanceTo(width: number, height: number, inside: (x: number, y: number) => boolean, limit: number): Float64Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = inside(x, y) ? 1 : 0;
  const out = new Float64Array(width * height).fill(Infinity);
  const r = Math.ceil(limit);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let best = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const sx = x + dx; const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !mask[sy * width + sx]) continue;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    out[y * width + x] = best <= limit ? best : Infinity;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC2: the terrain floor, flips, animated rows

/** #467's terrain atlas: tile k is the solid color (40 + 40k, 140, 60) (../467/helpers.ts `atlasPng`). */
export const terrainColor = (tile: number): Rgb => [40 + 40 * tile, 140, 60];
/** #467's terrain grid: pointy hexes, offset odd, cell [32, 28] (../467/helpers.ts `terrain`). */
export const HEX_CELL: [number, number] = [32, 28];
/** The design's hex layout (Mark set: hex grid), pointy, offset odd: x = w × (cx + s ÷ 2), y = 0.75 × h × cy, s = 1 on an odd row (cy mod 2, floored). */
export function hexCentre(cx: number, cy: number): [number, number] {
  const s = ((cy % 2) + 2) % 2 === 1 ? 1 : 0;
  return [HEX_CELL[0] * (cx + s / 2), 0.75 * HEX_CELL[1] * cy];
}
/** #467's 30-cell floor: cx 0..5, cy 0..4. */
export const FLOOR: [number, number][] = [];
for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 6; cx++) FLOOR.push([cx, cy]);

/** A 16 × 16 tile whose texel (i, j) is (20 + 14i, 20 + 14j, 120): no mirror of it equals it. */
export function gradientTile(): Buffer {
  return encodeRgbaPng(16, 16, (x, y) => [20 + 14 * x, 20 + 14 * y, 120, 255]);
}
/** One row at cell (1, 1) of a square grid with 16 u cells, drawing the gradient tile with `flip`. */
export function flipDoc(asset: string, flip: number): JsonObject {
  return doc(`flip-${flip}`, [48, 48], [atlasSet('tiles', 'a1', asset, [16, 16], { shape: 'square', cell: [16, 16] }, [{ cx: 1, cy: 1, tile: 0, flip }])]);
}

/** The animation atlas: eight solid 16 × 16 cells, one color each. */
export const ANIM_COLORS: Rgb[] = [[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230]];
export const FRAMES = 4;
export const RATE = 6;
/** The rows the animation document draws: `plain` (phase none, tile 0) and four `hashed` rows (phase hashed, tile 4). */
export const PLAIN_CELL: [number, number] = [1, 1];
export const HASHED_CELLS: [number, number][] = [[3, 1], [5, 1], [7, 1], [9, 1]];
/**
 * The animated rows: a set `plain` with one row at (1, 1) showing tile 0 with `frames` 4, `frame_rate` 6 and `phase`
 * none, and a set `hashed` with four rows showing tile 4 with `phase` hashed; the document's seed is 1653. Square grid,
 * 16 u cells, rows two cells apart so their quads never meet.
 */
export function animDoc(asset: string): JsonObject {
  const grid = { shape: 'square', cell: [16, 16] };
  const anim = (phase: string): JsonObject => ({ frames: { const: FRAMES }, frame_rate: { const: RATE }, phase: { const: phase } });
  return doc('animated', [176, 48], [
    atlasSet('plain', 'a1', asset, [16, 16], grid, [{ cx: PLAIN_CELL[0], cy: PLAIN_CELL[1], tile: 0 }], anim('none')),
    atlasSet('hashed', 'a2', asset, [16, 16], grid, HASHED_CELLS.map(([cx, cy]) => ({ cx, cy, tile: 4 })), anim('hashed')),
  ], { seed: 1653 });
}
/**
 * The pixel read for the row at (cx, cy) of a square grid with 16 u cells: 4 u right and down of (16 cx, 16 cy), inside
 * the quad whether the grid puts a cell's centre or its corner there (README: Readings).
 */
export const rowPixel = (cx: number, cy: number): [number, number] => [16 * cx + 4, 16 * cy + 4];
/** The atlas cell whose color the pixel shows (within 3 codes), or -1. */
export function cellShown(im: Image, x: number, y: number): number {
  return ANIM_COLORS.findIndex((c) => rgbOff(im, x, y, c) <= 3);
}

// ---------------------------------------------------------------------------------------------------
// AC3: status in a parallax group and a sorting group

export const VERDICT = 'verdict:01JB1653000000000000000001';
/**
 * #467's look without the data roles that sit within its status distance of a status color (drop, figd, hill, marquee,
 * moss, satin, sepia, vermilion): wherever status shows, the check holds every data role of the look apart from the
 * status colors (the status-color rule), and those roles were never meant to sit beside status.
 */
export const STATUS_LOOK: JsonObject = (() => {
  const look = JSON.parse(JSON.stringify(LOOK)) as JsonObject;
  const roles = obj(look['roles'], 'look.roles');
  for (const r of ['drop', 'figd', 'hill', 'marquee', 'moss', 'satin', 'sepia', 'vermilion']) delete roles[r];
  return look;
})();
/**
 * A parallax band repeating every 170 u on x, holding `lamp`, a 60 × 30 rect. With `bound` the lamp's fill is a status
 * binding's (a status mark); without it the lamp is filled in the data role `figb`. With `inside` false the lamp is the
 * band's sibling instead of its child.
 */
export function parallaxStatus(id: string, opts: { bound: boolean; inside: boolean }): JsonObject {
  return doc(id, [480, 270], [
    backdrop([480, 270], 'sky'),
    item('band', 'group@1', 'a1', { parallax: { rate: [1, 1], repeat: [170, 0], repeat_count: 3, drift: [0, 0], origin: [0, 0] } }),
    item('lamp', 'rect@1', 'a2', { box: [20, 40, 60, 30], ...(opts.bound ? {} : { paint: { fill: { role: 'figb' } } }) }, opts.inside ? { parent: 'band' } : {}),
  ], opts.bound ? { status_bindings: { 'lamp-state': { target: 'items/lamp/params/paint/fill', source: VERDICT } } } : {});
}
/**
 * A `sort: y` group holding `post` (a 60 × 60 rect whose foot is at y 100) and `crate` (a 60 × 80 rect whose foot is at
 * y 110, over post's top-right corner, so y sort draws it over post). With `bound` post carries a status badge (a status
 * binding on its badge slot). With `inside` false post is the group's sibling, drawn after it.
 */
export function sortStatus(id: string, opts: { bound: boolean; inside: boolean }): JsonObject {
  return doc(id, [240, 160], [
    backdrop([240, 160]),
    item('line', 'group@1', 'a1', { sort: 'y' }),
    item('crate', 'rect@1', 'a2', { box: [80, 30, 60, 80], paint: { fill: { role: 'figb' } } }, { parent: 'line' }),
    item('post', 'rect@1', opts.inside ? 'a3' : 'a9', { box: [40, 40, 60, 60], paint: { fill: { role: 'figa' } } }, opts.inside ? { parent: 'line' } : {}),
  ], opts.bound ? { status_bindings: { 'post-state': { target: 'items/post/params/paint/badge', source: VERDICT } } } : {});
}
/** The check's errors that name `id`: its `ids` hold it, or its `path` is under `items/<id>`. */
export const naming = (errors: { ids: string[]; path: string }[], id: string): boolean => errors.some((e) => e.ids.includes(id) || e.path === `items/${id}` || e.path.startsWith(`items/${id}/`));

// ---------------------------------------------------------------------------------------------------
// AC4: the isometric fixture

export const ISO_CELL: [number, number] = [32, 16];
/** The issue's isometric layout: with cell [w, h], the centre of (cx, cy) is ((cx − cy) × w ÷ 2, (cx + cy) × h ÷ 2). */
export const isoCentre = (cx: number, cy: number): [number, number] => [((cx - cy) * ISO_CELL[0]) / 2, ((cx + cy) * ISO_CELL[1]) / 2];
export const TILE_A: Rgb = [200, 40, 40];
export const TILE_B: Rgb = [40, 60, 200];
/** The isometric atlas: two opaque 32 × 16 cells, tile 0 in TILE_A and tile 1 in TILE_B. */
export const isoAtlas = (): Buffer => solidAtlas(ISO_CELL, [TILE_A, TILE_B]);
/** The rows in the order written: (1, 0) tile 0 first, then (0, 0) tile 1, then (0, 1) and (2, 1). */
export const ISO_ROWS: Row[] = [{ cx: 1, cy: 0, tile: 0 }, { cx: 0, cy: 0, tile: 1 }, { cx: 0, cy: 1, tile: 1 }, { cx: 2, cy: 1, tile: 0 }];
/** The new isometric atlas fixture: one set `iso` at the document's origin, grid isometric with cell [32, 16]. */
export function isoDoc(asset: string): JsonObject {
  return doc('isometric', [128, 64], [atlasSet('iso', 'a1', asset, ISO_CELL, { shape: 'isometric', cell: ISO_CELL }, ISO_ROWS)]);
}
/** One `deep-canvas-render geometry` line (#373, #221; ../467/helpers.ts `render` drives only check, raster and path). */
export function geometryOf(bin: string, input: JsonObject): JsonObject {
  const run = spawnSync(bin, ['geometry'], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-canvas-render geometry: ${run.error.message}`);
  expect(run.status, `deep-canvas-render geometry exited 0; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-canvas-render geometry: one output line for the input line').toBe(1);
  return obj(JSON.parse(lines[0]!) as JsonValue, 'deep-canvas-render geometry: the answer');
}
/**
 * Each row's centre as `geometry {doc, item: "iso"}` answers it: `rows.<key>.place.{x, y}`, matched to its cell by the
 * row's `columns.cx` and `columns.cy` (README: The surface under test).
 */
export function centresOf(answer: JsonObject, what: string): Map<string, [number, number]> {
  expect(answer['ok'], `geometry ${what} was answered, not refused: ${shown(answer)}`).toBe(true);
  const rows = obj(answer['rows'], `geometry ${what}: rows`);
  const out = new Map<string, [number, number]>();
  for (const [key, v] of Object.entries(rows)) {
    const row = obj(v as JsonValue, `geometry ${what}: rows.${key}`);
    const c = obj(row['columns'], `rows.${key}.columns`);
    const place = obj(row['place'], `rows.${key}.place: the row's centre`);
    out.set(`${String(c['cx'])},${String(c['cy'])}`, [Number(place['x']), Number(place['y'])]);
  }
  return out;
}
