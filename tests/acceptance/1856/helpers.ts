// Shared test-side tools for the issue #1856 acceptance tests (a rules.json removed after setup). Temp homes under
// /tmp (a Unix socket path must stay short); the shipped default entries copied in as the first rules.json, as setup
// writes it; setup's last record, setup-finished.json; deep-hook run as Claude Code's hook entry runs it; the hub as a
// process; a test guard entry installed through `deep guard add`; and the record read back through the hub's socket
// (`events.read`). Adapted from tests/acceptance/304/helpers.ts (same repo, same license); this suite keeps its own
// copy so a redraft of that suite never moves these tests. Nothing here stands in for deep-hook or the hub: every
// decision comes from the real programs.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');

/** Each criterion's ID: `#1856.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1856.6023a4b7';
export const AC2 = '#1856.e52ea188';
export const AC3 = '#1856.074bdc1e';

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

// ---- Temp folders, removed by cleanup().
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1856-'));
  made.push(dir);
  return dir;
}
/** A fresh, empty home folder: no ~/.deepbuild in it yet. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export const rulesFile = (home: string) => join(rootOf(home), 'rules.json');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function own(pid: number | undefined): void {
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes its temp folders. */
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

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_/GIT_/XDG_/RUST_ settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|RUST_|CLAUDE|CURSOR|CODEX)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 800))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;

/** The deep-hook and deep CLI this checkout built (README, How to run); BLOCKED when either is missing. */
export function built(): void {
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no deep-hook at ${DEEP_HOOK}: run cargo build --locked -q -p deep-hook`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: no deep CLI at ${CLI}: run npm run build --workspaces`);
  // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
  spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
}

// ---- The states of ~/.deepbuild the criteria name.
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
export interface Rules { v: number; entries: Record<string, Guard> }
/** Copies the shipped defaults file in as <home>/.deepbuild/rules.json, the file setup writes into a home that has none. */
export function seedDefaults(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(rulesFile(home), readFileSync(DEFAULT_RULES, 'utf8'));
}
/** Setup's last record, as setup writes it once it has finished (packages/hub/src/setup.ts): `{version, at}`, mode 0600. */
export function finishSetup(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const version = String(parseObject(readFileSync(join(REPO, 'package.json'), 'utf8'))?.version ?? '0.0.0');
  writeFileSync(join(rootOf(home), 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
}
/** rules.json as it stands, or undefined when it is missing or not `{entries: {...}}`. */
export function readRules(home: string): Rules | undefined {
  if (!existsSync(rulesFile(home))) return undefined;
  const parsed = parseObject(readFileSync(rulesFile(home), 'utf8'));
  return parsed && typeof parsed.entries === 'object' && parsed.entries !== null ? (parsed as Rules) : undefined;
}

// ---- A session's hook, shaped like Claude Code's PreToolUse payload for a Bash call.
export interface Session { id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd);
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export interface Hooked extends Ran { call: string }
/** deep-hook as Claude Code's hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. */
export async function hook(home: string, s: Session, command: string): Promise<Hooked> {
  const call = `toolu_${randomBytes(12).toString('hex')}`;
  const body = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command }, tool_use_id: call };
  const r = await run(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: the hook for \`${command}\` was killed at its 60 s timeout; run the suite again alone: ${shown(r)}`);
  // The watchdog's denials: the machine's load decided, not the guards (crates/deep-hook/src/main.rs, watchdog).
  if (/within 500 ms/.test(r.stderr)) throw Error(`INCONCLUSIVE: the hook for \`${command}\` was decided by deep-hook's 500 ms watchdog, not its guards; run the suite again alone: ${shown(r)}`);
  return { ...r, call };
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 lets it run. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Everything the agent reads of a denial. */
export const said = (r: Ran) => `${r.stdout}\n${r.stderr}`;

// ---- A test guard entry, installed as you install one: `deep guard add <file>` against the running hub.
/** A guard file holding one entry with its planted call and twin; returns its path. */
export function guardFile(name: string, guard: Guard, planted: string, twin: string): string {
  const call = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  const path = join(tempDir(), 'guards.json');
  writeFileSync(path, `${JSON.stringify({ v: 1, entries: { [name]: guard }, proofs: { [name]: { planted: call(planted), twin: call(twin) } } }, null, 2)}\n`);
  return path;
}
export function guardAdd(home: string, file: string): Promise<Ran> {
  return run(NODE, [CLI, 'guard', 'add', file], { env: childEnv(home), cwd: dirname(file), timeoutMs: 120_000 });
}

// ---- The hub as a process.
export interface Hub { home: string; socket: string; pid: number; proc: ChildProcess; stderr(): string; exit: Promise<void> }
/**
 * Starts `deep hub run` on the home's root. It gets DEEP_HUB_TEST_CONFIRM naming a file that says `confirmed`, so an
 * install that asks the OS to confirm you is confirmed (as tests/acceptance/304 starts it).
 */
export async function startHub(home: string, timeoutMs = 120_000): Promise<Hub> {
  const confirm = join(tempDir(), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(timeoutMs).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start within ${timeoutMs} ms: ${err.slice(-1500)}`);
  return { home, socket: String(ready.socket), pid: Number(ready.pid), proc: child, stderr: () => err, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, then SIGKILL after 15 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(home: string, socket: string, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(rootOf(home), 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; data: Line }
/** Every event the record holds, in log order. */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub.home, hub.socket, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
/** The record once `ready` holds of it and it has stopped growing for a second, or as it stands after `timeoutMs`. */
export async function settled(hub: Hub, ready: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  let events = await allEvents(hub);
  for (;;) {
    await sleep(1000);
    const next = await allEvents(hub);
    const still = next.length === events.length;
    events = next;
    if ((still && ready(events)) || Date.now() > deadline) return events;
  }
}
