// The criteria's fixtures (README: The fixtures): the atlases this suite writes and its documents. An atlas tile set is
// written once (`Tiles`) and put in either envelope: #373's figure, as #1653's and #536's suites give
// `deep-canvas-render` one, or #391's film with a 2D camera over the page, as #535's suite gives `deep-show` one. The
// issue's two fields are written where it puts them, `atlas.draw` and `atlas.anchor`. Nothing here lays out, draws or
// hits anything: the layouts below are the design's closed forms, in f64, for the tests' own geometry checks.

import { encodeRgbaPng, type Box, type JsonObject, type JsonValue, type Pt, type Rgb } from './helpers.ts';

type Rgba = [number, number, number, number];
const CLEAR: Rgba = [0, 0, 0, 0];
const solid = ([r, g, b]: Rgb): Rgba => [r, g, b, 255];

// ---------------------------------------------------------------------------------------------------
// Documents

/** A typed column `{dtype, len, data: base64}` (Mark set and columns). */
export function column(dtype: 'i32' | 'u16' | 'f32', values: number[]): JsonObject {
  const b = Buffer.alloc((dtype === 'u16' ? 2 : 4) * values.length);
  values.forEach((v, i) => {
    if (dtype === 'i32') b.writeInt32LE(v, i * 4);
    else if (dtype === 'u16') b.writeUInt16LE(v, i * 2);
    else b.writeFloatLE(v, i * 4);
  });
  return { dtype, len: values.length, data: b.toString('base64') };
}

/** A row on a grid cell, and a free row at (x, y) u turned by `angle` degrees. */
export interface Cell { cx: number; cy: number; tile: number }
export interface Free { x: number; y: number; tile: number; angle?: number }
/**
 * An atlas tile set (Mark set: atlas tiles): `marks@1` with `mark: image`, its `atlas` (padding 1) with the issue's
 * `draw` and `anchor` where given, its `grid`, and its rows in the order written: `cells` (columns `cx`, `cy`, `tile`)
 * or, with `place: free`, `free` (columns `x`, `y`, `tile`, and `angle` where any row turns). No key column: a row's
 * key is its index. `pos` is the set's `at.pos`; `columns` and `params` add to or replace what is written.
 */
export interface Tiles {
  id: string;
  order: string;
  atlas: { asset: string; cell: Pt; draw?: JsonValue; anchor?: JsonValue };
  grid: JsonObject;
  cells?: Cell[];
  free?: Free[];
  pos?: Pt;
  columns?: JsonObject;
  params?: JsonObject;
}
function paramsOf(s: Tiles): JsonObject {
  const atlas: JsonObject = { asset: s.atlas.asset, cell: s.atlas.cell, padding: 1 };
  if (s.atlas.draw !== undefined) atlas['draw'] = s.atlas.draw;
  if (s.atlas.anchor !== undefined) atlas['anchor'] = s.atlas.anchor;
  const free = s.free;
  const columns: JsonObject = free
    ? {
      x: column('f32', free.map((r) => r.x)), y: column('f32', free.map((r) => r.y)), tile: column('u16', free.map((r) => r.tile)),
      ...(free.some((r) => r.angle !== undefined) ? { angle: column('f32', free.map((r) => r.angle ?? 0)) } : {}),
    }
    : { cx: column('i32', (s.cells ?? []).map((r) => r.cx)), cy: column('i32', (s.cells ?? []).map((r) => r.cy)), tile: column('u16', (s.cells ?? []).map((r) => r.tile)) };
  return {
    mark: 'image', n: (free ?? s.cells ?? []).length, ...(free ? { place: 'free' } : {}), atlas, grid: s.grid,
    columns: { ...columns, ...(s.columns ?? {}) }, ...(s.params ?? {}),
  };
}
const at = (s: Tiles): JsonObject => (s.pos ? { at: { pos: [s.pos[0], s.pos[1], 0] } } : {});

