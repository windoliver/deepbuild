// Test-side tools for the blind redraft of #2204's AC3: temp homes under /tmp holding ~/.deepbuild/rules.json, the
// real deep-hook built from this checkout and run as Claude Code's hook entry runs it (`deep-hook claude-code
// PreToolUse`, the hook JSON on stdin), and the real hub (`deep hub run`) as a process, started and stopped by its PID.
// Adapted from tests/acceptance/316/helpers.ts and tests/acceptance/304/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of those suites never moves these tests. Nothing here stands in for deep-hook or the
// hub, and no call is ever executed: each is only a hook payload on deep-hook's stdin.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The first-party guard@1 entries as they ship: `deep setup` installs this file as the first rules.json. */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');

/** AC3's ID: `#2204.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC3 = '#2204.7c1b9c13';

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
  const dir = realpathSync(mkdtempSync('/tmp/dh2204r3-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; rules.json and the hub's root live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');

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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
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
export function childEnv(home: string): NodeJS.ProcessEnv {
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
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop; `timeoutMs` kills it with SIGKILL. */
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

// ---- deep-hook, built from this checkout (a twin's files laid over it build the twin).
let built: Promise<string> | undefined;
/** `cargo build --locked -q -p deep-hook` once per test process; the binary is target/debug/deep-hook. */
export function buildDeepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_800_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook did not build deep-hook: ${shown(r)}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no binary at ${DEEP_HOOK} after cargo build`);
    // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 60_000 });
    return DEEP_HOOK;
  });
  return built;
}

// ---- A Claude Code session and its PreToolUse payload for a Bash call.
export interface Session { id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** Claude Code's PreToolUse hook JSON for a Bash call of `command` in the session. */
export function bash(s: Session, command: string): Line {
  return { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}` };
}
/** deep-hook as Claude Code's hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. */
export function hook(home: string, s: Session, body: Line, timeoutMs = 120_000): Promise<Ran> {
  return run(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs });
}
/**
 * What Claude Code does with a PreToolUse hook's output: exit 2 blocks the call and gives the agent stderr as the
 * reason; exit 0 with a deny decision on stdout blocks it with that decision's reason; anything else lets it run.
 */
export function verdict(r: Ran): { denied: boolean; reason: string } {
  if (r.code === 2) return { denied: true, reason: r.stderr };
  if (r.code === 0) {
    const out = parseObject(r.stdout.trim());
    const specific = out?.hookSpecificOutput;
    if (specific?.permissionDecision === 'deny') return { denied: true, reason: String(specific.permissionDecisionReason ?? '') };
    if (out?.decision === 'block') return { denied: true, reason: String(out.reason ?? '') };
  }
  return { denied: false, reason: '' };
}

// ---- The hub as a process.
export interface Hub { pid: number; socket: string; proc: ChildProcess; stderr(): string; exit: Promise<void> }
/** Starts `deep hub run` on the home's root and waits for its ready line; BLOCKED when none comes. */
export async function startHub(home: string, timeoutMs = 300_000): Promise<Hub> {
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
  if (!ready || ready.ready !== true || typeof ready.socket !== 'string') {
    throw Error(`BLOCKED: the hub did not start (deep hub run) within ${timeoutMs / 1000} s: stdout ${JSON.stringify(out.slice(0, 500))}, stderr ${JSON.stringify(err.slice(-1500))}`);
  }
  return { pid: child.pid!, socket: ready.socket, proc: child, stderr: () => err, exit };
}
/** Stops a hub this suite started, by its PID: SIGTERM, its own clean stop, then SIGKILL past `timeoutMs`. */
export async function stopHub(hub: Hub, timeoutMs = 120_000): Promise<'clean' | 'killed'> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + timeoutMs;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  let how: 'clean' | 'killed' = 'clean';
  if (alive(hub.pid)) {
    how = 'killed';
    try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  await hub.exit;
  return how;
}
/** Whether anything accepts a connection at a socket path; one that neither accepts nor refuses in time counts as live. */
export function answers(socket: string, timeoutMs = 5_000): Promise<boolean> {
  return new Promise((done) => {
    const sock = net.connect(socket);
    const timer = setTimeout(() => { sock.destroy(); done(true); }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); sock.destroy(); done(true); });
    sock.once('error', () => { clearTimeout(timer); done(false); });
  });
}
