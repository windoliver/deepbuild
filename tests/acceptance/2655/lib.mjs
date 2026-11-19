// #2655 acceptance: what the five tests share. Everything here reaches the code under test from outside: a hub is
// `deep hub run` of a built checkout on a home of its own, spoken to over its socket as deep-hook and the CLI speak to
// it, and read through a preload (NODE_OPTIONS=--import, the way packages/hub/test/startup-memory.test.ts reads its load
// lists) or Node's inspector (the way benchmarks/hub-churn.mjs forces a full collection and reads a thread's heap).
// A side that is missing, unbuilt or unreadable is BLOCKED or INCONCLUSIVE, never PASS: those throw, so the test fails.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
/** The checkout under test: DEEP_2655_CHANGE, else the checkout this file is in. */
export const CHANGE = resolve(process.env.DEEP_2655_CHANGE || join(HERE, '../../..'));
/** The built merge-base checkout, DEEP_2655_BASE; undefined when it isn't given. */
export const BASE = process.env.DEEP_2655_BASE ? resolve(process.env.DEEP_2655_BASE) : undefined;
/** MB as packages/hub/test/startup-memory.test.ts reads it: 2^20 bytes. */
export const MB = 2 ** 20;
export const mb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };

const cliOf = (checkout) => join(checkout, 'packages/cli/dist/main.js');
/** Why a checkout can't be run, or undefined. */
export function unbuilt(checkout) {
  if (!existsSync(cliOf(checkout))) return `BLOCKED: ${cliOf(checkout)} is not built (npm run build --workspaces in ${checkout})`;
  if (!existsSync(join(checkout, 'packages/hub/dist/server.js'))) return `BLOCKED: ${checkout}/packages/hub/dist is not built`;
  return undefined;
}
/** The checkout under test, runnable, or a throw that says BLOCKED. */
export function needChange() {
  const why = unbuilt(CHANGE);
  if (why) throw Error(why);
  return CHANGE;
}
/** The merge base, runnable, or a throw that says BLOCKED: a comparison with a missing side never passes. */
export function needBase() {
  if (!BASE) throw Error('BLOCKED: DEEP_2655_BASE names no merge-base checkout, so nothing can be compared with the merge base. Set it to a built checkout of the merge base.');
  const why = unbuilt(BASE);
  if (why) throw Error(why);
  return BASE;
}

/** A hub's environment: this process's, less everything that would reach into the hub (as benchmarks/hub-churn.mjs drops it). */
export function hubEnv(home, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DEEP_|XDG_|CLAUDE|ANTHROPIC|OPENAI|CODEX|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS)/.test(key)));
  return { ...env, HOME: home, LC_ALL: 'C', ...extra };
}

/**
 * A PATH for a hub on `home` with stand-ins first for the tools this repo doesn't own (`gh`, `claude`, `codex`), as
 * #1338's world makes them: they say they are stand-ins and fail, so no hub here starts a real agent or reaches a forge.
 */
export function standIns(home) {
  const bin = join(home, 'stand-ins');
  mkdirSync(bin, { recursive: true });
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}`); chmodSync(join(bin, name), 0o755); };
  stub('gh', 'echo "gh: not signed in (test stand-in)" >&2\nexit 1\n');
  for (const agent of ['claude', 'codex']) stub(agent, `[ "$1 $2 $3" = "plugin list --json" ] && { echo '[]'; exit 0; }\necho "${agent}: test stand-in" >&2\nexit 1\n`);
  return `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
}

/** Every hub this process started and hasn't stopped: stopped by PID on the way out, whatever a test threw. */
const started = new Set();
process.on('exit', () => { for (const hub of started) { try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ } rmSync(hub.home, { recursive: true, force: true }); } });

/** A fresh home under /tmp (a Unix socket's path must fit in 104 bytes on macOS). */
export function tempHome(tag = 'h') {
  const home = realpathSync(mkdtempSync(`/tmp/d2655${tag}-`));
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, 'work'), { recursive: true });
  return home;
}

/**
 * `deep hub run` of `checkout` on a home of its own: resolves at its ready line (its core has started).
 * `nodeArgs` go to node before the CLI, `env` joins the hub's environment, `home` reuses a home the caller made.
 */
