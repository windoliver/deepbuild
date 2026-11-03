// Shared test-side tools for issue #993's criteria (README): a copy of this checkout whose deep-hook a test may
// remove, temp homes, `deep setup`/`deep doctor`/`deep status` through the copy's built CLI, Claude Code's user
// settings and DeepBuild's entries in them, the hub as a process with its socket's line protocol, and hook runs played
// through the real deep-hook binary. Parts are adapted from tests/acceptance/19/doctor/helpers.ts,
// tests/acceptance/18/mapping/helpers.ts and tests/acceptance/880/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of those never moves these tests. Nothing here stands in for DeepBuild.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSchemas } from '@deepbuild/contracts';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const NODE = process.execPath;
export const MINUTE = 60_000;
/** The hub's check interval the issue names: "every 10 minutes". */
export const CHECK_INTERVAL_MS = 10 * MINUTE;

// Criterion IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
// (scripts/proof-change.mjs, criterionId). Each test's title starts with its criterion and ID.
export const AC1 = 'AC1 #993.8355427d';
export const AC2 = 'AC2 #993.e11861a0';
export const AC3 = 'AC3 #993.b40b1853';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw.trim()); return l ? [l] : []; });

/** The doctor family's codes, from their one source, doctor.item@1. */
export function doctorCodes(): string[] {
  const schema = listSchemas().find((e) => e.name === 'doctor.item@1')!.schema as Line;
  return schema.properties.code.enum as string[];
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh993-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

// ---- deep-hook as this checkout builds it (cargo only rebuilds what changed).
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
let built: Promise<string> | undefined;
export function buildDeepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    return DEEP_HOOK;
  });
  return built;
}

