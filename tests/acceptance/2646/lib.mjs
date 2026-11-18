// #2646 acceptance: what the test files share. The change is this checkout; the merge base is the built checkout
// DEEP_2646_BASE names (README: Run). Each side's code runs in a process of its own: its hub is `deep hub run` of that
// checkout, and its record and asks core are loaded through that checkout's package entries (probe.mjs). Everything
// read back comes through a surface the base already has: the hub's ready line, its socket (cli hello, test.clock,
// inbox.read, hook requests as deep-hook sends them), its reads log (DEEP_HUB_TEST_READS), and the record's SQLite file
// opened read-only. A missing checkout, build, hub or count is BLOCKED or INCONCLUSIVE in the failure's message.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHANGE = resolve(HERE, '../../..');
export const BASE = process.env.DEEP_2646_BASE ? resolve(process.env.DEEP_2646_BASE) : null;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const BUILT = ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'packages/record/dist/index.js', 'packages/asks/dist/index.js'];
/** Why `checkout` can't run, or null. */
export function unbuilt(checkout) {
  if (!existsSync(checkout)) return `BLOCKED: there is no checkout at ${checkout}`;
  const missing = BUILT.filter((file) => !existsSync(join(checkout, file)));
  return missing.length ? `BLOCKED: ${checkout} is not built (${missing.join(', ')} missing); run npm ci && npm run build --workspaces there` : null;
}
/** Why the two sides can't be compared, or null. */
export function sidesProblem() {
  if (!BASE) return 'BLOCKED: set DEEP_2646_BASE to a built checkout of the merge base (git merge-base HEAD origin/main; 9ae04c6cd when this suite was written)';
  return unbuilt(BASE) ?? unbuilt(CHANGE);
}

/** The record's SQLite file, opened read-only with the library the record itself uses. */
export function sqlite(file) {
  const Database = createRequire(import.meta.url)('better-sqlite3');
  return new Database(file, { readonly: true, fileMustExist: true });
}

/** A temp folder with a short path: a hub's socket path must fit in 104 bytes on macOS. */
export const tempHome = () => realpathSync(mkdtempSync('/tmp/dh2646-'));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/** `probe.mjs <action>` in a process of its own, with `checkout`'s packages: its one JSON line. */
export function probe(checkout, action, input = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, 'probe.mjs'), action, checkout, JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr = (stderr + text).slice(-4000)));
    child.on('error', (error) => fail(Error(`BLOCKED: the probe ${action} did not start: ${error.message}`)));
    child.on('close', (code) => {
      try {
        if (code !== 0) throw Error(`exit ${code}`);
        done(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        fail(Error(`BLOCKED: the probe ${action} on ${checkout} failed (${error.message}): ${stderr.slice(-1500)}`));
      }
    });
  });
}

