// Fast acceptance tests for issue #48: the agent test harness, driven through
// `node scripts/agent-harness.mjs` against the fake agent in fixtures/, and its budgets lane in
// the local preflight. No real session starts and nothing is spent.
// Run: node --test tests/acceptance/48/harness.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import {
  alive, assertBudgetStatus, assertLaneExit, assertReadOnlyLaunch, assertRunShape, BASE, continuedWith, entry, fakeAgents, gone, harness, hookFiles,
  mergeBase, onlyLane, onlyRun, PAIRS, readFacts, repoPath, root, safeEnv, scaledBudgets, scratch, SESSION_MS, HARNESS_MS, show, startHarness, stillRunning, totalTokens, waitFor,
} from './helpers.mjs';

const OCT4 = '#48.d82aa825';
const COST = '#48.a0c92350';
const PROCESSES = '#48.e5ba087b';
const JOB = '#48.25de0c6b';
const BUDGETS = '#48.0f909fd3';

const agents = (fake) => ['--claude', fake.claude, '--codex', fake.codex];

// ---------------------------------------------------------------- the October 4 scenarios

for (const scenario of ['held-stop', 'idle-wake']) {
  test(`${OCT4} ${scenario} runs Claude Code interactively in a pseudo-terminal with --settings, never claude -p, and doesn't pass when the session never continues`, (t) => {
    // This fake runs the hooks but never continues on a block or a wake.
    const fake = fakeAgents(t, { obey: false });
    const out = scratch(t);
    const result = harness(['run', '--scenario', scenario, ...agents(fake), '--timeout-ms', '3000', '--out', out], { timeout: 60_000, env: fake.env });
    const run = onlyRun(result);
    assertRunShape(run, out);
    assert.equal(run.scenario, scenario);
    assert.equal(run.agent, 'claude');
    assert.notEqual(run.verdict, 'PASS', `a session that never continued must not pass\n${show(result)}`);
    const sessions = fake.sessions();
    assert.ok(sessions.length >= 1, `the harness never started the agent\n${show(result)}`);
    for (const session of sessions) {
      assert.ok(!session.argv.includes('-p') && !session.argv.includes('--print'), `claude -p ends async hooks at teardown: ${JSON.stringify(session.argv)}`);
      assert.ok(session.stdinTTY && session.stdoutTTY, `the session must run in a pseudo-terminal: ${JSON.stringify(session)}`);
      const settings = session.argv.indexOf('--settings');
      assert.ok(settings >= 0 && session.argv[settings + 1], `the session must start with --settings: ${JSON.stringify(session.argv)}`);
    }
    assert.ok(sessions.some(({ sessionId }) => sessionId === run.sessionId), `the run names the session the agent reported: ${run.sessionId}`);
    assert.match(readFileSync(run.transcript, 'utf8'), new RegExp(fake.nonce), 'the kept transcript is the session\'s own');
  });
}

test(`${OCT4} a held stop continues with the answer`, (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', ...agents(fake), '--timeout-ms', '30000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.verdict, 'PASS', show(result));
  assert.equal(run.stop, 'done');
  assert.equal(result.status, 0, show(result));
  assert.ok(fake.sessions().every(({ argv, stdinTTY }) => stdinTTY && !argv.includes('-p')), 'the held session ran interactively');
  assert.ok(String(run.evidence?.answer).includes(run.evidence?.token), `the hold's answer carries the token: ${JSON.stringify(run.evidence)}`);
  continuedWith(run.transcript, run.evidence.token);
});

test(`${OCT4} an idle session wakes with a background waiter`, (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'idle-wake', ...agents(fake), '--timeout-ms', '30000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.verdict, 'PASS', show(result));
  assert.equal(run.stop, 'done');
  assert.match(readFileSync(run.settings, 'utf8'), /asyncRewake/, 'the session is woken by an asyncRewake waiter from its --settings');
  const idleMs = continuedWith(run.transcript, run.evidence?.token);
  assert.ok(idleMs >= 1000, `the session sat idle before it woke: ${idleMs} ms`);
});

// ---------------------------------------------------------------- cost and caps

