// #2651 AC2 (redraft): what the test file shares. Everything goes through surfaces the base already has: `deep hub run`
// of this checkout on a home of its own, its ready line, its socket (the cli hello with the control token, job.submit,
// job.list, hook requests as deep-hook sends them), and the kernel's count of the hub process's instructions retired
// (proc_pid_rusage, read by rusage.c, as the perf lane's counter reads a process). A hub is stopped by its PID only.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = resolve(HERE, '../../..');
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const BUILT = ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'target/debug/deep-hook'];
/** Why this checkout can't run a hub, or null. */
export function unbuilt() {
  const missing = BUILT.filter((file) => !existsSync(join(REPO, file)));
  return missing.length ? `BLOCKED: ${REPO} is not built (${missing.join(', ')} missing); run npm ci, npm run build --workspaces --if-present and cargo build -p deep-hook there` : null;
}

/** A temp folder with a short path: a hub's socket path must fit in 104 bytes on macOS. */
export const tempHome = () => realpathSync(mkdtempSync('/tmp/dh2651a2-'));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

// ---- The hub: `deep hub run` of this checkout on a home of its own.
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
function hubEnv(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C' };
}
/** Starts this checkout's hub on `home` and waits for its ready line; `nodeArgs` go to node before the CLI. */
export async function startHub(home, nodeArgs = []) {
  mkdirSync(join(home, 'work'), { recursive: true });
  const child = spawn(process.execPath, [...nodeArgs, join(REPO, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: REPO, env: hubEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
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
    throw Error(`BLOCKED: the hub didn't start on ${home}: ${output.slice(-1500) || 'it printed no ready line'}`);
  }
  return hub;
}
/** Stops a hub this test started, by its PIDs, and waits for it to go. */
export async function stopHub(hub) {
  const gone = hub.child.exitCode !== null || hub.child.signalCode !== null ? Promise.resolve() : new Promise((done) => hub.child.once('exit', done));
  for (const pid of new Set([hub.child.pid, hub.pid])) {
    try {
      if (pid) process.kill(pid, 'SIGTERM');
    } catch { /* gone already */ }
  }
  await Promise.race([gone, sleep(30_000)]);
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
    /** Takes the first unread line that matches; lines skipped stay readable by a later `next` with another match. */
    next: (match, ms, what) => new Promise((done, fail) => {
      const settle = (act, value) => { clearTimeout(timer); wakers.delete(check); act(value); };
      const check = () => {
        for (let i = read; i < got.length; i++) {
          if (got[i] !== undefined && match(got[i])) {
            const line = got[i];
            got[i] = undefined;
            while (read < got.length && got[read] === undefined) read++;
            return settle(done, line);
          }
        }
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
    await conn.next(() => true, 60_000, 'hello from the hub');
    conn.write({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
    const role = await conn.next((line) => 'role' in line || 'error' in line, 60_000, 'reply to the cli hello');
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

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID at `ms` whose random part is `n`. */
export function ulid(ms, n) {
  let text = '', value = (BigInt(ms) << 80n) | BigInt(n);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
let sent = 0;
/** One hook as deep-hook sends it for Claude Code: one connection, the request, its reply line. */
export async function hook(hub, session, event, fields = {}) {
  const now = Date.now(), n = ++sent;
  const payload = { session_id: session, transcript_path: join(hub.home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(hub.home, 'work'), hook_event_name: event, ...fields };
  const request = { v: 1, agent: 'claude-code', event, seq: `${BigInt(now) * 1_000_000n + BigInt(n % 1_000_000)}`, id: ulid(now, n), pid: process.pid, ppid: process.ppid, matched: [], payload };
  const conn = connect(hub.socket);
  try {
    await conn.next((line) => 'hello' in line, 60_000, 'hello from the hub');
    conn.write(request);
    const reply = await conn.next((line) => 'exit' in line || 'error' in line, 120_000, `reply to ${event}`);
    if ('error' in reply) throw Error(`BLOCKED: the hub refused ${event}: ${JSON.stringify(reply).slice(0, 300)}`);
    return reply;
  } finally {
    conn.close();
  }
}

// ---- Instructions retired (macOS): rusage.c, built once per run into a temp folder.
let built;
/** { bin }, or { blocked } saying why this host can't count. */
export function counter() {
  if (built) return built;
  if (process.platform !== 'darwin') return (built = { blocked: `INCONCLUSIVE: no instruction counter on ${process.platform}; the hub's instructions retired are counted on macOS only` });
  const dir = mkdtempSync(join(tmpdir(), 'deep-2651a2-rusage-'));
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
/** The instructions each PID's own threads have retired so far, read in one call; null for a count the kernel didn't give. */
export function retired(pids) {
  const { bin } = counter();
  const out = spawnSync(bin, pids.map(String), { encoding: 'utf8' });
  if (out.status !== 0) return pids.map(() => null);
  const counts = out.stdout.trim().split('\n').map(Number);
  return pids.map((_, i) => (Number.isSafeInteger(counts[i]) && counts[i] > 0 ? counts[i] : null));
}

export const median = (values) => {
  const s = [...values].sort((a, b) => a - b), m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

// ---- The measurement (README: Measurement).
/**
 * Hooks a reading counts, one after another; readings a side takes in each round; and how many of a side's readings a
 * round leaves out, its highest. The hub's own timers do work in bursts of up to some 10^8 instructions that no hook
 * asked for, and one that lands in a reading lifts it alone, never lowers it; work a hook costs is in every reading.
 * So a side's round count is the mean, per hook, of its 14 lowest readings of 20: 1,400 counted PreToolUse hooks.
 * Measured here under load: a single reading of 200 hooks moves about ±8% from the next; a round's count, about ±2%.
 */
export const BATCH = 100, READINGS = 20, HIGHEST_LEFT_OUT = 6;
/** Uncounted PreToolUse hooks (each with its PostToolUse) a reading's fresh session takes before the counted ones, past its first-call work. */
const OPENING = 10;
/** Returns once no state pass is under way or due on `hub`: inbox.read waits for that before it answers. */
export const settled = (hub) => control(hub, (call) => call('inbox.read'));
let calls = 0, sessions = 0;
const call = (id) => ({ tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: id });
/** A PreToolUse of `session`; returns its call's ID, for its PostToolUse. */
export async function preToolUse(hub, session) {
  const id = `toolu_2651a2_${++calls}`;
  await hook(hub, session, 'PreToolUse', call(id));
  return id;
}
/** The PostToolUse that ends the call `id`, as the agent sends it once the tool has run. */
export const postToolUse = (hub, session, id) => hook(hub, session, 'PostToolUse', { ...call(id), tool_response: { stdout: 'a\nb\n', stderr: '', interrupted: false } });
/** A Claude Code session of the user's own (no job's) on `hub`, past its opening calls. */
export async function session(hub, id) {
  await hook(hub, id, 'SessionStart', { source: 'startup' });
  for (let i = 0; i < OPENING; i++) await postToolUse(hub, id, await preToolUse(hub, id));
}
export const sessionId = (n) => `a2651a20-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * One reading of `hub` in `id`'s session: the hub's own instructions retired over BATCH PreToolUse hooks, each on a
 * connection of its own as deep-hook sends it, from a settled hub to a settled hub. Then, uncounted, each call's
 * PostToolUse, so no reading inherits calls left open. { instructions, hooks }, instructions null when a count is missing.
 */
export async function reading(hub, id) {
  await settled(hub);
  const [before] = retired([hub.pid]);
  const ids = [];
  for (let i = 0; i < BATCH; i++) ids.push(await preToolUse(hub, id));
  await settled(hub);
  const [after] = retired([hub.pid]);
  for (const call of ids) await postToolUse(hub, id, call);
  return { instructions: before === null || after === null || after <= before ? null : after - before, hooks: BATCH };
}

/**
 * `count` alternated rounds over two hubs, `current` and `base`. In each, READINGS readings a side, each in a session
 * of its own started on both hubs alike, in an order that swaps each round and each reading (ABBAABBA…, then
 * BAABBAAB…), so a hub's drift and the machine's load fall on both. A side's round count is the mean per hook of its
 * readings less its HIGHEST_LEFT_OUT highest, rounded; null when any count is missing. Returns [{ current, base, readings }] in round order.
 */
export async function rounds(count, current, base) {
  const hubs = { current, base }, pairs = [];
  for (let round = 0; round < count; round++) {
    const first = round % 2 ? ['base', 'current'] : ['current', 'base'];
    const got = { current: [], base: [] };
    for (let r = 0; r < READINGS; r++) {
      const id = sessionId(++sessions);
      for (const side of r % 2 ? [...first].reverse() : first) {
        await session(hubs[side], id);
        got[side].push(await reading(hubs[side], id));
      }
    }
    const of = (side) => {
      const all = got[side];
      if (all.some((g) => g.instructions === null)) return null;
      const kept = all.map((g) => g.instructions / g.hooks).sort((a, b) => a - b).slice(0, all.length - HIGHEST_LEFT_OUT);
      return Math.round(kept.reduce((sum, n) => sum + n, 0) / kept.length);
    };
    pairs.push({ current: of('current'), base: of('base'), readings: { current: got.current.map((g) => g.instructions && g.instructions / g.hooks), base: got.base.map((g) => g.instructions && g.instructions / g.hooks) } });
  }
  return pairs;
}
