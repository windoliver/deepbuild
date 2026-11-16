// The criteria's fixtures (README: Fixtures): the tile atlas this suite writes and the documents, each a figure with a
// transport in #539's form (a 2D camera over the page, a transport at 60 frames a second, its logic items with their
// programs listed in `assets`), with this issue's fields on its controls; and the piece `deep-logic` takes for criterion
// 1's save. Nothing here scrolls, types, commits or draws anything.

import { ECHO_WRITES, ROWS, TILES_WRITES, type Writes } from './programs.ts';
import { encodeRgbaPng, putEvidence, type JsonObject, type Program, type Pt } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #542 acceptance tests.' };
export const SEED = 542;

/** Every fixture's page: 480 × 240 u, shown in a 480 × 240 px panel (1 px a u: a step of 24 u covers 24 px on screen). */
export const PAGE: [number, number] = [480, 240];
/** The list's area, the item `listbox`: the page's left half, 10 rows of 24 u. */
export const AREA: [number, number, number, number] = [0, 0, 240, 240];
/** A page point over the list's area, and one outside it (the page's right half, where the camera keeps the wheel). */
export const OVER: Pt = [120, 120];
export const OUTSIDE: Pt = [360, 120];
/** The item `elsewhere` in the text fixtures: the page's bottom right corner, clear of every control. */
export const ELSEWHERE: [number, number, number, number] = [400, 176, 64, 48];
export const ELSEWHERE_AT: Pt = [432, 200];
/** Criterion 1's program: 24 bytes, its line ends LF. */
export const PROGRAM_TEXT = 'set a 1\nop add b a 2\nend';

/** The atlas: four solid 8 × 8 px cells, the list's row colors (row i takes cell i mod 4). */
const TILE_COLORS: [number, number, number][] = [[236, 196, 64], [64, 112, 72], [72, 104, 176], [196, 64, 48]];
export const putAtlas = (evidence: string): string => putEvidence(evidence, encodeRgbaPng(32, 8, (x) => [...TILE_COLORS[Math.floor(x / 8)]!, 255]));

function camera2d(): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] } };
}
/** A figure with a transport: a 2D camera over the page, 4 s at 60 fps, the items, `assets` with a license each. */
function piece(id: string, items: JsonObject[], assets: Record<string, string>, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#542 ${id}`, description: `The #542 acceptance tests' document ${id}.`, size: PAGE, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
    items: Object.fromEntries([camera2d(), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
    ...extra,
  };
}
const writesOf = (writes: Writes): JsonObject => Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }]));
/** A logic item (Logic `logic@1`): its program by SHA-256 at 60 steps a second, reading `reads`, writing `writes`. */
function logicItem(id: string, program: Program, writes: Writes, reads: string[] = []): JsonObject {
  return { id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9', params: { program: program.sha, step_rate: 60, ...(reads.length ? { reads } : {}), writes: writesOf(writes) } };
}

// ---------------------------------------------------------------------------------------------------
// Controls, as the issue's Fields write them.

export type Lines = 'one' | 'many';
/** A text control (Control: text): class document, `text: {max_bytes, lines}`. */
export const textControl = (label: string, maxBytes: number, lines: Lines): JsonObject =>
  ({ kind: 'text', class: 'document', label, role: 'textbox', text: { max_bytes: maxBytes, lines } });

export interface ScrollSpec { class: 'document' | 'view'; range: [number, number]; snap?: number; page?: number }
/** A scroll control (Control: scroll) over `listbox`: step 24, axis y, its value announced as "Row <position>". */
export const scrollControl = (s: ScrollSpec): JsonObject => ({
  kind: 'scroll', class: s.class, label: 'Rows', role: 'scrollbar', default: 0, value_text: 'Row {value}',
  scroll: { axis: 'y', step: 24, range: s.range, page: s.page ?? 10, area: 'listbox', ...(s.snap !== undefined ? { snap: s.snap } : {}) },
});

// ---------------------------------------------------------------------------------------------------
// The 200-row list: `listbox`, a rect over the page's left half (the scroll control's `area`); `rows`, an atlas tile set
// of 1 × 200 cells of 240 × 24 u from `tiles` (row i in color i mod 4), whose offset a driver takes from the scroll
// control's position p: row 0's centre at (120, 12 − 24 p), so at position p the area shows rows p to p + 9.

export interface ListParts {
  atlas: string;
  tiles: Program;
  /** The scroll control `list` (or under `id`); none for the camera's zoom fixture with no scroll control. */
  scroll?: { id: string; spec: ScrollSpec };
  /** Controls ahead of the scroll control in the document's order (criterion 10's text control). */
  before?: JsonObject;
}
export function listDoc(id: string, p: ListParts): JsonObject {
  const items: JsonObject[] = [
    logicItem('tiles', p.tiles, TILES_WRITES),
    { id: 'listbox', kind: 'rect@1', name: 'List', role: 'part', order: 'a1', params: { box: AREA, paint: { fill: { role: 'muted' } } } },
    {
      id: 'rows', kind: 'marks@1', name: 'Rows', order: 'a2', at: { pos: [120, 12, 0] },
      params: {
        mark: 'image', atlas: { asset: p.atlas, cell: [8, 8], padding: 1 }, grid: { shape: 'square', cell: [240, 24], size: [1, ROWS] },
        alive: { array: 'tiles.alive', as: 'bool' }, columns: { tile: { array: 'tiles.tile', as: 'u16' } },
      },
    },
  ];
  const controls: JsonObject = { ...(p.before ?? {}) };
  const extra: JsonObject = {};
  if (p.scroll) {
    controls[p.scroll.id] = scrollControl(p.scroll.spec);
    extra['drivers'] = { rows_y: { target: 'items/rows/at/pos/1', expr: '12 - 24 * p', vars: { p: `controls/${p.scroll.id}/value` } } };
  }
  return piece(id, items, { tiles_program: p.tiles.sha, tile_atlas: p.atlas }, { controls, ...extra });
}

// ---------------------------------------------------------------------------------------------------
// The text fixtures: one text control `id`, the logic item `echo` reading it (programs.ts), and `elsewhere`, a rect in
// the page's bottom right corner that no control covers, where a click is a click elsewhere.

export function textDoc(id: string, echo: Program, control: { id: string; label: string; maxBytes: number; lines: Lines }): JsonObject {
  return piece(id, [
    logicItem('echo', echo, ECHO_WRITES, [control.id]),
    { id: 'elsewhere', kind: 'rect@1', name: 'Elsewhere', role: 'part', order: 'a1', params: { box: ELSEWHERE, paint: { fill: { role: 'muted' } } } },
  ], { echo_program: echo.sha }, { controls: { [control.id]: textControl(control.label, control.maxBytes, control.lines) } });
}

/** Criterion 1's piece as `deep-logic` takes it (#534's form): the text control and `echo` reading it, saving slot 1 on request. */
export function logicPiece(echo: Program): JsonObject {
  return {
    seed: SEED,
    controls: { program: textControl('Program', 16_384, 'many') },
    items: { echo: { kind: 'logic@1', params: { program: echo.sha, step_rate: 60, reads: ['program'], writes: writesOf(ECHO_WRITES), saves: { slots: 1, request: 'request' } } } },
    assets: { [echo.sha]: echo.b64 },
  };
}
