// Shared by the fast and live #48 acceptance tests: the harness's command line, its run log, its
// budgets lane, the process table and the machine. The harness is reached only through
// `node scripts/agent-harness.mjs`, and the preflight only through `scripts/preflight`.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const entry = 'scripts/agent-harness.mjs';
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
export const LANE = 'harness budgets';
export const LANE_STATUSES = ['PASS', 'INITIAL', 'FAIL', 'INCONCLUSIVE', 'BLOCKED', 'UNTOUCHED'];
export const PAIRS = ['held-stop/claude', 'idle-wake/claude', 'read-only-job/claude', 'read-only-job/codex'];
export const BASE = '1de288cb4c27b33e83f75ef854d49caaaff41088'; // has no harness
export const SESSION_MS = 60_000;
export const HARNESS_MS = 10 * 60_000;

export function scratch(t, prefix = 'deep-harness-48-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Run lines are the JSON objects on stdout that carry a `run` token; `all` adds one object with
// `summary: true`, and `budgets` one with `lane: "harness budgets"`.
export function parseLog(stdout) {
  const objects = stdout.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((value) => value && typeof value === 'object');
  return {
    runs: objects.filter((object) => typeof object.run === 'string' && object.run),
    summary: objects.find((object) => object.summary === true),
    lanes: objects.filter((object) => object.lane === LANE),
  };
}

export function harness(args, { timeout = 120_000, env = process.env } = {}) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: 'utf8', timeout, env, maxBuffer: 64 * 1024 * 1024 });
  return { ...result, wallMs: performance.now() - started, ...parseLog(result.stdout ?? '') };
}

export function startHarness(args, { env = process.env } = {}) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const closed = once(child, 'close').then(([status, signal]) => ({ status, signal, stdout, stderr, ...parseLog(stdout) }));
  return { child, closed };
}

export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

export function onlyRun(result) {
  assert.equal(result.runs.length, 1, `expected one run line\n${show(result)}`);
  return result.runs[0];
}

export function onlyLane(result) {
  assert.equal(result.lanes.length, 1, `expected one "${LANE}" line\n${show(result)}`);
  return result.lanes[0];
}

const PRICED = ['reported', 'estimated'];
const BASES = [...PRICED, 'unpriced', 'not captured'];
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;

// Usage and cost as the design reads them: a cost is reported, estimated from a named rate card,
// or unpriced; usage nobody captured reads "not captured", never $0 or 0 tokens; a priced run is
// held to a dollar cap and an unpriced one to a token cap.
export function assertCost(run) {
  const where = JSON.stringify(run);
  assert.ok(run.cost && BASES.includes(run.cost.basis), `every run prints its cost, with a basis of ${BASES.join(', ')}: ${where}`);
  if (PRICED.includes(run.cost.basis)) {
    assert.ok(typeof run.cost.usd === 'number' && Number.isFinite(run.cost.usd) && run.cost.usd >= 0, `a priced run prints its dollars: ${where}`);
    if (run.cost.basis === 'estimated') assert.ok(typeof run.cost.rateCard === 'string' && run.cost.rateCard, `an estimate names its rate card: ${where}`);
  } else {
    assert.ok(!('usd' in run.cost), `a run with no price prints no dollar figure, never $0: ${where}`);
  }
  if (run.tokens === 'not captured') {
    assert.notEqual(run.cost.basis, 'unpriced', `an unpriced run reports its tokens: ${where}`);
  } else {
    assert.ok(run.tokens && ['input', 'cached', 'output'].every((key) => count(run.tokens[key])), `tokens are counts of input, cached and output, or "not captured": ${where}`);
    assert.ok(['exact', 'estimate'].includes(run.tokens.count), `a token count says whether it is exact or an estimate: ${where}`);
    assert.ok(['turn', 'session'].includes(run.tokens.covers), `usage says whether it covers the turn or the session so far: ${where}`);
  }
  const caps = Object.keys(run.cap ?? {}).filter((key) => ['usd', 'tokens'].includes(key));
  assert.equal(caps.length, 1, `every run names one cap, in dollars or in tokens: ${where}`);
  assert.ok(positive(run.cap[caps[0]]), `the cap is a positive number: ${where}`);
  if (PRICED.includes(run.cost.basis)) assert.ok('usd' in run.cap, `a priced run is held to a dollar cap: ${where}`);
  if (run.cost.basis === 'unpriced') assert.ok('tokens' in run.cap, `a token cap stands in for an unpriced run's cost cap: ${where}`);
  if (run.cost.basis === 'not captured') assert.notEqual(run.verdict, 'PASS', `a run whose usage wasn't captured can't be held to its cap, so it never passes: ${where}`);
}

