// The criteria's fixtures (README: Fixtures): atlases this suite writes, and the documents, each a #391 film envelope as
// #544's suite writes one (a 2D camera over the page, a transport at 60 frames a second, its logic item with its program
// listed in `assets`) with the issue's fields on its `marks@1` sets. Every atlas cell is solid, or (criterion 6's) two
// solid halves, so a sample inside a drawn quad reads its cell's color exactly. Nothing here draws or narrows anything.

import {
  ALIVE, CELLS, COLS, COUNT_WRITES, DOOR_COLS, DOOR_ROWS, NARROW_WRITES, POOL_WRITES, POSE, SWARM_WRITES, actorAt, doorValue,
} from './programs.ts';
import { encodeRgbaPng, putEvidence, type JsonObject, type Program, type Rgb } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #535 acceptance tests.' };
export const SEED = 535;

function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A film envelope (#544's): a 2D camera over the page, 4 s at 60 fps, the items, and `assets` with a license each. */
export function film(id: string, size: [number, number], items: JsonObject[], assets: Record<string, string>): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#535 ${id}`, description: `The #535 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] },
    items: Object.fromEntries([camera2d(size), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
  };
}
/** A logic item (Logic `logic@1`): its program by SHA-256 at 60 steps a second, writing `writes`. */
export function logicItem(id: string, program: Program, writes: [string, string, number][]): JsonObject {
  return {
    id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9',
    params: { program: program.sha, step_rate: 60, writes: Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }])) },
  };
}
/** A logic column (Mark set: logic columns): `{array: <logic>.<name>, as, part?}`. */
export const array = (path: string, as: string, part?: string): JsonObject => ({ array: path, as, ...(part ? { part } : {}) });
export interface AtlasSpec { asset: string; cell: [number, number] }
/**
 * An atlas tile set (Mark set: atlas tiles): `marks@1` with `mark: image`, its `atlas` (padding 1), a square grid of
 * `grid` u cells, and `params` (`grid.size`, `place`, `alive`, `columns`) as given. No `n`: the arrays' count is it.
 */
export function atlasSet(id: string, order: string, atlas: AtlasSpec, grid: { cell: [number, number]; size?: [number, number] }, params: JsonObject, pos: [number, number] = [0, 0]): JsonObject {
  return {
    id, kind: 'marks@1', name: `Set ${id}`, order, ...(pos[0] || pos[1] ? { at: { pos: [pos[0], pos[1], 0] } } : {}),
    params: { mark: 'image', atlas: { asset: atlas.asset, cell: atlas.cell, padding: 1 }, grid: { shape: 'square', ...grid }, ...params },
  };
}

// ---------------------------------------------------------------------------------------------------
// Atlases

/** An atlas of `cols` × `rows` solid cells of `cell` px, cell k (row-major) in `color(k)`, opaque. */
export function solidAtlas(cell: [number, number], cols: number, rows: number, color: (k: number) => Rgb): Buffer {
  return encodeRgbaPng(cell[0] * cols, cell[1] * rows, (x, y) => [...color(Math.floor(y / cell[1]) * cols + Math.floor(x / cell[0])), 255] as [number, number, number, number]);
}
/** Ten well-separated solid colors: tiles 0 to 9 of criteria 1, 3, 4 and 5. */
export const TEN: Rgb[] = [
  [230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48],
  [145, 30, 180], [70, 240, 240], [240, 50, 230], [128, 128, 0], [0, 0, 128],
];

/**
 * Criterion 2's atlas: 70 × 64 solid cells of 2 × 2 px (4,480 tiles, so tile 4,464 is one), tile t in the color that
 * spells t: r = 4 + 8 (t mod 32), g = 4 + 8 (⌊t ÷ 32⌋ mod 32), b = 4 + 8 ⌊t ÷ 1024⌋.
 */
