// The warehouse document (criteria 7 and 10; README: The warehouse): a #391 film envelope, as #535's and #544's suites
// write one, holding the warehouse model's logic item (scenes.ts: WAREHOUSE, linking process@1's reference library),
// an atlas tile set whose free rows read the program's drawing arrays (#535's logic columns), plain rects and labels for
// the stations, and the throughput readout: a text counter (Text animator and counter) whose source is a driver that
// reads `wh.thru[N]`, the throughput in all over the last hour (#1183's driver var on one logic element). Nothing here
// draws or runs anything; `deep-show run` does (../535/helpers.ts, imported unchanged).

import type { JsonObject } from '../190/helpers.ts';
import { encodeRgbaPng } from '../535/helpers.ts';
import { MEMORY_MIB, PAGE, TILES, type Writes } from './programs.ts';
import { WAREHOUSE, stationCount } from './scenes.ts';
import type { Link } from './helpers.ts';
import type { Program } from '../190/helpers.ts';

export const LOGIC = 'wh';
/** The readout's item, and the index of "in all" in the statistics arrays. */
export const READOUT = 'rate';
export const ALL = stationCount(WAREHOUSE);
/** 600 s of the piece's clock at 60 steps a second: 36,000 ticks of 0.2 s, two hours of the model. */
export const SPAN_STEPS = 36_000;
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB980D${String(n).padStart(18, '0')}`;

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #980 acceptance tests.' };
const CELL = 16;
type Rgb = [number, number, number];
/** The atlas: one 16 × 16 cell per tile (programs.ts: TILES), a box with a darker one-pixel edge. */
export function warehouseAtlas(): Buffer {
  const colors: Rgb[] = [[214, 168, 92], [190, 120, 60], [120, 76, 40]];
  check(colors.length === Object.keys(TILES).length, 'one color a tile');
  return encodeRgbaPng(CELL * colors.length, CELL, (x, y) => {
    const c = colors[Math.floor(x / CELL)]!, u = x % CELL;
    const edge = u === 0 || u === CELL - 1 || y === 0 || y === CELL - 1;
    return [...(edge ? c.map((v) => Math.round(v * 0.6)) : c), 255] as [number, number, number, number];
  });
}
function check(ok: boolean, what: string): void { if (!ok) throw Error(`fixture bug: ${what}`); }

const text = (id: string, order: string, pos: [number, number], words: string, size = 12): JsonObject =>
  ({ id, kind: 'text@1', name: words, order, at: { pos: [pos[0], pos[1], 0] }, params: { text: words, size } });
const rect = (id: string, order: string, box: [number, number, number, number], role: string): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role } } } });
const column = (name: string, as: string): JsonObject => ({ array: `${LOGIC}.${name}`, as });

/**
 * The warehouse: its logic item, the stations drawn as rects with labels, the cases as free rows of an atlas set, and
 * the readout. `typed`: criterion 7's planted label, the readout's text typed as that string instead of its counter.
 */
export function warehouseDoc(o: { id: string; program: Program; atlas: string; ref: Link; writes: Writes; typed?: string }): JsonObject {
  const readout: JsonObject = o.typed !== undefined
    ? { text: o.typed, size: 28 }
    : { text: { counter: { source: 'thru', tabular: true, format: { group: 'none' } } }, size: 28, box: { w: 140, h: 36 }, widest: '888' };
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] } },
    rect('inbound_zone', 'b0', [12, 150, 140, 40], 'muted'), rect('belt', 'b1', [152, 160, 316, 20], 'muted'),
    rect('dock_zone', 'b2', [468, 150, 118, 40], 'muted'), rect('fork_a', 'b3', [612, 140, 28, 20], 'accent'), rect('fork_b', 'b4', [612, 180, 28, 20], 'accent'),
    text('title', 'c0', [20, 32], 'Warehouse model', 18), text('inbound_label', 'c1', [20, 214], 'Inbound'), text('belt_label', 'c2', [280, 214], 'Conveyor'),
    text('dock_label', 'c3', [480, 214], 'Dock queue'), text('fork_label', 'c4', [606, 228], 'Forklifts'),
    { id: READOUT, kind: 'text@1', name: 'Throughput', order: 'c5', at: { pos: [500, 44, 0] }, params: readout },
    text('rate_label', 'c6', [500, 80], 'cases shipped in the last hour'),
    {
      id: 'cases', kind: 'marks@1', name: 'Cases', order: 'd0',
      params: {
        mark: 'image', atlas: { asset: o.atlas, cell: [CELL, CELL], padding: 1 }, grid: { shape: 'square', cell: [CELL, CELL] }, place: 'free',
        alive: column('show', 'bool'), columns: { x: column('x', 'f32'), y: column('y', 'f32'), tile: column('tile', 'u16') },
      },
    },
    {
      id: LOGIC, kind: 'logic@1', name: 'Warehouse model', order: 'e0',
      params: {
        program: o.program.sha, step_rate: WAREHOUSE.rate, writes: o.writes as unknown as JsonObject, process: { kinds: WAREHOUSE.kinds },
        budget: { fuel: 10_000_000, memory: MEMORY_MIB }, links: [o.ref as unknown as JsonObject],
      },
    },
  ];
  return {
    format: 1, id: o.id, profile: 'film', title: 'Warehouse model', description: 'Cases arrive, wait, ride a conveyor into a dock queue and are taken out by two forklifts; the readout shows the cases shipped over the last hour.',
    size: PAGE, seed: 980, camera: 'cam', transport: { span: `${SPAN_STEPS / WAREHOUSE.rate}s`, frame_rate: [60, 1] },
    data: { thru: { value: 0, source: 'story' } },
    drivers: { thru: { target: 'data/thru', expr: 'x', vars: { x: `${LOGIC}.thru[${ALL}]` } } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    assets: { warehouse_program: { sha256: o.program.sha, license: LICENSE }, warehouse_atlas: { sha256: o.atlas, license: LICENSE } },
  };
}
