// Shared test-side tools for the issue #316 acceptance tests (criteria 1-8; criterion 9 is corpus.test.ts,
// written by a separate blind job, which imports from here). Temp homes, the default guard@1 entries read from
// the repo and installed as the first rules.json, deep-hook built and run as an agent's hook entry runs it, the
// hub as a process (for the corpus job), real git checkouts, and PATH stubs for gh/curl. Parts are adapted from
// tests/acceptance/315/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of #315's
// suite never moves these tests. Nothing here stands in for deep-hook: every decision comes from the real binary.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The repo file the implementer ships: the default guard@1 entries, installed verbatim as the first rules.json. */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const SECOND = 1000;

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
  const dir = realpathSync(mkdtempSync('/tmp/dh316-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; deep-hook's rules.json and the hub's root live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
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

/** Variables that make an agent bill an API account; a child never inherits this process's (README, Privacy). */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_ settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- deep-hook builds: the plain one and each planted twin (README, Wrong programs).
const builds = new Map<string, Promise<string>>();
/**
 * Builds deep-hook once per test process and returns the binary's path. `features` builds a planted twin into a
 * target folder of its own, target/<features joined by +>/debug/deep-hook. A plant whose feature the base lacks
 * fails the cargo build, so its wrong-program test fails (not passes).
 */
export function buildDeepHook(o: { features?: string[] } = {}): Promise<string> {
  const features = o.features ?? [];
  const key = features.join('+') || 'plain';
  let built = builds.get(key);
  if (!built) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    let binary = DEEP_HOOK;
    if (features.length) {
      const dir = join(REPO, 'target', features.join('+'));
      args.push('--features', features.join(','), '--target-dir', dir);
      binary = join(dir, 'debug', 'deep-hook');
    }
    built = run('cargo', args, { timeoutMs: 900_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
      if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
      // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
      spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
      return binary;
    });
    builds.set(key, built);
  }
  return built;
}

// ---- Sessions and their hook JSON, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { agent: 'claude-code'; id: string; cwd: string; transcript: string }
/** A session whose cwd is `cwd` (a real checkout for the git criteria) or a fresh work folder. */
export function newSession(home: string, cwd?: string): Session {
  const id = randomUUID();
  const dir = cwd ?? join(tempDir(), 'work');
  mkdirSync(dir, { recursive: true });
  const transcript = join(home, '.claude/projects', dir.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { agent: 'claude-code', id, cwd: dir, transcript };
}
let calls = 0;
export const callId = () => `toolu_${randomBytes(12).toString('hex')}_${++calls}`;
/** The base of a Claude Code hook payload for `event`, in the session, with `extra` merged over it. */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); break;
    case 'PreToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: callId() }); break;
    default: break;
  }
  return { ...base, ...extra };
}
/** A PreToolUse for a Bash command; `extra` can add agent_id/agent_type for a subagent call. */
export const bash = (s: Session, command: string, extra: Line = {}): Line =>
  payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: callId(), ...extra });
/** A PreToolUse for an Edit of a file path. */
export const edit = (s: Session, filePath: string, extra: Line = {}): Line =>
  payload(s, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: filePath, old_string: 'a', new_string: 'b', replace_all: false }, tool_use_id: callId(), ...extra });
