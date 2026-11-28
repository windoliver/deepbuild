// Criterion 14's document (README: The readout): a #391 film envelope, as #1181's show.ts writes one, holding a logic
// item `board` that runs criterion 7's leak (circuits.ts: BOARD_CIRCUIT, the fault closed by the item's own `leak[0]`
// from step 100) on circuit@2's reference library at 1,000 steps a second, and the readout `residual`: a text counter
// whose source is a driver reading `board.residual[1]`, the RCD's residual in A, × 1,000, formatted with its unit, mA,
// to no places. Nothing here draws or runs anything; `deep-show run` does (../535/helpers.ts, imported unchanged).

import type { JsonObject, Program } from '../190/helpers.ts';
import { BOARD_CIRCUIT, BOARD_OWN, index, type Fix } from './circuits.ts';
import type { Link } from './helpers.ts';
import { writesOf } from './programs.ts';

export const LOGIC = 'board';
export const READOUT = 'residual';
/** The logic item's step rate: 1 ms, the criterion 7 circuit's. */
export const RATE = 1000;
/** 1 s of film: 1,000 steps. */
export const SPAN_STEPS = 1000;
export const RCD_AT = index(BOARD_CIRCUIT, 'rcd');
export const BOARD: Fix = { item: LOGIC, circuit: BOARD_CIRCUIT, rate: RATE, inputs: [], track: [], steps: SPAN_STEPS, own: BOARD_OWN };
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB3604D${String(n).padStart(17, '0')}`;

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #3604 acceptance tests.' };
const text = (id: string, order: string, pos: [number, number], words: string, size = 14): JsonObject =>
  ({ id, kind: 'text@1', name: words, order, at: { pos: [pos[0], pos[1], 0] }, params: { text: words, size } });

/** The document. `typed`: criterion 14's planted label, the readout's text typed as that string instead of its counter. */
export function shownDoc(o: { id: string; program: Program; ref: Link; typed?: string }): JsonObject {
  const readout: JsonObject = o.typed !== undefined
    ? { text: o.typed, size: 28 }
    : { text: { counter: { source: 'residual_ma', tabular: true, format: { unit: 'mA', precision: 0, group: 'none' } } }, size: 28, box: { w: 160, h: 36 }, widest: '888 mA' };
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [240, 100, 0], view_width: 480 } },
    text('title', 'b0', [20, 32], 'A lamp behind an RCD, and a leak to earth', 18),
    { id: READOUT, kind: 'text@1', name: 'Residual current', order: 'b1', at: { pos: [20, 100, 0] }, params: readout },
    text('label', 'b2', [20, 140], 'the current that doesn\'t come back, read from the circuit'),
    {
      id: LOGIC, kind: 'logic@1', name: 'The board', order: 'c0',
      params: { program: o.program.sha, step_rate: RATE, writes: writesOf(BOARD) as unknown as JsonObject, circuit: BOARD_CIRCUIT as unknown as JsonObject, budget: { fuel: 10_000_000 }, links: [o.ref as unknown as JsonObject] },
    },
  ];
  return {
    format: 1, id: o.id, profile: 'film', title: 'Residual current', description: 'A lamp behind a 30 mA RCD with a 2,000 ohm leak to earth; the readout shows the current that leaves by the earth, read from the circuit the logic item solves.',
    size: [480, 200], seed: 3604, camera: 'cam', transport: { span: `${SPAN_STEPS / RATE}s`, frame_rate: [60, 1] },
    data: { residual_ma: { value: 0, source: 'story' } },
    drivers: { residual_ma: { target: 'data/residual_ma', expr: 'x * 1000', vars: { x: `${LOGIC}.residual[${RCD_AT}]` } } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    assets: { circuit_program: { sha256: o.program.sha, license: LICENSE } },
  };
}
