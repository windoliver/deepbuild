// Test-side tools for the #536 acceptance tests (README: The surface under test). The driver, the check, PNG writing,
// the look and the expansion reader come from ../467/helpers.ts by import, and typed columns, the asset store, atlas
// sets, solid atlases, `geometry` and its centres from ../1653/helpers.ts (both read only). This file adds the build with
// its BLOCKED gate, this suite's documents, the fixture's terrains, the recipe's tiles and their art, and the rules the
// design states (the hex layout, cube-coordinate neighbours, edge numbering, precedence), computed here in f64. Nothing
// here stands in for the renderer, the layout or the recipe: every centre, tile and refusal read here is the binary's.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import { encodeRgbaPng, item, seeded, str, REPO, type Issue, type JsonObject, type JsonValue } from '../467/helpers.ts';
import { atlasSet, type Row } from '../1653/helpers.ts';

export {
  check, describeErrors, failsNaming, none, shown, tilesOf, useDir, LOOK, REPO, type Issue, type JsonObject,
  type JsonValue,
} from '../467/helpers.ts';
export { atlasSet, centresOf, geometryOf, putAssets, rasterLine, rasterLines, solidAtlas } from '../1653/helpers.ts';

/** The criteria's IDs: `#536.` + the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #536.a6553751',
  2: 'AC2 #536.b30a306f',
  3: 'AC3 #536.9a17b91a',
} as const;
/** Each test passes this explicit timeout (a first build of deep-canvas-render takes minutes, in `beforeAll`). */
export const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// The build: `deep-canvas-render` once per file, copied out of the target folder. No cargo is BLOCKED, never a pass.

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** `deep-canvas-render` built once for this file; the returned function gives its path, failing the test if it can't. */
export function useRender(): () => string {
  let dir = ''; let error = ''; let blocked = '';
  beforeAll(() => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
      CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
      ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
    };
    const args = ['build', '--locked', '--bin', 'deep-canvas-render'];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) { blocked = `cargo could not run (${run.error.message}); this machine lacks the Rust toolchain`; return; }
    if (run.status !== 0) { error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`; return; }
    dir = mkdtempSync(join(tmpdir(), 'deep-536-bin-'));
    copyFileSync(join(TARGET, 'debug', 'deep-canvas-render'), join(dir, 'deep-canvas-render'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    if (blocked) expect.fail(`BLOCKED: ${blocked}; this is not a pass`);
    expect(error, 'deep-canvas-render builds: cargo build --locked --bin deep-canvas-render').toBe('');
    return join(dir, 'deep-canvas-render');
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents

/** #373's envelope, as #467's and #1653's suites write it: one writer layer `main`, class figure. */
export function doc(id: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#536 ${id}`, description: `The #536 acceptance document ${id}.`, size,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// The hex grid as the design gives it (Mark set: hex grid)

export interface Hex { orient: 'pointy' | 'flat'; offset: 'odd' | 'even' }
/** The fixture's grid cell [w, h] in u. */
export const CELL: [number, number] = [32, 28];
/** 1 on a shifted row (pointy) or column (flat): with offset odd the odd ones, with even the even ones; mod 2 floored. */
const shifted = (line: number, offset: Hex['offset']): number => ((((line % 2) + 2) % 2 === 1) === (offset === 'odd') ? 1 : 0);
/** The design's centre of cell (cx, cy): pointy x = w (cx + s ÷ 2), y = 0.75 h cy; flat x = 0.75 w cx, y = h (cy + s ÷ 2). */
export function hexCentre(hex: Hex, cx: number, cy: number): [number, number] {
  const [w, h] = CELL;
  return hex.orient === 'pointy' ? [w * (cx + shifted(cy, hex.offset) / 2), 0.75 * h * cy] : [0.75 * w * cx, h * (cy + shifted(cx, hex.offset) / 2)];
}
/**
 * A cell's axial coordinates (q, r), converted from its offset coordinates by the grid's own convention: read back from
 * the design's centre, so the conversion is the layout's and no offset table is assumed.
 */
function axial(hex: Hex, cx: number, cy: number): [number, number] {
  const [x, y] = hexCentre(hex, cx, cy);
  const [w, h] = CELL;
  if (hex.orient === 'pointy') { const r = y / (0.75 * h); return [x / w - r / 2, r]; }
  const q = x / (0.75 * w);
  return [q, y / h - q / 2];
}
const cubeDistance = ([q1, r1]: [number, number], [q2, r2]: [number, number]): number => {
  const dq = q1 - q2; const dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};
/**
 * A cell's six neighbours in edge order: the cells at distance 1 in cube coordinates, ordered counterclockwise on screen
 * (y grows down) from the one facing +x (pointy) or between +x and −y (flat), on the grid or off it.
 */
export function neighbours(hex: Hex, cx: number, cy: number): [number, number][] {
  const here = axial(hex, cx, cy);
  const [x0, y0] = hexCentre(hex, cx, cy);
  const found: { cell: [number, number]; angle: number }[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cell: [number, number] = [cx + dx, cy + dy];
    if (Math.abs(cubeDistance(axial(hex, ...cell), here) - 1) > 1e-9) continue;
    const [x, y] = hexCentre(hex, ...cell);
    let angle = Math.atan2(-(y - y0), x - x0);
    if (angle < -1e-9) angle += 2 * Math.PI;
    found.push({ cell, angle });
  }
  expect(found.length, `cell (${cx}, ${cy}) has six neighbours at cube distance 1`).toBe(6);
  return found.sort((a, b) => a.angle - b.angle).map((f) => f.cell);
}

// ---------------------------------------------------------------------------------------------------
// AC1: the atlas hex fixture

export const POINTY_ODD: Hex = { orient: 'pointy', offset: 'odd' };
/** The criterion's three layouts and its numbers, written out. */
export const LAYOUTS: { name: string; hex: Hex; centres: [[number, number], [number, number]][] }[] = [
  { name: 'pointy odd', hex: POINTY_ODD, centres: [[[1, 1], [48, 21]], [[2, 2], [64, 42]]] },
  { name: 'pointy even', hex: { orient: 'pointy', offset: 'even' }, centres: [[[1, 1], [32, 21]], [[2, 2], [80, 42]]] },
  { name: 'flat odd', hex: { orient: 'flat', offset: 'odd' }, centres: [[[1, 1], [24, 42]], [[2, 2], [48, 56]]] },
];
/** The 6 × 6 grid's cells, row by row: (cx, cy) for cy and cx from 0 to 5. */
export const GRID: [number, number][] = [];
for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) GRID.push([cx, cy]);