export const CODE_COLS = 70;
export const CODE_ROWS = 64;
export const codeColor = (t: number): Rgb => [4 + 8 * (t % 32), 4 + 8 * (Math.floor(t / 32) % 32), 4 + 8 * Math.floor(t / 1024)];
/** The tile a color spells, or null when it spells none (each channel within 3 of 4 + 8 k). */
export function tileOfColor(c: Rgb): number | null {
  const ks = c.map((v) => Math.round((v - 4) / 8));
  if (ks.some((k, i) => k < 0 || k > 31 || Math.abs(c[i]! - (4 + 8 * k)) > 3)) return null;
  const t = ks[0]! + 32 * ks[1]! + 1024 * ks[2]!;
  return t < CODE_COLS * CODE_ROWS ? t : null;
}
export const codeAtlas = (): Buffer => solidAtlas([2, 2], CODE_COLS, CODE_ROWS, codeColor);

/** Criterion 6's atlas: two cells of 8 × 4 px, cell 0 grey, cell 1 red on its left half and blue on its right. */
export const POSE_ATLAS_CELL: [number, number] = [8, 4];
export const poseAtlas = (): Buffer => encodeRgbaPng(16, 4, (x) => (x < 8 ? [128, 128, 128, 255] : x < 12 ? [230, 25, 75, 255] : [0, 130, 200, 255]));

// ---------------------------------------------------------------------------------------------------
// Where a grid cell is read. The design leaves a square grid's origin open (#1653's README): a set at (w/2, w/2) puts
// cell (cx, cy)'s quad over [w cx, w cx + w] if the grid centres cells on multiples of w, or over [w cx + w/2, w cx +
// 3w/2] if it puts their corners there; the pixel at w cx + 3w/4 lies inside both, at least w/4 − 1 px from each edge.

export const gridPixel = (w: number, pos: number, c: number): number => Math.floor(pos + w * c + w / 4);

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the 96 × 96 layer, tile column from `map.cells` (i32 × 9,216) as u16, grid.size [96, 96], 6 u cells.

