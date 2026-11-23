// AC5 #278.fe1a5277: Budgets, on the reference Mac in the local preflight, compared with the merge base: a join's
// replay of the eight-seat piece is recorded as a reading in steps a second, and a piece without `open`, `finish` or a
// `{min, max}` count gains no work
//
// Split as #277's budgets are: the merge-base comparison in time is the budget window's (a task of
// benchmarks/budgets.json naming this criterion, valid against the merge base's budgets; the window measures each
// merged commit against its merge base), and this test holds what a run here can: the eight-seat piece with one player
// count and no `open` or `finish`, played by four copies, does the work it did at the merge base, by counts no load
// can move (the frames the test relay carried, their bytes and messages, the rollbacks and the steps they ran again,
// the steps run, under one seeded schedule that holds frames back up to the window), equal to the counts the merge
// base gave for the same match (`BASE_WORK`, read at 7a256fd4b by this job); and the fourth copy of criterion 2
// records its replay as a reading in steps a second, counted only on a reference Mac (else INCONCLUSIVE). One test
// holds the three, so the part the merge base already gives is never credited alone. Wrong programs it fails: the
// merge base (no task, no join); a module that sends, reruns or stamps more in a match with one count; a join's replay
// with no reading, or one that isn't steps a second.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { referenceMacProblem } from '../551/helpers.ts';
import { BASE_WORK, DOC, JOINED, JOINER, JOIN_STEP, WORK_PEOPLE, WORK_RELAY, WORK_STEPS, roomPiece, roomPlays } from './fixtures.ts';
import {
  AC, FULL, REPO, TIMEOUT, attempt, benchmark, catchUpsOf, copyFor, loadNote, play, seatsOf, show, useBuilds, useChildren, useTemp, workOf, type Match, type Played, type Work,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const CRITERION = '#278.fe1a5277';
/** A git in the checkout reads this repository alone, whatever the caller's environment names. */
const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
/** A run's match, or the reason there is none. */
const matchOf = (r: Played, what: string): Match | string => (!r.ok ? `${what}: deep-show run didn't take the scenario: ${r.why}` : r.outcome !== 'presented' ? `${what}: the piece isn't presented: ${r.why}` : r.code !== null ? `${what}: the match call refused: ${r.why}` : r.match!);

describe(`${AC[5]} budgets: a join's replay as a reading, and no new work for a piece with one player count`, () => {
  it(`${AC[5]} the window's task names the criterion against the merge base; a piece without open, finish or a {min, max} count does the merge base's work; a join's replay is recorded in steps a second`, async () => {
    const f: string[] = [];
    await attempt(f, 'the budget window\'s task', async () => {
      const { validateBudgets } = await benchmark();
      const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; criteria?: string[] }[] };
      if (!current.tasks.some((t) => (t.criteria ?? []).includes(CRITERION))) f.push(`benchmarks/budgets.json has no task naming ${CRITERION}, so no budget window measures a join's replay or the piece with one count against the merge base`);
      const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', env: gitEnv() }).trim();
      validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', env: gitEnv(), maxBuffer: 1 << 28 })));
    });
    await attempt(f, 'a piece without open, finish or a {min, max} count', async () => {
      const m = matchOf(await play(builds.show(), temp(), 'AC5 one player count', {
        piece: roomPiece({ id: DOC.base, count: WORK_PEOPLE, open: false }), steps: WORK_STEPS, plays: roomPlays(WORK_PEOPLE, WORK_STEPS), relay: WORK_RELAY,
      }), 'AC5 one player count');
      if (typeof m === 'string') { f.push(m); return; }
      const work = workOf(m, 'AC5');
      console.log(`${AC[5]} the work of ${WORK_STEPS} match steps of the piece with one player count: ${JSON.stringify(work)}; at the merge base: ${JSON.stringify(BASE_WORK)}`);
      for (const k of Object.keys(BASE_WORK) as (keyof Work)[]) if (work[k] !== BASE_WORK[k]) f.push(`a piece without open, finish or a {min, max} count counts ${k} ${work[k]}, where the merge base counts ${BASE_WORK[k]} for the same match`);
      for (const c of m.copies) { const s = seatsOf(c); if (s.length) f.push(`copy ${c.player} holds seat entries in a match with one player count, whose seats never change: ${show(s, 300)}`); }
    });
    await attempt(f, 'a join\'s replay', async () => {
      const steps = 1_200;
      const m = matchOf(await play(builds.show(), temp(), 'AC5 a join\'s replay', {
        piece: roomPiece(), steps, plays: roomPlays(JOINER, steps), start: { joined: JOINED }, join: [{ player: JOINER, step: JOIN_STEP }], relay: { seed: 278 },
      }), 'AC5 a join\'s replay');
      if (typeof m === 'string') { f.push(m); return; }
      const ups = catchUpsOf(copyFor(m, JOINER), 'the copy that joined');
      if (ups.length !== 1) { f.push(`the copy that joined reports ${ups.length} replays (catch_ups), not one: ${show(ups.map((u) => u.raw))}`); return; }
      const u = ups[0]!;
      console.log(`${AC[5]} a join's replay of the eight-seat piece: ${u.steps} steps (${u.from} to ${u.to}) in ${u.seconds} s, ${u.stepsPerS} steps a second; ${loadNote()}`);
      if (u.from !== 0 || u.to < JOIN_STEP || u.steps !== u.to - u.from + 1) f.push(`the join's replay counts ${u.steps} steps from ${u.from} to ${u.to}, not every step from 0 through ${JOIN_STEP} or later`);
      if (!(u.seconds > 0) || !(u.stepsPerS > 0) || Math.abs(u.stepsPerS - u.steps / u.seconds) > 0.01 * u.stepsPerS) f.push(`the join's replay's reading isn't its steps over its seconds: ${show(u.raw)}`);
    });
    expect(f, `${AC[5]} the budgets:\n  ${f.join('\n  ')}`).toEqual([]);
    const off = referenceMacProblem();
    if (off) expect.fail(`INCONCLUSIVE: ${AC[5]}: a join's replay reading counts only on a reference Mac (${off}); this is not a pass`);
  }, TIMEOUT);
});
