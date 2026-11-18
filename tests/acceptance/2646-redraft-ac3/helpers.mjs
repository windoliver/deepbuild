// Shared tools of the #2646 acceptance tests. None stands in for the code under test: every test reaches it through
// `deep hub run` and its socket, the record's file opened read-only, `@deepbuild/record` and `@deepbuild/asks` by name
// (in fixtures/, resolved from the checkout they run for), and benchmarks/budgets.json with the commands it names.
// What a criterion counts, it counts at better-sqlite3, a boundary the hub doesn't own (fixtures/preload.cjs).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
/** The checkout these tests run in: the change, or in a proof lane's run on the merge base, the merge base. */
export const REPO = resolve(HERE, '../../..');
/** A built checkout of the merge base beside the change (README: Run). */
export const BASE = process.env.DEEP_2646_BASE ? resolve(process.env.DEEP_2646_BASE) : null;
export const DAY = 86_400_000;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A prerequisite is missing: the test fails as BLOCKED, never at an assertion and never as a pass. */
export function blocked(why) {
  throw new Error(`BLOCKED: ${why}`);
}
/** The measurement can't decide here: the test fails as INCONCLUSIVE, never at an assertion and never as a pass. */
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE: ${why}`);
}
/** Fails the test as its problem says (a text starting BLOCKED or INCONCLUSIVE), when there is one. */
export function settle(problem) {
  if (problem) throw new Error(/^(BLOCKED|INCONCLUSIVE)\b/.test(problem) ? problem : `BLOCKED: ${problem}`);
}
/** A scene several tests of a file read, made on the first test's turn; it never throws: it returns { problem }. */
export function shared(make) {
  let made;
  return () => (made ??= make().catch((error) => ({ problem: /^(BLOCKED|INCONCLUSIVE)\b/.test(error?.message ?? '') ? error.message : `BLOCKED: ${error?.stack ?? error}` })));
}

/** Why a checkout can't run these tests, or null: what `npm ci && npm run build` leaves must be there. */
export function unbuilt(checkout) {
  for (const file of ['packages/cli/dist/main.js', 'packages/hub/dist/core-worker.js', 'packages/record/dist/index.js', 'packages/asks/dist/index.js', 'node_modules/better-sqlite3/package.json']) {
    if (!existsSync(join(checkout, file))) return `BLOCKED: ${checkout} is not built: it has no ${file} (run npm ci && npm run build there)`;
  }
  return null;
}
/** Why there is no merge base to compare with, or null. */
export function noBase() {
  if (!BASE) return 'BLOCKED: no merge-base checkout: set DEEP_2646_BASE to a built checkout of `git merge-base HEAD origin/main` (npm ci && npm run build there)';
  if (!existsSync(join(BASE, 'package.json'))) return `BLOCKED: DEEP_2646_BASE=${BASE} holds no checkout`;
  return unbuilt(BASE);
}

// ---- Temp folders, short and under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made = [];
export function tempDir() {
  const dir = realpathSync(mkdtempSync('/tmp/dh2646-'));
  made.push(dir);
  return dir;
}
/** A fresh home: the installed hub's root is <home>/.deepbuild. */
export function makeHome() {
  const home = join(tempDir(), 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  return { home, root: join(home, '.deepbuild'), ledger: join(home, '.deepbuild', 'ledger.db') };
}
/** Copies a record the seeder closed, with what SQLite keeps beside it. */
export function copyRecord(from, to) {
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  for (const tail of ['', '-wal', '-shm']) if (existsSync(from + tail)) copyFileSync(from + tail, to + tail);
}

// ---- Processes these tests started: stopped by PID only, never by name or port.
const owned = new Set();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function stopPid(pid, waitMs = 30_000) {
  if (!alive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + waitMs;
  while (alive(pid) && Date.now() < deadline) await sleep(50);
  if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
/** Stops what these tests started and removes their folders; each test file calls it once, after its tests. */
export async function cleanup() {
  await Promise.all([...owned].map((pid) => stopPid(pid, 10_000)));
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** This process's environment without DeepBuild's, an agent's or a billing variable, with HOME moved. */
export function childEnv(home, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|CLAUDE|CODEX|TMUX|ANTHROPIC_|OPENAI_|AWS_|GH_TOKEN$|GITHUB_TOKEN$|NODE_OPTIONS$|NODE_TEST_CONTEXT$)/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = String(value);
  return env;
}

// ---- The hub as a process: `deep hub run` under the preload (README: The surface).
const PRELOAD = join(HERE, 'fixtures/preload.cjs');
/**
 * Starts `deep hub run` of `checkout` on `home`, the preload writing to its log. `names`: the texts whose statements
 * the log keeps; `minutes`: the hub's 60,000 ms timers answer to its minutes file; `clock`: the hub's test clock
 * starts there and takes steps; `plant`: DEEP_HUB_PLANT. Resolves with the hub, or with { problem, stderr }.
 */
export async function startHub({ checkout, home, names = [], minutes = false, clock, plant, readyMs = 900_000 }) {
  const problem = unbuilt(checkout);
  if (problem) return { problem };
  const folder = dirname(home.home);
  const log = join(folder, `sql-${randomBytes(3).toString('hex')}.jsonl`);
  const minutesFile = minutes ? join(folder, `minutes-${randomBytes(3).toString('hex')}`) : undefined;
  writeFileSync(log, '');
  if (minutesFile) writeFileSync(minutesFile, '');
  const env = childEnv(home.home, {
    DEEP_2646_LOG: log, DEEP_2646_CHECKOUT: checkout, DEEP_2646_NAMES: JSON.stringify(names), DEEP_2646_MINUTES: minutesFile,
    DEEP_HUB_PLANT: plant, ...(clock === undefined ? {} : { DEEP_HUB_TEST_CLOCK: clock, DEEP_HUB_TEST_CLOCK_STEPS: '1' }),
  });
  const child = spawn(process.execPath, ['--require', PRELOAD, join(checkout, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  owned.add(child.pid);
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (text) => { stderr = (stderr + text).slice(-20_000); });
  const ready = await new Promise((done) => {
    let out = '';
    const timer = setTimeout(() => done(null), readyMs);
    child.stdout.setEncoding('utf8').on('data', (text) => {
      out += text;
      for (let at = out.indexOf('\n'); at >= 0; at = out.indexOf('\n')) {
        const line = out.slice(0, at);
        out = out.slice(at + 1);
        try {
          const parsed = JSON.parse(line);
          if (parsed?.ready === true) { clearTimeout(timer); done(parsed); return; }
        } catch { /* not the ready line */ }
      }
    });
    child.on('exit', () => { clearTimeout(timer); done(null); });
  });
  if (!ready) {
    await stopPid(child.pid, 5_000);
    return { problem: `BLOCKED: \`deep hub run\` of ${checkout} gave no ready line${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${stderr.trim().slice(-1500) || 'nothing on stderr'}`, stderr };
  }
  return { pid: child.pid, socket: ready.socket, root: home.root, ledger: home.ledger, log, minutesFile, checkout, stderr: () => stderr };
}
export async function stopHub(hub) {
  if (!hub?.pid) return;
  await stopPid(hub.pid);
  owned.delete(hub.pid);
}

