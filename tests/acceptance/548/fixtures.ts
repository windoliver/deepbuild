// The criteria's fixtures (README: Fixtures): the pieces `deep-logic` takes and the documents deep-show presents, each
// a figure with a transport as #539's suite writes one (a 2D camera over the page, 60 frames a second, its logic items
// with their programs in the evidence store and listed in `assets` with a license). The hex board's tiles are pointy
// hexagons on a transparent ground. Nothing here steps, previews, draws or queries anything.

import {
  BOIDS, CELLS, COLS, FLOCK_EMITS, FLOCK_READS, FLOCK_WRITES, GAME_PREVIEW, GAME_WRITES, ROWS, flock, probe, type Cell,
} from './programs.ts';
import {
  admitted, checkCall, encodeRgbaPng, entryAt, logic, offsetIn, params, piece, putEvidence, type EmitsSpec, type Entry, type ItemSpec, type JsonObject, type PreviewSpec, type Program, type WritesSpec,
} from './helpers.ts';

export const SEED = 548;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #548 acceptance tests.' };

// ---------------------------------------------------------------------------------------------------
// The hex board's pieces for deep-logic (criteria 1 to 3).

/** The hex board's logic item: `game`, its writes and its preview, reading the point control `place`'s hover. */
export const gameSpec = (program: Program): ItemSpec => ({
  program, step_rate: 60, writes: GAME_WRITES as unknown as WritesSpec, preview: GAME_PREVIEW as unknown as PreviewSpec,
});
export const gamePiece = (program: Program): JsonObject => piece({ seed: SEED, controls: { place: 'point' }, items: { game: gameSpec(program) } });

// ---------------------------------------------------------------------------------------------------
// The flock (criteria 4 to 6).

export const flockSpec = (program: Program, reads: string[] = FLOCK_READS): ItemSpec => ({
  program, step_rate: 60, reads, writes: FLOCK_WRITES as unknown as WritesSpec, emits: FLOCK_EMITS as unknown as EmitsSpec,
});
export const flockPiece = (program: Program, reads: string[] = FLOCK_READS): JsonObject =>
  piece({ seed: SEED, controls: { wind: 'slider', gust: 'slider' }, items: { flock: flockSpec(program, reads) } });
/** The flock's program for `reads`, built against the layout `check` gives its item (its one emit kind at the emit region's start). */
export function flockProgram(reads: string[] = FLOCK_READS): Program {
  const [reply] = logic([checkCall(flockPiece(probe(), reads))]);
  const l = admitted(reply!, 'check of the flock\'s item')['flock']!;
  return flock({ wind: offsetIn(l, 'reads', 'wind'), gust: offsetIn(l, 'reads', 'gust'), pos: offsetIn(l, 'writes', 'pos'), vel: offsetIn(l, 'writes', 'vel'), score: offsetIn(l, 'writes', 'score'), crossing: 0 });
}
/** The flock's input track: wind and gust entries at fixed steps, before and after step 600. */
export const FLOCK_TRACK: Entry[] = [
  entryAt('wind', 30, 2.5), entryAt('gust', 100, 1.5), entryAt('wind', 200, -4), entryAt('gust', 350, -2),
  entryAt('gust', 350, 0.75, 1), entryAt('wind', 450, 6), entryAt('gust', 590, 3), entryAt('wind', 600, -1.25), entryAt('gust', 650, 2),
];
/** The program that traps at step 412: its `trigger` entries (3 at step 100, 0 at 412, read first there, and 0 at 500). */
export const judgeSpec = (program: Program): ItemSpec => ({ program, step_rate: 60, reads: ['trigger'], writes: { acc: { type: 'i32' } } });
export const JUDGE_TRACK: Entry[] = [entryAt('trigger', 100, 3), entryAt('trigger', 412, 0), entryAt('trigger', 500, 0)];

// ---------------------------------------------------------------------------------------------------
// Documents for deep-show.

