// Each asks criterion's scenario, shared by the criterion tests and plants.test.ts: on the fixed program it
// passes; on a wrong program it fails at the assertion naming what the criterion says. The buying scenarios
// (criteria 4 and 5) are in buying-scenarios.ts, so these load without the buying module.

import { expect } from 'vitest';
import type { PlanStep } from '../../../packages/asks/src/index.ts';
import {
  agent, approve, authoritySources, card, BATCH_1, BATCH_2, batchOf, CANT_UNDO, core, DAY, deleteBranch, dropTable, emptyBucket,
  fixtureAsk, isObj, MINUTE, plan, postNotes, raiseWithPlan, refused, run, sha256, step, T0, target, type World,
} from './helpers.ts';
import { AskRefused } from '../../../packages/asks/src/index.ts';

/** #69.9eb13dee: every place that raises authority asks, the core's and an agent's, without a plan or with an empty one. */
export async function noPlanNoAsk(w: World): Promise<void> {
  const now = w.clock.now();
  const created = async () => (await w.events('ask.created')).length;
  for (const source of authoritySources()) {
    const before = await created();
    await refused(w.asks.raise(core('S1'), source, fixtureAsk(source, now, { question: `${source}: go ahead?` })), 'plan', `an authority ask from ${source} without a plan`);
    expect(await created(), `an authority ask from ${source} without a plan was created`).toBe(before);
  }
  // An agent's own authority ask, whose options say no or nothing (only DeepBuild writes an allow).
  const theirs = fixtureAsk('effect.send', now, {
    question: 'Email the beta list about the outage?',
    options: [{ id: 'send', label: 'Send it', decision: 'none' }, { id: 'hold', label: "Don't send", decision: 'deny' }], default: 'hold',
  });
  let before = await created();
  await refused(w.asks.raise(agent('S1'), 'effect.send', theirs), 'plan', "an agent's authority ask without a plan");
  expect(await created(), "an agent's authority ask without a plan was created").toBe(before);
  // A plan with no steps shows nothing that will happen.
  before = await created();
  await refused(w.asks.raise(core('S1'), 'effect.send', fixtureAsk('effect.send', now, { question: 'Send it, plan empty?' }), plan([], 'empty')), 'plan', 'an authority ask whose plan has no steps');
  expect(await created(), 'an authority ask whose plan has no steps was created').toBe(before);
  // With its plan, the same ask is created and shows it.
  const steps = [postNotes('#releases')];
  const a = await raiseWithPlan(w, 'effect.send', fixtureAsk('effect.send', now, { question: 'Post the release notes?' }), plan(steps, 'notes'));
  expect((await w.asks.card(a)).plan?.steps, `${a}, raised with its plan, shows the plan's steps`).toEqual(steps);
}

/** #69.f54debdc: a deletion of two branches, approved; the run then tries a third. */
export async function addedStepStops(w: World): Promise<void> {
  const steps = [deleteBranch('old-ui'), deleteBranch('old-api')];
  const added = deleteBranch('release-1.3');
  const a = await raiseWithPlan(w, 'effect.delete', fixtureAsk('effect.delete', w.clock.now(), { question: 'Delete the branches old-ui and old-api on origin?' }), plan(steps, 'branches'));
  await w.at(BATCH_1);
  expect((await w.asks.beforeStep(a, steps[0]!)).run, `before your yes, "${steps[0]!.does}" runs`).toBe(false);
  const shown = await approve(w, a, 'click-1');
  const on = target();
  const stop = await run(w, a, [...steps, added], on);
  expect(stop?.stopped, `a run that adds a step after your yes stops before "${added.does}"`).toEqual(added);
  expect(on.taken, 'the run takes the steps you approved, and only those').toEqual(steps);
  // It asks again: a new authority ask whose plan shows the added step.
  const again = stop!.ask;
  expect(again, 'the run asks again with a new ask, not the one you approved').not.toBe(a);
  const row = await w.row(again);
  expect(row?.kind, `${again}, asking again, is an authority ask`).toBe('authority');
  expect(row?.outcome, `${again}, asking again, waits for you`).toBe('unanswered');
  const asked = await w.asks.card(again);
  expect(asked.plan?.steps, `${again}'s plan shows the added step`).toContainEqual(added);
  expect(asked.plan?.hash, `${again}'s plan is not the one your yes approved`).not.toBe(shown.plan!.hash);
  // Asked once: the same step tried again names the same open ask.
  expect(await w.asks.beforeStep(a, added), 'the same added step tried again').toEqual({ run: false, ask: again });
  const open = (await w.asks.inbox()).filter((r) => r.outcome === 'unanswered' && r.kind === 'authority');
  expect(open.map((r) => r.ask), 'one ask, asked once, for the added step').toEqual([again]);
  // Your yes to the new plan runs the step.
  await w.at(BATCH_2);
  await approve(w, again, 'click-2');
  expect(await run(w, again, [added], on), `after your yes to ${again}, "${added.does}" runs`).toBeNull();
  expect(on.taken).toEqual([...steps, added]);
}

