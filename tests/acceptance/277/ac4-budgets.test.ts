// AC4 #277.2c9337c4: Budgets, on the reference Mac in the local preflight, compared with the merge base: catch-up of
// the eight-seat piece is recorded as a reading in steps a second, and a match whose seats never change does the same
// work per step as before
//
// Split as #172's and #1017's budgets are: the merge-base comparison in time is the budget window's (a task of
// benchmarks/budgets.json naming this criterion, valid against the merge base's budgets; the window measures each
// merged commit against its merge base), and this test holds what a run here can: the eight-seat piece played by its
// four copies with seats that never change does the same work per step as at the merge base, by counts no load can
// move (the frames the test relay carried, their bytes and messages, the rollbacks and the steps they ran again, the
// steps run, under one seeded schedule that holds frames back up to the window), equal to the counts the merge base
// gave for the same match (`BASE_WORK`, read at e575a47af from the same piece without its `net.seats` read, which the
// merge base doesn't know); and the hidden copy of criterion 3 records its catch-up as a reading in steps a second,
// counted only on a reference Mac (else INCONCLUSIVE). One test holds the three, so the part the merge base already
// gives is never credited alone. Wrong programs it fails: the merge base (no task, no seats, no catch-up); a module
// that sends or reruns more for seats that never change; a catch-up with no reading, or one that isn't steps a second.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { referenceMacProblem } from '../551/helpers.ts';
import { BASE_WORK, HIDDEN, HIDE_S, HIDE_STEP, PEOPLE, RATE, WORK_RELAY, WORK_STEPS, arenaPiece, arenaPlays } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, attempt, benchmark, catchUpsOf, inconclusive, loadNote, none, play, seatsOf, show, useBuilds, useChildren, useTemp, workOf, type Work,
} from './helpers.ts';
import { REPO } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const CRITERION = '#277.2c9337c4';

describe(`${AC[4]} budgets: catch-up as a reading, and no new work for seats that never change`, () => {
  it(`${AC[4]} the window's task names the criterion against the merge base; a match whose seats never change does the merge base's work per step; catch-up is recorded in steps a second`, async () => {
    const f: string[] = [];
    await attempt(f, 'the budget window\'s task', async () => {
      const { validateBudgets } = await benchmark();
      const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; criteria?: string[] }[] };
      if (!current.tasks.some((t) => (t.criteria ?? []).includes(CRITERION))) f.push(`benchmarks/budgets.json has no task naming ${CRITERION}, so no budget window measures catch-up or the unchanged match against the merge base`);
      const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
      validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    });
    await attempt(f, 'a match whose seats never change', async () => {
      const r = await play(builds.show(), temp(), 'AC4 seats that never change', { piece: arenaPiece(), steps: WORK_STEPS, plays: arenaPlays(PEOPLE, WORK_STEPS), relay: WORK_RELAY });
      const work = workOf(r, 'AC4');
      console.log(`${AC[4]} the work of ${WORK_STEPS} match steps whose seats never change: ${JSON.stringify(work)}; at the merge base: ${JSON.stringify(BASE_WORK)}`);
      for (const k of Object.keys(BASE_WORK) as (keyof Work)[]) if (work[k] !== BASE_WORK[k]) f.push(`a match whose seats never change counts ${k} ${work[k]}, where the merge base counts ${BASE_WORK[k]} for the same match`);
      for (const c of r.copies) { const s = seatsOf(c); if (s.length) f.push(`copy ${c.player} holds seat entries in a match whose seats never change: ${show(s, 300)}`); }
    });
    await attempt(f, 'the catch-up reading', async () => {
      const r = await play(builds.show(), temp(), 'AC4 catch-up', {
        piece: arenaPiece(), steps: 3_000, plays: arenaPlays(PEOPLE, 3_000), hide: [{ player: HIDDEN, step: HIDE_STEP, for: HIDE_S }], relay: { seed: 277 },
      });
      const ups = catchUpsOf(r.copies[HIDDEN - 1]!, 'the hidden copy');
      if (ups.length !== 1) { f.push(`the hidden copy reports ${ups.length} catch-ups, not one: ${show(ups.map((u) => u.raw))}`); return; }
      const u = ups[0]!;
      console.log(`${AC[4]} catch-up of the eight-seat piece: ${u.steps} steps (${u.from} to ${u.to}) in ${u.seconds} s, ${u.stepsPerS} steps a second; ${loadNote()}`);
      if (u.steps < HIDE_S * RATE || u.steps !== u.to - u.from + 1) f.push(`the catch-up counts ${u.steps} steps from ${u.from} to ${u.to}, not the ${HIDE_S * RATE} or more it owed`);
      if (!(u.seconds > 0) || !(u.stepsPerS > 0) || Math.abs(u.stepsPerS - u.steps / u.seconds) > 0.01 * u.stepsPerS) f.push(`the catch-up's reading isn't its steps over its seconds: ${show(u.raw)}`);
    });
    none(f, `${AC[4]} the budgets`);
    const off = referenceMacProblem();
    if (off) inconclusive(`${AC[4]}: the catch-up reading counts only on a reference Mac (${off})`);
  }, TIMEOUT);
});
