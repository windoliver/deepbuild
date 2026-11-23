// Test-side tools for the blind redraft of #2386's criterion 6, second clause: "Each fixture of #1653 and #536 keeps
// its pixel hash" (README). The fixtures are the two suites' own: built by their helpers, imported read only, or, where
// a suite keeps a builder in a test file, written here as that file writes it. This file adds the pictures' list, the
// pixel hash, and the layout the issue and the design state, computed here in f64: each grid's cell centres, each
// row's quad (`draw` placed so `anchor` is on the cell's centre; the grid's cell, centred, with neither), the draw
// order, and the atlas texel a page pixel shows. Nothing here stands in for the renderer: every pixel and hash read
// is `deep-canvas-render raster`'s.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  arr, check, columnValues, decodePng, describeErrors, encodeRgbaPng, num, obj, px, role, sha256, tilesOf,
  type Image, type JsonObject, type JsonValue,
} from '../467/helpers.ts';
import * as s1653 from '../1653/helpers.ts';
import * as s536 from '../536/helpers.ts';

export { decodePng, none, render, shown, useDir, LOOK, type Image, type JsonObject } from '../467/helpers.ts';
export { rasterLine } from '../1653/helpers.ts';
export { useRender, TIMEOUT } from '../536/helpers.ts';

/** The criterion's ID: `#2386.` + the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const ID = 'AC6 #2386.b3f6fe16';

export type Rgb = [number, number, number];
type Box = [number, number, number, number];

// ---------------------------------------------------------------------------------------------------
// The hashes taken at the merge base (README: The hashes)

/** A picture's pixel hash: the SHA-256 of its 8-bit RGBA pixels, straight alpha, row by row from the top left. */
export const pixelHash = (im: Image): string => sha256(im.rgba);
export interface BaseHash { zoom: number; width: number; height: number; sha256: string }
/** base-hashes.json: what each picture drew to at the merge base. */
export const BASE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'base-hashes.json'), 'utf8')) as { base: string; pictures: Record<string, BaseHash> };

// ---------------------------------------------------------------------------------------------------
// The layout, as the issue and the design state it

const pair = (v: JsonValue | undefined, what: string): [number, number] => {
  const l = arr(v, what);
  return [num(l[0], `${what}[0]`), num(l[1], `${what}[1]`)];
};

/**
 * The centre of cell (cx, cy) in the set's u. Square: (cx × w, cy × h), where the issue's third criterion puts it.
 * Isometric: ((cx − cy) × w ÷ 2, (cx + cy) × h ÷ 2) (Mark set: atlas tiles). Hex: pointy (w × (cx + s ÷ 2),
 * 0.75 × h × cy), flat (0.75 × w × cx, h × (cy + s ÷ 2)), s 1 on a shifted row or column (Mark set: hex grid).
 */
export function centre(grid: JsonObject, cx: number, cy: number): [number, number] {
  const [w, h] = pair(grid['cell'], 'grid.cell');
  const shape = grid['shape'] ?? 'square';
  if (shape === 'square') return [cx * w, cy * h];
  if (shape === 'isometric') return [((cx - cy) * w) / 2, ((cx + cy) * h) / 2];
  expect(shape, 'a grid shape the design lays out').toBe('hex');
  const hex = obj(grid['hex'] ?? {}, 'grid.hex');
  const odd = (hex['offset'] ?? 'odd') === 'odd';
  const s = (line: number): number => ((((line % 2) + 2) % 2 === 1) === odd ? 1 : 0);
  return (hex['orient'] ?? 'pointy') === 'pointy' ? [w * (cx + s(cy) / 2), 0.75 * h * cy] : [0.75 * w * cx, h * (cy + s(cx) / 2)];
}

/**
 * The quad of the row at cell (cx, cy) of a set at `pos`, `[x, y, w, h]` in page u (the issue's Scope): `draw` (the
 * grid's cell without one) placed so `anchor` (`[0.5, 0.5]` without one), a fraction of its width and height from
 * its top left, sits on the cell's centre.
 */
export function boxOf(grid: JsonObject, atlas: JsonObject, cx: number, cy: number, pos: [number, number] = [0, 0]): Box {
  const [dw, dh] = pair(atlas['draw'] ?? grid['cell'], 'atlas.draw');
  const [ax, ay] = pair(atlas['anchor'] ?? [0.5, 0.5], 'atlas.anchor');
  const [x, y] = centre(grid, cx, cy);
  return [pos[0] + x - ax * dw, pos[1] + y - ay * dh, dw, dh];
}

/** One row as the page draws it: its set and cell, its quad in page u, and the atlas cell it shows (null: not known here). */
export interface Quad { row: string; box: Box; tile: number | null; flip: number; cell: [number, number] }