// ---------------------------------------------------------------------------------------------------
// AC2: the terrain fixture, the recipe's tiles and their art

export type Terrain = 'water' | 'sand' | 'grass';
export const PRECEDENCE: Terrain[] = ['grass', 'sand', 'water'];
/** The fixture's terrains, row cy = 0 to 5 top to bottom, cx = 0 to 5 left to right: W water, S sand, G grass. */
const MAP = ['WWWWWW', 'WSSWWW', 'SGGSWW', 'SGGSWS', 'WSSWSG', 'WWWWSG'];
const LETTER: Record<string, Terrain> = { W: 'water', S: 'sand', G: 'grass' };
/** The recipe's cells `[cx, cy, terrain]`, written row by row. */
export const FLOOR: [number, number, Terrain][] = GRID.map(([cx, cy]) => [cx, cy, LETTER[MAP[cy]![cx]!]!]);
export const cellsOf = (cells: [number, number, Terrain][]): Map<string, Terrain> => new Map(cells.map(([x, y, t]) => [`${x},${y}`, t]));

/**
 * The six labels the design wants for (cx, cy): edge i takes the neighbour's terrain N where N comes before the cell's
 * own T in the precedence, and T otherwise, an edge with no neighbouring cell taking T.
 */
export function wanted(cells: Map<string, Terrain>, cx: number, cy: number, across: (cx: number, cy: number) => [number, number][] = (x, y) => neighbours(POINTY_ODD, x, y)): Terrain[] {
  const own = cells.get(`${cx},${cy}`)!;
  return across(cx, cy).map(([x, y]) => {
    const n = cells.get(`${x},${y}`);
    return n !== undefined && PRECEDENCE.indexOf(n) < PRECEDENCE.indexOf(own) ? n : own;
  });
}
/**
 * The planted reading `terrain_reads_square_sides` (README: Planted programs): a square grid's four sides as the
 * neighbours, each hex edge reading the side it faces: edges 0 and 3 the cells right and left, edges 1 and 2 the cell
 * above (cx, cy − 1), edges 4 and 5 the cell below (cx, cy + 1). Used only to put its tiles in the atlas.
 */
export const squareSides = (cx: number, cy: number): [number, number][] => [[cx + 1, cy], [cx, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy + 1], [cx, cy + 1]];

export interface Tile { tile: number; terrain: Terrain; edges: Terrain[] }
const labelKey = (terrain: Terrain, edges: Terrain[]): string => `${terrain}:${edges.join(',')}`;
/** Plain tiles (all six edges their own terrain) come in this many variants, so a cell's pick among them is the hash's. */
export const VARIANTS = 3;
/**
 * The recipe's tiles: one for each label set the fixture's cells want, and one for each the planted reading wants, so
 * the twin's expansion is answered rather than refused; plain ones in VARIANTS variants. Grouped grass, sand, water,
 * each in the order a cell first wants it; `tile` is the atlas cell, row-major.
 */
