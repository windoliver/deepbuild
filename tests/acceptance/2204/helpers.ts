// Test-side tools for issue #2204's acceptance tests (a rules.json deep-hook can't read, with the hub answering):
// temp homes under /tmp holding the first-party entries as rules.json, the real hub as a process (`deep hub run`),
// the real deep-hook run as Claude Code's hook entry runs it, and the record read back through the hub's socket.
// `run`, `childEnv`, `startHub`, `stopHub`, `control` and `allEvents` are adapted from tests/acceptance/304/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft there never moves these tests. Nothing here
// stands in for deep-hook or the hub, and nothing here asserts a criterion: a setup that can't be made throws a
// plain BLOCKED or INCONCLUSIVE error, never an assertion; the criteria's assertions are the tests' own `expect`s.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The first-party entries: what setup installs as the first rules.json (packages/hub/src/setup.ts, installRules). */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');

/** Each criterion's ID: `#2204.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#2204.64b12833';
export const AC2 = '#2204.722aff94';
export const AC3 = '#2204.7c1b9c13';
export const AC4 = '#2204.7f8edc15';
export const AC5 = '#2204.17dfce30';

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

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2204-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function alive(pid: number): boolean {
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
/** Stops every process this suite started that still runs (SIGTERM, then SIGKILL after 3 s) and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** A child's environment: this one with HOME the test's and no DEEP_, GIT_, XDG_, CLAUDE, CODEX or RUST_ settings or billing keys. */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|GIT_|CLAUDE|CODEX|RUST_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end, with stdin `input`, killing it (by its PID) at `timeoutMs`. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut });
    };
    child.on('error', (error) => done(null, null, error.message));
    child.on('close', (code, signal) => done(code, signal));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 900))}`;

/** This checkout's deep-hook, built plain into target/debug (a no-op when it is fresh). */
export async function buildDeepHook(): Promise<void> {
  const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
  const r = await run('nice', ['-n', '10', 'cargo', ...args], { timeoutMs: 1_800_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} was killed at the timeout`);
  if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: no ${CLI}: run \`npm run build --workspaces\` first`);
}

// ---- A home after setup, and its rules.json.
export interface Home { home: string; root: string; rules: string; work: string }
/** The first-party entries file as shipped: its bytes, and parsed. */
export const shippedText = () => readFileSync(DEFAULT_RULES, 'utf8');
export const shipped = () => JSON.parse(shippedText()) as { v: number; entries: Record<string, Line> };
/**
 * A fresh home as setup leaves the parts these tests reach: <home>/.deepbuild (0700) holding the shipped
 * default-rules.json verbatim as rules.json and a setup-finished.json shaped as setup writes it, and a work folder.
 * No agent config, login service or hub: `deep setup` itself is never run (README, Readings).
 */
export function makeHome(): Home {
  const home = join(tempDir(), 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rules = join(root, 'rules.json');
  writeFileSync(rules, shippedText(), { mode: 0o600 });
  const version = String((JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as Line).version);
  writeFileSync(join(root, 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  const work = join(home, 'w');
  mkdirSync(work);
  return { home, root, rules, work };
}
/** The file cut to its first 40 bytes, as a command's child cutting it short leaves it. */
export function cutShort(h: Home): void {
  writeFileSync(h.rules, readFileSync(h.rules).subarray(0, 40));
}
/** The name of the entry AC2's file gains; no shipped entry has it. */
export const NEWER = 'newer-than-this-hook';
/** The readable file with one more entry, a whole guard@1 entry whose `match` is `effect:not-a-class`. */
export function gainUnknownEntry(h: Home): void {
  const file = JSON.parse(readFileSync(h.rules, 'utf8')) as { entries: Record<string, Line> };
  file.entries[NEWER] = { match: 'effect:not-a-class', scope: 'all_repos', mode: 'block', reason: 'A test entry of a match this deep-hook does not know.', next_step: 'Leave it; this is a test.', fail_closed: false };
  writeFileSync(h.rules, `${JSON.stringify(file, null, 2)}\n`);
}
/** rules.json's entries as they stand, or undefined when it isn't JSON with an entries object. */
export function entriesOf(h: Home): Record<string, Line> | undefined {
  if (!existsSync(h.rules)) return undefined;
  const entries: unknown = parseObject(readFileSync(h.rules, 'utf8'))?.entries;
  return typeof entries === 'object' && entries !== null && !Array.isArray(entries) ? (entries as Record<string, Line>) : undefined;
}

// ---- Hooks, shaped like Claude Code's payloads for a Bash call.
const session = randomUUID();
/** deep-hook as a hook entry runs it: `deep-hook claude-code <event>`, the payload on stdin, HOME the agent's. `call` is its tool_use_id. */
export async function hook(h: Home, event: 'PreToolUse' | 'PostToolUse', command: string): Promise<Ran & { call: string }> {
  const call = `toolu_${randomBytes(12).toString('hex')}`;
  const body: Line = { session_id: session, transcript_path: join(h.home, 't.jsonl'), cwd: h.work, hook_event_name: event, permission_mode: 'default', tool_name: 'Bash', tool_input: { command }, tool_use_id: call };
  if (event === 'PostToolUse') body.tool_response = { stdout: '', stderr: '', interrupted: false, isImage: false };
  const r = await run(DEEP_HOOK, ['claude-code', event], { cwd: h.work, env: childEnv(h.home), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: the ${event} hook for \`${command}\` was killed at 60 s (the machine may be loaded): ${shown(r)}`);
  return { ...r, call };
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 with neither allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said: unknown = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Everything the hook printed: where a denial's words are, whichever stream carries them. */
export const words = (r: Ran) => `${r.stdout}\n${r.stderr}`;
/** "isn't JSON", loosely: the issue states the fact, not the wording. */
export const NOT_JSON = /(?:isn['’]?t|is not|not)(?: valid)? JSON/i;

// ---- The hub as a process.
export interface Hub { home: string; socket: string; pid: number; proc: ChildProcess; stderr(): string; exit: Promise<void> }
/** Starts `deep hub run` on the home's root and waits for its ready line. */
export async function startHub(h: Home, timeoutMs = 120_000): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(h.home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
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
  return { home: h.home, socket: String(ready.socket), pid: Number(ready.pid), proc: child, stderr: () => err, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, then SIGKILL after 15 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
  owned.delete(hub.pid);
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`INCONCLUSIVE: no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(Error(`BLOCKED: the hub's socket: ${error.message}`)); });
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
          if (line.error) reject(Error(`BLOCKED: ${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; data: Line }
/** Every event the record holds, in log order (`events.read`). */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
/**
 * Whether the hub answered this PreToolUse within the hook's 50 ms: the record holds the call's tool.before and it
 * isn't marked late (tool.before@4: a call the hub was late for is marked `late`). A hub the machine gave no time is
 * late, and deep-hook then decides as with the hub away, which is no reading of "with the hub running". Waits up to
 * 10 s for the event.
 */
export async function answered(hub: Hub, call: string): Promise<boolean> {
  for (const deadline = Date.now() + 10_000; ;) {
    const before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data.call === call);
    if (before) return before.data.late !== true;
    if (Date.now() > deadline) return false;
    await sleep(200);
  }
}