test(`${COST} a priced run over its cost cap stops`, async (t) => {
  // $0.03 every 200 ms, forever, against a $0.05 cap and a 30 s deadline.
  const fake = fakeAgents(t, { obey: false, ticks: null });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', ...agents(fake), '--cost-cap-usd', '0.05', '--timeout-ms', '30000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.stop, 'cost_cap', `the run must stop at its cost cap\n${show(result)}`);
  assert.notEqual(run.verdict, 'PASS');
  assert.notEqual(result.status, 0);
  assert.ok(['reported', 'estimated'].includes(run.cost.basis), `Claude Code's cost is priced: ${JSON.stringify(run.cost)}`);
  assert.equal(run.cap.usd, 0.05);
  assert.ok(run.cost.usd > 0.05 && run.cost.usd < 1, `the printed cost is past the cap and stopped growing: ${run.cost.usd}`);
  assert.ok(result.wallMs < 20_000, `the cap stopped the run, not its deadline: ${Math.round(result.wallMs)} ms`);
  assert.deepEqual(await stillRunning(fake), [], 'the capped agent is stopped');
});

test(`${COST} a priced run under its cap that ends on its deadline prints what it spent, each message counted once`, (t) => {
  const fake = fakeAgents(t, { obey: false });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', ...agents(fake), '--cost-cap-usd', '1', '--timeout-ms', '3000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.stop, 'timeout', show(result));
  assert.notEqual(run.verdict, 'PASS');
  const spent = fake.spend(run.sessionId);
  assert.ok(spent && spent.messages >= 1, `the session replied at least once\n${show(result)}`);
  assert.ok(['reported', 'estimated'].includes(run.cost.basis), JSON.stringify(run.cost));
  assert.ok(Math.abs(run.cost.usd - spent.costUsd) < 0.0051, `${spent.messages} Haiku 4.5 messages of 10,000 in and 4,000 out cost $${spent.costUsd}; printed ${run.cost.usd}`);
  // Each message's usage is repeated on every transcript entry of that message; it counts once.
  assert.deepEqual({ input: run.tokens.input, cached: run.tokens.cached, output: run.tokens.output }, spent.tokens, `tokens counted once per message: ${JSON.stringify(run.tokens)}`);
  assert.equal(run.tokens.count, 'exact');
  assert.equal(run.model, 'claude-haiku-4-5', 'the run names the model that answered');
  assert.equal(run.cap.usd, 1);
});

test(`${COST} a run whose agent binary is missing is BLOCKED and its cost reads "not captured", never $0`, (t) => {
  const out = scratch(t);
  const { env, assertNoRealAgent } = safeEnv(out);
  const result = harness(['run', '--scenario', 'held-stop', '--claude', join(out, 'no-such-claude'), '--codex', join(out, 'no-such-codex'), '--timeout-ms', '3000', '--out', out], { timeout: 60_000, env });
  assertNoRealAgent();
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.verdict, 'BLOCKED', show(result));
  assert.equal(run.cost.basis, 'not captured', JSON.stringify(run.cost));
  assert.equal(run.tokens, 'not captured');
  assert.notEqual(result.status, 0);
});

test(`${COST} a run whose agent reports no usage prints its cost as "not captured", never $0, and doesn't pass`, (t) => {
  const fake = fakeAgents(t, { obey: false, usage: false });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'held-stop', ...agents(fake), '--timeout-ms', '3000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.ok(fake.spend(run.sessionId)?.messages >= 1, `the session replied, reporting no usage\n${show(result)}`);
  assert.equal(run.cost.basis, 'not captured', JSON.stringify(run.cost));
  assert.equal(run.tokens, 'not captured');
  assert.notEqual(run.verdict, 'PASS');
});

test(`${COST} a Codex run on a plan reports its tokens as unpriced, never $0, against a token cap`, (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'read-only-job', '--agent', 'codex', ...agents(fake), '--timeout-ms', '20000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.agent, 'codex');
  const session = fake.sessions().find(({ name }) => name === 'codex');
  assert.ok(session, `the harness never started codex\n${show(result)}`);
  assert.equal(session.homes.CODEX_HOME, fake.homes.CODEX_HOME, 'the job runs in the account home it was given');
  assert.equal(run.cost.basis, 'unpriced', JSON.stringify(run.cost));
  assert.ok(!('usd' in run.cost), 'an unpriced run prints no dollar figure');
  assert.ok(typeof run.cap.tokens === 'number' && run.cap.tokens > 0 && !('usd' in run.cap), `a token cap stands in for its cost cap: ${JSON.stringify(run.cap)}`);
  const spent = fake.spend(run.sessionId);
  assert.ok(spent, `the run names the thread Codex reported: ${run.sessionId}`);
  // Codex counts cached input inside input_tokens; the run reports it apart, once.
  assert.deepEqual({ input: run.tokens.input, cached: run.tokens.cached, output: run.tokens.output }, spent.tokens, `tokens with cached input taken back out: ${JSON.stringify(run.tokens)}`);
  assert.equal(run.tokens.count, 'exact');
  assert.equal(run.model, 'gpt-5.1-codex-mini', 'the run names the model that answered');
});