/** #373's figure envelope, one writer layer `main`, as #1653's and #536's suites write it: what `deep-canvas-render` reads. */
export function figure(id: string, size: Pt, sets: Tiles[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#2386 ${id}`, description: `The #2386 acceptance document ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(sets.map((s) => [s.id, { id: s.id, kind: 'marks@1', layer: 'main', name: s.id, order: s.order, params: paramsOf(s), ...at(s) }])),
  };
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #2386 acceptance tests.' };
/**
 * #391's film envelope as #535's suite writes one: a 2D orthographic camera over the page (its target the page's
 * centre, its view the page's width, so a snapshot at the document's size is the page at zoom 1 and scale factor 1),
 * 4 s at 60 frames a second, the sets, and each atlas in `assets` with a license: what `deep-show run` reads. `extra`
 * adds to or replaces the envelope's fields (the budget's transport and channel).
 */
export function film(id: string, size: Pt, sets: Tiles[], assets: Record<string, string>, extra: JsonObject = {}): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
  const items = sets.map((s): JsonObject => ({ id: s.id, kind: 'marks@1', name: `Set ${s.id}`, order: s.order, ...at(s), params: paramsOf(s) }));
  return {
    format: 1, id, profile: 'film', title: `#2386 ${id}`, description: `The #2386 acceptance tests' document ${id}.`, size, seed: 2386, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] },
    items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// The design's layouts and cell areas (Mark set: atlas tiles; Control: point), for the tests' geometry checks

/** An isometric cell's centre: with cell [w, h], ((cx − cy) × w ÷ 2, (cx + cy) × h ÷ 2). */
export const isoCentre = ([w, h]: Pt, cx: number, cy: number): Pt => [((cx - cy) * w) / 2, ((cx + cy) * h) / 2];
/** A square cell's centre: (cx × w, cy × h), as the base lays a square grid out. */
export const squareCentre = ([w, h]: Pt, cx: number, cy: number): Pt => [cx * w, cy * h];
/** How far `p` is into an isometric cell's diamond: |dx| ÷ (w ÷ 2) + |dy| ÷ (h ÷ 2), under 1 inside, 1 on an edge, over 1 outside. */
export const inDiamond = ([w, h]: Pt, [cx, cy]: Pt, [x, y]: Pt): number => {
  const [x0, y0] = isoCentre([w, h], cx, cy);
  return Math.abs(x - x0) / (w / 2) + Math.abs(y - y0) / (h / 2);
};
/** The quad a row draws: `draw` placed so `anchor`, a fraction of it from its top left, is on `centre`. */
export const quadAt = (centre: Pt, draw: Pt, anchor: Pt): Box => [centre[0] - anchor[0] * draw[0], centre[1] - anchor[1] * draw[1], draw[0], draw[1]];
/** Whether a box holds a point, its edges included. */
export const holds = ([x, y, w, h]: Box, [px, py]: Pt): boolean => px >= x && px <= x + w && py >= y && py <= y + h;

// ---------------------------------------------------------------------------------------------------
// Atlases. Every texel is opaque or clear, never between, so a pixel of a snapshot shows a texel or the ground.

/** A cell whose every texel differs from each of its neighbours: (x, y) of a w × h cell is [x × 256 ÷ w, y × 256 ÷ h, 200 or 40 by parity]. */
export const codeTexel = ([w, h]: Pt, x: number, y: number): Rgb => [(x * 256) / w, (y * 256) / h, (x + y) % 2 ? 200 : 40];

/** The isometric wall's atlas: four 64 × 64 px cells in a row. */
export const WALL_TILE = { block: 0, code: 1, red: 2, blue: 3 } as const;
export const RED: Rgb = [200, 40, 40];
export const BLUE: Rgb = [40, 60, 200];
/**
 * Cell 0, the block: a 64 × 32 px diamond with 32 px of wall above it, its top face lit, its left face in half shade
 * and its right face in shade, with courses of stone; clear outside. Its footprint's centre is (32, 48), the anchor
 * [0.5, 0.75] of the cell.
 */
