// The criteria's fixtures (README: The fixtures): the atlas this suite draws, texel by texel, the picture under the first
// row, the rows, and the documents, in either envelope: #391's film with a 2D camera over the page, as #2386's and #535's
// suites give `deep-show` one, or #373's figure, as #1653's and #2386's give `deep-canvas-render` one. The issue's
// fields are written where the design puts them (Mark set: atlas tiles): `slice`, `fill` and `center` on the set, and
// the columns `w` and `h` beside `x` and `y`. Nothing here lays out, draws or checks a frame, and nothing here imports
// the test runner, so a plain node script can read every texel and every document (README: Run them).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };
export type Pt = [number, number];
/** A box `[x, y, w, h]` in u (px of a snapshot at zoom 1 and scale factor 1). */
export type Box = [number, number, number, number];
export type Rgba = [number, number, number, number];

// ---------------------------------------------------------------------------------------------------
// The atlas: nine 24 × 24 px cells, three by three, with no gap between them. The frame is the middle one, so a cell
// touches each of its sides and each of its corners.

/** The issue's cell, px. */
export const CELL: Pt = [24, 24];
/** The issue's `slice`: 8 on each side. */
export const SLICE = { left: 8, top: 8, right: 8, bottom: 8 } as const;
/** A side of the slice, px: a corner is 8 × 8 texels, an edge's strip 8 texels along its run. */
export const SIDE = 8;
export const ATLAS: Pt = [72, 72];
/** The frame's cell in row-major order of the atlas's 24 × 24 px cells. */
export const FRAME_TILE = 4;
/** The red (or green) of the frame cell's first column (or line), and its step a texel. */
export const CODE_0 = 5;
export const CODE_STEP = 10;
/** The frame cell's largest red and green: texel 23's. */
export const CODE_MAX = CODE_0 + CODE_STEP * 23;
/** The blue of every texel of a neighbouring cell; the frame cell's and the picture's under the first row are 0. */
export const NEIGHBOUR_BLUE = 255;

/**
 * Texel (x, y) of the frame cell, 0 to 23 each way: [10x + 5, 10y + 5, 0, 255]. Its red spells its column and its
 * green its line, so no two texels of the cell are equal, each differs from every neighbour, and a pixel's red and
 * green say which texel it shows, or how far between two.
 */
export const cellTexel = (x: number, y: number): Rgba => [CODE_0 + CODE_STEP * x, CODE_0 + CODE_STEP * y, 0, 255];
/**
 * Texel (x, y) of the atlas, 0 to 71 each way. The frame cell is the middle one; each of the eight cells around it
 * holds the same red and green at the same place in its own cell, with blue 255: a draw that shows another cell, or
 * lets a sample cross the cell's border, could be taken for the frame by its red and green, and is told by its blue.
 */
export function atlasTexel(x: number, y: number): Rgba {
  const [r, g] = cellTexel(x % CELL[0], y % CELL[1]);
  const frame = Math.floor(x / CELL[0]) === 1 && Math.floor(y / CELL[1]) === 1;
  return [r, g, frame ? 0 : NEIGHBOUR_BLUE, 255];
}
/** The red of the item under the first row is at least this: above every texel of the frame cell (at most 235). */
export const UNDER_RED = 240;
/**
 * Pixel (x, y) of the picture under the first row: red 240 to 255, green by a step that repeats on no short shift,
 * blue 0, opaque. No pixel equals a texel of the frame cell, and each differs from its neighbours, so a hash of a
 * region of it says whether exactly it shows there.
 */
export const underTexel = (x: number, y: number): Rgba => [UNDER_RED + ((3 * x + 5 * y) % 16), (37 * x + 101 * y) % 256, 0, 255];

// ---------------------------------------------------------------------------------------------------
// Rows and their boxes

