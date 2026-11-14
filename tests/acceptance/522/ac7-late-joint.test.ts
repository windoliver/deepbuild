// #522.5a2c866e: "Under the conformance kit's late-entry part (#138), a joint with `over_steps: 3` that crosses its
// threshold one step before the restored step breaks at the same step as the on-time run, with the same occurrences; a
// planted checkpoint that drops the joint's steps past `breaks_at` breaks it a step late and fails, naming the joint and
// the step"
//
// The kit is #138's `kit` call in `deep-show run`, its `late_entry` part over the physics module (README: deep-show, the
// physics module in the kit): each declared input entry of the module's fixture `parity/physics/late-joint.<profile>`
// arrives 1 to 8 steps late; the copy restores the nearest checkpoint at or before its step and steps forward. The
// "restored step" is the first step the rollback runs again (a case's `restored`). With `over_steps: 3`, a joint that
// crosses its threshold one step before it is past it on that step, the restored one and the next, so it breaks on the
// step after the restored one; a checkpoint that drops its count makes it count again from the restored step and break
// a step later. Each physics case reports each joint's break step in the on-time run and in the late one (`breaks`),
// and a physics `late_entry` failure whose first difference is in a joint names the joint (`joint`) and the step.
// `test-physics-checkpoint-drops-break-steps` is the planted module (README: deep-show).
import { describe, expect, it } from 'vitest';
import { failuresIn, kit, matching, moduleOf, partIn, ROLLBACK_WINDOW, type Case } from '../138/helpers.ts';
import { CRITERIA, TIMEOUT, arr, num, obj, prebuildShows, show, showWith, useTemp, type JsonObject } from './helpers.ts';

const FULL: string[] = [];
const DROPS = ['test-physics-checkpoint-drops-break-steps'];
prebuildShows([FULL, DROPS]);

const ID = CRITERIA[7];
const temp = useTemp();
const FIXTURE = 'parity/physics/late-joint.';

interface Joint { joint: string; overSteps: number; onTime: number | null; late: number | null }
interface LateCase { name: string; verdict: string; step: number; arrived: number; restored: number; joints: Joint[] }
const stepOrNull = (v: JsonObject[keyof JsonObject] | undefined, what: string): number | null => (v === null || v === undefined ? null : num(v, what));
function lateCase(c: Case): LateCase {
  const e = obj(c.raw['entry'], `${c.case}.entry`);
  return {
    name: c.case, verdict: c.verdict, step: num(e['step'], `${c.case}.entry.step`), arrived: num(e['arrived'], `${c.case}.entry.arrived`),
    restored: num(c.raw['restored'], `${c.case}.restored (the first step the rollback runs again)`),
    joints: arr(c.raw['breaks'], `${c.case}.breaks (each joint's break step on time and late)`).map((b, i) => {
      const o = obj(b, `${c.case}.breaks[${i}]`);
      return { joint: String(o['joint']), overSteps: num(o['over_steps'], `${c.case}.breaks[${i}].over_steps`), onTime: stepOrNull(o['on_time'], `${c.case}.breaks[${i}].on_time`), late: stepOrNull(o['late'], `${c.case}.breaks[${i}].late`) };
    }),
  };
}
/** The physics module's late_entry part over its late-joint fixture, on `features`' build. */
function lateJoint(features: string[], what: string): { verdict: string; cases: LateCase[]; failures: JsonObject[] } {
  const r = kit(showWith(features), temp(), { modules: ['physics'], parts: ['late_entry'] });
  const m = moduleOf(r, 'physics');
  const p = partIn(m, 'late_entry');
  const cases = p.cases.filter((c) => c.fixture?.startsWith(FIXTURE)).map(lateCase);
  expect(cases.length, `${what}: the late-entry part runs the physics module's fixture ${FIXTURE}*; its cases: ${show(p.cases.map((c) => c.fixture ?? c.case))}`).toBeGreaterThan(0);
  return { verdict: p.verdict, cases, failures: matching(failuresIn(m, 'late_entry'), 'late_entry', { module: 'physics' }) as unknown as JsonObject[] };
}
/** The joint with over_steps 3 that crosses its threshold one step before the restored step: it breaks on time on the step after it. */
const crossing = (c: LateCase): Joint | undefined => c.joints.find((j) => j.overSteps === 3 && j.onTime === c.restored + 1);

describe(`${ID} under the kit's late-entry part a joint that crosses its threshold one step before the restored step breaks on time; a checkpoint without its steps past breaks_at breaks it late`, () => {
  it(`${ID} a joint with over_steps: 3 crossing its threshold one step before the restored step breaks at the same step as the on-time run, with the same occurrences`, () => {
    const run = lateJoint(FULL, 'the full set');
    const named = run.cases.filter((c) => crossing(c) !== undefined);
    expect(named.length, `a case's joint with over_steps 3 breaks on time on the step after the restored step: ${JSON.stringify(run.cases).slice(0, 1500)}`).toBeGreaterThan(0);
    const fails = named.flatMap((c) => {
      const j = crossing(c)!;
      return [
        ...(j.late === j.onTime ? [] : [`${c.name}: ${j.joint} breaks at step ${j.late} late and at step ${j.onTime} on time`]),
        ...(c.verdict === 'PASS' ? [] : [`${c.name}: ${c.verdict}`]),
      ];
    });
    expect(fails, 'it breaks at the same step, with the same step hashes, checkpoints and occurrences as the on-time run').toEqual([]);
    const lags = [...new Set(named.map((c) => c.arrived - c.step))].sort((x, y) => x - y);
    expect(lags, `its entry arrives 1 to ${ROLLBACK_WINDOW} steps late`).toEqual(Array.from({ length: ROLLBACK_WINDOW }, (_, i) => i + 1));
    expect(run.verdict, `the late-entry part passes: ${show(run.failures)}`).toBe('PASS');
  }, TIMEOUT);

  it(`${ID} a planted checkpoint that drops the joint's steps past breaks_at (test-physics-checkpoint-drops-break-steps) breaks it a step late and fails, naming the joint and the step`, () => {
    const run = lateJoint(DROPS, 'the planted checkpoint');
    const named = run.cases.filter((c) => crossing(c) !== undefined);
    expect(named.length, `the fixture's joint still breaks on time on the step after the restored step: ${JSON.stringify(run.cases).slice(0, 1500)}`).toBeGreaterThan(0);
    const c = named[0]!;
    const j = crossing(c)!;
    expect(j.late, `${c.name}: it breaks a step late`).toBe(j.onTime! + 1);
    expect(run.verdict, 'the late-entry part fails').toBe('FAIL');
    // The first step that differs: the restored one when the step hash holds the joint's count (Joint `joint@1`: the
    // steps past breaks_at are in the state hash), at the latest the late break.
    const naming = run.failures.filter((f) => f['joint'] === j.joint && typeof f['step'] === 'number' && f['step'] >= c.restored && f['step'] <= j.late!);
    expect(naming.length, `a late_entry failure names the joint ${j.joint} and a step from ${c.restored} to ${j.late}: ${show(run.failures)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