export const TILES: Tile[] = (() => {
  const cells = cellsOf(FLOOR);
  const seen = new Map<string, { terrain: Terrain; edges: Terrain[] }>();
  for (const reading of [undefined, squareSides]) for (const [cx, cy, terrain] of FLOOR) {
    const edges = wanted(cells, cx, cy, reading);
    if (!seen.has(labelKey(terrain, edges))) seen.set(labelKey(terrain, edges), { terrain, edges });
  }
  const out: Tile[] = [];
  for (const t of PRECEDENCE) for (const s of seen.values()) {
    if (s.terrain !== t) continue;
    const plain = s.edges.every((e) => e === t);
    for (let v = 0; v < (plain ? VARIANTS : 1); v++) out.push({ tile: out.length, terrain: t, edges: [...s.edges] });
  }
  return out;
})();
/** The tiles whose terrain and labels are these. */
export const tilesFor = (terrain: Terrain, edges: Terrain[]): Tile[] => TILES.filter((t) => labelKey(t.terrain, t.edges) === labelKey(terrain, edges));

/** An atlas cell in px: the art for a w × h = 32 × 28 u quad at 2 px a u. */
export const ART: [number, number] = [64, 56];
const PER_ROW = 8;
const RGB: Record<Terrain, [number, number, number]> = { water: [46, 112, 186], sand: [222, 196, 138], grass: [82, 154, 68] };
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (p: number[], q: number[], k: number): number[] => p.map((v, i) => v + (q[i]! - v) * k);
/**
 * The recipe's atlas, PER_ROW cells a row: each tile a pointy hexagon filling its cell (transparent outside, a pixel
 * over its edge so neighbours meet), in its terrain's color with a seeded texture of its own, and a band of each edge's
 * label where it isn't the tile's terrain, so a picture shows which tile sits where.
 */
export function atlasPng(): Buffer {
  const [cw, ch] = ART; const a = cw / 2; const b = ch / 2;
  const marks = TILES.map((t) => { const r = seeded(536 + t.tile); return Array.from({ length: 7 }, () => [(r() - 0.5) * a, (r() - 0.5) * b * 1.1] as [number, number]); });
  const rows = Math.ceil(TILES.length / PER_ROW);
  return encodeRgbaPng(cw * PER_ROW, ch * rows, (px, py) => {
    const t = TILES[Math.floor(py / ch) * PER_ROW + Math.floor(px / cw)];
    if (!t) return [0, 0, 0, 0];
    const x = (px % cw) + 0.5 - a; const y = (py % ch) + 0.5 - b;
    // Each edge's distance fraction: 1 on the edge, edges 0–5 counterclockwise on screen from the one facing +x.
    const d = [x / a, (x * b / 2 - y * a) / (a * b), (-x * b / 2 - y * a) / (a * b), -x / a, (-x * b / 2 + y * a) / (a * b), (x * b / 2 + y * a) / (a * b)];
    const far = Math.max(...d);
    if (far > 1 + 1 / a) return [0, 0, 0, 0];
    let c: number[] = [...RGB[t.terrain]];
    const shade = t.terrain === 'water' ? 34 : -30;
    if (marks[t.tile]!.some(([mx, my]) => (t.terrain === 'water' ? ((x - mx) / 4) ** 2 + ((y - my) / 1.3) ** 2 : ((x - mx) / 1.9) ** 2 + ((y - my) / 1.9) ** 2) <= 1)) c = c.map((v) => v + shade);
    let edge = -1; let weight = 0;
    t.edges.forEach((label, i) => { const k = label === t.terrain ? 0 : smooth(0.5, 0.8, d[i]!); if (k > weight) { weight = k; edge = i; } });
    if (edge >= 0) c = mix(c, RGB[t.edges[edge]!], weight);
    if (far > 0.93) c = c.map((v) => v * 0.88);
    return [...c.map((v) => Math.round(Math.min(255, Math.max(0, v)))), 255] as [number, number, number, number];
  });
}

/** Where the fixture sits on its page, so every quad is inside it. */
const FLOOR_AT: [number, number] = [24, 20];
/**
 * The terrain fixture: one `tiles.terrain@1` instance `floor` on the 6 × 6 pointy odd hex grid, cell [32, 28], over
 * the recipe's atlas, its tiles declared `{tile, terrain, edges}` as #467's suite writes them, with `rules` and
 * `precedence` [grass, sand, water] and seed 536. `params` replaces fields (`cells`, `rules`, `tiles`).
 */