test(`${COST} an unpriced Codex run over its token cap stops`, async (t) => {
  // 14,000 tokens every 200 ms, forever, against a 30,000 token cap and a 30 s deadline.
  const fake = fakeAgents(t, { obey: false, ticks: null });
  const out = scratch(t);
  const result = harness(['run', '--scenario', 'read-only-job', '--agent', 'codex', ...agents(fake), '--token-cap', '30000', '--timeout-ms', '30000', '--out', out], { timeout: 60_000, env: fake.env });
  const run = onlyRun(result);
  assertRunShape(run, out);
  assert.equal(run.stop, 'token_cap', `the run must stop at its token cap\n${show(result)}`);
  assert.notEqual(run.verdict, 'PASS');
  assert.notEqual(result.status, 0);
  assert.equal(run.cost.basis, 'unpriced');
  assert.equal(run.cap.tokens, 30_000);
  assert.ok(totalTokens(run.tokens) > 30_000 && totalTokens(run.tokens) < 300_000, `the printed tokens are past the cap and stopped growing: ${JSON.stringify(run.tokens)}`);
  assert.ok(result.wallMs < 20_000, `the cap stopped the run, not its deadline: ${Math.round(result.wallMs)} ms`);
  assert.deepEqual(await stillRunning(fake), [], 'the capped agent is stopped');
});

// ---------------------------------------------------------------- processes

// The fake leaves a child in its own process group and a detached grandchild in a new session,
// both ignoring SIGTERM, SIGHUP and SIGINT. A decoy with the same command line, started by the
// test without the harness's run token, must survive.
function decoy(t, fake) {
  const child = spawn(process.execPath, [fake.claude, '--linger', 'detached'], { detached: true, stdio: 'ignore' });
  child.unref();
  t.after(() => { if (alive(child.pid, fake.bin)) process.kill(child.pid, 'SIGKILL'); });
  return child.pid;
}
const lingers = (fake, decoyPid) => fake.calls().filter(({ pid, linger }) => linger && pid !== decoyPid).map(({ linger }) => linger).sort();
const ours = (fake, decoyPid) => fake.processes().filter(({ pid }) => pid !== decoyPid);
async function survivors(fake, decoyPid) {
  const living = [];
  for (const { pid, marker } of ours(fake, decoyPid)) if ((await gone([pid], marker)).length) living.push(pid);
  return living;
}

test(`${PROCESSES} no process the agent or its hooks started outlives a run that ends, and a decoy without the run token survives`, async (t) => {
  const fake = fakeAgents(t, { obey: false, linger: true });
  const out = scratch(t);
  const decoyPid = decoy(t, fake);
  await waitFor(() => fake.calls().some(({ pid }) => pid === decoyPid), 5000, 'the decoy to start');
  const result = harness(['run', '--scenario', 'held-stop', ...agents(fake), '--timeout-ms', '4000', '--out', out], { timeout: 60_000, env: fake.env });
  assert.equal(result.runs.length, 1, show(result));
  assert.deepEqual(lingers(fake, decoyPid), ['child', 'detached'], `the fake must have run and left both processes\n${show(result)}`);
  assert.deepEqual(await survivors(fake, decoyPid), [], 'every process the run started is gone when the harness exits');
  assert.ok(alive(decoyPid, fake.bin), 'a decoy that carries no run token survives cleanup');
});

test(`${PROCESSES} no process outlives a harness stopped with SIGTERM mid-run, and the decoy survives`, async (t) => {
  const fake = fakeAgents(t, { obey: false, ticks: null, linger: true });
  const out = scratch(t);
  const decoyPid = decoy(t, fake);
  await waitFor(() => fake.calls().some(({ pid }) => pid === decoyPid), 5000, 'the decoy to start');
  const { child, closed } = startHarness(['run', '--scenario', 'held-stop', ...agents(fake), '--cost-cap-usd', '100', '--timeout-ms', '60000', '--out', out], { env: fake.env });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await waitFor(() => lingers(fake, decoyPid).length === 2, 30_000, 'the fake agent to start both processes');
  child.kill('SIGTERM');
  const deadline = new Promise((done) => setTimeout(() => done(null), 20_000));
  const result = await Promise.race([closed, deadline]);
  assert.ok(result, 'the harness exits within 20 s of SIGTERM');
  assert.deepEqual(await survivors(fake, decoyPid), [], `every process the run started is gone when the harness exits\n${show(result)}`);
  assert.ok(alive(decoyPid, fake.bin), 'a decoy that carries no run token survives cleanup');
  assert.ok(result.runs.length === 1, `a stopped run still prints its line\n${show(result)}`);
  assertRunShape(result.runs[0]);
});