// ---- The hub: `deep hub run` of one checkout on a home of its own.
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
function hubEnv(home, extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C', ...extra };
}
/** Starts `checkout`'s hub on `home` and waits for its ready line; `nodeArgs` go to node before the CLI. */
export async function startHub(checkout, home, env = {}, nodeArgs = []) {
  mkdirSync(join(home, 'work'), { recursive: true });
  const child = spawn(process.execPath, [...nodeArgs, join(checkout, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: checkout, env: hubEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output = (output + text).slice(-20_000)));
  const ready = await new Promise((done) => {
    let first = '';
    const timer = setTimeout(() => done(null), 300_000);
    child.stdout.setEncoding('utf8').on('data', (text) => {
      first += text;
      if (!first.includes('\n')) return;
      clearTimeout(timer);
      try {
        done(JSON.parse(first.split('\n')[0]));
      } catch {
        done(null);
      }
    });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('exit', () => { clearTimeout(timer); done(null); });
  });
  const hub = { child, pid: ready?.pid ?? child.pid, home, root: join(home, '.deepbuild'), socket: ready?.socket ?? join(home, '.deepbuild', 'hub.sock'), output: () => output };
  if (ready?.ready !== true) {
    await stopHub(hub);
    throw Error(`BLOCKED: the hub of ${checkout} didn't start: ${output.slice(-1500) || 'it printed no ready line'}`);
  }
  return hub;
}
/** Stops the hub this test started, by its PIDs, and waits for it to go. */
export async function stopHub(hub) {
  const gone = hub.child.exitCode !== null || hub.child.signalCode !== null ? Promise.resolve() : new Promise((done) => hub.child.once('exit', done));
  for (const pid of new Set([hub.child.pid, hub.pid])) {
    try {
      if (pid) process.kill(pid, 'SIGTERM');
    } catch { /* gone already */ }
  }
  await Promise.race([gone, sleep(20_000)]);
  if (hub.child.exitCode === null && hub.child.signalCode === null) hub.child.kill('SIGKILL');
}

/** One connection of the hub's line protocol: `write` a line, `next` the first unread line that matches. */
function connect(socket) {
  const sock = net.connect(socket);
  const got = [], wakers = new Set();
  let buffer = '', read = 0, ended = null;
  const wake = () => { for (const waker of [...wakers]) waker(); };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const text = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        got.push(JSON.parse(text));
      } catch { /* no line of the protocol */ }
    }
    wake();
  });
  sock.on('error', (error) => { ended ??= error.message; wake(); });
  sock.on('close', () => { ended ??= 'the hub closed the connection'; wake(); });
  return {
    write: (line) => sock.write(`${JSON.stringify(line)}\n`),
    close: () => sock.destroy(),
    next: (match, ms, what) => new Promise((done, fail) => {
      const settle = (act, value) => { clearTimeout(timer); wakers.delete(check); act(value); };
      const check = () => {
        for (; read < got.length; read++) if (match(got[read])) return settle(done, got[read++]);
        if (ended) settle(fail, Error(`BLOCKED: no ${what}: ${ended}`));
      };
      const timer = setTimeout(() => settle(fail, Error(`BLOCKED: no ${what} within ${ms / 1000} s`)), ms);
      wakers.add(check);
      check();
    }),
  };
}
/** A cli connection with the control token: `use` gets `call(method, params)`, which gives the result. */
export async function control(hub, use) {
  const conn = connect(hub.socket);
  try {
    await conn.next(() => true, 30_000, 'hello from the hub');
    conn.write({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
    const role = await conn.next((line) => 'role' in line || 'error' in line, 30_000, 'reply to the cli hello');
    if (role.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(role)}`);
    let calls = 0;
    return await use(async (method, params = {}) => {
      const id = `${method}#${++calls}`;
      conn.write({ v: 1, id, method, params });
      const reply = await conn.next((line) => line.id === id && ('result' in line || 'error' in line), 300_000, `reply to ${method}`);
      if ('error' in reply) throw Error(`BLOCKED: the hub refused ${method}: ${JSON.stringify(reply.error)}`);
      return reply.result;
    });
  } finally {
    conn.close();
  }
}
/** Returns once no state pass is under way or due: inbox.read waits for that before it answers. */
export const settled = (hub) => control(hub, (call) => call('inbox.read'));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID at `ms` whose random part is `n`. */
export function ulid(ms, n) {
  let text = '', value = (BigInt(ms) << 80n) | BigInt(n);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
let sent = 0;
/** One hook as deep-hook sends it for Claude Code: hello, the request, its reply line. */
export async function hook(hub, session, event, fields = {}) {
  const now = Date.now(), n = ++sent;
  const payload = { session_id: session, transcript_path: join(hub.home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(hub.home, 'work'), hook_event_name: event, ...fields };
  const request = { v: 1, agent: 'claude-code', event, seq: `${BigInt(now) * 1_000_000n + BigInt(n)}`, id: ulid(now, n), pid: process.pid, ppid: process.ppid, matched: [], payload };
  const conn = connect(hub.socket);
  try {
    await conn.next((line) => 'hello' in line, 30_000, 'hello from the hub');
    conn.write(request);
    const reply = await conn.next((line) => 'exit' in line || 'error' in line, 120_000, `reply to ${event}`);
    if ('error' in reply) throw Error(`BLOCKED: the hub refused ${event}: ${JSON.stringify(reply).slice(0, 300)}`);
    return reply;
  } finally {
    conn.close();
  }
}

// ---- The reads log (DEEP_HUB_TEST_READS): one JSON line per read the core's record served.
/** The log's lines so far; a line still being written is left for the next read. */
export function readsOf(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}
/** The log's new whole lines at each call, from where the last call stopped. */
export function follow(file) {
  let offset = 0, rest = '';
  return () => {
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    if (size <= offset) return [];
    const buffer = Buffer.alloc(size - offset), fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, offset);
    } finally {
      closeSync(fd);
    }
    offset = size;
    const lines = (rest + buffer.toString('utf8')).split('\n');
    rest = lines.pop();
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  };
}
/** A raw read's SQL and bound values: the log writes the values after the SQL as ` -- [..]` when it has some. */
export function rawOf(entry) {
  const text = String(entry.query), at = text.lastIndexOf(' -- [');
  if (at >= 0) {
    try {
      const params = JSON.parse(text.slice(at + 4));
      if (Array.isArray(params)) return { sql: text.slice(0, at), params };
    } catch { /* the SQL's own text */ }
  }
  return { sql: text, params: [] };
}
/** Polls `read` until it gives something, or fails with `problem` after `ms`. */
export async function until(read, ms, problem) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw Error(typeof problem === 'function' ? problem() : problem);
    await sleep(25);
  }
}