/** #69.3f9c3f3d, first half: a step given with no undo is marked "can't undo" in its plan, on the card and in the record. */
export async function markedCantUndo(w: World): Promise<string> {
  const steps = [deleteBranch('old-ui'), emptyBucket('logs-2025')];
  const a = await raiseWithPlan(w, 'effect.delete', fixtureAsk('effect.delete', w.clock.now(), { question: 'Delete branch old-ui and the bucket logs-2025?' }), plan(steps, 'bucket'));
  const shown = (await w.asks.card(a)).plan?.steps;
  expect(shown?.[1]?.undo, `"${steps[1]!.does}", given with no undo, is marked can't undo in its plan`).toBe(CANT_UNDO);
  expect(shown?.[0]?.undo, `"${steps[0]!.does}" keeps its undo`).toBe(steps[0]!.undo);
  const proposed = (await w.events('plan.proposed')).find((e) => isObj(e.data) && e.data.ask === a);
  const recorded = isObj(proposed?.data) && Array.isArray(proposed.data.steps) ? (proposed.data.steps as unknown as PlanStep[]) : [];
  expect(recorded[1]?.undo, `the plan recorded for ${a} marks "${steps[1]!.does}" can't undo`).toBe(CANT_UNDO);
  return a;
}

/**
 * #69.3f9c3f3d, second half: anything irreversible still defaults to no. One ask names its no as its default; the
 * other's raiser names the option that approves. A core may refuse the second at raise, naming its default: then it
 * is raised with its no, and both must take no at their deadline.
 */
export async function irreversibleDefaultsNo(w: World): Promise<void> {
  const first = await markedCantUndo(w);
  const bucket = emptyBucket('logs-2026');
  const ask = fixtureAsk('effect.delete', w.clock.now(), { question: 'Delete the bucket logs-2026?', default: 'approve' });
  let second: string;
  try {
    second = await raiseWithPlan(w, 'effect.delete', ask, plan([bucket], 'bucket 2026'));
  } catch (error) {
    expect(error, 'an ask whose default approves an irreversible step is refused, or takes no').toBeInstanceOf(AskRefused);
    expect((error as AskRefused).field, 'the refusal names the default').toBe('default');
    second = await raiseWithPlan(w, 'effect.delete', { ...ask, default: 'decline' }, plan([bucket], 'bucket 2026'));
  }
  await w.at(BATCH_1);
  await w.at(T0 + DAY);
  for (const [a, irreversible] of [[first, emptyBucket('logs-2025')], [second, bucket]] as const) {
    const closed = (await w.events()).filter((e) => e.subject === a && /^ask\.(answered|defaulted|cancelled|escalated)$/.test(e.kind));
    expect(closed.map((e) => e.kind), `${a}, unanswered past its deadline, takes its default`).toEqual(['ask.defaulted']);
    expect(isObj(closed[0]!.data) && closed[0]!.data.decision, `anything irreversible still defaults to no: ${a}`).toBe('deny');
    expect((await w.asks.beforeStep(a, irreversible)).run, `after ${a}'s default, "${irreversible.does}" runs`).toBe(false);
  }
}

/**
 * #69.275c8f18: a batch of two asks, one with a step that can't be undone, approved with no switch turned; then a
 * batch whose ask has two such steps, approved with one switch on.
 */