export async function startHub(checkout, { env = {}, nodeArgs = [], home = tempHome(), readyMs = 120_000 } = {}) {
  const why = unbuilt(checkout);
  if (why) throw Error(why);
  const root = join(home, '.deepbuild');
  const child = spawn(process.execPath, [...nodeArgs, cliOf(checkout), 'hub', 'run'], { cwd: join(home, 'work'), env: hubEnv(home, { PATH: standIns(home), ...env }), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-20_000); });
  const hub = {
    checkout, home, root, child, pid: child.pid, socket: join(root, 'hub.sock'),
    stderr: () => stderr,
    token: () => readFileSync(join(root, 'control.token'), 'utf8').trim(),
    inspectorUrl: () => /ws:\/\/\S+/.exec(stderr)?.[0],
    async stop() {
      started.delete(hub);
      if (child.exitCode === null && child.signalCode === null) {
        const gone = new Promise((done) => child.once('exit', done));
        child.kill('SIGTERM');
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 20_000);
        await gone;
        clearTimeout(timer);
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
  started.add(hub);
  try {
    const ready = await new Promise((done, fail) => {
      let buffer = '';
      const timer = setTimeout(() => fail(Error(`BLOCKED: the hub of ${checkout} printed no ready line within ${readyMs} ms: ${stderr.slice(-600)}`)), readyMs);
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const text = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          try { const line = JSON.parse(text); if (line.ready === true) { clearTimeout(timer); done(line); } } catch { /* not the ready line */ }
        }
      });
      child.once('exit', (code, signal) => { clearTimeout(timer); fail(Error(`BLOCKED: the hub of ${checkout} exited ${code ?? signal} before it was ready: ${stderr.slice(-600)}`)); });
    });
    hub.pid = ready.pid ?? child.pid;
    if (typeof ready.socket === 'string') hub.socket = ready.socket;
    return hub;
  } catch (error) {
    await hub.stop();
    throw error;
  }
}

/** A hook request line as deep-hook writes it, without its newline. `seq` and `id` are the caller's, so both sides get the same bytes. */
export function hookLine({ id, seq, event, payload, agent = 'claude-code', extra = {} }) {
  return JSON.stringify({ v: 1, agent, event, seq: String(seq), id, pid: process.pid, ppid: process.ppid, matched: [], payload, ...extra });
}
/** A Claude Code session's payload for one hook, in the hub's home. */
export function payloadOf(home, session, event, more = {}) {
  return { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(home, 'work'), hook_event_name: event, ...more };
}
/** A 26-character ID as the hooks carry: a fixed head and a counter, so a run's IDs are the same on both sides. */
export const idOf = (n) => `01K74FKZVK8Q2X5R7R${String(n).padStart(8, '0')}`;
/** A hook's seq: ns since the epoch, fixed, so an event's `ts` is the same on both sides. */
export const seqOf = (n) => 1_760_013_460_000_000_000n + BigInt(n) * 1_000_000n;

/** One connection as deep-hook makes it: reads the hello, writes the line, and resolves with every line the hub wrote after it. */
export function exchange(socket, text, timeoutMs = 120_000) {
  return new Promise((done, fail) => {
    const sock = net.connect(socket);
    let buffer = '';
    let hello;
    const lines = [];
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`the hub gave no reply to a ${text.length}-byte line within ${timeoutMs} ms (it wrote ${lines.length} lines after its hello)`)); }, timeoutMs);
    const finish = () => { clearTimeout(timer); sock.destroy(); done({ hello, lines, ack: lines.find((l) => 'ack' in l), reply: lines.find((l) => 'exit' in l), error: lines.find((l) => 'error' in l)?.error }); };
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); fail(error); });
    sock.on('close', () => { if (hello) finish(); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!hello) { hello = line; sock.write(`${text}\n`); continue; }
        lines.push(line);
        if ('exit' in line || 'error' in line) return finish();
      }
    });
  });
}