// ---- Instructions retired (macOS): rusage.c, built once per run into a temp folder.
let built;
/** { bin }, or { blocked } saying why this host can't count. */
export function counter() {
  if (built) return built;
  if (process.platform !== 'darwin') return (built = { blocked: `INCONCLUSIVE: no instruction counter on ${process.platform}; instructions retired are counted on macOS only` });
  const dir = mkdtempSync(join(tmpdir(), 'deep-2646-rusage-'));
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  try {
    execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(dir, 'rusage'), join(HERE, 'rusage.c')], { stdio: 'pipe' });
  } catch (error) {
    return (built = { blocked: `INCONCLUSIVE: cc could not build rusage.c, so no instructions can be counted: ${String(error.stderr ?? error.message).slice(0, 300)}` });
  }
  const bin = join(dir, 'rusage');
  const own = spawnSync(bin, [String(process.pid)], { encoding: 'utf8' });
  if (own.status !== 0 || !(Number(own.stdout) > 0)) return (built = { blocked: `INCONCLUSIVE: this host gives no instruction count (rusage exited ${own.status})` });
  return (built = { bin });
}

// ---- Judging paired instruction counts the way the design does (Every task carries its own budgets).
const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
function words(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    const h = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
    const k = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (k ^ (k >>> 16)) >>> 0;
  };
}
/**
 * "At most `share` of the merge base's instructions", over alternated pairs { base, change }: FAIL when the median
 * pair is above the share, PASS when a seeded one-sided sign-flip test over 10,000 flips also rejects "above the share"
 * at p under 0.01 on 20 pairs or more, and INCONCLUSIVE otherwise, as with a missing count.
 */
export function judgeShare(pairs, share, seed = 2646) {
  const counted = (n) => Number.isSafeInteger(n) && n > 0;
  if (!pairs.length || pairs.some((p) => !counted(p.base) || !counted(p.change))) return { status: 'INCONCLUSIVE', reason: 'instructions retired are missing in a pair, or none were measured', pairs };
  const ratio = median(pairs.map((p) => p.change / p.base));
  const shifted = pairs.map((p) => Math.log(p.change / (p.base * share)));
  const observed = shifted.reduce((a, b) => a + b, 0), tolerance = 1e-9 * shifted.reduce((a, b) => a + Math.abs(b), 0);
  const next = words(seed);
  let below = 1;
  for (let flip = 0; flip < 10_000; flip++) {
    let total = 0, bits = 0;
    for (let i = 0; i < shifted.length; i++) {
      if (i % 32 === 0) bits = next();
      total += (bits >>> (i % 32)) & 1 ? shifted[i] : -shifted[i];
    }
    if (total <= observed + tolerance) below++;
  }
  const pBelow = below / 10_001, out = { ratio, pBelow, seed, pairs };
  const read = `the change retired ${(ratio * 100).toFixed(2)}% of the merge base's instructions (median of ${pairs.length} pairs)`;
  if (ratio > share) return { status: 'FAIL', reason: `${read}; at most ${(share * 100).toFixed(0)}% is required`, ...out };
  if (pBelow >= 0.01) return { status: 'INCONCLUSIVE', reason: `${read}, and the pairs can't tell it from ${(share * 100).toFixed(0)}% at p under 0.01 (p ${pBelow.toPrecision(2)}, seed ${seed})`, ...out };
  if (pairs.length < 20) return { status: 'INCONCLUSIVE', reason: `${pairs.length} pairs; 20 are required`, ...out };
  return { status: 'PASS', ...out };
}