export async function batchSwitchedOff(w: World): Promise<void> {
  const [a0, a1, b0] = [deleteBranch('old-ui'), emptyBucket('logs-2025'), postNotes('#releases')];
  const A = await raiseWithPlan(w, 'effect.delete', fixtureAsk('effect.delete', w.clock.now(), { question: 'Delete branch old-ui and the bucket logs-2025?' }), plan([a0, a1], 'A'));
  const B = await raiseWithPlan(w, 'effect.send', fixtureAsk('effect.send', w.clock.now(), { question: 'Post the v1.4.0 release notes?' }), plan([b0], 'B'));
  await w.at(BATCH_1);
  const batch = await batchOf(w, A);
  expect(await batchOf(w, B), `${A} and ${B} show in one batch`).toBe(batch);
  const shown = await w.asks.batch(batch);
  const at = (ask: string, i: number) => shown.steps.find((s) => s.ask === ask && s.step === i);
  expect(at(A, 1)?.undo, `in batch ${batch}, "${a1.does}" is marked can't undo`).toBe(CANT_UNDO);
  expect(at(A, 1)?.on, `in batch ${batch}, "${a1.does}", marked can't undo, starts switched off`).toBe(false);
  expect([at(A, 0)?.on, at(B, 0)?.on], `in batch ${batch}, the steps that can be undone start switched on`).toEqual([true, true]);
  await w.asks.approveBatch(card, batch, { token: 'click-1', switches: [] });
  const on = target();
  expect(await run(w, A, [a0], on), `approving batch ${batch} runs "${a0.does}"`).toBeNull();
  expect(await run(w, B, [b0], on), `approving batch ${batch} runs "${b0.does}"`).toBeNull();
  expect((await run(w, A, [a1], on))?.stopped, `approving batch ${batch} with its switch off runs "${a1.does}"`).toEqual(a1);
  expect(on.taken).toEqual([a0, b0]);

  // The next batch: two steps that can't be undone, and only the first one's switch turned on.
  w.clock.set(BATCH_1 + 5 * MINUTE);
  const [c0, c1] = [dropTable('sessions_2024'), dropTable('sessions_2023')];
  const C = await raiseWithPlan(w, 'effect.delete', fixtureAsk('effect.delete', w.clock.now(), { question: 'Drop the 2024 and 2023 session tables?' }), plan([c0, c1], 'C'));
  await w.at(BATCH_2);
  const batch2 = await batchOf(w, C);
  const shown2 = await w.asks.batch(batch2);
  expect(shown2.steps.filter((s) => s.ask === C).map((s) => s.on), `in batch ${batch2}, both steps that can't be undone start switched off`).toEqual([false, false]);
  await w.asks.approveBatch(card, batch2, { token: 'click-2', switches: [{ ask: C, step: 0, on: true }] });
  expect(await run(w, C, [c0], on), `"${c0.does}" runs once its own switch is on`).toBeNull();
  expect((await run(w, C, [c1], on))?.stopped, `"${c1.does}" runs though only another step's switch was turned on`).toEqual(c1);
  expect(on.taken).toEqual([a0, b0, c0]);
}

/** #69.eb8b7be8: one plan's preview, drafted: a deletion of 500 cached files, the last step one that can't be undone. */
export const PREVIEW_STEPS = 500;
export async function draftPreview(w: World, n: number): Promise<number> {
  const steps = [
    ...Array.from({ length: PREVIEW_STEPS - 1 }, (_, i) => step(`Delete build/cache/part-${n}-${i}.bin`, [`build/cache/part-${n}-${i}.bin`], `Restore build/cache/part-${n}-${i}.bin from the staged copy`)),
    step('Empty the staged copies of build/cache', ['the staged copies'], null),
  ];
  const ask = fixtureAsk('effect.delete', w.clock.now(), { question: `Delete the build cache, round ${n}?`, key: sha256(`preview ${n}`) });
  const t = performance.now();
  const a = await w.asks.raise(core('S1'), 'effect.delete', ask, plan(steps, `preview ${n}`));
  const shown = await w.asks.card(a);
  const ms = performance.now() - t;
  expect(shown.plan?.steps.length, `${a}'s preview shows every step`).toBe(PREVIEW_STEPS);
  expect(shown.plan?.steps.at(-1)?.undo, `${a}'s preview marks its last step can't undo`).toBe(CANT_UNDO);
  return ms;
}
/** One warm-up, then five drafted previews; their times in ms. */
export async function previewRuns(w: World): Promise<number[]> {
  console.log(`warm-up: ${(await draftPreview(w, 0)).toFixed(1)} ms (discarded)`);
  const runs: number[] = [];
  for (let r = 1; r <= 5; r++) runs.push(await draftPreview(w, r));
  return runs;
}