/**
 * Every row of `doc` as a quad, in draw order: the sets by order key, each set's rows by their cell's centre y, then
 * centre x, never their quad's (the issue's Scope). `doc` holds atlas tile sets on a grid and nothing else, with no
 * `scale` or `angle`. A row whose phase is hashed shows a frame this file doesn't work out.
 */
export function quadsOf(doc: JsonObject): Quad[] {
  const items = Object.entries(obj(doc['items'], 'items')).map(([id, v]) => ({ id, item: obj(v, `items.${id}`) }));
  const key = (i: { item: JsonObject }): string => String(i.item['order']);
  items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return items.flatMap(({ id, item }) => {
    const params = obj(item['params'], `items.${id}.params`);
    const columns = obj(params['columns'] ?? {}, `items.${id}.params.columns`);
    expect([item['kind'], params['mark'], params['place'] ?? 'cell', 'scale' in columns, 'angle' in columns], `${id} is an atlas tile set on a grid, unscaled and unturned`).toEqual(['marks@1', 'image', 'cell', false, false]);
    const grid = obj(params['grid'], `items.${id}.params.grid`);
    const atlas = obj(params['atlas'], `items.${id}.params.atlas`);
    const at = arr(obj(item['at'] ?? { pos: [0, 0, 0] }, `items.${id}.at`)['pos'], `items.${id}.at.pos`);
    const pos: [number, number] = [num(at[0], 'pos x'), num(at[1], 'pos y')];
    const n = num(params['n'], `items.${id}.params.n`);
    const values = (name: string): number[] => (name in columns ? columnValues(columns[name], n, `${id}.${name}`) : Array.from({ length: n }, () => 0));
    const [cx, cy, tile, flip] = [values('cx'), values('cy'), values('tile'), values('flip')];
    const hashed = 'frames' in columns && obj(columns['phase'] ?? {}, `${id}.phase`)['const'] === 'hashed';
    const rows = Array.from({ length: n }, (_, i) => ({
      c: centre(grid, cx[i]!, cy[i]!),
      quad: { row: `${id} (${cx[i]}, ${cy[i]})`, box: boxOf(grid, atlas, cx[i]!, cy[i]!, pos), tile: hashed ? null : tile[i]!, flip: flip[i]!, cell: pair(atlas['cell'], 'atlas.cell') },
    }));
    return rows.sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0]).map((r) => r.quad);
  });
}

/** How far, in device px, a named pixel's centre stays from every quad's edge, so no edge's blend reaches it. */
export const CLEAR = 1.5;

/**
 * What the layout draws at device pixel (x, y) of a picture at `zoom`: the top quad's row and the color of the atlas
 * texel it shows there, or nothing where the page is bare. The pixel's centre must lie CLEAR px clear of every quad's
 * edge, and the texel must be opaque and one color with the eight around it, so neither an edge nor the sampling
 * filter decides the color.
 */
export function drawnAt(quads: Quad[], atlas: Image, [x, y]: [number, number], zoom: number, what: string): { row: string; rgb: Rgb } | undefined {
  const [u, v, m] = [(x + 0.5) / zoom, (y + 0.5) / zoom, CLEAR / zoom];
  let top: Quad | undefined;
  for (const q of quads) {
    const [qx, qy, qw, qh] = q.box;
    const outer = u > qx - m && u < qx + qw + m && v > qy - m && v < qy + qh + m;
    const inner = u > qx + m && u < qx + qw - m && v > qy + m && v < qy + qh - m;
    expect(outer && !inner, `${what}: pixel (${x}, ${y}) lies ${CLEAR} px clear of every quad's edge; it is on the edge of ${q.row}'s quad [${q.box.join(', ')}]`).toBe(false);
    if (inner) top = q;
  }
  if (!top) return undefined;
  expect([top.tile === null, top.flip & 4], `${what}: ${top.row} shows an atlas cell this file works out, not transposed`).toEqual([false, 0]);
  const [cw, ch] = top.cell;
  const fx = (u - top.box[0]) / top.box[2]; const fy = (v - top.box[1]) / top.box[3];
  // flip: bits h (1) and v (2) mirror the cell left to right and top to bottom (#1653's flip clause).
  const i = Math.floor((top.flip & 1 ? 1 - fx : fx) * cw); const j = Math.floor((top.flip & 2 ? 1 - fy : fy) * ch);
  // An atlas's cells count row by row from its top left, with no margin or separation in these fixtures.
  const columns = Math.floor(atlas.width / cw);
  const [ox, oy] = [(top.tile! % columns) * cw, Math.floor(top.tile! / columns) * ch];
  const texel = px(atlas, ox + i, oy + j);
  const around: string[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const [ni, nj] = [Math.min(cw - 1, Math.max(0, i + di)), Math.min(ch - 1, Math.max(0, j + dj))];
    around.push(px(atlas, ox + ni, oy + nj).join(','));
  }
  expect([texel[3], new Set(around).size], `${what}: pixel (${x}, ${y}) shows texel (${i}, ${j}) of atlas cell ${top.tile}, opaque and one color with the eight around it: ${around.join(' ')}`).toEqual([255, 1]);
  return { row: top.row, rgb: [texel[0], texel[1], texel[2]] };
}