export const LAYER_W = 6;
export const LAYER_POS = LAYER_W / 2;
export const LAYER_SIZE: [number, number] = [COLS * LAYER_W + LAYER_W, COLS * LAYER_W + LAYER_W];
export const LAYER_ATLAS_CELL: [number, number] = [4, 4];
export const layerAtlas = (): Buffer => solidAtlas(LAYER_ATLAS_CELL, 8, 1, (k) => TEN[k]!);
export const layerPixel = (i: number): [number, number] => [gridPixel(LAYER_W, LAYER_POS, i % COLS), gridPixel(LAYER_W, LAYER_POS, Math.floor(i / COLS))];
export function layerDoc(program: Program, atlas: string): JsonObject {
  return film('layer', LAYER_SIZE, [
    logicItem('map', program, [['cells', 'i32', CELLS]]),
    atlasSet('layer', 'a1', { asset: atlas, cell: LAYER_ATLAS_CELL }, { cell: [LAYER_W, LAYER_W], size: [COLS, COLS] }, { columns: { tile: array('map.cells', 'u16') } }, [LAYER_POS, LAYER_POS]),
  ], { map_program: program.sha, layer_atlas: atlas });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: narrowing. `units` (grid.size [8, 2], tile from `nums.tile` as u16), `flips` (grid.size [8, 2], tile 2,
// flip from `nums.flip` as u8) and `drift` (free rows: x from `nums.fine` as f32, y 120, tile 3), on the code atlas.

export const NARROW_SIZE: [number, number] = [272, 160];
export const UNITS_POS: [number, number] = [8, 8];
export const FLIPS_POS: [number, number] = [8, 56];
export const DRIFT_Y = 120;
export const FLIPS_TILE = 2;
export const DRIFT_TILE = 3;
/** A pixel no set ever draws on. */
export const NARROW_EMPTY: [number, number] = [268, 150];
export const unitsPixel = (i: number): [number, number] => [gridPixel(16, UNITS_POS[0], i % 8), gridPixel(16, UNITS_POS[1], Math.floor(i / 8))];
export const flipsPixel = (i: number): [number, number] => [gridPixel(16, FLIPS_POS[0], i % 8), gridPixel(16, FLIPS_POS[1], Math.floor(i / 8))];
export const driftPixel = (i: number): [number, number] => [16 + 16 * i, DRIFT_Y];
export function narrowDoc(program: Program, atlas: string, unitsOnly = false): JsonObject {
  const a: AtlasSpec = { asset: atlas, cell: [2, 2] };
  const grid = { cell: [16, 16] as [number, number], size: [8, 2] as [number, number] };
  return film(unitsOnly ? 'units' : 'narrowing', NARROW_SIZE, [
    logicItem('nums', program, NARROW_WRITES),
    atlasSet('units', 'a1', a, grid, { columns: { tile: array('nums.tile', 'u16') } }, UNITS_POS),
    ...(unitsOnly ? [] : [
      atlasSet('flips', 'a2', a, grid, { columns: { tile: { const: FLIPS_TILE }, flip: array('nums.flip', 'u8') } }, FLIPS_POS),
      atlasSet('drift', 'a3', a, { cell: [16, 16] }, { place: 'free', columns: { x: array('nums.fine', 'f32'), y: { const: DRIFT_Y }, tile: { const: DRIFT_TILE } } }),
    ]),
  ], { nums_program: program.sha, code_atlas: atlas });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the pool. `pool`: 64 free rows at `actors.x`, `actors.y`, alive `actors.alive`, 16 u quads, tile 0.

export const POOL_SIZE: [number, number] = [208, 208];
export const POOL_TILE: Rgb = TEN[3]!;
export const poolAtlas = (): Buffer => solidAtlas([8, 8], 1, 1, () => POOL_TILE);
/** A pixel no row ever draws on. */
export const POOL_EMPTY: [number, number] = [204, 4];
/** The bounds of the alive rows' quads in u: rows 0 to 9 at y 20 and 44, x 20 to 188, 16 u quads. */
export const ALIVE_BOUNDS = { min: [12, 12], max: [196, 52] } as const;
export const ROW_CLICKED = 20;
export const ROW_ALIVE = 3;
export function poolDoc(program: Program, atlas: string): JsonObject {
  return film('pool', POOL_SIZE, [
    logicItem('actors', program, POOL_WRITES),
    atlasSet('pool', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [16, 16] }, {
      place: 'free', alive: array('actors.alive', 'bool'),
      columns: { x: array('actors.x', 'f32'), y: array('actors.y', 'f32'), tile: { const: 0 } },
    }),
  ], { actors_program: program.sha, pool_atlas: atlas });
}
export { ALIVE, actorAt };

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the door. `house`: grid.size [8, 6], 16 u cells, tile from `keeper.tiles` as u16; and its references, the
// same cells drawn with no logic and no grid.size, as #1653 draws them: written `n`, and data columns cx, cy (row i at
// (i mod 8, ⌊i ÷ 8⌋), where grid.size lays it) and tile (the door's values before or from step 100).

export const DOOR_SIZE: [number, number] = [DOOR_COLS * 16 + 16, DOOR_ROWS * 16 + 16];
export const DOOR_POS = 8;
export const doorAtlas = (): Buffer => solidAtlas([8, 8], 10, 1, (k) => TEN[k]!);
export const doorPixel = (cx: number, cy: number): [number, number] => [gridPixel(16, DOOR_POS, cx), gridPixel(16, DOOR_POS, cy)];
export function doorDoc(program: Program, atlas: string): JsonObject {
  return film('door', DOOR_SIZE, [
    logicItem('keeper', program, [['tiles', 'i32', DOOR_COLS * DOOR_ROWS]]),
    atlasSet('house', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [16, 16], size: [DOOR_COLS, DOOR_ROWS] }, { columns: { tile: array('keeper.tiles', 'u16') } }, [DOOR_POS, DOOR_POS]),
  ], { keeper_program: program.sha, door_atlas: atlas });
}
/** A typed data column `{dtype, len, data: base64}` (Mark set and columns). */
export function dataColumn(dtype: 'i32' | 'u16', values: number[]): JsonObject {
  const b = Buffer.alloc((dtype === 'i32' ? 4 : 2) * values.length);
  values.forEach((v, i) => (dtype === 'i32' ? b.writeInt32LE(v, 4 * i) : b.writeUInt16LE(v, 2 * i)));
  return { dtype, len: values.length, data: b.toString('base64') };
}
/** The door drawn with no logic: its 48 cells as data columns, the tiles its values at step `k`. */
export function doorRefDoc(atlas: string, k: number): JsonObject {
  const rows = Array.from({ length: DOOR_COLS * DOOR_ROWS }, (_, i) => i);
  return film(`door-ref-${k}`, DOOR_SIZE, [atlasSet('house', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [16, 16] }, {
    n: rows.length,
    columns: { cx: dataColumn('i32', rows.map((i) => i % DOOR_COLS)), cy: dataColumn('i32', rows.map((i) => Math.floor(i / DOOR_COLS))), tile: dataColumn('u16', rows.map((i) => doorValue(i, k))) },
  }, [DOOR_POS, DOOR_POS])], { door_atlas: atlas });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: refusals at check, each a set of `grid` (`counts`) arrays.

export function countsDoc(id: string, program: Program, atlas: string, set: JsonObject): JsonObject {
  return film(id, [160, 120], [logicItem('grid', program, COUNT_WRITES), set], { grid_program: program.sha, pool_atlas: atlas });
}
/** Two array columns of 9,216 and 9,215 values: tile from `grid.big`, flip from `flip` (`grid.short`; the control reads
 * `grid.big` for both). */
export const mismatchSet = (atlas: string, flip = 'grid.short'): JsonObject =>
  atlasSet('mismatch', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [1, 1], size: [COLS, COLS] }, { columns: { tile: array('grid.big', 'u16'), flip: array(flip, 'u8') } });
