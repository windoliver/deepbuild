// How the #3262 acceptance tests drive a canvas side and a fresh hub (criterion 3; README: The surface under test).
// The side is `deep-show canvas`, the hub's long-lived canvas core: one JSON line in (`{"world": …}` or `{"call": …}`),
// one answer line out, as packages/hub/src/canvas.ts sends them. A fresh hub is `deep-show run`: one scenario in, a new
// hub plays its calls once, one reply per call out. Nothing here stands in for either: every reply compared is the
// program's own, and judge.mjs says which scenarios a fresh hub is asked and whether the replies are equal.
//
// Every process started here is stopped by PID and every folder removed. What can't run throws a plain Error starting
// BLOCKED or INCONCLUSIVE; a reply that differs is the test's to assert.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { firstDifference, freshPlan } from './judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout under test: this suite is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

const supplied = process.env.DEEP_BIN_DIR;
/** `deep-show`: from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build. */
export const SHOW_BIN = join(supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied), 'deep-show');

const blocked = (text) => Error(`BLOCKED: ${text}`);
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** How long one answer of the side, or one scenario of a fresh hub, may take before the run is stopped. */
const ANSWER_MS = 10 * 60_000;
/** Fresh hubs played side by side: each is its own process with its own scenario. */
const AT_ONCE = 4;

/**
 * Builds deep-show unless the proof run supplied it, as #2694's and #393's suites do (the environment as given, so
 * the build is the one those suites find and compiles nothing when it is fresh); BLOCKED when there is no binary.
 */
export function showBinary() {
  if (supplied === undefined) {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin deep-show failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  }
  try { accessSync(SHOW_BIN, constants.X_OK); } catch { throw blocked(`${SHOW_BIN} is missing or not executable`); }
  return SHOW_BIN;
}

/** The proof lanes stop a file at 20 minutes: what a file's sides and fresh hubs may take together, with room to stop them. */
const FILE_MS = 18 * 60_000;
const started = Date.now();

/**
 * Resolves with `promise`, or rejects INCONCLUSIVE, after `stop` has stopped what was waited for, once one answer's
 * time or what is left of the file's has passed.
 */
function within(promise, what, stop) {
  const left = Math.max(1000, Math.min(ANSWER_MS, FILE_MS - (Date.now() - started)));
  let timer;
  // deadline: only turns a side or a hub that never answers, or a file past its time, into a result that names it.
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop(); reject(Error(`INCONCLUSIVE: no ${what} within ${Math.round(left / 1000)} s (one answer's ${ANSWER_MS / 60_000} minutes, or what was left of the ${FILE_MS / 60_000} a file may take)`)); }, left); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
const stopChild = (child) => { try { if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(child.pid, 'SIGKILL'); } catch { /* it has just ended */ } };

/** Starts `deep-show canvas`: `send(line)` gives its answer line, whole; `close()` stops it by PID and waits for its end. */
function openSide() {
  const child = spawn(SHOW_BIN, ['canvas'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { value = { ok: false, code: 'bad_output', line: line.slice(0, 600) }; }
    waiting.shift()?.(value);
  });
  const ended = new Promise((done) => { child.once('exit', done); child.once('error', done); });
  const gone = () => { for (const wake of waiting.splice(0)) wake({ ok: false, code: 'canvas_core_exited', said: said.trim() }); };
  void ended.then(gone);
  return {
    send(line, what) {
      const answer = new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) return done({ ok: false, code: 'canvas_core_exited', said: said.trim() });
        waiting.push(done);
        child.stdin.write(`${JSON.stringify(line)}\n`);
      });
      return within(answer, `answer of the side to ${what}`, () => stopChild(child));
    },
    async close() { stopChild(child); await ended; },
  };
}