function blockTexel(x: number, y: number): Rgba {
  const dx = x + 0.5 - 32; const py = y + 0.5;
  const reach = 16 * (1 - Math.abs(dx) / 32);
  if (py < 16 - reach || py > 48 + reach) return CLEAR;
  const rim = py - (16 - reach) < 1 || 48 + reach - py < 1 || Math.abs(dx) > 31;
  if (py <= 16 + reach) return solid(rim || 16 + reach - py < 1 ? [150, 138, 116] : [206, 190, 160]);
  const course = Math.floor(py + Math.abs(dx) / 2 - 32) % 8 === 0;
  const face: Rgb = dx < 0 ? [158, 136, 110] : [118, 100, 84];
  return solid(rim || course ? [face[0] - 40, face[1] - 36, face[2] - 30] : face);
}
export const wallAtlas = (): Buffer => encodeRgbaPng(256, 64, (x, y) => {
  const k = Math.floor(x / 64);
  if (k === WALL_TILE.block) return blockTexel(x, y);
  return solid(k === WALL_TILE.code ? codeTexel([64, 64], x - 64, y) : k === WALL_TILE.red ? RED : BLUE);
});
/** The isometric floor's atlas: two 64 × 32 px diamonds, clear outside, a lighter and a darker stone. */
export const floorAtlas = (): Buffer => encodeRgbaPng(128, 32, (x, y) => {
  const d = Math.abs((x % 64) + 0.5 - 32) / 32 + Math.abs(y + 0.5 - 16) / 16;
  if (d > 1) return CLEAR;
  const base: Rgb = x < 64 ? [104, 132, 112] : [120, 148, 126];
  return solid(d > 0.9 ? [base[0] - 26, base[1] - 26, base[2] - 26] : base);
});

/** The tree's atlas: three 16 × 32 px cells in a row. */
export const TREE_TILE = { tree: 0, pine: 1, code: 2 } as const;
/** Cell 0: a round tree, its trunk standing on (8, 24), the anchor [0.5, 0.75] of the cell; cell 1: a pine. Clear around them. */
function treeTexel(x: number, y: number, pine: boolean): Rgba {
  const dx = x + 0.5 - 8;
  if (y >= (pine ? 24 : 20) && y <= 29 && x >= 6 && x <= 9) return solid(x === 6 ? [86, 58, 38] : [118, 82, 52]);
  if (y === 30 && x >= 5 && x <= 10) return solid([70, 48, 34]);
  if (pine) {
    if (y < 2 || y > 23) return CLEAR;
    const half = 1 + ((y - 2) % 8) * 0.7 + Math.floor((y - 2) / 8) * 1.3;
    return Math.abs(dx) > half ? CLEAR : solid(dx > half - 1.5 ? [22, 82, 60] : dx < -half + 1.5 ? [70, 150, 96] : [38, 112, 72]);
  }
  const dy = y + 0.5 - 11;
  const r = (dx / 7.5) ** 2 + (dy / 10) ** 2;
  if (r > 1) return CLEAR;
  return solid(dx + dy > 6 || r > 0.82 ? [30, 96, 52] : dx + dy < -4 ? [96, 178, 88] : [52, 138, 66]);
}
export const treeAtlas = (): Buffer => encodeRgbaPng(48, 32, (x, y) => {
  const k = Math.floor(x / 16);
  return k === TREE_TILE.code ? solid(codeTexel([16, 32], x - 32, y)) : treeTexel(x % 16, y, k === TREE_TILE.pine);
});
/** The square ground's atlas: two 16 × 16 px grass cells, opaque, with a few darker blades. */
export const grassAtlas = (): Buffer => encodeRgbaPng(32, 16, (x, y) => {
  const base: Rgb = x < 16 ? [128, 172, 98] : [118, 164, 92];
  return solid((x * 7 + y * 13 + (x < 16 ? 0 : 5)) % 11 === 0 ? [base[0] - 24, base[1] - 20, base[2] - 20] : base);
});

// ---------------------------------------------------------------------------------------------------
// Criteria 1 and 2: the isometric wall. Grid cell [64, 32]; atlas cell [64, 64]; draw [64, 64]; anchor [0.5, 0.75].

export const WALL_GRID: Pt = [64, 32];
export const WALL_DRAW: Pt = [64, 64];
export const WALL_ANCHOR: Pt = [0.5, 0.75];
/** The wall set at `pos`, its rows as written. */
export const wallSet = (asset: string, cells: Cell[], pos: Pt): Tiles => ({
  id: 'wall', order: 'a2', atlas: { asset, cell: [64, 64], draw: WALL_DRAW, anchor: WALL_ANCHOR }, grid: { shape: 'isometric', cell: WALL_GRID }, cells, pos,
});

// ---------------------------------------------------------------------------------------------------
// Criterion 3 (and criterion 4's last click): the square grid's tree. Grid cell [16, 16]; atlas cell [16, 32]; draw
// [16, 32]. The sets sit at the page's origin, so the criterion's boxes and points are page u as written.

