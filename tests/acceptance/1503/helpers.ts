// Shared test-side tools for the issue #1503 acceptance tests (inline program text, a shell fed from a pipe and eval
// meet the block entries). Temp homes; the shipped default entries copied in as the first rules.json; deep-hook built
// plain, as a planted twin, or from the pinned merge base, and run as an agent's hook entry runs it or in its `match`
// mode; the hub as a process, stopped by its PID. Adapted from tests/acceptance/1097/helpers.ts (same repo, same
// license); this suite keeps its own copy so a redraft of that suite never moves these tests. Nothing here stands in
// for deep-hook or the hub: every decision comes from the real programs. No call is ever executed.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const CORPUS = join(REPO, 'adapters/corpus');
/**
 * The merge base this suite was written on, pinned: origin/main before any #1503 code. Pinned rather than computed,
 * so the wrong program stays the pre-fix reader after #1503 merges and main moves past it (README, Wrong programs).
 */
export const BASE = 'c12a65bbe9c0fa26a677b2fd65e12146b3a24016';

/** Each criterion's ID: `#1503.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1503.22d68710';
export const AC2 = '#1503.fcb087fa';
export const AC3 = '#1503.c4d8f829';
export const AC4 = '#1503.2e57e7be';
export const AC5 = '#1503.935f1060';

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

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1503-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; rules.json and the hub's root live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes temp folders. */
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
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_/GIT_/XDG_ settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 900))}, stderr ${JSON.stringify(r.stderr.slice(0, 900))}`;

/** The message a judgement throws, or null when it holds: a wrong program's test expects it to throw. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Throws `message` unless `ok`: the judgements read as one assertion per sentence of the criterion. */
export function must(ok: boolean, message: string): void {
  if (!ok) throw Error(message);
}

// ---- deep-hook builds: the plain one, a planted twin, and the pinned merge base (README, Wrong programs).
const builds = new Map<string, Promise<string>>();
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
function once(key: string, make: () => Promise<string>): Promise<string> {
  let built = builds.get(key);
  if (!built) {
    built = make().then((binary) => {
      // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
      spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
      return binary;
    });
    builds.set(key, built);
  }
  return built;
}
/**
 * Builds deep-hook from this checkout and returns the binary's path. `features` builds a planted twin into a target
 * folder of its own, target/<features joined by +>/debug/deep-hook. A plant whose feature the checkout lacks fails the
 * cargo build, so its test fails BLOCKED (never passes).
 */
export function buildDeepHook(o: { features?: string[] } = {}): Promise<string> {
  const features = o.features ?? [];
  return once(features.join('+') || 'plain', async () => {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    let binary = DEEP_HOOK;
    if (features.length) {
      const dir = join(REPO, 'target', features.join('+'));
      args.push('--features', features.join(','), '--target-dir', dir);
      binary = join(dir, 'debug', 'deep-hook');
    }
    const r = await run('cargo', args, { env: CARGO_ENV, timeoutMs: 900_000 });
    if (r.code !== 0) throw Error(`BLOCKED: the deep-hook build ${features.length ? `with the plant ${features.join(', ')} ` : ''}did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-2000)}`);
    if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
    return binary;
  });
}
/**
 * deep-hook as the pinned merge base `BASE` has it: crates/deep-hook and crates/deep-contracts (deep-hook's only
 * dependency; neither has a crate from outside the repo) taken from that commit with `git archive`, built offline
 * in a workspace of their own under target/base-1503. Built once and kept; nothing in the checkout changes.
 */
export function buildBase(): Promise<string> {
  return once('base', async () => {
    const dir = join(REPO, 'target', 'base-1503', BASE.slice(0, 12));
    const binary = join(dir, 'target', 'debug', 'deep-hook');
    if (existsSync(binary)) return binary;
    const src = join(dir, 'src');
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'crates/deep-hook', 'crates/deep-contracts'], { maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', src], { input: tar });
    writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
    const args = ['build', '--offline', '-q', '-p', 'deep-hook', '--manifest-path', join(src, 'Cargo.toml'), '--target-dir', join(dir, 'target')];
    const r = await run('cargo', args, { env: CARGO_ENV, cwd: src, timeoutMs: 900_000 });
    if (r.code !== 0 || !existsSync(binary)) throw Error(`BLOCKED: deep-hook at the merge base ${BASE} did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-2000)}`);
    return binary;
  });
}

// ---- guard@1 entries and calls (#304's shapes).
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
export interface Call { tool_name: string; tool_input: Line; cwd?: string }
export interface Rules { v: number; entries: Record<string, Guard> }

export const bashCall = (command: string, cwd?: string): Call => ({ tool_name: 'Bash', tool_input: { command }, ...(cwd ? { cwd } : {}) });
/** The shipped defaults file, parsed. */
export function defaults(): Rules {
  return JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as Rules;
}
/** The names of the shipped entries that are block-mode and fail_closed: the ones that hold with the hub stopped. */
export function failClosedBlockNames(): string[] {
  return Object.entries(defaults().entries).filter(([, g]) => g.mode === 'block' && g.fail_closed).map(([name]) => name);
}
/** Copies the shipped defaults file verbatim in as <home>/.deepbuild/rules.json, the first rules.json. */
export function seedDefaults(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
}

// ---- Sessions and their hook JSON, shaped like Claude Code's PreToolUse payloads.
export interface Session { id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const dir = join(tempDir(), 'work');
  mkdirSync(dir, { recursive: true });
  const transcript = join(home, '.claude/projects', dir.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: dir, transcript };
}
let calls = 0;
/** A PreToolUse payload for `call` in the session. */
export function preToolUse(s: Session, call: Call): Line {
  return { session_id: s.id, transcript_path: s.transcript, cwd: call.cwd ?? s.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: call.tool_name, tool_input: call.tool_input, tool_use_id: `toolu_${randomBytes(12).toString('hex')}_${++calls}` };
}
/** deep-hook as a hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. */
export function hook(home: string, body: Line, binary: string): Promise<Ran> {
  return run(binary, ['claude-code', 'PreToolUse'], { cwd: String(body.cwd), env: childEnv(home), input: JSON.stringify(body), timeoutMs: 30_000 });
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Everything a reply tells the agent: a denial's reason (stderr, or a deny decision's reason) and any context. */
export const told = (r: Ran) => `${r.stdout}\n${r.stderr}`;
/** The guards a denial names, as deep-hook's hub-away denials name them: `(guard <name>`. */
export const guardsNamed = (text: string): string[] => [...text.matchAll(/\(guard ([A-Za-z0-9_.:-]+)/g)].map((m) => m[1]!);

// ---- The hub as a process.
export interface Hub { home: string; socket: string; pid: number; proc: ChildProcess; exit: Promise<void> }
/** Starts `deep hub run` on the home's root. */
export async function startHub(home: string, timeoutMs = 60_000): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { home, socket: String(ready.socket), pid: Number(ready.pid), proc: child, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, then SIGKILL after 15 s. Its process is gone after. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

/**
 * A home with the shipped defaults as rules.json whose hub was started and then stopped by its PID, so deep-hook gets
 * no answer and applies the fail_closed entries (the design's "With the hub down"). `whileUp` runs with the hub up.
 */
export async function stoppedHome<T>(whileUp?: (home: string) => Promise<T>): Promise<{ home: string; up: T | undefined }> {
  const home = makeHome();
  seedDefaults(home);
  const hub = await startHub(home);
  let up: T | undefined;
  try {
    if (whileUp) up = await whileUp(home);
  } finally {
    await stopHub(hub);
  }
  return { home, up };
}

// ---- deep-hook's `match` mode: a tool hook's JSON per line in, what the guards match per line out.
export interface Matched { matched: string[]; denials: string[]; unread?: boolean }
/** Runs `deep-hook match` over `payloads` with HOME `home`; one reading per payload, in order, or BLOCKED. */
export async function matchMode(binary: string, home: string, payloads: Line[]): Promise<Matched[]> {
  const r = await run(binary, ['match'], { env: childEnv(home), cwd: home, input: payloads.map((p) => JSON.stringify(p)).join('\n') + '\n', timeoutMs: 300_000 });
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  if (r.code !== 0 || lines.length !== payloads.length) throw Error(`BLOCKED: deep-hook match (${binary}) must answer each of the ${payloads.length} lines: ${shown(r)}`);
  return lines.map((l, i) => {
    const o = parseObject(l);
    if (!o || !Array.isArray(o.matched) || !Array.isArray(o.denials)) throw Error(`BLOCKED: deep-hook match's line ${i + 1} isn't a reading: ${l.slice(0, 300)}`);
    return { matched: o.matched.map(String), denials: o.denials.map(String), unread: o.unread === true };
  });
}
