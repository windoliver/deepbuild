// Criterion 14: "A bound value reading the RCD's `residual` shows 115 mA at 20 sampled steps of its fault. A planted
// label typed as "115 mA" fails honest numbers (#406), naming the item."
//
// Through `deep-show run` (#393's scenario; ../535/helpers.ts, imported unchanged) and `deep-logic first_party` and
// `playback` (README: The surface), as #1181's criterion 8 reads its lamp. The document (show.ts) runs criterion 7's
// leak in its logic item `board` at 1,000 steps a second, the fault closed by the item's own `leak[0]` from step 100,
// so the RCD opens 52.17 ms later, at step 152 or 153, and shows the readout `residual`: a text counter whose source
// is a driver reading `board.residual[1]` × 1,000, with the unit mA to no places. At 20 sampled steps of the fault,
// 100, 102 … 138, `eval` gives the text the frame draws: "115 mA" at each; `playback` of the same logic item gives the
// RCD's residual 0.115 A there while the lamp carries 0.26087 A, so a readout of another array shows another number.
// The planted label: the same document with the readout's text typed as "115 mA" is refused by honest numbers,
// `number_unsourced` naming `residual`, while the counter's document raises no such issue. deep-show is built inside
// the first test, after circuit@2 is found. The wrong programs: a readout of another part or array, a residual in the
// wrong unit or precision, and a check blind to a typed number.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, obj, onHost, prebuild, show, str, type JsonObject } from '../190/helpers.ts';
import { binOf, issuesOf, namesItem, presented, putEvidence, runShow, scenario, showCall, useTemp } from '../535/helpers.ts';
import { LAMP, LEAKED, index } from './circuits.ts';
import { AC, INTERFACE, circuitLib, layout, nums, playbackCall, played, rel } from './helpers.ts';
import { circuitProgram, writesOf } from './programs.ts';
import { BOARD, DOC, LOGIC, RATE, RCD_AT, READOUT, SPAN_STEPS, shownDoc } from './show.ts';

prebuild(() => { logicBin(); });
const temp = useTemp();

/** The 20 sampled steps of the fault: 100, 102 … 138, before the RCD opens at 152 or 153. */
const SAMPLES = Array.from({ length: 20 }, (_, j) => LEAKED.k + 2 * j);
const FLICKS = 705_600_000;
const at = (k: number): number => (k * FLICKS) / RATE;
const plain = (t: string): string => t.replace(/[\s  ]+/g, ' ').trim();

function setup() {
  const L = circuitLib();
  layout(writesOf(BOARD));
  const program = circuitProgram(BOARD, INTERFACE);
  const ev = temp();
  putEvidence(ev, program.bytes);
  putEvidence(ev, Buffer.from(L.assets[L.ref.asset]!, 'base64'));
  return { L, program, ev };
}

describe(`${AC[14]} the residual current, read from the circuit`, () => {
  it(`${AC[14]} a bound value reading the RCD's residual shows 115 mA at 20 sampled steps of its fault`, () => {
    expect([SAMPLES.length, SAMPLES.at(-1)! < LEAKED.k + 52, Math.round(0.115 * 1000)], 'twenty steps of the fault, before the RCD opens; 0.115 A is 115 mA').toEqual([20, true, 115]);
    const { L, program, ev } = setup();
    const id = DOC(1);
    const doc = shownDoc({ id, program, ref: L.ref });
    const logicItem = obj(obj(doc['items'], 'items')[LOGIC], LOGIC);
    const p: JsonObject = { seed: 3604, items: { [LOGIC]: { kind: 'logic@1', params: logicItem['params']! } }, assets: { ...L.assets, [program.sha]: program.b64 } };
    const [play] = onHost([playbackCall(p, { ...BOARD, steps: SAMPLES.at(-1)! + 1 }, SAMPLES)]);
    const logic = played(play!, LOGIC);
    const lamp = index(BOARD.circuit, 'lamp');
    expect(SAMPLES.filter((k) => !(rel(nums(logic.get(k), 'residual')[RCD_AT]!, LEAKED.residual) <= 1e-9 && rel(nums(logic.get(k), 'i_rms')[lamp]!, LAMP.amps) <= 1e-9)), 'the circuit gives the RCD a residual of 0.115 A and the lamp 0.26087 A at each sampled step').toEqual([]);

    expect(SAMPLES.at(-1)!, 'inside the film').toBeLessThan(SPAN_STEPS);
    const replies = runShow(binOf(), scenario(ev, [id], [showCall(id, doc), ...SAMPLES.map((k) => ({ call: 'eval', doc: id, t: at(k), texts: true }))]), 'the residual\'s readout');
    presented(replies[0]!, 'the residual\'s readout');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the readout reads its number from the circuit: honest numbers raises nothing').toEqual([]);
    const shown = SAMPLES.map((k, j) => {
      const r = replies[1 + j]!;
      expect(r['outcome'], `the frame at step ${k} is evaluated: ${show(r)}`).toBe('evaluated');
      return { k, text: plain(str(obj(r['texts'], `texts at step ${k}`)[READOUT], `the readout's text at step ${k}`)) };
    });
    console.log(`${AC[14]} the readout at the sampled steps: ${shown.map((s) => `${s.k}: ${s.text}`).join(', ')}`);
    expect(shown.filter((s) => s.text !== '115 mA').map((s) => `step ${s.k}: "${s.text}"`), 'at each of the 20 sampled steps of the fault the readout shows 115 mA').toEqual([]);
  }, TIMEOUT);

  it(`${AC[14]} a planted label typed as "115 mA" fails honest numbers, naming the item`, () => {
    const { L, program, ev } = setup();
    const [real, typed] = [DOC(2), DOC(3)];
    const replies = runShow(binOf(), scenario(ev, [real, typed], [
      showCall(real, shownDoc({ id: real, program, ref: L.ref })),
      showCall(typed, shownDoc({ id: typed, program, ref: L.ref, typed: '115 mA' })),
    ]), 'the readout and its typed twin');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the document with its counter raises no number_unsourced').toEqual([]);
    const found = issuesOf(replies[1]!).filter((i) => i['code'] === 'number_unsourced');
    expect(found.some((i) => namesItem(i, READOUT)), `the typed "115 mA" fails honest numbers, naming ${READOUT}: ${show(issuesOf(replies[1]!) as never)}`).toBe(true);
  }, TIMEOUT);
});