// ---- A copy of this checkout (README: The copy of the checkout), after tests/acceptance/880's `copyOfTheHub`: every
// top-level entry a link, except `target`, which holds a real copy of the built deep-hook at `target/debug/deep-hook`
// and nothing else, and `packages/hub` and `packages/cli`, folders of links whose `dist` is a real copy, with
// `node_modules/@deepbuild/*` pointing into the copy's `packages`, so the copy's CLI loads the copy's hub, and the
// copy's setup names the copy's deep-hook. A test removes that one file; nothing in this checkout changes.
export interface Copy { root: string; cli: string; deepHook: string }
export async function copyOfTheCheckout(at: string): Promise<Copy> {
  for (const dist of ['packages/hub/dist/index.js', 'packages/cli/dist/main.js', 'node_modules/@deepbuild']) {
    if (!existsSync(join(REPO, dist))) throw Error(`BLOCKED: ${dist} is missing; run npm ci and npm run build --workspaces first`);
  }
  const hook = await buildDeepHook();
  mkdirSync(at);
  for (const name of readdirSync(REPO)) if (!['packages', 'node_modules', 'target'].includes(name)) symlinkSync(join(REPO, name), join(at, name));
  mkdirSync(join(at, 'packages'));
  for (const name of readdirSync(join(REPO, 'packages'))) {
    if (name !== 'hub' && name !== 'cli') { symlinkSync(join(REPO, 'packages', name), join(at, 'packages', name)); continue; }
    mkdirSync(join(at, 'packages', name));
    for (const entry of readdirSync(join(REPO, 'packages', name))) {
      if (entry !== 'dist') symlinkSync(join(REPO, 'packages', name, entry), join(at, 'packages', name, entry));
    }
    cpSync(join(REPO, 'packages', name, 'dist'), join(at, 'packages', name, 'dist'), { recursive: true });
  }
  mkdirSync(join(at, 'node_modules'));
  for (const name of readdirSync(join(REPO, 'node_modules'))) if (name !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', name), join(at, 'node_modules', name));
  mkdirSync(join(at, 'node_modules', '@deepbuild'));
  for (const name of readdirSync(join(REPO, 'node_modules', '@deepbuild'))) {
    const real = realpathSync(join(REPO, 'node_modules', '@deepbuild', name));
    const inPackages = dirname(real) === realpathSync(join(REPO, 'packages'));
    symlinkSync(inPackages ? join(at, 'packages', basename(real)) : real, join(at, 'node_modules', '@deepbuild', name));
  }
  const deepHook = join(at, 'target', 'debug', 'deep-hook');
  mkdirSync(dirname(deepHook), { recursive: true });
  copyFileSync(hook, deepHook);
  chmodSync(deepHook, 0o755);
  return { root: at, cli: join(at, 'packages/cli/dist/main.js'), deepHook };
}

// ---- A home: <tmp>/h is HOME for every process a test starts; <tmp>/bin holds the system-tool stand-ins.
export interface Home { tmp: string; home: string; bin: string; work: string; copy: Copy; env: Record<string, string | undefined> }
const STUB = [
  '#!/bin/sh',
  '# A stand-in for a system tool these tests never let `deep` reach (launchctl, systemctl, the login-service launcher):',
  '# it appends its name and arguments to calls.log beside it and exits 0, so no test registers a login service here.',
  'here=$(cd "$(dirname "$0")" && pwd -P)',
  'printf \'%s %s\\n\' "$(basename "$0")" "$*" >> "$here/calls.log"',
  'exit 0',
  '',
].join('\n');
/** A fresh home with a copy of the checkout, a working folder (a git repo) and the system-tool stand-ins. */
export async function makeHome(): Promise<Home> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const work = join(tmp, 'w');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', work]);
  for (const name of ['launchctl', 'systemctl', 'launcher']) {
    writeFileSync(join(bin, name), STUB);
    chmodSync(join(bin, name), 0o755);
  }
  const copy = await copyOfTheCheckout(join(tmp, 's'));
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${copy.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  return { tmp, home, bin, work, copy, env: {} };
}
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');
export const pathFor = (h: Home) => `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;

/** Variables that mark an agent's process or bill an API account: a child never inherits this process's. */
const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_|OTEL_)/;
/**
 * The environment a child gets: HOME the test's home, PATH the stand-ins and the system folders only (no real
 * `claude` or `codex`), and no agent marker, billing key, DEEP_ setting or GIT_ variable of this process's.
 */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('GIT_')) continue;
    if (key === 'PATH' || key === 'HOME' || key === 'SHELL') continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = pathFor(h);
  env.LC_ALL = 'C';
  env.NO_COLOR = '1';
  env.DEEP_HUB_LAUNCHER = join(h.bin, 'launcher');
  for (const [key, value] of Object.entries({ ...h.env, ...extra })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
/** `deep <args>` from the copy's built CLI, HOME the test's home, in the home's working folder. */
export function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [h.copy.cli, ...args], { env: childEnv(h, o.env), cwd: h.work, timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- Claude Code's user settings and DeepBuild's entries in them.
export function readSettings(h: Home): Line {
  const text = readFileSync(settingsFile(h), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(h)} is not a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
export interface Entry { event: string; command: string; async: boolean }
/** DeepBuild's hook entries in your settings: each command that runs `program`. */
export function entriesRunning(h: Home, program: string): Entry[] {
  const hooks = (readSettings(h).hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.hooks) ? (group.hooks as Line[]) : [])
      .filter((hook) => typeof hook.command === 'string' && hook.command.includes(program))
      .map((hook) => ({ event, command: String(hook.command), async: Boolean(hook.async || hook.asyncRewake) }))));
}

// ---- deep doctor --json: one doctor.item@1 (with item and agent) per line.
export interface DoctorItem { item?: string; agent?: string; code: string; level: string; evidence: string; fix: string }
export async function doctor(h: Home): Promise<{ ran: Ran; items: DoctorItem[] }> {
  const ran = await deep(h, ['doctor', '--json']);
  return { ran, items: jsonLines(ran.stdout) as DoctorItem[] };
}
export const itemText = (i: DoctorItem) => `${i.evidence ?? ''} ${i.fix ?? ''}`;
export const itemsShown = (items: DoctorItem[]) => items.map((i) => JSON.stringify(i)).join('\n');

// ---- The hub as a process: `deep hub run` from the copy, HOME the test's home (#16).
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(h: Home, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [h.copy.cli, 'hub', 'run'], { cwd: h.work, env: childEnv(h, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(rootOf(h), 'hub.sock'), root: rootOf(h), child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}

/** DeepBuild set up by `deep setup` with a hub answering, as you would; the hub stopped after. */
export async function setUp(h: Home): Promise<void> {
  const hub = await startHub(h);
  const set = await deep(h, ['setup']);
  await stopHub(hub);
  if (set.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 in the test home: ${shown(set)}`);
  if (!entriesRunning(h, h.copy.deepHook).length) throw Error(`BLOCKED: deep setup wrote no entry running the copy's deep-hook (${h.copy.deepHook}) into ${settingsFile(h)}: ${JSON.stringify(readSettings(h).hooks)}`);
}