/** The page where no item draws: the look's ground role. */
export const GROUND: Rgb = role('ground');
/** Largest per-channel difference a read pixel may show against the color the layout gives it. */
export const TOL = 3;
/** The pixel as `[r, g, b, a]`, and whether it reads `want`, opaque, within TOL. */
export function reads(im: Image, [x, y]: [number, number], want: Rgb): { got: string; ok: boolean } {
  const p = px(im, x, y);
  return { got: `[${p.join(', ')}]`, ok: want.every((c, i) => Math.abs(p[i]! - c) <= TOL) && p[3] >= 255 - TOL };
}

// ---------------------------------------------------------------------------------------------------
// The pictures: each fixture of #1653 and #536 that draws an atlas tile set (README: The fixtures)

/** #1653's flip fixture, as tests/acceptance/1653-redraft-ac2-flip/flip.test.ts writes it: a decoy cell and a cell of four quadrants. */
const flipAtlas = (): Buffer => encodeRgbaPng(32, 16, (x, y) => {
  if (x < 16) return [120, 60, 20, 255];
  return y < 8 ? (x < 24 ? [220, 40, 40, 255] : [40, 180, 60, 255]) : (x < 24 ? [40, 60, 220, 255] : [230, 200, 30, 255]);
});
/** Two rows of tile 1 on a square grid of 40 u cells, at (1, 1) and (3, 1); the right row's `flip` is `f`. */
const flipDoc = (asset: string, f: number): JsonObject => s1653.doc('atlas-flip', [240, 120], [
  s1653.atlasSet('tiles', 'a1', asset, [16, 16], { shape: 'square', cell: [40, 40] }, [{ cx: 1, cy: 1, tile: 1, flip: 0 }, { cx: 3, cy: 1, tile: 1, flip: f }]),
]);
/** #536's 6 × 6 atlas hex fixture, as tests/acceptance/536/ac1-centres.test.ts writes it: every row tile 0 of a one-cell atlas. */
const boardDoc = (asset: string, hex: s536.Hex): JsonObject => s536.doc(`board-${hex.orient}-${hex.offset}`, [240, 200], [
  s536.atlasSet('board', 'a1', asset, [16, 16], { shape: 'hex', cell: s536.CELL, hex: { ...hex } }, s536.GRID.map(([cx, cy]) => ({ cx, cy, tile: 0 }))),
]);
const boardAtlas = (): Buffer => s536.solidAtlas([16, 16], [[200, 120, 40]]);

/**
 * One picture: a fixture's document over its atlas, at the zoom it is drawn at, and the two device pixels the layout
 * is read at. `inside` lies in the quad of `row`, the top quad there. `below` lies under the cell of `under`,
 * a row of the set's last line of cells: on the bare page, and in that row's quad once it is hung (`hung`). `under`
 * is `row` but in the flip fixture, where `row` is the row whose `flip` changes and `under` the one beside it, never
 * flipped. `recipe` names a terrain recipe, whose rows are its check's expansion.
 */