export function terrainDoc(id: string, asset: string, params: JsonObject = {}, items: JsonObject[] = []): JsonObject {
  return doc(id, [224, 148], [
    ...items,
    item('floor', 'tiles.terrain@1', 'a1', {
      atlas: { asset, cell: ART, padding: 1 },
      grid: { shape: 'hex', cell: CELL, hex: { ...POINTY_ODD } },
      tiles: TILES.map((t) => ({ tile: t.tile, terrain: t.terrain, edges: t.edges })),
      cells: FLOOR,
      rules: 'edges_6', precedence: PRECEDENCE, seed: 536,
      ...params,
    }, { at: { pos: [FLOOR_AT[0], FLOOR_AT[1], 0] } }),
  ]);
}
/**
 * For each cell in the order the recipe writes them, what is wrong with the tile the check gave it: none, one the
 * recipe doesn't declare, another terrain's, or labels other than the design's for that cell.
 */
export function labelProblems(tiles: Map<string, number>, cells: [number, number, Terrain][]): string[] {
  const map = cellsOf(cells);
  return cells.flatMap(([cx, cy, own]) => {
    const got = tiles.get(`${cx},${cy}`);
    if (got === undefined) return [`cell (${cx}, ${cy}): no tile`];
    const t = TILES.find((x) => x.tile === got);
    if (!t) return [`cell (${cx}, ${cy}): tile ${got} is not one the recipe declares`];
    const want = wanted(map, cx, cy);
    if (t.terrain !== own) return [`cell (${cx}, ${cy}): tile ${got} is ${t.terrain}, the cell ${own}`];
    return t.edges.join() === want.join() ? [] : [`cell (${cx}, ${cy}): tile ${got}'s labels [${t.edges.join(', ')}], wanted [${want.join(', ')}]`];
  });
}

/** A minimal valid WebAssembly module (magic and version, no sections): the logic item's program bytes. */
export const EMPTY_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
/** A logic item `board` (Logic `logic@1`): its program by SHA-256 at 60 steps a second, writing `tiles` and `terrain`, i32 × 36. */
export const logicItem = (program: string): JsonObject => item('board', 'logic@1', 'a9', {
  program, step_rate: 60, writes: { tiles: { type: 'i32', count: 36 }, terrain: { type: 'i32', count: 36 } },
});
/**
 * The 6 × 6 pointy odd hex fixture as an atlas tile set `units` laid out by `grid.size [6, 6]`, its `tile` column reading
 * the logic array `board.tiles` as u16 (Mark set: logic columns; no written `n`: the array's count is it).
 */
export const logicTileSet = (asset: string): JsonObject => item('units', 'marks@1', 'a1', {
  mark: 'image', atlas: { asset, cell: ART, padding: 1 },
  grid: { shape: 'hex', cell: CELL, hex: { ...POINTY_ODD }, size: [6, 6] },
  columns: { tile: { array: 'board.tiles', as: 'u16' } },
}, { at: { pos: [FLOOR_AT[0], FLOOR_AT[1], 0] } });

// ---------------------------------------------------------------------------------------------------
// Reading a check's issues

/** An issue's own fields: without its prose (`what`, `fix`), its catalog name (`check`) and its close names. */
export function fieldsOf(issue: Issue): JsonObject {
  const { what: _w, fix: _f, check: _c, close: _n, ...rest } = issue.raw;
  return rest;
}
/** `word` stands as a whole name anywhere in the issue's own fields. */
export const namesWord = (issue: Issue, word: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(JSON.stringify(fieldsOf(issue)));
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export const namesItem = (issue: Issue, id: string): boolean => issue.ids.includes(id) || issue.path === `items/${id}` || issue.path.startsWith(`items/${id}/`);
/** `v` holds, at any depth, an array equal to `want`. */
export function holdsArray(v: JsonValue | undefined, want: JsonValue[]): boolean {
  if (Array.isArray(v)) return JSON.stringify(v) === JSON.stringify(want) || v.some((x) => holdsArray(x, want));
  if (typeof v === 'object' && v !== null) return Object.values(v).some((x) => holdsArray(x, want));
  return false;
}

// ---------------------------------------------------------------------------------------------------
// AC3: the recipe's tiles on one sheet

/**
 * The recipe's tiles as one atlas set `sheet` on a square grid of the fixture's cell: grass on the first row, sand on the
 * next, water on the rows after, PER_ROW to a row, each tile in the order the recipe lists it.
 */
export function tileSheet(asset: string): JsonObject {
  const rows: Row[] = [];
  let cy = 0;
  for (const t of PRECEDENCE) {
    const group = TILES.filter((x) => x.terrain === t);
    group.forEach((x, i) => rows.push({ cx: i % PER_ROW, cy: cy + Math.floor(i / PER_ROW), tile: x.tile }));
    cy += Math.ceil(group.length / PER_ROW);
  }
  const sheet = { ...atlasSet('sheet', 'a1', asset, ART, { shape: 'square', cell: CELL }, rows), at: { pos: [CELL[0], CELL[1], 0] } };
  return doc('terrain-tiles', [(PER_ROW + 1.5) * CELL[0], (cy + 1.5) * CELL[1]], [sheet]);
}
