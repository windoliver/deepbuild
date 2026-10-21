// Live acceptance tests for issue #48: real Claude Code and Codex sessions on your own sign-in,
// driven through `node scripts/agent-harness.mjs`. They spend plan usage, so they run only by hand:
//   DEEP_HARNESS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/48/harness.live.test.mjs
// A missing binary, sign-in, plan, opt-in or reference Mac fails the test with BLOCKED in its
// message; nothing skips.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import test from 'node:test';
import {
  alive, assertLaneExit, assertReadOnlyLaunch, assertRunShape, continuedWith, entry, HARNESS_MS, harness, mergeBase, onlyLane, onlyRun, PAIRS, readFacts,
  referenceMachine, root, scratch, SESSION_MS, show, totalTokens,
} from './helpers.mjs';

const OCT4 = '#48.d82aa825';
const COST = '#48.a0c92350';
const PROCESSES = '#48.e5ba087b';
const JOB = '#48.25de0c6b';
const BUDGETS = '#48.0f909fd3';

function requireLive(...agents) {
  if (process.env.DEEP_HARNESS_LIVE !== '1') assert.fail('BLOCKED: live tests spend plan usage; run them by hand with DEEP_HARNESS_LIVE=1');
  for (const agent of agents) {
    const version = spawnSync(agent, ['--version'], { encoding: 'utf8', timeout: 30_000 });
    if (version.error || version.status !== 0) assert.fail(`BLOCKED: ${agent} is not runnable on PATH: ${version.error?.message ?? `exit ${version.status}`}`);
    // `codex login status` prints part of an API key when one is used, so its output is only
    // matched in memory, never shown.
    const signIn = spawnSync(agent, agent === 'codex' ? ['login', 'status'] : ['auth', 'status'], { encoding: 'utf8', timeout: 30_000 });
    if (signIn.error || signIn.status !== 0) assert.fail(`BLOCKED: ${agent} is not signed in (sign-in status exit ${signIn.status})`);
    if (agent === 'codex' && !/ChatGPT/.test(`${signIn.stdout}${signIn.stderr}`)) assert.fail('BLOCKED: Codex is not signed in on a ChatGPT plan, so its usage would carry a price');
  }
}

// What every live run must show: it passed, printed what it spent within its cap, kept its
// transcript, and left none of its processes running. The run line is the scenario's proof.
function passed(t, result, out, agent) {
  const run = onlyRun(result);
  t.diagnostic(JSON.stringify(run));
  assertRunShape(run, out);
  assert.equal(run.agent, agent);
  assert.equal(run.verdict, 'PASS', show(result));
  assertSpent(run);
  assertStopped(run, agent);
  return run;
}

// Claude Code reports a price; Codex on a plan reports tokens and no price.
function assertSpent(run) {
  if (run.agent === 'codex') {
    assert.equal(run.cost.basis, 'unpriced', `Codex on a plan is unpriced, never $0: ${JSON.stringify(run.cost)}`);
    assert.ok(totalTokens(run.tokens) > 0 && totalTokens(run.tokens) <= run.cap.tokens, `a real session spends tokens, within its cap: ${JSON.stringify(run.tokens)} of ${run.cap.tokens}`);
  } else {
    assert.ok(['reported', 'estimated'].includes(run.cost.basis), JSON.stringify(run.cost));
    assert.ok(run.cost.usd > 0 && run.cost.usd <= run.cap.usd, `a real session costs something, within its cap: ${run.cost.usd} of ${run.cap.usd}`);
  }
}

function assertStopped(run, agent) {
  assert.ok(Array.isArray(run.processes?.started) && run.processes.started.length > 0, `the run lists the processes it started: ${JSON.stringify(run.processes)}`);
  const living = run.processes.started.filter((pid) => alive(pid, agent));
  assert.deepEqual(living, [], `processes the run started still run after the harness exited: ${living.join(', ')}`);
}

test(`${OCT4} ${PROCESSES} a held stop continues with the answer`, { timeout: 2 * SESSION_MS }, (t) => {
  requireLive('claude');
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', '--out', out], { timeout: 2 * SESSION_MS });
  const run = passed(t, result, out, 'claude');
  assert.equal(run.stop, 'done');
  assert.ok(String(run.evidence?.answer).includes(run.evidence?.token), `the hold's answer carries the token: ${JSON.stringify(run.evidence)}`);
  continuedWith(run.transcript, run.evidence.token);
});

test(`${OCT4} ${PROCESSES} an idle session wakes with a background waiter`, { timeout: 2 * SESSION_MS }, (t) => {
  requireLive('claude');
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'idle-wake', '--out', out], { timeout: 2 * SESSION_MS });
  const run = passed(t, result, out, 'claude');
  assert.equal(run.stop, 'done');
  assert.match(readFileSync(run.settings, 'utf8'), /asyncRewake/, 'the session is woken by an asyncRewake waiter from its --settings');
  const idleMs = continuedWith(run.transcript, run.evidence?.token);
  assert.ok(idleMs >= 1000, `the session sat idle before it woke: ${idleMs} ms`);
});

