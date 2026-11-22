// #2332 acceptance: the hub is ready sooner. Run from the CHANGE's checkout with MAIN built beside it:
//   DEEP_2332_MAIN=/path/to/main/checkout node --test tests/acceptance/2332/ready.test.mjs
// (both checkouts need `npm ci && npm run build`; macOS, for the instruction counter). 20 alternated paired rounds by default
// (DEEP_2332_ROUNDS, DEEP_2332_IDLE_ROUNDS to shorten a sanity run, which then reads INCONCLUSIVE at best). A missing prerequisite
// or counter fails the test with BLOCKED or INCONCLUSIVE in its message; none passes.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUESTS, idleRuns, judgeBudget, judgeFirst, judgeIdle, judgeReady, pairedRuns, runBudgetCommand } from './measure.mjs';

const CHANGE = fileURLToPath(new URL('../../..', import.meta.url));
const MAIN = process.env.DEEP_2332_MAIN;
const ROUNDS = Number(process.env.DEEP_2332_ROUNDS ?? 20);
const IDLE = Number(process.env.DEEP_2332_IDLE_ROUNDS ?? 5);
const settle = (v) => assert.equal(v.status, 'PASS', `${v.status}: ${v.reason ?? ''}\n${JSON.stringify(v, null, 1).slice(0, 3000)}`);

describe('the judgements fail a wrong program and never pass a missing count', () => {
  const runs = (ready, first) => ({ pairs: Array.from({ length: 20 }, (_, i) => ({ main: { ready: 1e9 + i * 1e6, costs: { SessionStart: 1e8 + i } }, change: { ready: Math.round(ready * (1e9 + i * 1e6)), costs: { SessionStart: Math.round(first * (1e8 + i)) } } })) });
  it('25% means 25%: 24% under fails, 26% under passes', () => {
    assert.equal(judgeReady(runs(0.76, 1)).status, 'FAIL');
    assert.equal(judgeReady(runs(0.74, 1)).status, 'PASS');
  });
  it('a first request more than main fails, equal or fewer passes', () => {
    assert.equal(judgeFirst(runs(1, 1.03), 'SessionStart').status, 'FAIL');
    assert.equal(judgeFirst(runs(1, 1), 'SessionStart').status, 'PASS');
    assert.equal(judgeFirst(runs(1, 0.8), 'SessionStart').status, 'PASS');
  });
  it('a missing count, a missing counter and too few rounds are never PASS', () => {
    const missing = runs(0.5, 1);
    missing.pairs[3].change.ready = null;
    assert.equal(judgeReady(missing).status, 'INCONCLUSIVE');
    assert.equal(judgeReady({ pairs: [], problem: 'BLOCKED: no counter' }).status, 'BLOCKED');
    assert.equal(judgeReady({ pairs: runs(0.5, 1).pairs.slice(0, 5) }).status, 'INCONCLUSIVE');
  });
  it('idle memory above main fails', () => {
    assert.equal(judgeIdle({ rss: { main: [100, 100, 100, 100, 100], change: [101, 101, 101, 101, 101] } }).status, 'FAIL');
    assert.equal(judgeIdle({ rss: { main: [100, 100, 100, 100, 100], change: [100, 99, 100, 98, 100] } }).status, 'PASS');
  });
});

describe('#2332 against main', { timeout: 3_600_000 }, () => {
  let runs, idle;
  before(() => {
    assert.ok(MAIN, 'BLOCKED: set DEEP_2332_MAIN to a built checkout of main (9f93f1e7b)');
  });
  before(async () => { if (MAIN) { runs = await pairedRuns(MAIN, CHANGE, ROUNDS); idle = idleRuns(MAIN, CHANGE, IDLE); } });

  it('AC1: the hub\'s own instructions from start to core-ready, on a fresh home with the shipped guards, are at least 25% under main\'s over 20 alternated rounds', () => settle(judgeReady(runs)));
  for (const kind of REQUESTS) it(`AC2: the first ${kind} after ready retires no more instructions in the hub than on main`, () => settle(judgeFirst(runs, kind)));
  it('AC3: benchmarks/hub.mjs idle reads no more resident memory than on main', () => settle(judgeIdle(idle)));

  it('Proof: benchmarks/budgets.json has the start-to-ready task, from main\'s first reading, and its command reads a hub instruction count', () => {
    const task = judgeBudget(MAIN, CHANGE);
    settle(task);
    settle(runBudgetCommand(CHANGE, task.command));
  });
});
