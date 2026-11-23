// Criterion 8: "A bound value reading the load's current shows 0.02 A at 20 sampled steps. A planted label typed as
// "0.02 A" fails honest numbers (#406), naming the item."
//
// Through `deep-show run` (#393's scenario; ../535/helpers.ts, imported unchanged) and `deep-logic first_party` and
// `playback` (README: The surface), as #980's suite reads its throughput. The document (show.ts) runs a lamp (4.6 W)
// and a heater (2,300 W) straight on the mains in its logic item `mains`, and shows the readout `current`: a text
// counter whose source is a driver reading `mains.i_rms[1]`, the lamp's rms current, with the unit A to two places
// (README: Readings: "a bound value"). At 20 sampled steps, 30 to 600 (0.5 s to 10 s), `eval` gives the text the
// frame draws: "0.02 A" at each; `playback` of the same logic item in deep-logic gives the lamp's 0.02 A there, while
// the source carries 10.02 A, so a readout of another part shows another number. The planted label: the same document
// with the readout's text typed as "0.02 A" is refused by honest numbers, `number_unsourced` naming `current`, while
// the counter's document raises no such issue. deep-show is built inside the first test, after circuit@1 is found
// (README: Run them). The wrong programs: a readout of another part or array, a value without its unit or at
// another precision, and a check blind to a typed number.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, obj, onHost, prebuild, show, str, type JsonObject } from '../190/helpers.ts';
import { binOf, issuesOf, namesItem, presented, putEvidence, runShow, scenario, showCall, useTemp } from '../535/helpers.ts';
import { SHOWN_CIRCUIT, index, type Fixture } from './circuits.ts';
import { AC, INTERFACE, circuitLib, layout, nums, playbackCall, played } from './helpers.ts';
import { circuitProgram, writesOf } from './programs.ts';
import { DOC, LAMP_AT, LOGIC, RATE, READOUT, SPAN_STEPS, shownDoc } from './show.ts';

prebuild(() => { logicBin(); });
const temp = useTemp();

/** The 20 sampled steps: 30, 60 … 600. */
const SAMPLES = Array.from({ length: 20 }, (_, j) => 30 * (j + 1));
const FLICKS = 705_600_000;
const at = (k: number): number => (k * FLICKS) / RATE;
const plain = (t: string): string => t.replace(/[\s  ]+/g, ' ').trim();

function setup() {
  const L = circuitLib();
  layout(writesOf(SHOWN_CIRCUIT));
  const program = circuitProgram({ name: 'shown', circuit: SHOWN_CIRCUIT, per: RATE }, INTERFACE);
  const ev = temp();
  putEvidence(ev, program.bytes);
  putEvidence(ev, Buffer.from(L.assets[L.ref.asset]!, 'base64'));
  return { L, program, ev };
}

describe(`${AC[8]} the lamp's current, read from the circuit`, () => {
  it(`${AC[8]} a bound value reading the load's current shows 0.02 A at 20 sampled steps`, () => {
    expect([SAMPLES.length, SAMPLES.at(-1)! < SPAN_STEPS], 'twenty steps inside the span').toEqual([20, true]);
    const { L, program, ev } = setup();
    const id = DOC(1);
    const doc = shownDoc({ id, program, ref: L.ref });
    // The same logic item in deep-logic: the lamp's and the source's currents at each sampled step.
    const logicItem = obj(obj(doc['items'], 'items')[LOGIC], LOGIC);
    const p: JsonObject = { seed: 1181, items: { [LOGIC]: { kind: 'logic@1', params: logicItem['params']! } }, assets: { ...L.assets, [program.sha]: program.b64 } };
    const f: Fixture = { item: LOGIC, circuit: SHOWN_CIRCUIT, rate: RATE, inputs: [], track: [], steps: SAMPLES.at(-1)! + 1 };
    const [play] = onHost([playbackCall(p, f, SAMPLES)]);
    const logic = played(play!, LOGIC);
    const source = index(SHOWN_CIRCUIT, 'mains');
    expect(SAMPLES.filter((k) => !(Math.abs(nums(logic.get(k), 'i_rms')[LAMP_AT]! - 0.02) <= 1e-12 && Math.abs(nums(logic.get(k), 'i_rms')[source]! - 10.02) <= 1e-9)), 'the circuit gives the lamp 0.02 A and the source 10.02 A at each sampled step').toEqual([]);

    const replies = runShow(binOf(), scenario(ev, [id], [showCall(id, doc), ...SAMPLES.map((k) => ({ call: 'eval', doc: id, t: at(k), texts: true }))]), 'the lamp\'s readout');
    presented(replies[0]!, 'the lamp\'s readout');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the readout reads its number from the circuit: honest numbers raises nothing').toEqual([]);
    const shown = SAMPLES.map((k, j) => {
      const r = replies[1 + j]!;
      expect(r['outcome'], `the frame at step ${k} is evaluated: ${show(r)}`).toBe('evaluated');
      return { k, text: plain(str(obj(r['texts'], `texts at step ${k}`)[READOUT], `the readout's text at step ${k}`)) };
    });
    console.log(`${AC[8]} the readout at the sampled steps: ${shown.map((s) => `${s.k}: ${s.text}`).join(', ')}`);
    expect(shown.filter((s) => s.text !== '0.02 A').map((s) => `step ${s.k}: "${s.text}"`), 'at each of the 20 sampled steps the readout shows 0.02 A').toEqual([]);
  }, TIMEOUT);

  it(`${AC[8]} a planted label typed as "0.02 A" fails honest numbers, naming the item`, () => {
    const { L, program, ev } = setup();
    const [real, typed] = [DOC(2), DOC(3)];
    const replies = runShow(binOf(), scenario(ev, [real, typed], [
      showCall(real, shownDoc({ id: real, program, ref: L.ref })),
      showCall(typed, shownDoc({ id: typed, program, ref: L.ref, typed: '0.02 A' })),
    ]), 'the readout and its typed twin');
    expect(issuesOf(replies[0]!).filter((i) => i['code'] === 'number_unsourced'), 'the document with its counter raises no number_unsourced').toEqual([]);
    const found = issuesOf(replies[1]!).filter((i) => i['code'] === 'number_unsourced');
    expect(found.some((i) => namesItem(i, READOUT)), `the typed "0.02 A" fails honest numbers, naming ${READOUT}: ${show(issuesOf(replies[1]!) as never)}`).toBe(true);
  }, TIMEOUT);
});