test(`${COST} ${PROCESSES} a real priced session over its cost cap stops`, { timeout: 2 * SESSION_MS }, (t) => {
  requireLive('claude');
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', '--cost-cap-usd', '0.0001', '--out', out], { timeout: 2 * SESSION_MS });
  const run = onlyRun(result);
  t.diagnostic(JSON.stringify(run));
  assertRunShape(run, out);
  assert.equal(run.stop, 'cost_cap', show(result));
  assert.notEqual(run.verdict, 'PASS');
  assert.ok(run.cost.usd > 0.0001, `the printed cost is past the cap: ${run.cost.usd}`);
  assertStopped(run, 'claude');
});

test(`${COST} ${PROCESSES} a real unpriced Codex session over its token cap stops`, { timeout: 2 * SESSION_MS }, (t) => {
  requireLive('codex');
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'read-only-job', '--agent', 'codex', '--token-cap', '1', '--out', out], { timeout: 2 * SESSION_MS });
  const run = onlyRun(result);
  t.diagnostic(JSON.stringify(run));
  assertRunShape(run, out);
  assert.equal(run.stop, 'token_cap', show(result));
  assert.notEqual(run.verdict, 'PASS');
  assert.equal(run.cost.basis, 'unpriced');
  assert.ok(totalTokens(run.tokens) > 1, `the printed tokens are past the cap: ${JSON.stringify(run.tokens)}`);
  assertStopped(run, 'codex');
});

for (const agent of ['claude', 'codex']) {
  test(`${JOB} ${COST} ${PROCESSES} a ${agent} job with the read-only launch from its facts can't write`, { timeout: 2 * SESSION_MS }, (t) => {
    requireLive(agent);
    const out = scratch(t);
    const result = harness(['run', '--scenario', 'read-only-job', '--agent', agent, '--out', out], { timeout: 2 * SESSION_MS });
    const run = passed(t, result, out, agent);
    const facts = readFacts(run.launch?.facts ?? 'BLOCKED: no facts file named');
    assertReadOnlyLaunch(agent, run.launch.argv.slice(1), facts);
    const probe = run.evidence?.probe;
    assert.ok(typeof probe === 'string' && realpathSync(dirname(probe)).startsWith(realpathSync(run.workdir)), `the run names the file the job was asked to write, inside its folder: ${probe}`);
    assert.ok(readFileSync(run.transcript, 'utf8').includes(basename(probe)), 'the job attempted the write');
    assert.equal(existsSync(probe), false, `the write attempt failed: ${probe} exists`);
  });
}

test(`${BUDGETS} ${OCT4} on the reference Mac, the preflight's harness budgets lane passes: every scripted session under 60 s and the whole harness under 10 minutes, compared with the merge base`, { timeout: 2 * HARNESS_MS + 120_000 }, (t) => {
  requireLive('claude', 'codex');
  const machine = referenceMachine();
  if (!machine.hardware) assert.fail('BLOCKED: budgets count only on one of the two reference Macs, matched in full: a Mac15,7 with a 12-core M3 Pro, 18 GPU cores and 36 GB, or a Mac15,12 with an 8-core M3, 10 GPU cores and 16 GB');
  if (!machine.conditions) assert.fail('BLOCKED: the reference Mac must be on mains power with Low Power Mode off');
  const out = scratch(t);
  const base = mergeBase();
  const baseHasHarness = spawnSync('git', ['cat-file', '-e', `${base}:${entry}`], { cwd: root }).status === 0;
  // The lane as the preflight runs it, with real agents and the repo's budgets; --changed makes
  // it run whatever this checkout's diff is.
  const result = harness(['budgets', '--changed', entry, '--out', out], { timeout: 2 * HARNESS_MS + 60_000 });
  for (const run of result.runs) t.diagnostic(JSON.stringify(run));
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify(lane));
  assert.equal(lane.machine?.reference, true, `the lane ran on the reference Mac: ${JSON.stringify(lane.machine)}`);
  assert.equal(lane.status, baseHasHarness ? 'PASS' : 'INITIAL', show(result));
  assertLaneExit(result, lane);
  assert.equal(lane.baseCommit, base);
  if (baseHasHarness) assert.ok(lane.base && Number.isFinite(lane.base.wholeMs), `the lane measured the merge base: ${JSON.stringify(lane.base)}`);
  else assert.ok(lane.base === null && typeof lane.initialReason === 'string' && lane.initialReason, 'the first measurement says the merge base has no harness');
  assert.deepEqual(lane.limits, { sessionMs: SESSION_MS, wholeMs: HARNESS_MS });
  assert.deepEqual(lane.over, []);
  assert.deepEqual(lane.current.sessions.map(({ scenario, agent }) => `${scenario}/${agent}`).sort(), [...PAIRS].sort());
  for (const { scenario, agent, elapsedMs } of lane.current.sessions) assert.ok(elapsedMs < SESSION_MS, `${scenario}/${agent} took ${elapsedMs} ms`);
  assert.ok(lane.current.wholeMs < HARNESS_MS, `the whole harness took ${lane.current.wholeMs} ms`);
  for (const run of result.runs) {
    assertRunShape(run, out);
    assert.equal(run.verdict, 'PASS', JSON.stringify(run));
    assertSpent(run);
    assertStopped(run, run.agent);
  }
});