/** A tile column reading `tile` (`grid.missing`, an array no logic item of the document writes; the control reads
 * `grid.big`). */
export const unwrittenSet = (atlas: string, tile = 'grid.missing'): JsonObject =>
  atlasSet('ghost', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [1, 1], size: [COLS, COLS] }, { columns: { tile: array(tile, 'u16') } });
/** Free rows whose x reads the vec2 array `grid.where` as f32, without `part` unless `part` is given; y with part y. */
export const vectorSet = (atlas: string, part?: string): JsonObject =>
  atlasSet('spots', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [16, 16] }, { place: 'free', columns: { x: array('grid.where', 'f32', part), y: array('grid.where', 'f32', 'y'), tile: { const: 0 } } });

// ---------------------------------------------------------------------------------------------------
// Criterion 6: 3,000 free rows (`free`: x, y, angle from `flock`, tile 1, 4 × 2 u quads) and the reference image item.

export const SWARM_SIZE: [number, number] = [80, 50];
/** Drawn at 8 device px a u. */
export const SWARM_PX: [number, number] = [640, 400];
export const SWARM_SCALE = 8;
export const SWARM_CELL: [number, number] = [4, 2];
/** The region around row 0 that no other row reaches: [0, 0, 20, 12] u. */
export const POSE_REGION: [number, number, number, number] = [0, 0, 20 * SWARM_SCALE, 12 * SWARM_SCALE];
export function swarmDoc(program: Program, atlas: string): JsonObject {
  return film('swarm', SWARM_SIZE, [
    logicItem('flock', program, SWARM_WRITES),
    atlasSet('free', 'a1', { asset: atlas, cell: POSE_ATLAS_CELL }, { cell: SWARM_CELL }, {
      place: 'free', columns: { x: array('flock.x', 'f32'), y: array('flock.y', 'f32'), angle: array('flock.angle', 'f32'), tile: { const: 1 } },
    }),
  ], { flock_program: program.sha, pose_atlas: atlas });
}
/** An image item (Image `image@1`) showing atlas cell 1 at row 0's pose: its 4 × 2 u box centred on its origin, turned 90°
 * about it (`at.rot`, degrees about z, the sense a row's `angle` turns), at (10.5, 3.25). */
export function poseRefDoc(atlas: string): JsonObject {
  return film('pose-ref', SWARM_SIZE, [{
    id: 'ref', kind: 'image@1', name: 'Reference', order: 'a1',
    params: { asset: atlas, box: [-SWARM_CELL[0] / 2, -SWARM_CELL[1] / 2, SWARM_CELL[0], SWARM_CELL[1]], fit: 'fill', crop: [POSE_ATLAS_CELL[0], 0, POSE_ATLAS_CELL[0], POSE_ATLAS_CELL[1]], sampling: 'linear', alt: 'Atlas cell 1 at row 0\'s pose.' },
    at: { pos: [POSE.x, POSE.y, 0], rot: [0, 0, POSE.angle] },
  }], { pose_atlas: atlas });
}
/** Uploads an atlas's bytes to the store; its SHA-256. */
export const putAtlas = (evidence: string, png: Buffer): string => putEvidence(evidence, png);