/** One scenario through a new hub, once (`deep-show run`): its replies, one per call. */
function freshRun(scenario, what, running) {
  const child = spawn(SHOW_BIN, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  child.once('exit', () => running.delete(child));
  let out = '', said = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-1000); });
  child.stdin.on('error', () => undefined);
  // `close`, not `exit`: every line it printed has been read by then.
  const ended = new Promise((done) => { child.once('close', (code, signal) => done(code ?? signal)); child.once('error', (error) => done(error.message)); });
  child.stdin.end(`${JSON.stringify(scenario)}\n`);
  return within(ended, `end of ${what}`, () => stopChild(child)).then((status) => {
    let answer = null;
    try { answer = JSON.parse(out.split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { /* below */ }
    if (!isObject(answer) || answer.ok !== true || !Array.isArray(answer.replies) || answer.replies.length !== scenario.calls.length) {
      throw blocked(`${what}: deep-show run gave no reply per call (exit ${String(status)}): ${out.slice(0, 600)} ${said.slice(-600)}`);
    }
    return answer.replies;
  });
}

/**
 * Plays lines on one side and compares every reply with a fresh hub's (judge.mjs `freshPlan`, `firstDifference`).
 *
 * `feed` is given `{ evidence, fresh, send }`: the side's evidence store, the fresh hub's (each a folder of its own,
 * for a feed that must put a document's assets in both), and `send(line)`, which sends one `{world}` or `{call}`
 * line, with `evidence` put in a world, and resolves with the side's answer line, so a feed can take a later call's
 * fields from an earlier reply as a session does.
 *
 * Gives `{ calls, kept, scenarios, outcomes, difference }`: the calls played, how many of them a fresh hub plays again,
 * the scenarios fresh hubs played, the count of each `outcome` among the side's replies, and the first call whose
 * reply differs (`{ n, text }`) or null. BLOCKED when the side refuses a world, when a fresh hub gives no reply per
 * call, and when the comparison doesn't report a reply this function changed itself.
 */
export async function compare(name, feed) {
  const tmp = mkdtempSync('/tmp/dh3262-');
  const evidence = join(tmp, 'side'), fresh = join(tmp, 'fresh');
  mkdirSync(evidence);
  mkdirSync(fresh);
  const side = openSide();
  const running = new Set();
  try {
    const lines = [], answers = [];
    const send = async (line) => {
      if (isObject(line.world)) {
        const world = { ...line.world, evidence };
        const set = await side.send({ world }, `the world of ${name}`);
        if (set.ok !== true) throw blocked(`${name}: the side refused the world it was sent: ${JSON.stringify(set).slice(0, 600)}`);
        lines.push({ world });
        return set;
      }
      const answer = await side.send(line, `call ${answers.length + 1} of ${name} (${String(line.call?.call)})`);
      lines.push(line);
      answers.push(answer);
      return answer;
    };
    await feed({ evidence, fresh, send });
    await side.close();

    const plan = freshPlan(lines);
    if (!plan.calls.length) throw blocked(`${name}: no call was played, so no reply was compared`);
    const scenarios = plan.scenarios.map((s) => ({ ...s, evidence: fresh }));
    const replies = new Array(scenarios.length);
    let next = 0, failed = false;
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, scenarios.length) }, async () => {
      for (let i = next++; i < scenarios.length && !failed; i = next++) {
        try { replies[i] = await freshRun(scenarios[i], `fresh hub ${i + 1} of ${scenarios.length} for ${name}`, running); } catch (error) { failed = true; throw error; }
      }
    }));
    const expected = plan.calls.map((c) => replies[c.scenario][c.reply]);
    const empty = expected.findIndex((r) => !isObject(r));
    if (empty >= 0) throw blocked(`${name}: a fresh hub gave no reply object for call ${plan.calls[empty].n}: ${JSON.stringify(expected[empty] ?? null).slice(0, 300)}`);

    const difference = firstDifference(plan, answers, expected);
    if (!difference) {
      // The comparison can fail: the same replies with one changed by this function are reported, at that call.
      const k = Math.floor(plan.calls.length / 2);
      const changed = answers.map((a, i) => (i === k ? { ...a, reply: { ...a.reply, changed_by_the_test: true } } : a));
      const seen = firstDifference(plan, changed, expected);
      if (seen?.n !== plan.calls[k].n) throw blocked(`${name}: the comparison didn't report the reply to call ${plan.calls[k].n} after this suite changed it (it reported ${JSON.stringify(seen)}), so it proves nothing`);
    }
    const outcomes = {};
    for (const a of answers) { const o = isObject(a.reply) && typeof a.reply.outcome === 'string' ? a.reply.outcome : 'none'; outcomes[o] = (outcomes[o] ?? 0) + 1; }
    return { calls: plan.calls.length, kept: plan.calls.filter((c) => c.kept).length, scenarios: scenarios.length, outcomes, difference };
  } finally {
    await side.close();
    // A fresh hub still playing when another failed: stopped by its PID, and waited for.
    await Promise.all([...running].map((child) => new Promise((done) => { child.once('exit', done); stopChild(child); if (child.exitCode !== null || child.signalCode !== null) done(); })));
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * A stand-in scenario (`deep-show run`'s grammar: the world's fields, `clock`, `calls` each with its `at`) as the
 * lines a side is sent: its world (the scenario's fields but `calls` and `clock`), then each call without the time
 * the scenario's own clock gave it, since the side plays each call at its own (README: The clock).
 */
export function linesOf(scenario) {
  const { calls, clock: _clock, ...world } = scenario;
  if (!Array.isArray(calls) || !calls.length) throw blocked('a scenario with no calls');
  return [{ world }, ...calls.map((c) => {
    const { at, arrives, ...call } = c;
    // deep_query's, geometry's, fn's and deep_kinds' `at` is what they read at, not when they arrive: it stays.
    return { call: ['deep_query', 'geometry', 'fn', 'deep_kinds'].includes(String(c.call)) && at !== undefined ? { ...call, at } : call };
  })];
}
