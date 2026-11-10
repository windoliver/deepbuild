// #1937.078417c3: the over-class fixture (a showpiece scene at 14 ms against a 10 ms class) gets a fix whose patch,
// applied, measures under 10 ms, and whose subject share changes by under 2%; a planted chooser that picks the single
// largest gain, which turns off the key light's shadows and changes the subject by 30%, fails, naming the subject share.
//
// `budget_fix` on the scene (README: Fixtures) on Metal, the stub meter reading each frame 3 ms plus 6 ms while the
// key light shadows and 2.5 ms while each fill does, under a reference Mac's environment. The check: the scene is
// caught over its class (FAIL, five runs at 14 ms); every candidate is listed with its delta and share, the three
// lights' shadows-off among them, each measured as applied (−6, −2.5, −2.5 ms) and the key's share the one drawn here;
// and the fix, applied here to the payload and measured by #1899's `frame_budget` with the same stub, PASSes with
// every run under 10 ms, while #378's `view3d` draws the scene with and without it and fewer than 2% of the subject's
// pixels move more than 0.02 in OKLab. The scene is first shown to be the criterion's: turning the key light's shadows
// off changes 20–40% of the subject here.
// `--planted picks_largest_gain` picks the key light's shadows (6 ms, the single largest gain): its set changes about
// 30% of the subject, so it is no fix (over 5% it is offered as a choice ask) and the check fails naming the subject
// share. Wrong programs: the base (no `budget_fix`); a chooser by gain alone; a share read from anything but the
// subject's pixels; a fix reported but not applied (the scene measured again still reads 14 ms).
import { describe, expect, it } from 'vitest';
import {
  CHOICE_SHARE, FILL_A, FILL_B, FIX_SHARE, KEY, LIMIT_MS, SCENE_MS, SHADOW_MS, answered, applyOps, budgetFixCall, failsNaming, fixOf, frameBudgetCall,
  frameOf, ms, none, payload, pct, requireMetal, resultOf, run, runsAt, sameOps, sessionDoc, shadowCandidate, shadowOff, stubMeter, subjectShare,
  useBuild, useOut, view3dCall, writeJson,
  type Fix, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1937.078417c3';

/** The criterion's check on one budget_fix reply: failures as sentences, and the reply. */
function fixProblems(planted?: Planted): { problems: string[]; f: Fix } {
  const dir = out();
  const [reply] = run(bin(), dir, [budgetFixCall(writeJson(dir, 'scene', payload()), stubMeter())], planted);
  const f = fixOf(reply!, `budget_fix${planted ? ` --planted ${planted}` : ''}`);
  const problems: string[] = [];

  // The over-class scene caught: measured as it is, 14 ms in each of five runs against the showpiece's 10 ms.
  if (f.limit_ms !== LIMIT_MS) problems.push(`the class's GPU limit is ${ms(f.limit_ms)}, not the showpiece's ${ms(LIMIT_MS)}`);
  if (f.document.gpuVerdict !== 'FAIL') problems.push(`the scene measured as it is is ${f.document.gpuVerdict} on its GPU limit, not FAIL: it isn't caught over its class`);
  problems.push(...runsAt(f.document, SCENE_MS, 'the scene measured as it is'));

  // Drawn here (#378's view3d): the scene, the scene without its key light's shadows, and the scene with the fix;
  // and the fix applied to the payload and measured again (#1899's frame_budget, the same stub).
  const session = writeJson(dir, 'session', sessionDoc());
  const calls: JsonObject[] = [view3dCall(session), view3dCall(session, [shadowOff(KEY)])];
  if (f.fix) calls.push(view3dCall(session, f.fix), frameBudgetCall(writeJson(dir, 'fixed', applyOps(payload(), f.fix, 'the fix')), stubMeter()));
  const here = run(bin(), dir, calls);
  const scene = frameOf(here[0]!, 'the scene drawn here');
  const keyOff = subjectShare(dir, scene, frameOf(here[1]!, 'the scene without its key light\'s shadows'), 'the key light\'s shadows off');
  console.log(`${ID}: here, the key light's shadows off change ${pct(keyOff.share)} of the subject's ${keyOff.pixels} pixels`);
  expect(keyOff.share > 0.2 && keyOff.share < 0.4, `the fixture: turning the key light's shadows off changes about 30% of the subject (20–40%), got ${pct(keyOff.share)}`).toBe(true);

  // Every candidate tried, with its delta and its share: the three lights' shadows off among them, each measured as applied.
  for (const c of f.candidates) console.log(`${ID}: candidate ${c.knob} ${c.item}: predicted ${ms(c.predicted_ms)}, measured ${ms(c.measured_ms)}${c.estimate ? ' (estimate)' : ''}, subject share ${pct(c.share)}`);
  for (const light of [KEY, FILL_A, FILL_B]) {
    const c = shadowCandidate(f, light);
    if (!c) { problems.push(`no candidate turns ${light}'s shadows off`); continue; }
    if (!sameOps(c.ops, [shadowOff(light)])) problems.push(`${light}'s shadow_off candidate's ops are ${JSON.stringify(c.ops)}, not ${JSON.stringify([shadowOff(light)])}`);
    if (Math.abs(c.measured_ms + SHADOW_MS[light]!) > 0.01) problems.push(`${light}'s shadow_off measures ${ms(c.measured_ms)}, not −${ms(SHADOW_MS[light]!)}: not the scene measured with its patch applied`);
  }
  const key = shadowCandidate(f, KEY);
  if (key && Math.abs(key.share - keyOff.share) > 0.05) problems.push(`the key light's shadow_off candidate's subject share is ${pct(key.share)}, but its patch drawn here changes ${pct(keyOff.share)} of the subject`);

  // The fix: the chosen set's ops, its subject share under 2%, and, applied here, under 10 ms.
  if (!f.chosen) problems.push('no set is chosen, so no fix with a subject share under 2%');
  else if (f.chosen.share >= FIX_SHARE) problems.push(`the chosen set's subject share is ${pct(f.chosen.share)}, not under 2%`);
  if (!f.fix) {
    problems.push(`no fix: ${f.chosen ? `the chosen set's subject share is ${pct(f.chosen.share)}${f.ask ? `, offered as a ${f.ask.kind} ask` : ''}` : 'no set chosen, so no subject share under 2%'}`);
  } else {
    if (f.chosen && !sameOps(f.fix, f.chosen.ops)) problems.push(`the fix ${JSON.stringify(f.fix)} is not the chosen set's ops ${JSON.stringify(f.chosen.ops)}`);
    const drawn = subjectShare(dir, scene, frameOf(here[2]!, 'the scene with the fix'), 'the fix');
    console.log(`${ID}: here, the fix changes ${pct(drawn.share)} of the subject`);
    if (drawn.share >= FIX_SHARE) problems.push(`the fix's subject share, drawn here, is ${pct(drawn.share)}, not under 2%`);
    const measured = resultOf(answered(here[3]!, 'the fixed scene measured here'), 'the fixed scene measured here');
    console.log(`${ID}: here, the fixed scene measures ${measured.verdict}, p95s ${measured.p95s.join(', ')} ms`);
    if (measured.verdict !== 'PASS') problems.push(`the fix, applied, is ${measured.verdict} against ${ms(LIMIT_MS)}, not PASS`);
    for (const [i, p] of measured.p95s.entries()) if (p === null || p >= LIMIT_MS) problems.push(`the fix, applied, measures run ${i + 1}'s GPU p95 at ${p === null ? 'null' : ms(p)}, not under ${ms(LIMIT_MS)}`);
  }

  // A set over 5% of the subject is offered as a choice ask, never applied as the fix.
  if (f.chosen && f.chosen.share > CHOICE_SHARE) {
    if (f.fix) problems.push(`a set whose subject share is ${pct(f.chosen.share)}, over 5%, is applied as the fix`);
    if (!f.ask || f.ask.kind !== 'choice' || !f.ask.options.some((o) => sameOps(o.ops, f.chosen!.ops))) {
      problems.push(`a set whose subject share is ${pct(f.chosen.share)}, over 5%, isn't offered as a choice ask: ${JSON.stringify(f.ask)}`);
    }
  }
  return { problems, f };
}

describe(`${ID} the over-class scene gets the fix that changes the subject least, measured under its class`, () => {
  it(`${ID} a showpiece at 14 ms against its 10 ms class gets a fix whose patch, applied, measures under 10 ms and changes under 2% of the subject's pixels, every candidate listed with its delta and share`, () => {
    requireMetal();
    none(fixProblems().problems, 'the over-class fix');
  }, 1_800_000);

  it(`${ID} the planted picks_largest_gain chooser turns off the key light's shadows, changing about 30% of the subject, and fails, naming the subject share`, () => {
    requireMetal();
    const { problems, f } = fixProblems('picks_largest_gain');
    failsNaming(problems, ['subject share'], 'the planted picks_largest_gain');
    expect(f.chosen && sameOps(f.chosen.ops, [shadowOff(KEY)]), `the planted chooser picks the single largest gain, the key light's shadows off: ${JSON.stringify(f.chosen?.ops)}`).toBe(true);
    expect(f.fix, 'its set, over 5% of the subject, is not applied as the fix').toBeNull();
    expect(f.ask?.kind, 'it is offered as a choice ask').toBe('choice');
  }, 1_800_000);
});