/** A free row of a nine-part set: its centre (x, y) and the box it fills, w × h, in u. */
export interface Row { x: number; y: number; w: number; h: number }
/** The box a row fills: w × h centred at (x, y). */
export const boxOf = (r: Row): Box => [r.x - r.w / 2, r.y - r.h / 2, r.w, r.h];
/** `b` moved by `by`: a box in a set's own u as the page holds it. */
export const moved = ([x, y, w, h]: Box, [dx, dy]: Pt): Box => [x + dx, y + dy, w, h];

/** The page of the first row, and of the row 190 u wide. */
export const PAGE: Pt = [232, 128];
/** Criterion 1's row: 200 × 96 u on whole units; its box is [16, 16, 200, 96]. */
export const FIRST: Row = { x: 116, y: 64, w: 200, h: 96 };
/** Criterion 2's second row: 190 u wide, as tall as the first; its box is [21, 16, 190, 96]. */
export const FIT: Row = { x: 116, y: 64, w: 190, h: 96 };

/** Criterion 3's page for the check, and its two rows: one wide enough, then the one 12 u wide. */
export const NARROW_PAGE: Pt = [120, 80];
export const WIDE: Row = { x: 40, y: 40, w: 40, h: 40 };
export const NARROW: Row = { x: 90, y: 40, w: 12, h: 40 };

// ---------------------------------------------------------------------------------------------------
// Items

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

/** An item as either envelope takes it: `pos` is its `at.pos`. */
export interface Item { id: string; kind: string; order: string; params: JsonObject; pos?: Pt }

export type Fill = 'stretch' | 'tile' | 'tile_fit';
export interface Sides { left: number; top: number; right: number; bottom: number }
export interface Frames {
  id: string;
  asset: string;
  rows: Row[];
  order?: string;
  /** `fill`, written only when given: the design's default is `stretch`. */
  fill?: Fill;
  /** `center`, written only when given: the design's default is `true`. */
  center?: boolean;
  pos?: Pt;
  /** The atlas's cell, its `slice` and the cell each row shows, where they aren't the issue's fixture's. */
  cell?: Pt;
  slice?: Sides;
  tile?: number;
}
/**
 * A nine-part set (Mark set: atlas tiles): `marks@1` with `mark: image`, its `atlas` (padding 1), `place: free`, the
 * issue's `slice`, and one free row per `rows` entry in the order given: columns `x`, `y` (its centre), `w`, `h` (the
 * box it fills) as f32 and `tile` as u16. No `angle` and no `scale` column, so each row is at angle 0 and scale 1, the
 * design's defaults. No key column: a row's key is its index, so row 0 of `frame` is `frame#0`. `grid.cell` is the
 * atlas's cell: the design gives a set's `grid.cell` no default, and the base reads it for every atlas set.
 */
export function frames(f: Frames): Item {
  const cell = f.cell ?? CELL;
  const params: JsonObject = {
    mark: 'image', n: f.rows.length, place: 'free', atlas: { asset: f.asset, cell, padding: 1 }, grid: { shape: 'square', cell },
    slice: { ...(f.slice ?? SLICE) },
    columns: {
      x: column('f32', f.rows.map((r) => r.x)), y: column('f32', f.rows.map((r) => r.y)),
      w: column('f32', f.rows.map((r) => r.w)), h: column('f32', f.rows.map((r) => r.h)),
      tile: column('u16', f.rows.map(() => f.tile ?? FRAME_TILE)),
    },
  };
  if (f.fill !== undefined) params['fill'] = f.fill;
  if (f.center !== undefined) params['center'] = f.center;
  return { id: f.id, kind: 'marks@1', order: f.order ?? 'a2', params, ...(f.pos ? { pos: f.pos } : {}) };
}

/**
 * A plain free set of the same atlas, no `slice`: each row draws the frame's whole cell as one quad centred at (x, y),
 * `draw` u in size when given (#2386's `atlas.draw`), else the grid's cell, 24 × 24 u. This is how the merge base
 * draws an atlas row.
 */
