// The criteria's fixtures (README: Fixtures): the tile atlas this suite writes and the documents, each a figure with a
// transport, as #504's suite writes one, in #535's form (a 2D camera over the page, a transport at 60 frames a second,
// its logic items with their programs listed in `assets`), with this issue's fields on its controls. A figure, not a
// film: a film's viewer takes the arrow keys for its frames (#501). Every atlas cell is solid, so a
// sample inside a drawn quad reads its cell's color exactly. Nothing here hits, focuses, picks or draws anything.

import { HEX, RULES_WRITES, SQUARE, TROOP_WRITES, worldWrites, type Cell, type Writes, type WorldPlan } from './programs.ts';
import { encodeRgbaPng, putEvidence, type JsonObject, type Program, type Pt, type Rgb } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #539 acceptance tests.' };
export const SEED = 539;

/** The atlas: four solid 8 × 8 px cells: two greens (the checkerboard), a unit's red and the picked cell's gold. */
export const TILE_COLORS: Rgb[] = [[64, 112, 72], [104, 152, 96], [196, 64, 48], [236, 196, 64]];
export const tileAtlas = (): Buffer => encodeRgbaPng(32, 8, (x) => [...TILE_COLORS[Math.floor(x / 8)]!, 255] as [number, number, number, number]);
export const putAtlas = (evidence: string): string => putEvidence(evidence, tileAtlas());

function camera2d(size: [number, number], width = size[0]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: width } };
}
/** A figure with a transport: a 2D camera over the page, 4 s at 60 fps, the items, `assets` with a license each. */
function piece(id: string, size: [number, number], items: JsonObject[], assets: Record<string, string>, extra: JsonObject = {}, camWidth?: number): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#539 ${id}`, description: `The #539 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
    items: Object.fromEntries([camera2d(size, camWidth), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
    ...extra,
  };
}
/** A logic item (Logic `logic@1`): its program by SHA-256 at 60 steps a second, reading `reads`, writing `writes`. */
function logicItem(id: string, program: Program, writes: Writes, reads: string[] = []): JsonObject {
  return {
    id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9',
    params: { program: program.sha, step_rate: 60, ...(reads.length ? { reads } : {}), writes: Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }])) },
  };
}
const array = (path: string, as: string): JsonObject => ({ array: path, as });
/** An atlas tile set (Mark set: atlas tiles) on the suite's atlas, its grid and params as given, at `pos`. */
function atlasSet(id: string, order: string, atlas: string, grid: JsonObject, params: JsonObject, pos: Pt = [0, 0]): JsonObject {
  return {
    id, kind: 'marks@1', name: `Set ${id}`, order, ...(pos[0] || pos[1] ? { at: { pos: [pos[0], pos[1], 0] } } : {}),
    params: { mark: 'image', atlas: { asset: atlas, cell: [8, 8], padding: 1 }, grid: { shape: 'square', ...grid }, ...params },
  };
}
/** A pick control on rows (Control: picks on rows and grid focus): document class, `verb: pick`, `rows`, `focus` if given. */
export function pickControl(label: string, rows: string[], focus?: JsonObject): JsonObject {
  return { kind: 'press', class: 'document', verb: 'pick', label, role: 'grid', rows, ...(focus ? { focus } : {}) };
}
/** A plain view-class slider: the next control in the Tab order. */
export const slider = (label: string): JsonObject => ({ kind: 'slider', class: 'view', label, role: 'slider', range: [0, 1], default: 0.5, increment: 0.1 });
/** A grid row's ID as the base names a row of a set laid out by `grid.size`: `<set>#<cx>,<cy>`. */
export const rowId = (set: string, [cx, cy]: Cell): string => `${set}#${cx},${cy}`;
export const cellText = ([cx, cy]: Cell): string => `(${cx}, ${cy})`;

// ---------------------------------------------------------------------------------------------------
// The 12 × 12 square grid: `board`, an atlas tile set with grid.size [12, 12], cell [16, 16], its tile and alive columns
// from `world`, at (8, 8): under the base's layout cell (cx, cy)'s quad is centred on (8 + 16 cx, 8 + 16 cy) and covers
// [16 cx, 16 cx + 16) × [16 cy, 16 cy + 16), so a page point's cell is the floor of the point over the cell (README:
// Readings). The page is 224 × 224 u: a 32 u margin right and below that no row covers, where a drag pans.

export const SQUARE_PAGE: [number, number] = [224, 224];
export const cellCentre = ([cx, cy]: Cell): Pt => [8 + 16 * cx, 8 + 16 * cy];
/** A point no row covers, and one a cell to its left, also clear: a drag between them pans the camera by one cell. */
export const MARGIN_FROM: Pt = [208, 208];
export const MARGIN_TO: Pt = [192, 208];