// ---- The line protocol (#16): a cli connection with the control token.
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    sock.on('error', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
    sock.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
  }
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path}`)); }, timeoutMs);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; agent?: string; data: Line }
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
export const sessionsRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('sessions.read')).sessions as Line[]);
/** `deep status`'s rows as the hub serves them (`status.read`, the rows `deep status` prints). */
export const statusRows = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('status.read')).rows as Line[]);
/** Steps the hub's clock (DEEP_HUB_TEST_CLOCK_STEPS=1, #965's `test.clock`); the hub's now after the step. */
export const stepClock = (hub: Hub, ms: number): Promise<number> => control(hub, async (conn) => Number((await conn.call('test.clock', { advance_ms: ms })).now));

export async function eventually(probe: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

// ---- Hook runs: a session's hooks played through a deep-hook binary, as the tool running them does.
export const MODEL = 'claude-haiku-4-5';
export interface HookRun { event: string; payload: Line; ran: Ran }
/**
 * One session's hook calls, each `<program> claude-code <Event>` with the hook's JSON on stdin and the environment
 * the calling tool gives its hooks (`env`, plus `envFor(event)` per call), as DeepBuild's entries in Claude Code's
 * settings run them.
 */
export class HookSession {
  readonly id: string;
  readonly runs: HookRun[] = [];
  constructor(readonly program: string, readonly cwd: string, readonly transcript: string, private readonly env: NodeJS.ProcessEnv, private readonly envFor: (event: string) => Record<string, string> = () => ({}), id = randomUUID()) {
    this.id = id;
    mkdirSync(dirname(transcript), { recursive: true });
    if (!existsSync(transcript)) writeFileSync(transcript, '');
  }
  async hook(event: string, fields: Line = {}): Promise<HookRun> {
    const payload: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, permission_mode: 'default', hook_event_name: event, ...fields };
    const ran = await run(this.program, ['claude-code', event], { cwd: this.cwd, env: { ...this.env, ...this.envFor(event) }, input: JSON.stringify(payload), timeoutMs: 60_000 });
    const r = { event, payload, ran };
    this.runs.push(r);
    return r;
  }
  start(): Promise<HookRun> { return this.hook('SessionStart', { source: 'startup', model: MODEL }); }
  prompt(text: string): Promise<HookRun> { return this.hook('UserPromptSubmit', { prompt: text }); }
  async call(tool: string, input: Line, response: Line): Promise<void> {
    const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await this.hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id });
    await this.hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: response, tool_use_id: id, duration_ms: 40 });
  }
  stop(said = 'Done.'): Promise<HookRun> { return this.hook('Stop', { stop_hook_active: false, last_assistant_message: said }); }
}
/** The transcript path Claude Code keeps for a session in `cwd`. */
export const claudeTranscript = (home: string, cwd: string, id: string) => join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