export function quads(q: { id: string; asset: string; at: Pt[]; draw?: Pt; order?: string; pos?: Pt }): Item {
  const params: JsonObject = {
    mark: 'image', n: q.at.length, place: 'free', atlas: { asset: q.asset, cell: CELL, padding: 1, ...(q.draw ? { draw: q.draw } : {}) },
    grid: { shape: 'square', cell: CELL },
    columns: { x: column('f32', q.at.map((p) => p[0])), y: column('f32', q.at.map((p) => p[1])), tile: column('u16', q.at.map(() => FRAME_TILE)) },
  };
  return { id: q.id, kind: 'marks@1', order: q.order ?? 'a2', params, ...(q.pos ? { pos: q.pos } : {}) };
}

/** One 8 × 8 px part of the frame's cell, drawn at its own size centred at (x, y): column `i` and line `j` of its three by three parts. */
export interface Part { x: number; y: number; i: 0 | 1 | 2; j: 0 | 1 | 2 }
/**
 * A plain free set that reads the same atlas as 8 × 8 px cells (nine across), each row one part of the frame's cell at
 * its own size, 8 × 8 u: a frame laid by hand, part by part, with no `slice`. The frame's cell starts at (24, 24) px of
 * the atlas, so its part (i, j) is the 8 px cell 9 × (3 + j) + 3 + i. Rows draw in order of centre y, then centre x
 * (Mark set: atlas tiles), so of two parts on one line the one further right draws over the other.
 */
export function parts(p: { id: string; asset: string; parts: Part[]; order?: string }): Item {
  const params: JsonObject = {
    mark: 'image', n: p.parts.length, place: 'free', atlas: { asset: p.asset, cell: [SIDE, SIDE], padding: 1 }, grid: { shape: 'square', cell: [SIDE, SIDE] },
    columns: {
      x: column('f32', p.parts.map((t) => t.x)), y: column('f32', p.parts.map((t) => t.y)),
      tile: column('u16', p.parts.map((t) => (ATLAS[0] / SIDE) * (CELL[1] / SIDE + t.j) + CELL[0] / SIDE + t.i)),
    },
  };
  return { id: p.id, kind: 'marks@1', order: p.order ?? 'a2', params };
}

/**
 * A grid set of the same atlas with `place: cell` written out: one row per cell, columns `cx`, `cy`, `tile`. With
 * `sliced` it also carries the issue's `slice` and the columns `w` and `h`, so `slice` on `place: cell` is the one
 * thing check can refuse it for.
 */
export function cells(c: { id: string; asset: string; cells: Pt[]; sliced?: boolean }): Item {
  const columns: JsonObject = {
    cx: column('i32', c.cells.map((p) => p[0])), cy: column('i32', c.cells.map((p) => p[1])), tile: column('u16', c.cells.map(() => FRAME_TILE)),
    ...(c.sliced ? { w: column('f32', c.cells.map(() => 48)), h: column('f32', c.cells.map(() => 48)) } : {}),
  };
  const params: JsonObject = {
    mark: 'image', n: c.cells.length, place: 'cell', atlas: { asset: c.asset, cell: CELL, padding: 1 }, grid: { shape: 'square', cell: CELL },
    ...(c.sliced ? { slice: { ...SLICE } } : {}), columns,
  };
  return { id: c.id, kind: 'marks@1', order: 'a2', params };
}

/** The item under the first row: an image (Image `image@1`) of the picture `asset`, `size` px, drawn over the whole page at one px a u, before the row's set. */
export const under = (asset: string, size: Pt): Item => ({
  id: 'under', kind: 'image@1', order: 'a1',
  params: { asset, box: [0, 0, size[0], size[1]], fit: 'fill', sampling: 'linear', alt: 'The picture under the first row.' },
});

// ---------------------------------------------------------------------------------------------------
// Documents