/** The atlas: four pointy hexagons 32 × 28 px on a transparent ground: two greens (the board), the route's gold, the unit's red. */
export const TILE_COLORS: [number, number, number][] = [[58, 104, 70], [92, 140, 88], [236, 196, 64], [204, 64, 48]];
const inHex = (x: number, y: number): boolean => {
  // The cell's pointy hexagon, (16, 0), (32, 7), (32, 21), (16, 28), (0, 21), (0, 7), inset by about 1.5 px so the
  // cells' edges show, sampled at pixel centres.
  const px = x + 0.5; const py = y + 0.5;
  const dx = Math.abs(px - 16);
  return dx <= 14.5 && py >= 7 * (dx / 16) + 1.5 && py <= 28 - 7 * (dx / 16) - 1.5;
};
export const tileAtlas = (): Buffer => encodeRgbaPng(128, 28, (x, y) => inHex(x % 32, y) ? [...TILE_COLORS[Math.floor(x / 32)]!, 255] as [number, number, number, number] : [0, 0, 0, 0]);
export const putAtlas = (evidence: string): string => putEvidence(evidence, tileAtlas());

function camera2d(size: [number, number], width = size[0]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: width } };
}
function figure(id: string, size: [number, number], span: string, items: JsonObject[], assets: Record<string, string>, extra: JsonObject = {}, camWidth?: number): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#548 ${id}`, description: `The #548 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    transport: { span, frame_rate: [60, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
    items: Object.fromEntries([camera2d(size, camWidth), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
    ...extra,
  };
}
const logicItem = (id: string, spec: ItemSpec): JsonObject => ({ id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9', params: params(spec) });
const docSlider = (label: string, range: [number, number]): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range, default: 0, increment: 0.25 });

/** The board's page: 24 columns of 32 u (odd rows half a cell right) and 24 rows 21 u apart, at (16, 14). */
export const HEX_PAGE: [number, number] = [800, 520];
const BOARD_AT: [number, number] = [16, 14];
/** A hex cell's centre on the page: (16 + 32 (cx + s ÷ 2), 14 + 21 cy), s 1 on an odd row (Mark set: hex grid, pointy odd). */
export const hexCentre = ([cx, cy]: Cell): [number, number] => [BOARD_AT[0] + 32 * (cx + (cy & 1) / 2), BOARD_AT[1] + 21 * cy];
const hexSet = (id: string, order: string, atlas: string, extra: JsonObject): JsonObject => ({
  id, kind: 'marks@1', name: `Set ${id}`, order, at: { pos: [BOARD_AT[0], BOARD_AT[1], 0] },
  params: { mark: 'image', atlas: { asset: atlas, cell: [32, 28], padding: 1 }, grid: { shape: 'hex', cell: [32, 28], hex: { orient: 'pointy', offset: 'odd' }, size: [COLS, ROWS] }, ...extra },
});
/**
 * The hex board (criteria 1 and 7): `game`, the board (`board`, every cell), the previewed route above it (`route`,
 * alive from `game.preview.lit`, gold) and the unit above that (`unit`, alive from `game.here`, red), 4 s, and the point
 * control `place` on the board's cells.
 */
export function hexDoc(id: string, atlas: string, program: Program, camWidth?: number): JsonObject {
  const alive = (array: string): JsonObject => ({ array, as: 'bool' });
  return figure(id, HEX_PAGE, '4s', [
    logicItem('game', { ...gameSpec(program) }),
    hexSet('board', 'a1', atlas, { n: CELLS, columns: { tile: { const: 0 } } }),
    hexSet('route', 'a2', atlas, { alive: alive('game.preview.lit'), columns: { tile: { const: 2 } } }),
    hexSet('unit', 'a3', atlas, { alive: alive('game.here'), columns: { tile: { const: 3 } } }),
  ], { game_program: program.sha, tile_atlas: atlas }, {
    controls: { place: { kind: 'point', class: 'document', label: 'Place', role: 'grid', on: 'board' } },
  }, camWidth);
}
/** The flock's document (criteria 4 to 6): the logic item `flock` reading the sliders `wind` and `gust`, over 12 s. */
export function flockDoc(id: string, program: Program, reads: string[] = FLOCK_READS): JsonObject {
  return figure(id, [320, 180], '12s', [logicItem('flock', flockSpec(program, reads))], { flock_program: program.sha },
    { controls: Object.fromEntries(reads.map((r) => [r, docSlider(r === 'wind' ? 'Wind' : 'Gust', [-10, 10])])) });
}
/** The trapping program's document (criterion 4): the logic item `judge` reading the slider `trigger`, over 12 s. */
export function judgeDoc(id: string, program: Program): JsonObject {
  return figure(id, [320, 180], '12s', [logicItem('judge', judgeSpec(program))], { judge_program: program.sha }, { controls: { trigger: docSlider('Trigger', [0, 10]) } });
}
export { BOIDS, CELLS };