export interface Picture {
  name: string; zoom: number; atlas: () => Buffer; doc: (asset: string) => JsonObject; recipe?: string;
  row: string; inside: [number, number]; under: string; below: [number, number];
}
export const PICTURES: Picture[] = [
  { name: '1653-floor', zoom: 1, atlas: s1653.atlasPng, doc: (a) => s1653.terrain(a, s1653.FLOOR), recipe: 'floor', row: 'floor (3, 4)', inside: [96, 90], under: 'floor (3, 4)', below: [96, 118] },
  { name: '1653-animated', zoom: 1, atlas: () => s1653.solidAtlas([16, 16], s1653.ANIM_COLORS), doc: s1653.animDoc, row: 'plain (1, 1)', inside: [16, 18], under: 'plain (1, 1)', below: [16, 34] },
  { name: '1653-isometric', zoom: 1, atlas: s1653.isoAtlas, doc: s1653.isoDoc, row: 'iso (2, 1)', inside: [10, 26], under: 'iso (2, 1)', below: [10, 42] },
  { name: '1653-flip-none', zoom: 1, atlas: flipAtlas, doc: (a) => flipDoc(a, 0), row: 'tiles (3, 1)', inside: [110, 50], under: 'tiles (1, 1)', below: [30, 90] },
  { name: '1653-flip-h', zoom: 1, atlas: flipAtlas, doc: (a) => flipDoc(a, 1), row: 'tiles (3, 1)', inside: [110, 50], under: 'tiles (1, 1)', below: [30, 90] },
  { name: '1653-flip-v', zoom: 1, atlas: flipAtlas, doc: (a) => flipDoc(a, 2), row: 'tiles (3, 1)', inside: [110, 50], under: 'tiles (1, 1)', below: [30, 90] },
  { name: '536-board-pointy-odd', zoom: 1, atlas: boardAtlas, doc: (a) => boardDoc(a, s536.LAYOUTS[0]!.hex), row: 'board (2, 5)', inside: [80, 110], under: 'board (2, 5)', below: [80, 138] },
  { name: '536-board-pointy-even', zoom: 1, atlas: boardAtlas, doc: (a) => boardDoc(a, s536.LAYOUTS[1]!.hex), row: 'board (3, 5)', inside: [96, 110], under: 'board (3, 5)', below: [96, 138] },
  { name: '536-board-flat-odd', zoom: 1, atlas: boardAtlas, doc: (a) => boardDoc(a, s536.LAYOUTS[2]!.hex), row: 'board (2, 5)', inside: [48, 146], under: 'board (2, 5)', below: [48, 174] },
  { name: '536-terrain', zoom: 2, atlas: s536.atlasPng, doc: (a) => s536.terrainDoc('terrain', a), recipe: 'floor', row: 'floor (2, 5)', inside: [216, 248], under: 'floor (2, 5)', below: [216, 284] },
  { name: '536-tiles', zoom: 2, atlas: s536.atlasPng, doc: s536.tileSheet, row: 'sheet (1, 4)', inside: [120, 268], under: 'sheet (1, 4)', below: [120, 312] },
];

/** A picture made ready: its document, the same document with each recipe written out as the set it expands into, and its atlas. */
export interface Made { picture: Picture; doc: JsonObject; sets: JsonObject; atlas: Image }
/** Puts the picture's atlas in `store` and builds its document; a recipe's rows come from `check`'s expansion. */
export function make(bin: string, store: string, picture: Picture): Made {
  const png = picture.atlas();
  const [asset] = s1653.putAssets(store, [png]);
  const doc = picture.doc(asset!);
  if (!picture.recipe) return { picture, doc, sets: doc, atlas: decodePng(png) };
  const { answer, errors } = check(bin, doc, { store });
  expect(answer['ok'], `${picture.name}: the recipe passes the check: ${describeErrors(errors)}`).toBe(true);
  return { picture, doc, sets: writtenOut(doc, picture.recipe, tilesOf(answer)), atlas: decodePng(png) };
}

/**
 * `doc` with the terrain recipe `id` written out as the atlas tile set it expands into: the recipe's own atlas, grid,
 * position and order, one row a cell in the order the recipe writes them, each with the tile the check chose.
 */
export function writtenOut(doc: JsonObject, id: string, tiles: Map<string, number>): JsonObject {
  const items = obj(doc['items'], 'items');
  const recipe = obj(items[id], `items.${id}`);
  const params = obj(recipe['params'], `items.${id}.params`);
  const cells = arr(params['cells'], `items.${id}.params.cells`).map((c) => pair(c, 'a cell'));
  const tile = cells.map(([cx, cy]) => num(tiles.get(`${cx},${cy}`), `the tile the check chose for (${cx}, ${cy})`));
  const columns = { cx: s1653.col('i32', cells.map((c) => c[0])), cy: s1653.col('i32', cells.map((c) => c[1])), tile: s1653.col('u16', tile) };
  const set = { ...recipe, kind: 'marks@1', params: { mark: 'image', n: cells.length, atlas: params['atlas']!, grid: params['grid']!, columns } };
  return { ...doc, items: { ...items, [id]: set } };
}

/**
 * `doc` with the issue's two fields on every atlas tile set: `draw` its grid's cell at twice the height, and
 * `anchor: [0.5, 0.25]`, so each tile hangs from its cell's top edge and reaches one cell height below its cell.
 */
export function hung(doc: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  for (const [id, v] of Object.entries(obj(out['items'], 'items'))) {
    const params = obj(obj(v, `items.${id}`)['params'], `items.${id}.params`);
    const [w, h] = pair(obj(params['grid'], `items.${id}.params.grid`)['cell'], 'grid.cell');
    Object.assign(obj(params['atlas'], `items.${id}.params.atlas`), { draw: [w, 2 * h], anchor: [0.5, 0.25] });
  }
  return out;
}