export const TREE_GRID: Pt = [16, 16];
export const TREE_DRAW: Pt = [16, 32];
export const TREE_PAGE: Pt = [160, 80];
/** `tree`: one row on cell (2, 3), anchor [0.5, 0.75]. */
export const treeSet = (asset: string, cells: Cell[] = [{ cx: 2, cy: 3, tile: TREE_TILE.tree }], pos?: Pt): Tiles => ({
  id: 'tree', order: 'a2', atlas: { asset, cell: [16, 32], draw: TREE_DRAW, anchor: [0.5, 0.75] }, grid: { shape: 'square', cell: TREE_GRID }, cells, ...(pos ? { pos } : {}),
});
/** `free`: one free row of the same atlas at (100, 50), anchor [0.5, 1], showing the code cell, turned by `angle` when given. */
export const freeSet = (asset: string, angle?: number): Tiles => ({
  id: 'free', order: 'a3', atlas: { asset, cell: [16, 32], draw: TREE_DRAW, anchor: [0.5, 1] }, grid: { shape: 'square', cell: TREE_GRID },
  free: [{ x: 100, y: 50, tile: TREE_TILE.code, ...(angle === undefined ? {} : { angle }) }],
});
/** The tree and the free row on one page. */
export const treesDoc = (asset: string): JsonObject => film('trees', TREE_PAGE, [treeSet(asset), freeSet(asset)], { tree_atlas: asset });
/** The free row alone, turned 90°. */
export const turnedDoc = (asset: string): JsonObject => film('turned', TREE_PAGE, [freeSet(asset, 90)], { tree_atlas: asset });

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the click boards, isometric with cell [32, 16].

export const BOARD_GRID: Pt = [32, 16];
/** Where the flat board sits on its 160 × 96 u page, and the 640 × 384 px panel that shows it at 4 px a u. */
export const BOARD_POS: Pt = [80, 24];
export const BOARD_PAGE: Pt = [160, 96];
/** The flat board's cells in the order written: (cx, cy) for cy and cx from 0 to 3, so cell (cx, cy) is row 4 cy + cx. */
export const BOARD_CELLS: Pt[] = Array.from({ length: 16 }, (_, i): Pt => [i % 4, Math.floor(i / 4)]);
/** `board`: a 4 × 4 isometric board of opaque 32 × 16 px tiles with no `draw`, two colors in a checker. */
export const boardDoc = (asset: string): JsonObject => film('board', BOARD_PAGE, [{
  id: 'board', order: 'a1', atlas: { asset, cell: [32, 16] }, grid: { shape: 'isometric', cell: BOARD_GRID },
  cells: BOARD_CELLS.map(([cx, cy]) => ({ cx, cy, tile: (cx + cy) % 2 })), pos: BOARD_POS,
}], { board_atlas: asset });
export const TALL_POS: Pt = [32, 48];
export const TALL_PAGE: Pt = [64, 64];
export const TALL_DRAW: Pt = [32, 32];
export const TALL_ANCHOR: Pt = [0.5, 0.75];
/**
 * `tall`: opaque 32 × 32 px tiles with `draw: [32, 32]` and `anchor: [0.5, 0.75]`. With `behind`, cell (−1, −1), whose
 * diamond lies under the standing part of the tile at (0, 0), is written first: it is tall#0 and (0, 0) is tall#1,
 * drawn above it and after it in every order. Without, the tile on (0, 0) is the set's one row, tall#0.
 */
export const tallDoc = (asset: string, behind: boolean): JsonObject => film(behind ? 'tall-two' : 'tall-one', TALL_PAGE, [{
  id: 'tall', order: 'a1', atlas: { asset, cell: [32, 32], draw: TALL_DRAW, anchor: TALL_ANCHOR }, grid: { shape: 'isometric', cell: BOARD_GRID },
  cells: [...(behind ? [{ cx: -1, cy: -1, tile: 1 }] : []), { cx: 0, cy: 0, tile: 0 }], pos: TALL_POS,
}], { tall_atlas: asset });

// ---------------------------------------------------------------------------------------------------
// Criterion 6: 10,000 rows of one atlas on a 100 × 100 square grid of 4 u cells, each a 4 × 8 px tile.