// ---------------------------------------------------------------- the read-only job

for (const agent of ['claude', 'codex']) {
  test(`${JOB} the ${agent} job starts with exactly the read-only launch its adapter facts name, and its write attempt fails`, (t) => {
    const fake = fakeAgents(t, { obey: true });
    const out = scratch(t);
    // The harness is often started from inside a Claude Code session; the job must not inherit that.
    const env = { ...fake.env, CLAUDECODE: '1' };
    const result = harness(['run', '--scenario', 'read-only-job', '--agent', agent, ...agents(fake), '--timeout-ms', '20000', '--out', out], { timeout: 60_000, env });
    const run = onlyRun(result);
    assertRunShape(run, out);
    assert.equal(run.agent, agent);
    assert.ok(run.launch && Array.isArray(run.launch.argv) && typeof run.launch.facts === 'string', `BLOCKED: the run names no launch from adapter facts\n${show(result)}`);
    const facts = readFacts(run.launch.facts);
    assert.ok(facts.absolute.startsWith(root), `the facts file is the repo's own: ${facts.absolute}`);
    assert.equal(realpathSync(run.launch.argv[0]), realpathSync(agent === 'claude' ? fake.claude : fake.codex), 'the job runs the binary the harness was given');
    const session = fake.sessions().find(({ name }) => name === agent);
    assert.ok(session, `the harness never started the ${agent} job\n${show(result)}`);
    assert.deepEqual(session.argv, run.launch.argv.slice(1), 'the job ran with exactly the launch the run reports');
    assertReadOnlyLaunch(agent, session.argv, facts);
    assert.ok(!session.stdinTTY && session.stdinBytes > 0, `the job takes its prompt on stdin: ${JSON.stringify(session)}`);
    assert.equal(session.nested, false, 'the job starts without the variable that marks a nested session');
    const probe = run.evidence?.probe;
    assert.ok(typeof probe === 'string' && realpathSync(dirname(probe)).startsWith(realpathSync(run.workdir)), `the run names the file the job was asked to write, inside its folder: ${probe}`);
    const same = (path) => basename(path) === basename(probe) && realpathSync(dirname(path)) === realpathSync(dirname(probe));
    assert.ok(fake.writes().some(({ path, allowed }) => same(path) && !allowed), `the job tried to write the probe and was refused: ${JSON.stringify(fake.writes())}`);
    assert.equal(existsSync(probe), false, `the write attempt failed: ${probe} exists`);
    assert.equal(run.verdict, 'PASS', show(result));
  });
}

// ---------------------------------------------------------------- the budgets lane

