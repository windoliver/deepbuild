// The criteria's fixtures (README: Fixtures): #391 film envelopes as #535's and #538's suites write them (a 2D camera over
// the page, 60 frames a second, the logic item with its program listed in `assets`), each holding a backdrop in the
// look's `ground` role, one or two `grid_image@1` items with the issue's fields, and a key: one rect in each team's role,
// so every role's color is read from what the canvas draws, never written here. `sessionForm` turns one into the form
// `deep-gpu`'s 2D calls take (#385, #417): one writer layer, no camera. Nothing here draws, rebuilds or picks a role.

import type { JsonObject, Program } from '../538/helpers.ts';
import { FRONT, NONE, SIDE, WAR } from './programs.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #269 acceptance tests.' };
export const SEED = 269;

/** The grids' roles, by value: three teams and `none` (programs.ts NONE). Each team role is one the clean look defines. */
export const TEAMS = ['term_red', 'term_green', 'term_blue'] as const;
export const ROLES = [...TEAMS, 'none'] as const;
if (ROLES[NONE] !== 'none') throw Error('programs.ts NONE indexes none');

export type Sample = 'nearest' | 'smooth';
/** Each grid image's item ID, by how it samples. */
export const mapId = (s: Sample): string => `${s}_map`;
export const MARGIN = 8;
/** The grid fixture's cell, in u (1 u a px). */
export const CELL = 8;
export const SPAN = SIDE * CELL;
const GAP = 16;
/** Grid image i's top-left corner in px (cell (0, 0) there, x right, y down). */
export const originOf = (i: number): [number, number] => [MARGIN + i * (SPAN + GAP), MARGIN];
/** The key: role `TEAMS[i]` fills a 24 × 16 rect; its centre pixel is that role's color as drawn. */
export const keyCenter = (top: number, i: number): [number, number] => [MARGIN + 32 * i + 12, top + 8];
const keys = (top: number): JsonObject[] => TEAMS.map((role, i) => rect(`key_${i}`, `a3${i}`, [MARGIN + 32 * i, top, 24, 16], role));

function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A film envelope: a 2D camera over the page, 4 s at 60 fps, the items, each program listed in `assets`. */
function film(id: string, size: [number, number], items: JsonObject[], programs: Program[]): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#269 ${id}`, description: `The #269 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] },
    items: Object.fromEntries([camera2d(size), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(programs.map((p) => [`${p.name}_program`, { sha256: p.sha, license: LICENSE }])),
  };
}
/** A logic item (Logic `logic@1`) writing one i32 array `ground` of `count` cells, 60 steps a second. */
const logicItem = (id: string, program: Program, count: number): JsonObject =>
  ({ id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9', params: { program: program.sha, step_rate: 60, writes: { ground: { type: 'i32', count } } } });
export const rect = (id: string, order: string, box: number[], role: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role } } } });
/** The issue's mark (README: The item): `grid_image@1` at `pos`, its top-left corner, with every field written out. */
export const gridImage = (id: string, order: string, pos: [number, number], grid: string, size: number, cell: number, sample: Sample): JsonObject => ({
  id, kind: 'grid_image@1', name: id, order, at: { pos: [pos[0], pos[1], 0] },
  params: { grid, size: [size, size], cell: [cell, cell], roles: [...ROLES], sample, edge: 1 },
});

/** The grid fixture: `teams.ground` (programs.ts) drawn once per sample given, side by side at 8 px a cell, over the
 * backdrop, with the key below. */
export function gridDoc(program: Program, samples: Sample[]): JsonObject {
  const top = MARGIN + SPAN + MARGIN;
  const size: [number, number] = [MARGIN + samples.length * SPAN + (samples.length - 1) * GAP + MARGIN, top + 16 + MARGIN];
  return film(`grid-${samples.join('-')}`, size, [
    logicItem('teams', program, SIDE * SIDE),
    rect('backdrop', 'a1', [0, 0, size[0], size[1]], 'ground'),
    ...samples.map((s, i) => gridImage(mapId(s), `a2${i}`, originOf(i), 'teams.ground', SIDE, CELL, s)),
    ...keys(top),
  ], [program]);
}
export const GRID_KEY_TOP = MARGIN + SPAN + MARGIN;

/** The corner fixture: `front.ground` (8 × 8) drawn smooth at 32 px a cell at (8, 8), over the backdrop, key below. */
export const FRONT_CELL = 32;
export const FRONT_KEY_TOP = MARGIN + FRONT * FRONT_CELL + MARGIN;
export function cornerDoc(program: Program): JsonObject {
  const size: [number, number] = [MARGIN + FRONT * FRONT_CELL + MARGIN, FRONT_KEY_TOP + 16 + MARGIN];
  return film('corner', size, [
    logicItem('front', program, FRONT * FRONT),
    rect('backdrop', 'a1', [0, 0, size[0], size[1]], 'ground'),
    gridImage('corner_map', 'a20', [MARGIN, MARGIN], 'front.ground', FRONT, FRONT_CELL, 'smooth'),
    ...keys(FRONT_KEY_TOP),
  ], [program]);
}

/** The budget's fixture: `war.ground` (256 × 256) drawn smooth at 2 px a cell, 512 × 512 px, over the backdrop. */
export const WAR_PX = 512;
export function warDoc(program: Program): JsonObject {
  return film('war', [WAR_PX, WAR_PX], [
    logicItem('war', program, WAR * WAR),
    rect('backdrop', 'a1', [0, 0, WAR_PX, WAR_PX], 'ground'),
    gridImage('war_map', 'a20', [0, 0], 'war.ground', WAR, WAR_PX / WAR, 'smooth'),
  ], [program]);
}

/** The same document as a session holds it for `deep-gpu`'s 2D calls (#385's `layers`, #417's `film2d`): one writer
 * layer `main` that every item is on, and no camera (a 2D film's camera over the page draws as none does). */
export function sessionForm(doc: JsonObject): JsonObject {
  const items = Object.fromEntries(Object.entries(doc['items'] as Record<string, JsonObject>)
    .filter(([, item]) => item['kind'] !== 'camera@1')
    .map(([id, item]) => [id, { ...item, layer: 'main' }]));
  const { camera: _camera, ...rest } = doc;
  return { ...rest, layers: { main: { writer: 'agent:sess-269', title: 'main', order: 'a0' } }, items };
}
