// #1868 acceptance: what the test files share. Every program under test is this checkout's: its hub is `deep hub run`,
// its record and asks core are loaded through their package entries in a process of their own (probe.mjs), and its
// `deep mcp` runs under an agent stand-in (agent.mjs). Everything read back comes through a surface the base already
// has: the hub's ready line, its socket (the app's and the CLI's hellos with the control token, canvas.user,
// events.read, ask.answer), hooks as deep-hook sends them, and deep_show, deep_query and deep_status through
// `deep mcp`. A missing build, a hub that doesn't start or a fixture that doesn't read as seeded is BLOCKED, and a
// timing off the reference Macs or under load is INCONCLUSIVE, at the head of the failure's message. None passes.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHECKOUT = resolve(HERE, '../../..');
const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
export const ms = (value) => `${value.toFixed(value < 10 ? 2 : 1)} ms`;

const BUILT = ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'packages/record/dist/index.js', 'packages/asks/dist/index.js'];
/** Why this checkout can't run, or null. `canvas` asks for the canvas core's binary too. */
export function unbuilt({ canvas = false } = {}) {
  const missing = BUILT.filter((file) => !existsSync(join(CHECKOUT, file)));
  if (missing.length) return `BLOCKED: this checkout is not built (${missing.join(', ')} missing); run npm ci && npm run build --workspaces`;
  if (!['release', 'debug'].some((profile) => existsSync(join(CHECKOUT, 'target', profile, 'deep-hook')))) return 'BLOCKED: no deep-hook is built under target/; run cargo build -p deep-hook';
  if (canvas && !['release', 'debug'].some((profile) => existsSync(join(CHECKOUT, 'target', profile, 'deep-show')))) return 'BLOCKED: no canvas core is built under target/; run cargo build --bin deep-show';
  return null;
}

/** A temp folder with a short path: a hub's socket path must fit in 104 bytes on macOS. */
export const tempHome = () => realpathSync(mkdtempSync('/tmp/dh1868-'));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/** `probe.mjs <action>` in a process of its own, with this checkout's packages: its one JSON line. */
export function probe(action, input = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, 'probe.mjs'), action, CHECKOUT, JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr = (stderr + text).slice(-4000)));
    child.on('error', (error) => fail(Error(`BLOCKED: the probe ${action} did not start: ${error.message}`)));
    child.on('close', (code) => {
      try {
        if (code !== 0) throw Error(`exit ${code}`);
        done(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        fail(Error(`BLOCKED: the probe ${action} failed (${error.message}): ${stderr.slice(-1500)}`));
      }
    });
  });
}

// ---- A worktree: a git repo of its own (never this checkout) with the repo's spec, as #26's suite makes one.
const SPEC = ['claims:', '  done:', '    checks: [unit, lint]', 'checks:', '  unit: { type: command, run: "false" }', '  lint: { type: command, run: "false" }', 'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }', '  fallback: [change-owner]', ''].join('\n');
export function makeWorktree(home) {
  const dir = join(home, 'work');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), SPEC);
  writeFileSync(join(dir, 'README.md'), 'A fixture repo.\n');
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- The hub: `deep hub run` of this checkout on a home of its own.
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** This environment with HOME moved to the test's home and none of the hub's settings, plus `extra`. */
export function childEnv(home, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') ||key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
/** Starts the hub on `home` and waits for its ready line. Its OS confirmation is #24's stub, always `confirmed`. */
export async function startHub(home, env = {}) {
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: CHECKOUT, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, ...env }), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output = (output + text).slice(-20_000)));
  const ready = await new Promise((done) => {
    let first = '';
    const timer = setTimeout(() => done(null), 420_000);
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
    throw Error(`BLOCKED: the hub didn't start: ${output.slice(-1500) || 'it printed no ready line'}`);
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
        got.push({ line: JSON.parse(text), at: performance.now() });
      } catch { /* no line of the protocol */ }
    }
    wake();
  });
  sock.on('error', (error) => { ended ??= error.message; wake(); });
  sock.on('close', () => { ended ??= 'the hub closed the connection'; wake(); });
  return {
    write: (line) => sock.write(`${JSON.stringify(line)}\n`),
    close: () => sock.destroy(),
    next: (match, wait, what) => new Promise((done, fail) => {
      const settle = (act, value) => { clearTimeout(timer); wakers.delete(check); act(value); };
      const check = () => {
        for (; read < got.length; read++) if (match(got[read].line)) return settle(done, got[read++]);
        if (ended) settle(fail, Error(`BLOCKED: no ${what}: ${ended}`));
      };
      const timer = setTimeout(() => settle(fail, Error(`BLOCKED: no ${what} within ${wait / 1000} s`)), wait);
      wakers.add(check);
      check();
    }),
  };
}
/**
 * A connection as `role` ('app' or 'cli') with the control token: `use` gets `call(method, params)`, which gives
 * { result, ms } or, for a refusal, { error, ms }; `ms` runs from the request written to its reply read.
 */
