// Criterion 3 (no upstream test): "Declaring a write to a status binding's paint, another canvas module's array, a
// check's expectation or a path under the record is refused at check, naming it"
//
// Through `deep-logic check` (README: deep-logic). A logic item's writes are its own arrays, read as
// `<logic ID>.<name>` (Logic `logic@1`: writes); each piece below declares one write that names something else
// instead: a status binding's paint (`items/badge/params/paint`), a physics world's array (`world.positions`), a
// check's expectation (`checks/score_check/expect`) and a path under the record (`record/verdicts/score`). Each is
// refused, the refusal naming the item and the declared write; the same item writing its own `score` is admitted.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, checkCall, logicBin, none, onMac, piece, prebuild, refusedOf, show } from './helpers.ts';
import { tally } from './programs.ts';

prebuild(() => { logicBin(); });

const FORBIDDEN = {
  'a status binding\'s paint': 'items/badge/params/paint',
  'another canvas module\'s array': 'world.positions',
  'a check\'s expectation': 'checks/score_check/expect',
  'a path under the record': 'record/verdicts/score',
} as const;
const scorer = (write: string): ReturnType<typeof piece> => piece({ seed: 531_03, items: { scorer: { program: tally(), writes: { [write]: { type: 'i32' } } } } });

describe(`${AC[3]} a logic item writes only its own arrays`, () => {
  it(`${AC[3]} a write declared to a status binding's paint, another module's array, a check's expectation or a path under the record is refused at check, naming it; the item's own score is admitted`, () => {
    const names = Object.values(FORBIDDEN);
    const out = onMac([...names.map((n) => checkCall(scorer(n))), checkCall(scorer('score'))]);
    const failures: string[] = [];
    Object.entries(FORBIDDEN).forEach(([what, name], i) => {
      const reply = out[i]!;
      if (reply['ok'] !== false) { failures.push(`${what} (${name}) was admitted: ${show(reply)}`); return; }
      const r = refusedOf(reply, `${what} (${name})`);
      if (r.code !== 'logic_refused') failures.push(`${what} (${name}): refused as ${r.code}, not by the logic module's check (logic_refused)`);
      if (r.item !== 'scorer') failures.push(`${what} (${name}): the refusal names item ${r.item}, not scorer`);
      if (!r.refusals.some((x) => x['write'] === name)) failures.push(`${what} (${name}): no refusal names the write: ${show(r.refusals)}`);
    });
    none(failures, 'each declared write to something not the item\'s own is refused at check, naming it');
    expect(Object.keys(admitted(out[names.length]!, 'the item writing its own score')), 'the item writing its own array is admitted').toEqual(['scorer']);
  }, TIMEOUT);
});