export const ROWS = 10_000;
export const ROWS_POS: Pt = [4, 8];
export const ROWS_PAGE: Pt = [404, 408];
export const ROWS_DRAW: Pt = [4, 8];
export const ROWS_ANCHOR: Pt = [0.5, 0.75];
/** How far the budget's set slides a second, u: a quarter of a u each 60 fps frame. */
export const SLIDE = 15;
/**
 * `rows`: 10,000 rows, cell (i mod 100, ⌊i ÷ 100⌋), their tiles a checker of two colors, with `draw: [4, 8]` and
 * `anchor: [0.5, 0.75]` unless `plain`. `sliding` (the budget's frames) moves the set 15 u a second along x for 6 s by
 * a keyed channel on its `at.pos`, on a page wide enough to hold it, so each 60 fps frame places every row again.
 */
export function rowsDoc(asset: string, o: { plain?: boolean; sliding?: boolean } = {}): JsonObject {
  const cells = Array.from({ length: ROWS }, (_, i): Cell => ({ cx: i % 100, cy: Math.floor(i / 100), tile: ((i % 100) + Math.floor(i / 100)) % 2 }));
  const slide: JsonObject = {
    transport: { span: '6s', frame_rate: [60, 1] },
    channels: { slide: { target: 'items/rows/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: ROWS_POS[0], interp: 'linear' }, k1: { t: '6s', value: ROWS_POS[0] + 6 * SLIDE, interp: 'linear' } } } },
  };
  return film(`rows${o.plain ? '-plain' : ''}${o.sliding ? '-sliding' : ''}`, o.sliding ? [ROWS_PAGE[0] + 6 * SLIDE, ROWS_PAGE[1]] : ROWS_PAGE, [{
    id: 'rows', order: 'a1', atlas: { asset, cell: [4, 8], ...(o.plain ? {} : { draw: ROWS_DRAW, anchor: ROWS_ANCHOR }) }, grid: { shape: 'square', cell: [4, 4] }, cells, pos: ROWS_POS,
  }], { rows_atlas: asset }, o.sliding ? slide : {});
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: the two pictures (README: The taste call).

/** The isometric wall fixture: a 6 × 6 floor with no `draw`, walls along its two far edges, and three blocks standing on it. */
export function wallScene(wall: string, floor: string): JsonObject {
  const pos: Pt = [208, 72];
  const ground: Cell[] = [];
  for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) ground.push({ cx, cy, tile: (cx + cy) % 2 });
  const walls: Pt[] = [...Array.from({ length: 6 }, (_, i): Pt => [i, 0]), ...Array.from({ length: 5 }, (_, i): Pt => [0, i + 1]), [3, 3], [4, 3], [3, 4]];
  return figure('isometric-wall', [416, 288], [
    { id: 'floor', order: 'a1', atlas: { asset: floor, cell: [64, 32] }, grid: { shape: 'isometric', cell: WALL_GRID }, cells: ground, pos },
    wallSet(wall, walls.map(([cx, cy]) => ({ cx, cy, tile: WALL_TILE.block })), pos),
  ]);
}
/** The square grid's tree fixture: a 20 × 10 ground with no `draw`, and trees on it, some one cell behind another. */
export function treeScene(tree: string, grass: string): JsonObject {
  const pos: Pt = [16, 40];
  const ground: Cell[] = [];
  for (let cy = 0; cy < 10; cy++) for (let cx = 0; cx < 20; cx++) ground.push({ cx, cy, tile: (cx * 3 + cy * 5) % 2 });
  const trees: [number, number, number][] = [
    [2, 3, 0], [5, 2, 0], [5, 3, 0], [5, 4, 1], [8, 1, 1], [9, 1, 0], [10, 1, 1], [9, 2, 0], [12, 5, 0], [13, 5, 1], [12, 6, 1], [13, 6, 0],
    [16, 3, 0], [17, 7, 1], [3, 8, 1], [7, 7, 0], [0, 0, 1], [19, 0, 0], [19, 9, 1], [0, 9, 0],
  ];
  return figure('square-tree', [336, 208], [
    { id: 'ground', order: 'a1', atlas: { asset: grass, cell: [16, 16] }, grid: { shape: 'square', cell: TREE_GRID }, cells: ground, pos },
    treeSet(tree, trees.map(([cx, cy, tile]) => ({ cx, cy, tile })), pos),
  ]);
}
