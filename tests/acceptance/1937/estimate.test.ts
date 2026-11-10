// #1937.ef5ff5e8: each candidate's predicted delta is within 25% of its measured delta on the reference Mac, else the
// reply marks it `estimate` and re-measures the chosen set before naming it as the fix.
//
// `budget_fix` on the over-class scene (README: Fixtures) on Metal under a reference Mac's environment, the stub meter
// reading the lights' shadows at 6, 2.5 and 2.5 ms while the stub's cost model predicts them at 6 (exact), 2 (fill-a:
// 20% off, within 25%) and 3.5 ms (fill-b: 40% off). Every candidate is marked `estimate` exactly when its prediction
// is more than 25% off its measured delta, so fill-b's shadows off is marked and fill-a's and the key's are not; the
// chosen set (the two fills' shadows off, which leave the subject alone) is measured again together, five runs at
// 9 ms and a delta of −5 ms, not the −5.5 ms its predictions sum to, and only then named the fix. Twin: with every
// prediction exact, no candidate is marked, so the mark follows the prediction's error and the check can fail.
// Wrong programs: the base (no `budget_fix`); a mark on every candidate, or on none; a fix named from its candidates'
// predictions summed, with no run of the set together.
import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_BAND, FILL_A, FILL_B, KEY, SCENE_MS, SHADOW_MS, budgetFixCall, fixOf, ms, none, payload, pct, requireMetal, run, runsAt, sameOps,
  shadowCandidate, shadowOff, stubMeter, useBuild, useOut, writeJson,
  type Fix,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1937.ef5ff5e8';
/** The stub cost model's predictions: fill-a's shadows 20% under their measured 2.5 ms, fill-b's 40% over. */
const OFF: Record<string, number> = { [FILL_A]: 2, [FILL_B]: 3.5 };

function fixFor(predicted: Record<string, number>): Fix {
  const dir = out();
  const [reply] = run(bin(), dir, [budgetFixCall(writeJson(dir, 'scene', payload()), stubMeter(predicted))]);
  const f = fixOf(reply!, 'budget_fix');
  for (const c of f.candidates) console.log(`${ID}: candidate ${c.knob} ${c.item}: predicted ${ms(c.predicted_ms)}, measured ${ms(c.measured_ms)}${c.estimate ? ' (estimate)' : ''}, subject share ${pct(c.share)}`);
  return f;
}

/** The criterion's check: failures as sentences. */
function estimateProblems(f: Fix, predicted: Record<string, number>): string[] {
  const problems: string[] = [];
  // Each candidate marked `estimate` exactly when its prediction is more than 25% off its measured delta.
  for (const [i, c] of f.candidates.entries()) {
    const off = Math.abs(c.predicted_ms - c.measured_ms);
    const want = off > ESTIMATE_BAND * Math.abs(c.measured_ms) + 1e-9;
    if (c.estimate !== want) {
      problems.push(`candidate ${i} (${c.knob} ${c.item}) is predicted at ${ms(c.predicted_ms)} and measured at ${ms(c.measured_ms)}, ${ms(off)} off, ${want ? 'more than' : 'within'} 25%, but is ${c.estimate ? '' : 'not '}marked estimate`);
    }
  }
  // The lights' shadows off: predicted by the stub's cost model, measured as the scene with each patch applied.
  for (const light of [KEY, FILL_A, FILL_B]) {
    const c = shadowCandidate(f, light);
    if (!c) { problems.push(`no candidate turns ${light}'s shadows off`); continue; }
    const measured = -SHADOW_MS[light]!;
    const guess = -(predicted[light] ?? SHADOW_MS[light]!);
    if (Math.abs(c.measured_ms - measured) > 0.01) problems.push(`${light}'s shadows off measures ${ms(c.measured_ms)} on the reference Mac, not ${ms(measured)}: not the scene measured with its patch applied`);
    if (Math.abs(c.predicted_ms - guess) > 0.01) problems.push(`${light}'s shadows off is predicted at ${ms(c.predicted_ms)}, not the cost model's ${ms(guess)}`);
  }
  // The chosen set: the two fills' shadows off, measured again together before it is named the fix.
  const together = SCENE_MS - SHADOW_MS[FILL_A]! - SHADOW_MS[FILL_B]!;
  const summed = -[FILL_A, FILL_B].reduce((s, l) => s + (predicted[l] ?? SHADOW_MS[l]!), 0);
  if (!f.chosen) return [...problems, 'no set is chosen'];
  const has = (light: string): boolean => f.chosen!.ops.some((op) => sameOps([op], [shadowOff(light)]));
  if (!has(FILL_A) || !has(FILL_B) || has(KEY)) problems.push(`the chosen set ${JSON.stringify(f.chosen.ops)} isn't the two fills' shadows off, which leave the subject alone`);
  problems.push(...runsAt(f.chosen.measured, together, 'the chosen set measured again together'));
  if (Math.abs(f.chosen.measured_ms - (together - SCENE_MS)) > 0.01) {
    problems.push(`the chosen set's measured delta is ${ms(f.chosen.measured_ms)}, not ${ms(together - SCENE_MS)} measured together (its candidates' predictions sum to ${ms(summed)})`);
  }
  if (f.chosen.measured.verdict !== 'PASS') problems.push(`the chosen set measured again together is ${f.chosen.measured.verdict}, not PASS`);
  if (!f.fix || !sameOps(f.fix, f.chosen.ops)) problems.push(`the chosen set, measured again together at ${ms(together)}, is not named the fix: ${JSON.stringify(f.fix)}`);
  return problems;
}

const marked = (f: Fix): string[] => f.candidates.filter((c) => c.estimate).map((c) => `${c.knob} ${c.item}`);

describe(`${ID} a prediction more than 25% off its measured delta is marked estimate, and the chosen set is measured again before it is the fix`, () => {
  it(`${ID} fill-b's shadows predicted at 3.5 ms and measured at 2.5 ms (40% off) are marked estimate, fill-a's (2 ms against 2.5, 20% off) and the key's (exact) are not; the chosen set is measured again together at 9 ms, not the 8.5 ms its predictions give, before it is named the fix`, () => {
    requireMetal();
    const f = fixFor(OFF);
    none(estimateProblems(f, OFF), 'the estimate marks and the chosen set');
    expect(marked(f), 'exactly fill-b\'s shadows off is marked estimate').toEqual([`shadow_off ${FILL_B}`]);
  }, 1_800_000);

  it(`${ID} twin: with every prediction exact, no candidate is marked estimate and the chosen set is still measured together`, () => {
    requireMetal();
    const f = fixFor({});
    none(estimateProblems(f, {}), 'the estimate marks and the chosen set, every prediction exact');
    expect(marked(f), 'no candidate is marked estimate').toEqual([]);
  }, 1_800_000);
});