/** A control connection as the CLI's: the cli hello with the control token, then calls by ID, or raw bytes. */
export async function control(hub) {
  const sock = net.connect(hub.socket);
  let buffer = '';
  const got = [];
  const waiting = [];
  const wake = () => { for (const w of waiting.splice(0)) w(); };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { try { got.push(JSON.parse(buffer.slice(0, i))); } catch { got.push({ unparsed: buffer.slice(0, i).slice(0, 200) }); } buffer = buffer.slice(i + 1); }
    wake();
  });
  let closed = false;
  sock.on('error', () => { closed = true; wake(); });
  sock.on('close', () => { closed = true; wake(); });
  /** The first line that `match` takes, or undefined once `timeoutMs` passed or the hub closed the connection. */
  const until = async (match, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = got.findIndex(match);
      if (at >= 0) return got.splice(at, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0 || closed) return undefined;
      await new Promise((done) => { const timer = setTimeout(done, left); waiting.push(() => { clearTimeout(timer); done(); }); });
    }
  };
  if (!(await until((l) => 'hello' in l, 30_000))) throw Error('BLOCKED: the hub wrote no hello on its socket');
  sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: hub.token() })}\n`);
  const role = await until((l) => 'role' in l || 'error' in l, 30_000);
  if (!role || role.error) throw Error(`BLOCKED: the hub refused its owner's control hello: ${JSON.stringify(role)}`);
  let n = 0;
  return {
    until,
    write: (bytes) => sock.write(bytes),
    async call(method, params = {}, timeoutMs = 60_000) {
      const id = `q${++n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      const reply = await until((l) => l.id === id, timeoutMs);
      if (!reply) throw Error(`the hub gave no answer to ${method} within ${timeoutMs} ms`);
      if (reply.error) throw Error(`the hub refused ${method}: ${JSON.stringify(reply.error).slice(0, 400)}`);
      return reply.result;
    },
    close: () => sock.destroy(),
  };
}

/** Every event the record holds, read as the owner reads them. */
export async function allEvents(conn) {
  const out = [];
  for (let after = 0; ;) {
    const page = await conn.call('events.read', { after, limit: 1000 });
    if (!page.events?.length) return out;
    out.push(...page.events);
    after = page.log_pos;
  }
}
/** The record's event of `id`, once it is there (up to `timeoutMs`); undefined when it never comes. */
export async function eventOf(conn, id, timeoutMs = 60_000) {
  for (const deadline = Date.now() + timeoutMs; ;) {
    const found = (await allEvents(conn)).find((e) => e.id === id);
    if (found || Date.now() > deadline) return found;
    await sleep(100);
  }
}

/** The hub's inspector (it was started with --inspect=127.0.0.1:0), for its main thread: a full collection, and an expression's value. */
export async function inspector(hub) {
  for (const deadline = Date.now() + 30_000; !hub.inspectorUrl() && Date.now() < deadline;) await sleep(20);
  const url = hub.inspectorUrl();
  if (!url) throw Error(`BLOCKED: the hub offers no inspector, so a full collection can't be forced: ${hub.stderr().slice(-300)}`);
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(Error(`BLOCKED: the inspector at ${url} refused the connection, so a full collection can't be forced`)); });
  let n = 0;
  const waiting = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.fail(Error(`BLOCKED: ${pending.method}: ${message.error.message}`)); else pending.done(message.result);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++n;
    const timer = setTimeout(() => { waiting.delete(id); fail(Error(`BLOCKED: ${method}: the inspector gave no answer`)); }, 300_000);
    waiting.set(id, { done, fail, method, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const value = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (exceptionDetails) throw Error(`BLOCKED: ${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  return {
    value,
    /** The main thread's heap in use after two full collections; a read that isn't a positive count is missing, never 0. */
    async heap() {
      await send('HeapProfiler.collectGarbage');
      await send('HeapProfiler.collectGarbage');
      const bytes = await value('process.memoryUsage().heapUsed');
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw Error(`INCONCLUSIVE: the main thread's heap read ${bytes}`);
      return bytes;
    },
    close: () => socket.close(),
  };
}

/** A preload that appends each module a thread loads, `<thread> <url>`, to $DEEP_TEST_LOADS: startup-memory.test.ts's own. */
export function loadsPreload(dir) {
  const file = join(dir, 'loads.mjs');
  writeFileSync(file, `import { registerHooks } from 'node:module';\nimport { appendFileSync } from 'node:fs';\nimport { threadId } from 'node:worker_threads';\nregisterHooks({ load(url, context, next) { appendFileSync(process.env.DEEP_TEST_LOADS, threadId + ' ' + url + '\\n'); return next(url, context); } });\n`);
  return file;
}
/** The load list a hub wrote: each row's thread and module, a package's module named from `packages/`. */
export function loaded(log) {
  if (!existsSync(log)) throw Error(`BLOCKED: the load hook wrote no list at ${log}, so nothing can be read from it`);
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => ({ thread: l.slice(0, l.indexOf(' ')), url: l.slice(l.indexOf(' ') + 1).replace(/^.*\/packages\//, 'packages/') }));
}