const at = (i: Item): JsonObject => (i.pos ? { at: { pos: [i.pos[0], i.pos[1], 0] } } : {});
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #2039 acceptance tests.' };
/**
 * #391's film envelope as #2386's suite writes one: a 2D orthographic camera over the page (its target the page's
 * centre, its view the page's width, so a snapshot at the document's size is the page at zoom 1 and scale factor 1),
 * 4 s at 60 frames a second, the items, and each asset in `assets` with a license: what `deep-show run` reads. `extra`
 * adds to or replaces the envelope's fields (the budget's transport and channel).
 */
export function film(id: string, size: Pt, items: Item[], assets: Record<string, string>, extra: JsonObject = {}): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
  const drawn = items.map((i): JsonObject => ({ id: i.id, kind: i.kind, name: `Item ${i.id}`, order: i.order, ...at(i), params: i.params }));
  return {
    format: 1, id, profile: 'film', title: `#2039 ${id}`, description: `The #2039 acceptance tests' document ${id}.`, size, seed: 2039, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] },
    items: Object.fromEntries([cam, ...drawn].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
    ...extra,
  };
}
/** #373's figure envelope, one writer layer `main`, as #1653's and #2386's suites write it: what `deep-canvas-render` reads. */
export function figure(id: string, size: Pt, items: Item[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#2039 ${id}`, description: `The #2039 acceptance document ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [i.id, { id: i.id, kind: i.kind, layer: 'main', name: i.id, order: i.order, params: i.params, ...at(i) }])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: 500 rows of one atlas

export const ROWS = 500;
/** Where the set `rows` sits on its page, and the page that holds its 25 columns and 20 lines of frames. */
export const ROWS_POS: Pt = [4, 4];
export const ROWS_PAGE: Pt = [1304, 884];
/**
 * The 500 rows, in the set's own u: row i in column i mod 25 and line ⌊i ÷ 25⌋ of a lattice 52 u by 44 u, its box
 * 32, 40 or 48 u wide (by i mod 3) and 32 or 40 u tall (by i mod 2), on whole units, no two boxes touching. None is
 * 24 × 24 u, the size at which one quad of the whole cell and a nine-part frame draw the same pixels.
 */
export const rowsOf = (): Row[] => Array.from({ length: ROWS }, (_, i): Row => ({ x: 24 + 52 * (i % 25), y: 20 + 44 * Math.floor(i / 25), w: 32 + 8 * (i % 3), h: 32 + 8 * (i % 2) }));
/** How far the budget's set slides a second, u: a quarter of a u each 60 fps frame. */
export const SLIDE = 15;
/**
 * The 500 rows on their page: the nine-part set `rows`, or with `plain` the same rows with no `slice`, `w` and `h`,
 * one quad of the whole cell a row, as the merge base draws them. `sliding` (the budget's frames) moves the set 15 u a
 * second along x for 6 s by a keyed channel on its `at.pos`, on a page wide enough to hold it, so each 60 fps frame
 * places every row again.
 */
export function rowsDoc(asset: string, o: { plain?: boolean; sliding?: boolean } = {}): JsonObject {
  const rows = rowsOf();
  const set = o.plain ? quads({ id: 'rows', asset, at: rows.map((r): Pt => [r.x, r.y]), order: 'a1', pos: ROWS_POS }) : frames({ id: 'rows', asset, rows, order: 'a1', pos: ROWS_POS });
  const slide: JsonObject = {
    transport: { span: '6s', frame_rate: [60, 1] },
    channels: { slide: { target: 'items/rows/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: ROWS_POS[0], interp: 'linear' }, k1: { t: '6s', value: ROWS_POS[0] + 6 * SLIDE, interp: 'linear' } } } },
  };
  return film(`rows${o.plain ? '-plain' : ''}${o.sliding ? '-sliding' : ''}`, o.sliding ? [ROWS_PAGE[0] + 6 * SLIDE, ROWS_PAGE[1]] : ROWS_PAGE, [set], { frame_atlas: asset }, o.sliding ? slide : {});
}