export const totalTokens = ({ input, cached, output }) => input + cached + output;

// The fields every run line carries, whatever its outcome.
export function assertRunShape(run, out) {
  assert.ok(VERDICTS.includes(run.verdict), `verdict must be one of ${VERDICTS.join(', ')}: ${JSON.stringify(run)}`);
  assertCost(run);
  assert.ok(Number.isFinite(run.elapsedMs), `every run names its elapsed time: ${JSON.stringify(run)}`);
  if (out && run.verdict !== 'BLOCKED') {
    assert.equal(typeof run.transcript, 'string', `a run that started captures its transcript: ${JSON.stringify(run)}`);
    assert.ok(realpathSync(run.transcript).startsWith(realpathSync(out)), `the transcript is kept under --out: ${run.transcript}`);
    assert.ok(statSync(run.transcript).size > 0, `the transcript is not empty: ${run.transcript}`);
  }
}

// A process counts as alive only if it still runs (not a zombie) and its command still matches,
// so a reused PID never reads as ours.
export function alive(pid, marker) {
  const result = spawnSync('ps', ['-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const line = result.stdout.trim();
  if (!line || line.startsWith('Z')) return false;
  return marker ? line.includes(marker) : true;
}

export async function gone(pids, marker, withinMs = 1000) {
  const until = Date.now() + withinMs;
  let living = pids.filter((pid) => alive(pid, marker));
  while (living.length && Date.now() < until) {
    await new Promise((done) => setTimeout(done, 50));
    living = living.filter((pid) => alive(pid, marker));
  }
  return living;
}

// Version strings a facts file names for an agent, so the fake reports one the harness covers.
// The facts files don't exist at the base commit; then the fake reports a plausible current
// version and the tests that need the facts fail on their absence.
export function coveredVersion(agent) {
  const fallback = agent === 'codex' ? '0.162.0' : '2.1.0';
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'tests', 'docs', 'brand']);
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    if (skip.has(item.name)) return [];
    const path = join(directory, item.name);
    if (item.isDirectory()) return walk(path);
    return ['.json', '.yaml', '.yml', '.toml'].includes(extname(item.name)) && statSync(path).size < 1_000_000 ? [path] : [];
  });
  for (const path of walk(root)) {
    const text = readFileSync(path, 'utf8');
    if (!text.includes('adapter.facts@1') || !text.toLowerCase().includes(agent)) continue;
    const version = text.match(/\b\d+\.\d+\.\d+\b/)?.[0];
    if (version) return version;
  }
  return fallback;
}

// An environment in which nothing the harness starts can reach a real agent or a real sign-in:
// HOME, CLAUDE_CONFIG_DIR and CODEX_HOME point into a scratch folder, SHELL is /bin/sh, and the
// first `claude` and `codex` on PATH are tripwires that record a call and exit 97.
// assertNoRealAgent fails if a tripwire ever ran; fakeAgents checks it when its test ends.
export function safeEnv(directory) {
  const homes = { HOME: join(directory, 'home'), CLAUDE_CONFIG_DIR: join(directory, 'claude-home'), CODEX_HOME: join(directory, 'codex-home') };
  const tripwire = join(directory, 'tripwire');
  for (const path of [...Object.values(homes), tripwire]) mkdirSync(path, { recursive: true });
  for (const agent of ['claude', 'codex']) {
    writeFileSync(join(tripwire, agent), `#!/bin/sh\necho "${agent} $*" >> "${join(tripwire, 'fired')}"\nexit 97\n`);
    chmodSync(join(tripwire, agent), 0o755);
  }
  const fired = join(tripwire, 'fired');
  const assertNoRealAgent = () => assert.ok(!existsSync(fired), `the harness reached an agent on PATH instead of the one it was given: ${existsSync(fired) ? readFileSync(fired, 'utf8') : ''}`);
  const env = { ...process.env, ...homes, SHELL: '/bin/sh', PATH: `${tripwire}:${process.env.PATH}` };
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE']) delete env[key];
  return { env, homes, assertNoRealAgent };
}

