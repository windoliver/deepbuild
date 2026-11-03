// Shared test-side tools for the issue #1097 acceptance tests (a call the guard can't read whole). Temp homes; the
// shipped default entries copied in as the first rules.json; test guard entries installed through `deep guard add`;
// deep-hook built plain, as a planted twin, or from the pinned merge base, and run as an agent's hook entry runs it;
// the hub as a process; and the timing tools the budget uses. Adapted from tests/acceptance/304/helpers.ts (same
// repo, same license); this suite keeps its own copy so a redraft of that suite never moves these tests. Nothing here
// stands in for deep-hook, the hub or the adapter: every decision comes from the real programs.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
/**
 * The merge base this suite was written on, pinned: origin/main before any #1097 code. Pinned rather than computed,
 * so the wrong program stays the pre-fix reader after #1097 merges and main moves past it (README, Wrong programs).
 */
export const BASE = 'fad1c4cb4e9cc7a782752e595dc6760014d2291e';

/** Each criterion's ID: `#1097.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1097.35142c93';
export const AC2 = '#1097.68b4ff24';
export const AC3 = '#1097.cd061f3b';
export const AC4 = '#1097.818d5af2';
export const AC5 = '#1097.a5ceefc6';

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
  const dir = realpathSync(mkdtempSync('/tmp/dh1097-'));
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

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
 * folder of its own, target/<features joined by +>/debug/deep-hook; `release` builds target/release. A plant whose
 * feature the checkout lacks fails the cargo build, so its test fails BLOCKED (never passes).
 */
export function buildDeepHook(o: { features?: string[]; release?: boolean } = {}): Promise<string> {
  const features = o.features ?? [];
  return once(`${features.join('+') || 'plain'}${o.release ? ':release' : ''}`, async () => {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    if (o.release) args.push('--release');
    let binary = o.release ? join(REPO, 'target/release/deep-hook') : DEEP_HOOK;
    if (features.length) {
      const dir = join(REPO, 'target', features.join('+'));
      args.push('--features', features.join(','), '--target-dir', dir);
      binary = join(dir, o.release ? 'release' : 'debug', 'deep-hook');
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
 * in a workspace of their own under target/base-1097. Built once and kept; nothing in the checkout changes.
 */
export function buildBase(): Promise<string> {
  return once('base', async () => {
    const dir = join(REPO, 'target', 'base-1097', BASE.slice(0, 12));
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

// ---- guard@1 entries, calls, planted calls and twins (#304's shapes).
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
export interface Call { tool_name: string; tool_input: Line; cwd?: string }
export interface Proof { planted: Call; twin: Call }
export interface GuardFile { v: number; entries: Record<string, Guard>; proofs: Record<string, Proof> }
export interface Rules { v: number; entries: Record<string, Guard> }

export const bashCall = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command } });
/** A test entry: its reason carries a token no shipped entry has, so text that carries it is this entry's. */
export function testEntry(name: string, o: Partial<Guard> & { match: string }): Guard {
  const token = randomBytes(4).toString('hex');
  return {
    scope: 'all_repos',
    mode: 'block',
    fail_closed: false,
    reason: `Test entry ${name} (${token}) holds this call.`,
    next_step: `Leave ${name} (${token}) alone; this is a test.`,
    ...o,
  };
}
/** A guard file holding `entries`, each with its planted call and twin, written to a temp folder; returns its path. */
export function guardFile(entries: Record<string, { guard: Guard } & Proof>): string {
  const file: GuardFile = { v: 1, entries: {}, proofs: {} };
  for (const [name, e] of Object.entries(entries)) {
    file.entries[name] = e.guard;
    file.proofs[name] = { planted: e.planted, twin: e.twin };
  }
  const path = join(tempDir(), 'guards.json');
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}
/** `deep guard add <file>`, as you run it in your own terminal, against the hub at the home's address. */
export function guardAdd(home: string, file: string): Promise<Ran> {
  return run(NODE, [CLI, 'guard', 'add', file], { env: childEnv(home), cwd: dirname(file), timeoutMs: 120_000 });
}
/** The shipped defaults file, parsed. */
export function defaultsFile(): GuardFile {
  return JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as GuardFile;
}
/** Copies the shipped defaults file verbatim in as <home>/.deepbuild/rules.json, the first rules.json. */
export function seedDefaults(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
}
/** rules.json as it stands, or undefined when it is missing or not JSON. */
export function readRules(home: string): Rules | undefined {
  const file = join(rootOf(home), 'rules.json');
  if (!existsSync(file)) return undefined;
  const parsed = parseObject(readFileSync(file, 'utf8'));
  return parsed && typeof parsed.entries === 'object' && parsed.entries !== null ? (parsed as Rules) : undefined;
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
/** The context a PreToolUse reply adds for the agent (Claude Code's hookSpecificOutput.additionalContext), or ''. */
export const contextFor = (r: Ran): string => {
  const ctx: unknown = parseObject(r.stdout.trim())?.hookSpecificOutput?.additionalContext;
  return typeof ctx === 'string' ? ctx : '';
};
/** Everything a reply tells the agent: a denial's reason (stderr, or a deny decision's reason) and any context. */
export const told = (r: Ran) => `${r.stdout}\n${r.stderr}`;
/** The issue's own phrase, with a straight or a typographic apostrophe. */
export const COULDNT_BE_READ = /couldn['’]t be read/i;

// ---- The hub as a process.
export interface Hub { home: string; socket: string; pid: number; proc: ChildProcess; exit: Promise<void> }
/**
 * Starts `deep hub run` on the home's root. `plant` sets DEEP_HUB_PLANT; `env` adds test-only settings. The hub
 * always gets DEEP_HUB_TEST_CONFIRM naming a file that says `confirmed`, so `deep guard add` is confirmed (#304).
 */
export async function startHub(home: string, o: { plant?: string; env?: Record<string, string> } = {}, timeoutMs = 60_000): Promise<Hub> {
  const confirm = join(tempDir(), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_CONFIRM: confirm, ...o.env });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready || ready.ready !== true) {
    throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  }
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

// ---- The calls the issue names (README, The calls).
/** `cmd` inside `sh -c "…"`, `depth` times over, quoted with double quotes so the line grows linearly, not 4^n. */
export function nested(cmd: string, depth: number): string {
  let line = cmd;
  for (let i = 0; i < depth; i++) line = `sh -c "${line.replace(/[\\"$`]/g, '\\$&')}"`;
  return line;
}

// ---- Budgets: the timing rule of #315's and #304's suites (README, Budgets).
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state and not loaded past its cores. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length) return `load ${load.toFixed(1)} is past the ${cpus().length} cores`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
