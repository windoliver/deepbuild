// Criterion 8's document (README: The readout): a #391 film envelope, as #980's and #535's suites write one, holding a
// logic item `mains` that runs the lamp-and-heater circuit (circuits.ts: SHOWN_CIRCUIT) on circuit@1's reference
// library, and the readout `current`: a text counter (Text animator and counter) whose source is a driver reading
// `mains.i_rms[1]`, the lamp's rms current (#1183's driver var on one logic element), formatted with its unit, A, to
// two places. Nothing here draws or runs anything; `deep-show run` does (../535/helpers.ts, imported unchanged).

import type { JsonObject, Program } from '../190/helpers.ts';
import { SHOWN_CIRCUIT, index } from './circuits.ts';
import type { Link } from './helpers.ts';
import { writesOf } from './programs.ts';

export const LOGIC = 'mains';
export const READOUT = 'current';
/** The step rate of the document's logic item: a step a frame at 60 frames a second. */
export const RATE = 60;
/** 11 s of film: 660 steps. */
export const SPAN_STEPS = 660;
export const LAMP_AT = index(SHOWN_CIRCUIT, 'lamp');
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1181D${String(n).padStart(17, '0')}`;

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #1181 acceptance tests.' };
const text = (id: string, order: string, pos: [number, number], words: string, size = 14): JsonObject =>
  ({ id, kind: 'text@1', name: words, order, at: { pos: [pos[0], pos[1], 0] }, params: { text: words, size } });

/** The document. `typed`: criterion 8's planted label, the readout's text typed as that string instead of its counter. */
export function shownDoc(o: { id: string; program: Program; ref: Link; typed?: string }): JsonObject {
  const readout: JsonObject = o.typed !== undefined
    ? { text: o.typed, size: 28 }
    : { text: { counter: { source: 'i_lamp', tabular: true, format: { unit: 'A', precision: 2, group: 'none' } } }, size: 28, box: { w: 160, h: 36 }, widest: '88.88 A' };
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [240, 100, 0], view_width: 480 } },
    text('title', 'b0', [20, 32], 'A lamp and a heater on the mains', 18),
    { id: READOUT, kind: 'text@1', name: 'Lamp current', order: 'b1', at: { pos: [20, 100, 0] }, params: readout },
    text('label', 'b2', [20, 140], 'the lamp\'s current, read from the circuit'),
    {
      id: LOGIC, kind: 'logic@1', name: 'The circuit', order: 'c0',
      params: { program: o.program.sha, step_rate: RATE, writes: writesOf(SHOWN_CIRCUIT) as unknown as JsonObject, circuit: SHOWN_CIRCUIT as unknown as JsonObject, budget: { fuel: 10_000_000 }, links: [o.ref as unknown as JsonObject] },
    },
  ];
  return {
    format: 1, id: o.id, profile: 'film', title: 'Lamp current', description: 'A lamp and a heater on the mains; the readout shows the current the lamp draws, read from the circuit the logic item solves.',
    size: [480, 200], seed: 1181, camera: 'cam', transport: { span: `${SPAN_STEPS / RATE}s`, frame_rate: [60, 1] },
    data: { i_lamp: { value: 0, source: 'story' } },
    drivers: { i_lamp: { target: 'data/i_lamp', expr: 'x', vars: { x: `${LOGIC}.i_rms[${LAMP_AT}]` } } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    assets: { circuit_program: { sha256: o.program.sha, license: LICENSE } },
  };
}
