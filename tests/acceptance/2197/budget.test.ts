// #2197.e42c122a #26's budget holds. On the reference Mac, with 30 days in the record, `deep_status` still answers
//   under 100 ms at p95.
// The record is #26's heavy month (`seedMonth`: 30 days of 20 sessions, 3,000 asks, 600 decisions and 600 open
// items, all in the agent's own worktree), and the session that calls has what the reply now names: a spec naming
// unit and e2e, one open taste ask and one open item of its own. What is timed is that reply, so the test first
// holds the reply to it; on the merge base the reply names none of it, and the test fails there before any timing.
// The 100 ms is judged by the design's rule for timing results, as #26's budgets test judges it: five runs after a
// warm-up, each the p95 of 40 calls timed in the agent's own process; PASS when all five are within the limit, FAIL
// when all five are over it by more than the margin, otherwise INCONCLUSIVE. It counts only on a quiet reference
// Mac (one of the design's three, on mains power, Low Power Mode off, thermal state nominal, load at most half the
// cores: #1551's `timingProblem`); anywhere else the test is skipped as INCONCLUSIVE, never passed, and nothing is
// built. The second test feeds the rule readings it must fail, so the first can fail.

import { afterEach, expect, it, type TestContext } from 'vitest';
import { callTool, cleanup, judge, p95, seedMonth, valueOf, word } from '../26/helpers.ts';
import { timingProblem } from '../1551/helpers.ts';
import { askProblems, CHECKS, holdsText, notListed, oneSession, openItem, shown, status } from './helpers.ts';

afterEach(cleanup, 30_000);

const LIMIT_MS = 100;
const CALLS = 40;

it('#2197.e42c122a on the reference Mac, with 30 days in the record, deep_status answers under 100 ms at p95', async (ctx) => {
  const problem = timingProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
  const term = word(10);
  const w = await oneSession({
    ask: 'Which accent for the login header?',
    before: async (s, worktree) => { await seedMonth(s, worktree, term); s.at(Date.now()); },
  });
  const text = `The empty cart page still needs its copy checked, batch ${term}`;
  await openItem(w.hub, w, text);

  // The reply that is timed is the one the issue asks for: it names the checks, the session's ask and its item.
  const first = await status(w.agent);
  const missing = [...notListed(first, CHECKS).map((name) => `the check ${name}`), ...askProblems(first, w.ask!), ...(holdsText(first, text) ? [] : [`the open item "${text}"`])];
  expect(missing, `the deep_status that is timed names the repo's checks, the session's open ask and its open item: ${shown(first)}`).toEqual([]);

  const once = async (): Promise<number> => {
    const ms: number[] = [];
    for (let i = 0; i < CALLS; i++) {
      const call = await callTool(w.agent, 'deep_status', {});
      expect(valueOf(call, 'deep_status')?.session, 'each timed call answers for the agent\'s own session').toBe(w.session.id);
      ms.push(call.ms);
    }
    return p95(ms);
  };
  await once();
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) runs.push(await once());
  judge(ctx, '#2197 deep_status p95 (ms), 30 days in the record', runs, LIMIT_MS);
}, 900_000);

it('#2197.rule the timing rule fails a status over 100 ms in all five runs, and reads runs that straddle it as INCONCLUSIVE, never a pass', () => {
  const skipped: string[] = [];
  const ctx = { skip: (note?: string) => { skipped.push(String(note)); } } as unknown as TestContext;
  expect(() => judge(ctx, 'a planted slow status', [131, 134, 138, 140, 142], LIMIT_MS), 'five runs over the limit by more than the margin fail').toThrow(/FAIL a planted slow status/);
  expect(skipped, 'a failing reading is not skipped').toEqual([]);
  judge(ctx, 'a status at the limit', [92, 97, 101, 104, 99], LIMIT_MS);
  expect(skipped.map((note) => note.slice(0, 12)), 'runs on both sides of the limit are INCONCLUSIVE').toEqual(['INCONCLUSIVE']);
  judge(ctx, 'a fast status', [4, 5, 5, 6, 7], LIMIT_MS);
  expect(skipped.length, 'five runs within the limit pass, with nothing skipped').toBe(1);
});