// ---- The socket's line protocol (design: Hook protocol; Socket roles).
class Conn {
  constructor(sock) {
    this.sock = sock;
    this.lines = [];
    this.buffer = '';
    this.waiters = new Set();
    this.ended = false;
    this.ids = 0;
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
        const raw = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        try { this.lines.push(JSON.parse(raw)); } catch { this.lines.push({ unparsed: raw }); }
      }
      this.wake();
    });
    const end = () => { this.ended = true; this.wake(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  wake() { for (const waiter of [...this.waiters]) waiter(); }
  /** The first line from index `from` on that matches, or undefined once the connection closed or the time is up. */
  find(match, from, timeoutMs) {
    return new Promise((done) => {
      const finish = (value) => { clearTimeout(timer); this.waiters.delete(check); done(value); };
      const check = () => {
        const found = this.lines.slice(from).find(match);
        if (found || this.ended) finish(found);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      this.waiters.add(check);
      check();
    });
  }
  static async open(path, timeoutMs = 60_000) {
    const conn = new Conn(net.connect(path));
    const hello = await conn.find(() => true, 0, timeoutMs);
    if (!hello) { conn.close(); throw new Error(`BLOCKED: no hello from the hub at ${path} within ${timeoutMs} ms`); }
    return conn;
  }
  send(message) { this.sock.write(`${JSON.stringify(message)}\n`); }
  /** One method call: its result, or an Error naming the hub's refusal. */
  async call(method, params = {}, timeoutMs = 300_000) {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.send({ v: 1, id, method, params });
    const reply = await this.find((line) => line.id === id && ('result' in line || 'error' in line), from, timeoutMs);
    if (!reply) throw new Error(`BLOCKED: no reply to ${method} within ${timeoutMs} ms${this.ended ? ' (the hub closed the connection)' : ''}`);
    if ('error' in reply) throw new Error(`BLOCKED: the hub refused ${method}: ${JSON.stringify(reply.error).slice(0, 600)}`);
    return reply.result;
  }
  close() { this.sock.destroy(); }
}
/** A connection that presented the control token as `role`: `{v:1, hello, token}`. */
export async function control(hub, role = 'cli') {
  const conn = await Conn.open(hub.socket);
  conn.send({ v: 1, hello: role, token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
  const reply = await conn.find((line) => 'role' in line || 'error' in line, 1, 60_000);
  if (reply?.role !== role) { conn.close(); throw new Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(reply)}`); }
  return conn;
}
/** Every event of `kinds` after `after`, through events.read: { events, log_pos }. */
export async function eventsAfter(conn, after, kinds) {
  const events = [];
  for (;;) {
    const page = await conn.call('events.read', { after, limit: 1000, kinds });
    events.push(...page.events);
    after = page.log_pos;
    if (page.events.length < 1000) return { events, log_pos: after };
  }
}

// ---- Hooks, as deep-hook sends them (hook.request@1).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let stamped = 0n;
function ulid(ms = Date.now()) {
  let value = (BigInt(ms) << 80n) | BigInt(`0x${randomBytes(10).toString('hex')}`);
  let text = '';
  for (let i = 0; i < 26; i += 1) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
/** A Claude Code session of this test process, in a folder of its own, its transcript where the agent keeps it. */
export function newSession(home, n) {
  const id = `26460000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const cwd = join(dirname(home.home), `work-${n}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd, message: { role: 'user', content: 'start' } })}\n`);
  return { id, cwd, transcript };
}
export function hookRequest(session, event) {
  const base = { session_id: session.id, transcript_path: session.transcript, cwd: session.cwd, hook_event_name: event, permission_mode: 'default' };
  // One call ID a session: a state pass's reading of a call names it, and a new one each hook would be a text of its own.
  const payload = event === 'SessionStart' ? { ...base, source: 'startup' } : { ...base, tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${session.id.slice(-4)}` };
  stamped = (stamped + 1n) % 1_000_000n;
  return { v: 1, agent: 'claude-code', event, seq: (BigInt(Date.now()) * 1_000_000n + stamped).toString(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload };
}
/**
 * Hook requests on a connection each, as deep-hook makes one: every connection is opened and has the hub's hello
 * before the first request is written, then the requests go back to back, so one state pass can take them all.
 * Resolves once each has its reply; throws BLOCKED when one is refused or goes unanswered.
 */
export async function sendHooks(socket, requests, timeoutMs = 120_000) {
  const conns = await Promise.all(requests.map(() => Conn.open(socket)));
  try {
    for (const [i, conn] of conns.entries()) conn.send(requests[i]);
    const replies = await Promise.all(conns.map((conn) => conn.find((line) => 'exit' in line || 'error' in line, 1, timeoutMs)));
    for (const [i, reply] of replies.entries()) {
      if (!reply || 'error' in reply) throw new Error(`BLOCKED: the hub gave ${requests[i].event} of session ${requests[i].payload.session_id} ${reply ? `a refusal: ${JSON.stringify(reply).slice(0, 400)}` : `no reply within ${timeoutMs} ms`}`);
    }
  } finally {
    for (const conn of conns) conn.close();
  }
}

// ---- The preload's log.
/** Reads a hub's log as it grows: `lines` holds every line so far, `more()` takes what was written since. */
export function logOf(hub) {
  const lines = [];
  let offset = 0, rest = '';
  const more = () => {
    const fd = openSync(hub.log, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size > offset) {
        const bytes = Buffer.alloc(size - offset);
        readSync(fd, bytes, 0, bytes.length, offset);
        offset = size;
        const parts = (rest + bytes.toString('utf8')).split('\n');
        rest = parts.pop();
        for (const part of parts) if (part) lines.push(JSON.parse(part));
      }
    } finally {
      closeSync(fd);
    }
    return lines;
  };
  /** Waits until a line matches, reading every 20 ms; undefined when none did in time. */
  const until = async (match, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let from = 0;
    for (;;) {
      more();
      for (; from < lines.length; from += 1) if (match(lines[from])) return lines[from];
      if (Date.now() > deadline) return undefined;
      await sleep(20);
    }
  };
  return { lines, more, until };
}
/**
 * What a log says of the hub's threads: the core's (the one that compiles on the writable ledger), each statement's
 * text by thread and id, and why the log can't be read as the counter, or null.
 */
export function readLog(lines, hub) {
  const failed = lines.find((line) => line.t === 'failed');
  if (failed) return { problem: `BLOCKED: the preload failed in the hub's thread ${failed.thread}, so nothing was counted: ${failed.why.slice(0, 600)}` };
  const loaded = lines.filter((line) => line.t === 'loaded');
  if (!loaded.some((line) => line.pid === hub.pid)) return { problem: `BLOCKED: the preload didn't load in the hub (pid ${hub.pid}), so nothing was counted` };
  const cores = [...new Set(lines.filter((line) => line.t === 'p' && line.w).map((line) => line.thread))];
  if (cores.length !== 1) return { problem: `BLOCKED: ${cores.length} threads of the hub compiled statements on its writable ledger, so the core thread can't be told (threads ${cores.join(', ') || 'none'})` };
  const [core] = cores;
  const own = createRequire(join(hub.checkout, 'package.json')).resolve('better-sqlite3');
  if (!loaded.some((line) => line.thread === core && line.sqlite === own)) return { problem: `BLOCKED: the preload in the core thread counts another copy of better-sqlite3 than ${hub.checkout}'s (${own})` };
  const text = new Map(lines.filter((line) => line.t === 'sql' && line.thread === core).map((line) => [line.id, line.sql]));
  return { core, text, problem: null };
}

// ---- Fixture records, seeded through a checkout's own `@deepbuild/record` (fixtures/seed.mjs).
/** Seeds a record of `shape` at `path` with `checkout`'s packages: what the seeder says of it, or { problem }. */
export function seed(checkout, shape, path, at) {
  const problem = unbuilt(checkout);
  if (problem) return { problem };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const result = spawnSync(process.execPath, [join(HERE, 'fixtures/seed.mjs'), JSON.stringify({ checkout, shape, path, at })], { encoding: 'utf8', env: childEnv(dirname(path)), maxBuffer: 1 << 26, timeout: 3_600_000 });
  if (result.status !== 0) return { problem: `BLOCKED: the ${shape} record could not be seeded with ${checkout}'s @deepbuild/record (exit ${result.status ?? result.signal}): ${(result.stderr || result.error?.message || '').trim().slice(-1500)}` };
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

// ---- Instructions retired (design: Every task carries its own budgets).
let counterBuilt;
/** The reader of a live process's instructions retired, built once: { bin }, or { problem } where there is no counter. */
export function counter() {
  if (counterBuilt) return counterBuilt;
  if (process.platform !== 'darwin') return (counterBuilt = { problem: `INCONCLUSIVE: no instruction counter on ${process.platform}: the count is missing, never 0 (the perf lane counts on macOS only)` });
  const bin = join(tempDir(), 'rusage');
  try {
    execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', bin, join(HERE, 'fixtures/rusage.c')], { stdio: 'pipe' });
  } catch (error) {
    return (counterBuilt = { problem: `INCONCLUSIVE: cc could not build the instruction counter, so the count is missing: ${String(error.stderr ?? error.message).slice(0, 300)}` });
  }
  return (counterBuilt = { bin });
}
/** Instructions retired so far by a live process, or null when the kernel gives none: missing, never 0. */
export function instructionsOf(bin, pid) {
  const result = spawnSync(bin, [String(pid)], { encoding: 'utf8' });
  const count = Number(result.stdout.trim());
  return result.status === 0 && Number.isSafeInteger(count) && count > 0 ? count : null;
}
/** The perf lane's own judge and runner (scripts/benchmark.mjs), of the checkout these tests run in. */
export const benchmark = () => import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const mid = sorted.length / 2; return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2; };
/**
 * Whether the change retires at most `share` of the merge base's instructions, over alternated pairs
 * [{ current, base }], by the design's two seeded one-sided sign-flip tests: the perf lane's judgeInstructions with
 * the base scaled so its 2% line sits at `share`. PASS when "at least `share`" is rejected at p under 0.01, FAIL when
 * the pairs show it above at p under 0.01, INCONCLUSIVE otherwise or with a count missing or fewer than 20 pairs.
 */
export async function judgeShare(pairs, share) {
  const { judgeInstructions } = await benchmark();
  const valid = pairs.every((pair) => Number.isSafeInteger(pair.current) && pair.current > 0 && Number.isSafeInteger(pair.base) && pair.base > 0);
  const ratio = valid && pairs.length ? median(pairs.map((pair) => pair.current / pair.base)) : null;
  const judged = judgeInstructions(pairs.map((pair) => ({ current: pair.current, base: valid ? Math.max(1, Math.round(pair.base * share / 1.02)) : pair.base })));
  const out = { ratio, pairs, seed: judged.seed, pAbove: judged.pAbove, pBelow: judged.pBelow };
  if (ratio === null) return { status: 'INCONCLUSIVE', ...out, reason: judged.reason };
  if (judged.status === 'PASS' && pairs.length < 20) return { status: 'INCONCLUSIVE', ...out, reason: `${pairs.length} pairs, 20 required` };
  return { status: judged.status, ...out };
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label, value) {
  console.log(`PROOF #2646 ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}