// A temporary bin/ with the fake agent as `claude` and `codex`. Returns its paths, the safe
// environment to run the harness in, and readers for what the fake recorded.
export function fakeAgents(t, config) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-harness-48-fake-')));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const source = readFileSync(new URL('./fixtures/fake-agent.mjs', import.meta.url), 'utf8').replace(/^#!.*\n/, `#!${process.execPath}\n`);
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  const nonce = `nonce-${process.pid}-${Date.now()}`;
  writeFileSync(join(bin, 'fake.json'), JSON.stringify({ nonce, versions: { claude: coveredVersion('claude'), codex: coveredVersion('codex') }, ...config }));
  const { env, homes, assertNoRealAgent } = safeEnv(directory);
  const calls = () => existsSync(join(bin, 'calls.jsonl'))
    ? readFileSync(join(bin, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const hooks = () => calls().filter((call) => call.hook).map(({ hook }) => ({ pid: hook.pid, marker: marker(hook.command) }));
  // Everything the fake started: its own processes, what it left behind and the hooks it ran.
  const processes = () => [...calls().filter((call) => !call.hook).map(({ pid }) => ({ pid, marker: bin })), ...hooks()];
  // Whatever the harness did, nothing the fake started outlives the test: kill by recorded PID,
  // then remove the folder that holds the record.
  t.after(() => {
    for (const { pid, marker: match } of processes()) if (alive(pid, match)) try { process.kill(pid, 'SIGKILL'); } catch {}
    try { assertNoRealAgent(); } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  return {
    bin, claude: join(bin, 'claude'), codex: join(bin, 'codex'), nonce, env, homes, calls, processes, assertNoRealAgent,
    sessions: () => calls().filter((call) => call.argv),
    spend: (sessionId) => calls().filter((call) => call.spend?.sessionId === sessionId).at(-1)?.spend,
    writes: () => calls().filter((call) => call.write).map(({ write }) => write),
  };
}

// The longest word of a hook command, usually its script's path: what `ps` still shows once `sh`
// has exec'd it.
const marker = (command) => command.split(/[\s'"]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];

export async function stillRunning(fake, withinMs = 2000) {
  const living = [];
  for (const { pid, marker: match } of fake.processes()) if ((await gone([pid], match, withinMs)).length) living.push(pid);
  return living;
}

export async function waitFor(predicate, withinMs, what) {
  const until = Date.now() + withinMs;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(`timed out after ${withinMs} ms waiting for ${what}`);
}

export function readFacts(path) {
  const absolute = isAbsolute(path) ? path : join(root, path);
  assert.ok(existsSync(absolute), `BLOCKED: the facts file the run names is missing: ${path}`);
  const text = readFileSync(absolute, 'utf8');
  assert.match(text, /adapter\.facts@1/, `the launch must come from an adapter.facts@1 file: ${path}`);
  return { absolute, text };
}

export function repoPath(path) {
  const absolute = realpathSync(isAbsolute(path) ? path : join(root, path));
  assert.ok(absolute.startsWith(`${root}/`), `${path} is not inside the repo`);
  return relative(root, absolute);
}

// Repo files the hook and status line commands of a settings file name, outside build output.
export function hookFiles(settingsPath) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const commands = [...Object.values(settings.hooks ?? {}).flat().flatMap((group) => (group.hooks ?? []).map(({ command }) => command)), settings.statusLine?.command].filter(Boolean);
  const files = new Set();
  for (const word of commands.flatMap((command) => command.split(/[\s'"=]+/))) {
    if (!word) continue;
    const path = isAbsolute(word) ? word : resolve(root, word);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const real = realpathSync(path);
    if (!real.startsWith(`${root}/`)) continue;
    const inside = relative(root, real);
    if (!/^(?:target|node_modules|dist)\//.test(inside)) files.add(inside);
  }
  return [...files];
}

// The read-only launch the design names for DeepBuild's own jobs, checked on the argv the agent got.
const bypass = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions', 'acceptEdits', '--dangerously-bypass-approvals-and-sandbox', '--full-auto', 'workspace-write', 'danger-full-access', '--yolo'];
export function assertReadOnlyLaunch(agent, argv, facts) {
  for (const flag of argv.filter((arg) => arg.startsWith('-')))
    assert.ok(facts.text.includes(flag.split('=')[0]), `launch flag ${flag} is not named in ${facts.absolute}`);
  for (const flag of bypass) assert.ok(!argv.some((arg) => arg === flag || arg.endsWith(`=${flag}`)), `a read-only job never runs with ${flag}: ${JSON.stringify(argv)}`);
  const pair = (names, value) => argv.some((arg, index) => (names.includes(arg) && argv[index + 1] === value) || names.some((name) => arg === `${name}=${value}`));
  if (agent === 'claude') {
    assert.ok(argv.includes('--strict-mcp-config'), `the job gets only the MCP servers it needs: ${JSON.stringify(argv)}`);
    assert.ok(pair(['--setting-sources'], 'user'), `the job loads none of the checkout's settings: ${JSON.stringify(argv)}`);
  } else {
    assert.ok(pair(['-s', '--sandbox'], 'read-only'), `the Codex job runs with -s read-only: ${JSON.stringify(argv)}`);
  }
}

function entries(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((raw) => {
    let object = {};
    try { object = JSON.parse(raw); } catch {}
    return { raw, assistant: object.type === 'assistant', time: Date.parse(object.timestamp) };
  });
}

// The token reaches the session only after its first reply, from outside the prompt, and the
// agent's next reply carries it. Returns how long the session sat between that reply and the
// delivery.
export function continuedWith(transcript, token) {
  assert.ok(typeof token === 'string' && token.length >= 6, `the run names the token its answer carries: ${token}`);
  const lines = entries(transcript);
  const firstReply = lines.findIndex(({ assistant }) => assistant);
  const delivered = lines.findIndex(({ assistant, raw }) => !assistant && raw.includes(token));
  assert.ok(firstReply >= 0, 'the session replied before it was held or woken');
  assert.ok(delivered > firstReply, 'the answer arrived after the first reply, not in the prompt');
  assert.ok(lines.some(({ assistant, raw }, index) => index > delivered && assistant && raw.includes(token)), 'the session continued with the answer');
  const before = lines.slice(0, delivered).filter(({ assistant }) => assistant).at(-1);
  return lines[delivered].time - before.time;
}

// ------------------------------------------------------------------ the budgets lane

// The design's two reference Macs (Numbers version 0 has to hold: The reference Macs). A machine is
// one of them only when its whole fingerprint matches, never by its model name alone: each model
// also ships with other chip bins and memory sizes, and an M3 MacBook Air with an 8-core GPU is
// still a Mac15,12. The built-in display comes with the model, so it isn't read; a closed lid would
// hide it.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', cpuCores: 12, gpuCores: 18, memory: 36 * 2 ** 30 },
  { model: 'Mac15,12', chip: 'Apple M3', cpuCores: 8, gpuCores: 10, memory: 16 * 2 ** 30 },
];

const sysctl = (name) => {
  const result = spawnSync('sysctl', ['-n', name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};

// This machine as the OS reports it, and whether a budget could count on it now. A value that
// can't be read counts as not matching, so an unknown machine or power state is never a reference.
function thisMachine() {
  let gpuCores = null;
  const displays = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8', timeout: 30_000 });
  try { gpuCores = Number(JSON.parse(displays.stdout).SPDisplaysDataType.find((gpu) => gpu.sppci_cores).sppci_cores); } catch {}
  const fingerprint = { model: sysctl('hw.model'), chip: sysctl('machdep.cpu.brand_string'), cpuCores: Number(sysctl('hw.physicalcpu')), gpuCores, memory: Number(sysctl('hw.memsize')) };
  const hardware = REFERENCE_MACS.some((reference) => Object.keys(reference).every((key) => reference[key] === fingerprint[key]));
  const battery = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
  const settings = spawnSync('pmset', ['-g'], { encoding: 'utf8' });
  const mains = battery.status === 0 && /drawing from 'AC Power'/.test(battery.stdout);
  const lowPowerOff = settings.status === 0 && settings.stdout.match(/^\s*lowpowermode\s+(\d+)/m)?.[1] === '0';
  return { model: fingerprint.model, hardware, conditions: mains && lowPowerOff };
}

export function referenceMachine() {
  const { hardware, conditions } = thisMachine();
  return { hardware, conditions };
}

// The lane's status for the machine it ran on. Off a reference Mac, or on one off mains power or in
// Low Power Mode, a budget is only a reading: the lane says reference false and why, and is
// INCONCLUSIVE whatever its numbers. On one, it is `onReference`. These tests don't read the
// thermal state, which can change during a run, so on a reference Mac the lane may still call
// itself off-reference, but only by naming the thermal state, and then it is INCONCLUSIVE too.
export function assertBudgetStatus(lane, onReference) {
  const where = JSON.stringify(lane);
  const here = thisMachine();
  assert.ok(lane.machine && typeof lane.machine.reference === 'boolean', `the lane says whether it ran on a reference Mac: ${where}`);
  assert.equal(lane.machine.model, here.model, `the lane names the model this machine reports: ${where}`);
  if (lane.machine.reference === false) assert.ok(typeof lane.machine.why === 'string' && lane.machine.why.trim(), `an off-reference lane says why: ${where}`);
  if (!here.hardware || !here.conditions) {
    const why = here.hardware ? 'is off mains power or in Low Power Mode' : 'is not one of the reference Macs';
    assert.equal(lane.machine.reference, false, `this machine ${why}, so its timings are only readings: ${where}`);
    assert.equal(lane.status, 'INCONCLUSIVE', `off the reference Macs a budget never counts, so the lane is INCONCLUSIVE: ${where}`);
  } else if (lane.machine.reference === false) {
    assert.match(lane.machine.why, /thermal/i, `on a reference Mac on mains power with Low Power Mode off, only the thermal state can make the lane off-reference: ${where}`);
    assert.equal(lane.status, 'INCONCLUSIVE', `a lane off-reference by its thermal state is INCONCLUSIVE: ${where}`);
  } else {
    assert.equal(lane.status, onReference, `on a reference Mac the lane is ${onReference}: ${where}`);
  }
}

// The lane's exit code: zero for PASS, a first measurement and an untouched change, else not.
export function assertLaneExit(result, lane) {
  if (['PASS', 'INITIAL', 'UNTOUCHED'].includes(lane.status)) assert.equal(result.status, 0, show(result));
  else assert.notEqual(result.status, 0, `a ${lane.status} lane must not pass the preflight\n${show(result)}`);
}

// A budgets file like the repo's, with the harness limits replaced, so a test can scale them.
export function scaledBudgets(directory, limits) {
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  assert.ok(budgets.harness?.limits, `BLOCKED: benchmarks/budgets.json has no harness budget: ${JSON.stringify(budgets)}`);
  budgets.harness.limits = { ...budgets.harness.limits, ...limits };
  const path = join(directory, 'budgets.json');
  writeFileSync(path, JSON.stringify(budgets, null, 2));
  return path;
}

export function mergeBase() {
  const result = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `BLOCKED: no merge base with origin/main: ${result.stderr}`);
  return result.stdout.trim();
}