/** A PreToolUse for a Write of a file path. */
export const write = (s: Session, filePath: string, extra: Line = {}): Line =>
  payload(s, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' }, tool_use_id: callId(), ...extra });

export interface HookRun { binary?: string; env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number }
/** deep-hook as a hook entry runs it: `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's. */
export function hook(home: string, s: Session, event: string, body: Line, o: HookRun = {}): Promise<Ran> {
  return run(o.binary ?? DEEP_HOOK, ['claude-code', event], { cwd: o.cwd ?? s.cwd, env: childEnv(home, o.env), input: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 30_000 });
}

/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 400))}, stderr ${JSON.stringify(r.stderr.slice(0, 400))}`;
/** Everything deep-hook printed: Claude Code reads a deny's reason from stderr (exit 2) or from the JSON (stdout). */
export const denialText = (r: Ran) => `${r.stdout}\n${r.stderr}`;

// ---- The default guard@1 entries (README, The default entries).
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
export interface Rules { v: number; entries: Record<string, Guard> }
/** The shipped defaults, parsed. Throws when the repo file is missing (the base), so a test that needs it fails. */
export function defaultRules(): Rules {
  if (!existsSync(DEFAULT_RULES)) {
    throw Error(`crates/deep-hook/default-rules.json is missing: the default guard@1 entries must ship as a file so deep-hook (the only evaluator) installs them as the first rules.json with no hub (#316 Scope). Base has none.`);
  }
  const parsed = parseObject(readFileSync(DEFAULT_RULES, 'utf8'));
  if (!parsed || typeof parsed.v !== 'number' || typeof parsed.entries !== 'object') {
    throw Error(`crates/deep-hook/default-rules.json is not {v, entries}: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed as Rules;
}
/** Installs the shipped defaults verbatim as <home>/.deepbuild/rules.json, the first rules.json. */
export function installDefaults(home: string): Rules {
  const rules = defaultRules();
  mkdirSync(rootOf(home), { recursive: true });
  writeFileSync(join(rootOf(home), 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  return rules;
}
/** Writes an arbitrary rules.json (the empty-rules control, say). */
export function writeRules(home: string, rules: Rules): void {
  mkdirSync(rootOf(home), { recursive: true });
  writeFileSync(join(rootOf(home), 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
}
/**
 * Whether the denial carries one shipped entry's `reason` and that same entry's `next_step` verbatim: a real
 * entry's words, never a generic message. Returns the entry's name, or null when none is carried whole.
 */
export function carriesReasonNextStep(r: Ran, rules: Rules): string | null {
  const text = denialText(r);
  for (const [name, g] of Object.entries(rules.entries)) {
    if (g.reason && g.next_step && text.includes(g.reason) && text.includes(g.next_step)) return name;
  }
  return null;
}

// ---- The address setting: <home>/.deepbuild/config.json, `{"hub": {"address": "unix:<path>"}}` (#16).
export function setAddress(home: string, address: string | undefined): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  if (address === undefined) delete config.hub;
  else config.hub = { ...(config.hub as Line | undefined), address };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
}

// ---- The hub as a process (for corpus.test.ts; criteria 1-8 run with no hub) (#16).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface HubProc { child: ChildProcess; pid: number; stderr(): string; ready: Promise<Ready | undefined>; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
export interface Hub extends Ready { home: string; root: string; proc: HubProc }
export function spawnHub(home: string): HubProc {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const first = out.split('\n')[0];
      if (out.includes('\n') && first !== undefined) {
        const line = parseObject(first);
        resolve(line && line.ready === true ? (line as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  return { child, pid: child.pid!, stderr: () => err, ready, exit };
}
export async function startHub(home: string, timeoutMs = 30_000): Promise<Hub> {
  const proc = spawnHub(home);
  const r = await Promise.race([proc.ready, proc.exit.then(() => undefined), sleep(timeoutMs).then(() => undefined)]);
  if (!r) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${proc.stderr().slice(0, 2000)}`);
  return { ...r, home, root: rootOf(home), proc };
}
export async function stopHub(hub: { pid: number; proc?: HubProc }, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 15_000): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, signal); } catch { return; }
  const deadline = Date.now() + timeoutMs;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  if (hub.proc) await hub.proc.exit;
}

// ---- Real git checkouts (criteria 2 and 6). A main checkout and the worktrees made from it.
export interface Checkout { dir: string; git(args: string[], cwd?: string): string }
export function makeRepo(): Checkout {
  const dir = join(tempDir(), 'repo');
  mkdirSync(dir, { recursive: true });
  const git = (args: string[], cwd = dir): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', HOME: dir, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e' } }).trim();
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'README'), 'base\n');
  git(['add', 'README']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git };
}
/** A worktree of `repo` at a fresh branch, returned as a real resolved path. */
export function addWorktree(repo: Checkout, name: string): string {
  const path = join(tempDir(), name);
  repo.git(['worktree', 'add', '-q', '-b', `wt-${name}`, path]);
  return realpathSync(path);
}
export const gitDirOf = (repo: Checkout) => realpathSync(join(repo.dir, '.git'));

// ---- A PATH stub for gh/curl: an executable that records its argv and does nothing else (criterion 5).
export interface Stub { dir: string; calls(name: string): string[][] }
/** Writes `<dir>/<name>` for each name, each a script that appends its argv as a JSON line to its own log. */
export function stubBins(names: string[]): Stub {
  const dir = join(tempDir(), 'stub-bin');
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const log = join(dir, `${name}.argv`);
    // A POSIX sh stub: write every argument, one JSON string per line is awkward in sh, so one JSON array via node.
    const script = `#!/bin/sh\nexec "${NODE}" -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2))+"\\n")' "${log}" "$@"\n`;
    writeFileSync(join(dir, name), script);
    chmodSync(join(dir, name), 0o755);
  }
  return {
    dir,
    calls: (name: string) => {
      const log = join(dir, `${name}.argv`);
      if (!existsSync(log)) return [];
      return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
    },
  };
}

// ---- Symlinks (criterion 8).
export function link(target: string, at: string): void {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at);
}