export interface SquareParts {
  world: Program;
  plan?: WorldPlan;
  /** The logic item `rules`, reading `place` (or `reads`), writing `got` and `lit`. */
  rules?: { program: Program; reads?: string[]; id?: string };
  /** The units `army` from `troops`, drawn above the board. */
  troops?: Program;
  /** The picked cell's highlight `picked`, lit from `rules.lit`. */
  picked?: boolean;
  /** The ghost `ghost` and its drivers reading `place.hover`. */
  ghost?: boolean;
  controls: JsonObject;
  /** The camera's view width (u): the page's width unless given. */
  camWidth?: number;
}
/** A square-grid document: `world` and `board`, and the parts asked for. */
export function squareDoc(id: string, atlas: string, parts: SquareParts): JsonObject {
  const plan = parts.plan ?? SQUARE;
  const items: JsonObject[] = [
    logicItem('world', parts.world, worldWrites(plan)),
    atlasSet('board', 'a1', atlas, { cell: [16, 16], size: [plan.cols, plan.rows] }, { alive: array('world.alive', 'bool'), columns: { tile: array('world.tiles', 'u16') } }, [8, 8]),
  ];
  const assets: Record<string, string> = { world_program: parts.world.sha, tile_atlas: atlas };
  if (parts.rules) {
    const rid = parts.rules.id ?? 'rules';
    items.push(logicItem(rid, parts.rules.program, RULES_WRITES, parts.rules.reads ?? ['place']));
    assets[`${rid}_program`] = parts.rules.program.sha;
  }
  if (parts.picked) items.push(atlasSet('picked', 'a3', atlas, { cell: [16, 16], size: [plan.cols, plan.rows] }, { alive: array('rules.lit', 'bool'), columns: { tile: { const: 3 } } }, [8, 8]));
  if (parts.troops) {
    items.push(logicItem('troops', parts.troops, TROOP_WRITES));
    items.push(atlasSet('army', 'a2', atlas, { cell: [12, 12] }, {
      place: 'free', alive: array('troops.alive', 'bool'),
      columns: { x: array('troops.x', 'f32'), y: array('troops.y', 'f32'), opacity: array('troops.fog', 'f32'), tile: { const: 2 } },
    }));
    assets['troops_program'] = parts.troops.sha;
  }
  const extra: JsonObject = { controls: parts.controls };
  if (parts.ghost) {
    // The ghost: a 16 × 16 u square in the look's accent, off the page unless a driver places it on the cell under the
    // pointer; its drivers read `place.hover`'s cell, and while hover is none they write their fallback, off the page.
    items.push({ id: 'ghost', kind: 'rect@1', name: 'Ghost', role: 'part', order: 'a4', params: { box: [0, 0, 16, 16], paint: { fill: { role: 'accent' } } }, at: { pos: [-64, -64, 0] } });
    extra['drivers'] = {
      ghost_x: { target: 'items/ghost/at/pos/0', expr: '16 * cx', vars: { cx: 'controls/place/hover/0' }, fallback: -64 },
      ghost_y: { target: 'items/ghost/at/pos/1', expr: '16 * cy', vars: { cy: 'controls/place/hover/1' }, fallback: -64 },
    };
  }
  return piece(id, SQUARE_PAGE, items, assets, extra, parts.camWidth);
}

// ---------------------------------------------------------------------------------------------------
// The 6 × 6 pointy odd hex fixture, cell [32, 28] (#536's AC1 fixture: rows (cx, cy) for cx, cy in 0..5, at the
// origin), here as a tile array laid out by grid.size [6, 6] from `hexworld`, so its rows are keyed `hexes#<cx>,<cy>`.
// Cell (cx, cy)'s centre is (32 (cx + s ÷ 2), 21 cy), s 1 on an odd row (Mark set: hex grid).

export const HEX_PAGE: [number, number] = [224, 160];
export function hexDoc(id: string, atlas: string, world: Program, focus?: JsonObject): JsonObject {
  return piece(id, HEX_PAGE, [
    logicItem('hexworld', world, worldWrites(HEX)),
    atlasSet('hexes', 'a1', atlas, { shape: 'hex', cell: [32, 28], hex: { orient: 'pointy', offset: 'odd' }, size: [6, 6] }, { alive: array('hexworld.alive', 'bool'), columns: { tile: array('hexworld.tiles', 'u16') } }),
  ], { world_program: world.sha, tile_atlas: atlas }, { controls: { place: pickControl('Place', ['hexes'], focus) } });
}

// ---------------------------------------------------------------------------------------------------
// A small square grid of `plan.cols` × `plan.rows` cells (the Oracle lane's rows), `strip`, cell [16, 16] at (8, 8),
// with the controls given, in that order.

export function stripDoc(id: string, atlas: string, world: Program, plan: WorldPlan, controls: JsonObject): JsonObject {
  return piece(id, [16 * plan.cols + 16, 16 * plan.rows + 16], [
    logicItem('world', world, worldWrites(plan)),
    atlasSet('strip', 'a1', atlas, { cell: [16, 16], size: [plan.cols, plan.rows] }, { alive: array('world.alive', 'bool'), columns: { tile: array('world.tiles', 'u16') } }, [8, 8]),
  ], { world_program: world.sha, tile_atlas: atlas }, { controls });
}