export async function as(hub, role, use) {
  const conn = connect(hub.socket);
  try {
    await conn.next(() => true, 60_000, 'hello from the hub');
    conn.write({ v: 1, hello: role, token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
    const answer = (await conn.next((line) => 'role' in line || 'error' in line, 60_000, `reply to the ${role} hello`)).line;
    if (answer.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(answer)}`);
    let calls = 0;
    return await use(async (method, params = {}) => {
      const id = `${method}#${++calls}`, t0 = performance.now();
      conn.write({ v: 1, id, method, params });
      const reply = await conn.next((line) => line.id === id && ('result' in line || 'error' in line), 420_000, `reply to ${method}`);
      return 'error' in reply.line ? { error: reply.line.error, ms: reply.at - t0 } : { result: reply.line.result, ms: reply.at - t0 };
    });
  } finally {
    conn.close();
  }
}
/** A call's result; a refusal is BLOCKED, naming it. */
export function resultOf(reply, what) {
  if (reply.error) throw Error(`BLOCKED: the hub refused ${what}: ${JSON.stringify(reply.error).slice(0, 600)}`);
  return reply.result;
}

// ---- The agent stand-in: its hooks make a session, and its `deep mcp` binds to it.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
/** A ULID at `at` whose random part is counted in this process. */
export function ulid(at = Date.now()) {
  let text = '', value = (BigInt(at) << 80n) | (BigInt(process.pid) << 32n) | BigInt(++minted);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
export class Agent {
  #n = 0;
  #rpc = 0;
  #pending = new Map();
  #seq = BigInt(Date.now()) * 1_000_000n;
  #schemas;
  constructor(hub, cwd, session) {
    this.hub = hub;
    this.cwd = cwd;
    this.session = session;
    this.transcript = join(hub.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    if (!existsSync(this.transcript)) writeFileSync(this.transcript, `${JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: 'start' } })}\n`);
    this.child = spawn(process.execPath, [join(HERE, 'agent.mjs')], { cwd, env: childEnv(hub.home), stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.on('exit', () => { for (const [n, done] of [...this.#pending]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    this.child.stdout.setEncoding('utf8').on('data', (text) => {
      buffer += text;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, at)); } catch { line = null; }
        buffer = buffer.slice(at + 1);
        if (line && typeof line.n === 'number') this.#pending.get(line.n)?.(line);
      }
    });
  }
  #send(command, wait = 440_000) {
    const n = ++this.#n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.#pending.delete(n); fail(Error(`BLOCKED: the agent stand-in gave no answer to ${command.op} in ${wait / 1000} s`)); }, wait);
      this.#pending.set(n, (line) => {
        clearTimeout(timer);
        this.#pending.delete(n);
        if (line.failed) fail(Error(`BLOCKED: the agent stand-in failed ${command.op}: ${line.failed}`));
        else done(line);
      });
      this.child.stdin.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One Claude Code hook of the session, from a child of the stand-in; BLOCKED unless the hub acknowledged it. */
  async hook(event, extra = {}) {
    const payload = { session_id: this.session, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'fix the login page', prompt_id: `prompt-${ulid()}` });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${ulid()}` });
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.#seq += 1000n), id: ulid(), matched: [], payload: { ...payload, ...extra } };
    const answer = await this.#send({ op: 'hook', socket: this.hub.socket, request, cwd: this.cwd });
    if (!(answer.lines ?? []).some((line) => /"ack"/.test(line))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${this.session}: ${JSON.stringify(answer).slice(0, 600)}`);
  }
  /** The session's start, a prompt and a first tool call, each from a hook process the stand-in started, so the hub knows its process. */
  async begin() {
    await this.hook('SessionStart');
    await this.hook('UserPromptSubmit');
    await this.hook('PreToolUse');
  }
  /** The session begun, then its `deep mcp`, initialized, with the tools it lists. */
  async establish() {
    await this.begin();
    const started = await this.#rpcCall('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1868', version: '0' } });
    if (!started.reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(started.reply).slice(0, 600)}`);
    await this.#send({ op: 'mcp', argv: [process.execPath, CLI, 'mcp'], line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
    const listed = await this.#rpcCall('tools/list', {});
    if (!Array.isArray(listed.reply.result?.tools)) throw Error(`BLOCKED: deep mcp listed no tools: ${JSON.stringify(listed.reply).slice(0, 600)}`);
    this.#schemas = new Map(listed.reply.result.tools.map((tool) => [tool.name, tool.inputSchema]));
  }
  #rpcCall(method, params, wait = 420_000) {
    return this.#send({ op: 'mcp', argv: [process.execPath, CLI, 'mcp'], line: { jsonrpc: '2.0', id: `${method}#${++this.#rpc}`, method, params }, timeoutMs: wait }, wait + 10_000);
  }
  /**
   * One deep_* tool call through the session's `deep mcp`: { value, isError, ms }. A field the call leaves out goes as
   * null, and an object goes as its JSON text where the tool's schema types the field as a string (#26's strict schemas).
   */
  async tool(name, given = {}) {
    const schema = this.#schemas.get(name);
    if (!schema) throw Error(`BLOCKED: deep mcp lists no tool ${name}`);
    const args = {};
    for (const [key, spec] of Object.entries(schema.properties ?? {})) {
      const types = [spec.type ?? []].flat(), value = given[key];
      const object = typeof value === 'object' && value !== null && !Array.isArray(value);
      args[key] = value === undefined ? null : object && types.includes('string') && !types.includes('object') ? JSON.stringify(value) : value;
    }
    const { reply, ms: took } = await this.#rpcCall('tools/call', { name, arguments: args });
    if (reply.error) throw Error(`BLOCKED: deep mcp answered ${name} with a JSON-RPC error: ${JSON.stringify(reply.error).slice(0, 600)}`);
    const result = reply.result ?? {};
    const text = Array.isArray(result.content) ? result.content.find((block) => block?.type === 'text')?.text : undefined;
    let value = result.structuredContent;
    if (value === undefined && typeof text === 'string') { try { value = JSON.parse(text); } catch { value = text; } }
    return { value, isError: result.isError === true, ms: took };
  }
  /** Ends the stand-in and its `deep mcp`, by its PID. */
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const gone = new Promise((done) => this.child.once('exit', done));
    this.child.stdin.end();
    await Promise.race([gone, sleep(5000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}

// ---- A timing, judged as the design judges one (Numbers version 0 has to hold: Every task carries its own budgets,
// The reference Macs), by the repo's own rule, scripts/benchmark.mjs's judgeLimit: five runs after a warm-up; PASS when
// all five are within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and the five
// runs' spread), anything else INCONCLUSIVE; and INCONCLUSIVE off the reference Macs, off mains power, in Low Power
// Mode, with the thermal state not nominal, or at a load above the cores at a run's start or end.
export const RUNS = 5;
/**
 * `RUNS` runs of each side after one warm-up run of each, the sides alternating and swapping which goes first. A run is
 * the median of `calls` consecutive calls' times in ms. Returns each side's runs and the measured side's loads.
 */
export async function timeSides(reference, measured, calls) {
  const run = async (call) => { const times = []; for (let i = 0; i < calls; i++) times.push(await call()); return median(times); };
  await run(reference);
  await run(measured);
  const out = { reference: [], measured: [], loads: [] };
  for (let i = 0; i < RUNS; i++) {
    const measure = async () => { const start = loadavg()[0]; out.measured.push(await run(measured)); out.loads.push({ start, end: loadavg()[0] }); };
    if (i % 2 === 0) { out.reference.push(await run(reference)); await measure(); } else { await measure(); out.reference.push(await run(reference)); }
  }
  return out;
}
/**
 * "Within 20% of its time with <the reference record>": the limit is 1.2 times the median of the reference side's
 * five runs. Returns { status, message }, the message naming both times.
 */
export async function judgeWithin(times, what, measuredName, referenceName) {
  const bench = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'benchmark.mjs')).href);
  const base = median(times.reference), limit = 1.2 * base;
  const verdict = bench.judgeLimit({ limit, runs: times.measured, fingerprint: bench.fingerprint(), loads: times.loads });
  const list = (runs) => runs.map((run) => run.toFixed(2)).join(', ');
  const both = `${what} took ${ms(median(times.measured))} ${measuredName} (five runs: ${list(times.measured)} ms) and ${ms(base)} ${referenceName} (five runs: ${list(times.reference)} ms): `
    + `${(median(times.measured) / base).toFixed(2)} times as long, where at most 1.20 times (${ms(limit)}) is allowed`;
  if (verdict.status === 'PASS') return { status: 'PASS', message: both };
  if (verdict.status === 'FAIL') return { status: 'FAIL', message: `${both}. ${verdict.reason}` };
  const reading = times.measured.every((run) => run <= limit) ? 'all five runs are within the limit' : times.measured.every((run) => run > limit * (1 + verdict.margin)) ? 'all five runs are over the limit by more than the margin' : 'the five runs are neither all within the limit nor all over it by more than the margin';
  return { status: verdict.status, message: `${verdict.status}: ${both}. As a reading, ${reading}. ${verdict.reason}; this is not a pass` };
}