// A copy of the real preflight entry and scripts, with stub check, perf and harness workloads:
// the stub harness records how the preflight called it, then sleeps and exits as told.
function preflightCopy(t, { exit, sleepMs, limitMs }) {
  const cwd = scratch(t, 'deep-harness-48-preflight-');
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  mkdirSync(join(cwd, 'benchmarks'));
  writeFileSync(join(cwd, 'scripts/checks.mjs'), 'console.log("stub checks ran");\n');
  writeFileSync(join(cwd, 'scripts/perf.mjs'), 'console.log("stub perf ran");\n');
  writeFileSync(join(cwd, entry), `
    import { appendFileSync } from 'node:fs';
    appendFileSync(new URL('../lane-calls.jsonl', import.meta.url), JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');
    console.log('stub harness lane ran');
    await new Promise((done) => setTimeout(done, ${sleepMs}));
    process.exitCode = ${exit};
  `);
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ ...budgets, preflight: { margin: 0.5, limits: { elapsedMs: limitMs }, initialReason: 'Fixture.' }, tasks: [] }));
  writeFileSync(join(cwd, 'package.json'), '{ "private": true }');
  const { env, assertNoRealAgent } = safeEnv(cwd);
  const result = spawnSync('sh', [join(cwd, 'scripts/preflight')], { cwd, encoding: 'utf8', env, timeout: 120_000 });
  assertNoRealAgent();
  const calls = existsSync(join(cwd, 'lane-calls.jsonl')) ? readFileSync(join(cwd, 'lane-calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { ...result, calls };
}

test(`${BUDGETS} the local preflight runs the harness budgets lane as \`agent-harness.mjs budgets\`, outside the checks' time budget, and a failing lane fails it`, (t) => {
  // The lane sleeps past the checks' 2 s budget: it runs apart from them, as perf does.
  const passing = preflightCopy(t, { exit: 0, sleepMs: 2500, limitMs: 2000 });
  assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);
  assert.match(passing.stdout, /stub checks ran/);
  assert.match(passing.stdout, /stub harness lane ran/, 'the preflight shows the lane\'s output');
  assert.equal(passing.calls.length, 1, `the preflight runs the lane once: ${JSON.stringify(passing.calls)}`);
  const [{ argv }] = passing.calls;
  assert.equal(argv[0], 'budgets', `the lane is the harness's budgets command: ${JSON.stringify(argv)}`);
  for (const option of ['--claude', '--codex', '--budgets', '--changed'])
    assert.ok(!argv.some((arg) => arg === option || arg.startsWith(`${option}=`)), `the preflight runs the real lane, never with the tests' ${option}: ${JSON.stringify(argv)}`);
  const failing = preflightCopy(t, { exit: 1, sleepMs: 0, limitMs: 300_000 });
  assert.match(failing.stdout, /stub harness lane ran/);
  assert.notEqual(failing.status, 0, `a failing lane fails the preflight\n${failing.stdout}`);
});

function budgetsLane(fake, out, extra) {
  return harness(['budgets', ...agents(fake), '--out', out, ...extra], { timeout: HARNESS_MS + 60_000, env: fake.env });
}

const pairsOf = (items) => items.map(({ scenario, agent }) => `${scenario}/${agent}`).sort();

test(`${BUDGETS} under its budgets the lane passes, and the first measurement says the merge base has no harness`, { timeout: HARNESS_MS }, async (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = budgetsLane(fake, out, ['--base', BASE]);
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify(lane));
  assertBudgetStatus(lane, 'INITIAL');
  assertLaneExit(result, lane);
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  assert.deepEqual(budgets.harness?.limits, { sessionMs: SESSION_MS, wholeMs: HARNESS_MS }, 'the repo\'s harness budget holds the issue\'s 60 s and 10 minutes');
  assert.match(String(budgets.harness.initialReason), /#48/, 'the first measurement names its issue');
  assert.match(budgets.harness.initialReason, /first measurement/i);
  assert.match(budgets.harness.initialReason, /merge base/i);
  assert.equal(realpathSync(lane.budgets), realpathSync(join(root, 'benchmarks/budgets.json')), 'the lane reads the repo\'s budgets');
  assert.deepEqual(lane.limits, budgets.harness.limits);
  assert.equal(lane.baseCommit, BASE, 'the lane compares with the base it was given');
  assert.equal(lane.base, null, 'the base has no harness to measure');
  assert.equal(lane.initialReason, budgets.harness.initialReason, 'the first measurement says why it has no base');
  assert.ok(lane.touched?.includes(entry), `the harness is new since the base, so the change touches it: ${JSON.stringify(lane.touched)}`);
  assert.deepEqual(pairsOf(lane.current?.sessions ?? []), [...PAIRS].sort(), 'the lane measures every scripted session');
  for (const { scenario, agent, elapsedMs } of lane.current.sessions) assert.ok(Number.isFinite(elapsedMs) && elapsedMs > 0 && elapsedMs < SESSION_MS, `${scenario}/${agent}: ${elapsedMs} ms`);
  assert.ok(lane.current.wholeMs < HARNESS_MS && lane.current.wholeMs >= Math.max(...lane.current.sessions.map(({ elapsedMs }) => elapsedMs)), `the whole harness: ${lane.current.wholeMs} ms`);
  assert.deepEqual(lane.over, []);
  assert.deepEqual(pairsOf(result.runs), [...PAIRS].sort(), 'the lane prints each run\'s line');
  for (const run of result.runs) {
    assertRunShape(run, out);
    assert.equal(run.verdict, 'PASS', JSON.stringify(run));
  }
  assert.deepEqual(await stillRunning(fake), [], 'nothing the lane started outlives it');
});

test(`${BUDGETS} a scripted session over its budget fails the lane`, { timeout: HARNESS_MS }, async (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  // Every session takes longer than 1 ms; the whole harness keeps its 10 minutes.
  const result = budgetsLane(fake, out, ['--base', BASE, '--budgets', scaledBudgets(out, { sessionMs: 1 })]);
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify(lane));
  assert.equal(lane.limits?.sessionMs, 1, 'the lane reads the budgets it was given');
  assertBudgetStatus(lane, 'FAIL');
  assertLaneExit(result, lane);
  assert.ok(Array.isArray(lane.over) && lane.over.every(({ budget }) => budget === 'session'), `only session budgets are over: ${JSON.stringify(lane.over)}`);
  assert.deepEqual(pairsOf(lane.over), [...PAIRS].sort(), 'the lane names each session over its budget');
  for (const item of lane.over) assert.ok(item.limitMs === 1 && item.elapsedMs >= 1, JSON.stringify(item));
  assert.deepEqual(await stillRunning(fake), []);
});

test(`${BUDGETS} a whole harness over its budget fails the lane`, { timeout: HARNESS_MS }, async (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = budgetsLane(fake, out, ['--base', BASE, '--budgets', scaledBudgets(out, { sessionMs: SESSION_MS, wholeMs: 1 })]);
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify(lane));
  assert.equal(lane.limits?.wholeMs, 1, 'the lane reads the budgets it was given');
  assertBudgetStatus(lane, 'FAIL');
  assertLaneExit(result, lane);
  assert.equal(lane.over?.length, 1, `only the whole harness is over: ${JSON.stringify(lane.over)}`);
  assert.equal(lane.over[0].budget, 'whole');
  assert.ok(lane.over[0].limitMs === 1 && lane.over[0].elapsedMs === lane.current.wholeMs, JSON.stringify(lane.over[0]));
  assert.deepEqual(await stillRunning(fake), []);
});

test(`${BUDGETS} a change that doesn't touch the harness, its hook or its launch facts spends nothing`, (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  const result = budgetsLane(fake, out, ['--changed', 'docs/technical-design.md', '--changed', 'README.md']);
  const lane = onlyLane(result);
  assert.equal(lane.status, 'UNTOUCHED', show(result));
  assert.deepEqual(lane.touched, []);
  assertLaneExit(result, lane);
  assert.deepEqual(result.runs, [], 'no run starts');
  assert.deepEqual(fake.calls(), [], 'no agent binary was even asked its version');
});

test(`${BUDGETS} a change to the harness, its hook or its launch facts runs the lane against the merge base`, { timeout: HARNESS_MS }, async (t) => {
  const fake = fakeAgents(t, { obey: true });
  const out = scratch(t);
  // Find the files a run uses: its launch facts, and the hook its --settings start.
  const facts = ['claude', 'codex'].map((agent) => {
    const run = onlyRun(harness(['run', '--scenario', 'read-only-job', '--agent', agent, ...agents(fake), '--timeout-ms', '20000', '--out', out], { timeout: 60_000, env: fake.env }));
    assert.equal(typeof run.launch?.facts, 'string', `BLOCKED: the ${agent} run names no facts file: ${JSON.stringify(run)}`);
    return repoPath(run.launch.facts);
  });
  const held = onlyRun(harness(['run', '--scenario', 'held-stop', ...agents(fake), '--timeout-ms', '30000', '--out', out], { timeout: 60_000, env: fake.env }));
  assert.equal(typeof held.settings, 'string', `the held-stop run names its settings file: ${JSON.stringify(held)}`);
  const hooks = hookFiles(held.settings);
  assert.ok(hooks.length > 0, `the harness's hook is a file in the repo that its settings run: ${readFileSync(held.settings, 'utf8')}`);
  const expected = [...new Set([entry, ...facts, ...hooks])].sort();
  const before = fake.sessions().length;
  const result = budgetsLane(fake, out, [...expected, 'docs/technical-design.md', 'README.md'].flatMap((path) => ['--changed', path]));
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify(lane));
  assert.deepEqual([...(lane.touched ?? [])].sort(), expected, 'the lane names exactly the changed files that are the harness, its hook or its launch facts');
  assert.notEqual(lane.status, 'UNTOUCHED');
  assert.ok(fake.sessions().length > before, 'the lane ran the harness');
  assert.equal(lane.baseCommit, mergeBase(), 'with no --base, the lane compares with the merge base of HEAD and origin/main');
  assert.deepEqual(await stillRunning(fake), []);
});
