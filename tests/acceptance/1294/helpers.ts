// Shared test-side tools for issue #1294's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings, the staging settings and the OS-confirmation stub; a git repository with tracked files
// and an uncommitted edit), the hub as a process, the record read back through the hub's socket (`events.read`),
// Claude Code sessions driven through the real deep-hook binary, `deep undo`, and the judgements each criterion reads.
// Parts are adapted from tests/acceptance/347/helpers.ts (same repo, same license); this suite keeps its own copy so a
// redraft of that one never moves these tests. Nothing here stands in for DeepBuild: every decision comes from the
// real hub, deep-hook and CLI. The test plays Claude Code: it fires each hook through deep-hook and runs a command
// (with /bin/bash, in the repository) only when deep-hook's PreToolUse allows it, as Claude Code does.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const PRIVATE_SIZE_C = fileURLToPath(new URL('./fixtures/private-size.c', import.meta.url));

/** Each criterion's ID: `#1294.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1294.0d52ea18';
export const AC2 = '#1294.27ece250';
export const AC3 = '#1294.68f6f52b';
export const AC4 = '#1294.4cf10768';
export const AC5 = '#1294.17b207b0';
/** The Scope bullets no checkbox covers: they have no criterion ID. */
export const SCOPE = 'Scope #1294';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
const facts = JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[]; hookTimeouts: { defaultMs: number; perHook?: Record<string, number> } };
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
const COVERED = facts.versions[facts.versions.length - 1]!;
/** "Before the agent's hook timeout": Claude Code's PreToolUse timeout, from its facts (hookTimeouts). */
export const HOOK_TIMEOUT_MS = facts.hookTimeouts.perHook?.PreToolUse ?? facts.hookTimeouts.defaultMs;
const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
/** A reading the machine spoiled: a hook whose acknowledgement came too late, so the hub never decided its call. */
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/**
 * The message a scenario throws on a planted program, or null when it holds. A BLOCKED setup (the plant isn't there
 * to start) and an INCONCLUSIVE reading are thrown on, never read as the plant's failure.
 */
export async function failureOf(judge: () => Promise<void>): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
/** Throws `message` unless `ok`. A message that reads a value missing exactly when `ok` holds is passed as a function. */
export function must(ok: boolean, message: string | (() => string)): asserts ok {
  if (!ok) throw Error(typeof message === 'function' ? message() : message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1294-'));
  made.push(dir);
  return dir;
}

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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  agents.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the world's home and TMPDIR the world's own temp folder, so whatever the hub,
 * deep-hook or a command writes stays inside the world; no DEEP_/GIT_/XDG_/CLAUDE/CARGO/RUSTUP/npm settings or billing
 * keys of this process's. PATH is Node's folder and the system's, so the hub's look for a `claude` binary at a session's
 * start (`claude auth status`, #1033) finds none and no real Claude Code runs.
 */
function childEnv(w: { home: string; tmp: string }, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CARGO|RUSTUP|npm_)/i.test(key) || key === 'NODE_OPTIONS' || key === 'TMPDIR' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = w.home;
  env.TMPDIR = join(w.tmp, 't');
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.PATH = `${dirname(NODE)}:/usr/bin:/bin`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
/** Runs a command to its end without blocking this process's event loop. */
function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((done) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); done({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The staging settings: `staging` in ~/.deepbuild/config.json (#347). */
export interface Staging { files: number; seconds: number; keep: string }
/** #347's ceilings, which no test but the ceiling's comes near. */
const STAGING: Staging = { files: 1000, seconds: 20, keep: '3d' };

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; plant: string | undefined }
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const digestOf = (file: string) => sha256(readFileSync(file));
/**
 * 64 KiB of text, a size APFS gives its own blocks, so a clone of the file shows (fixtures/private-size.c), with bytes
 * no other file in the world has.
 */
function source(name: string): string {
  const head = `// ${name}\nexport const value = "`;
  const tail = '";\n';
  return `${head}${randomBytes(32_768).toString('hex').slice(0, 65_536 - head.length - tail.length)}${tail}`;
}
/** git in the world's repository, for the test's own setup: no hooks, the world's home, a name to commit as. */
export function git(w: World, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: w.repo, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the
 * first rules.json and config.json with your ask settings and `staging`. `<tmp>/t` is every child's TMPDIR.
 * `<tmp>/confirm` says `confirmed`: the OS confirming you, should `deep undo` ask it (DEEP_HUB_TEST_CONFIRM, #24's
 * stub). `<tmp>/repo` is a git repository, the folder every session works in: `main` holds tracked `src/a.ts` and
 * `src/keep.ts`; the checked-out branch `work` adds one commit with `src/b.ts`, so `git switch -f main` really switches
 * and `HEAD~1` exists. Its tree starts clean.
 */
export function makeWorld(staging: Staging = STAGING): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(tmp, 't'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, staging }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const w: World = { tmp, home, root, repo: realpathSync(repo), confirm, plant: undefined };
  git(w, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, '.gitignore'), 'build/\n');
  writeFileSync(join(repo, 'src', 'a.ts'), source('a.ts, as committed'));
  writeFileSync(join(repo, 'src', 'keep.ts'), 'export const keep = 1;\n');
  git(w, ['add', '.']);
  git(w, ['commit', '-q', '-m', 'base']);
  git(w, ['switch', '-q', '-c', 'work']);
  writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
  git(w, ['add', '.']);
  git(w, ['commit', '-q', '-m', 'add b']);
  return w;
}

/** An uncommitted change to a tracked file: its path in the repository, the file, and the SHA-256 of the edited bytes. */
export interface Edit { path: string; file: string; digest: string }
/** Edits tracked `path`, uncommitted, as a person or an earlier session did: no hook sees it. */
export function edit(w: World, path = 'src/a.ts'): Edit {
  const file = join(w.repo, path);
  const bytes = source(`${path}, edited and not committed`);
  writeFileSync(file, bytes);
  return { path, file, digest: sha256(bytes) };
}
/** The paths `git status` lists: what differs from HEAD or the index, or is untracked. */
export const changed = (w: World): string[] => git(w, ['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3)).sort();

// ---- Copies. Copy-on-write, read from APFS: the bytes private to a file, which a clone of it shares.
let reader: string | undefined;
function privateSizeReader(): string {
  if (reader && existsSync(reader)) return reader;
  const out = join(mkdtempSync('/tmp/dh1294r-'), 'private-size');
  try {
    execFileSync('cc', ['-O2', '-o', out, PRIVATE_SIZE_C], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: fixtures/private-size.c, which reads whether a file shares its blocks with a clone, didn't compile with cc (install the Xcode command line tools): ${error instanceof Error ? error.message : String(error)}`);
  }
  made.push(dirname(out));
  return (reader = out);
}
/** Each file's private bytes: its size until a clone shares its blocks, then 0; undefined where APFS doesn't say. */
function privateSizes(files: readonly string[]): Map<string, number | undefined> {
  const out = execFileSync(privateSizeReader(), files, { encoding: 'utf8' });
  const sizes = new Map<string, number | undefined>();
  for (const row of out.trim().split('\n')) {
    const [file, value] = row.split('\t');
    sizes.set(file!, value === 'unknown' ? undefined : Number(value));
  }
  return sizes;
}
/** The control: each file's blocks are its own before anything runs, or this file system can't show a clone. */
function expectPrivate(files: readonly string[]): void {
  for (const [file, size] of privateSizes(files)) {
    if (size !== 65_536) throw Error(`BLOCKED: ${file} must start with its 64 KiB private (no clone shares it) for the test to read a copy-on-write copy; this file system reads ${size ?? 'unknown'} (APFS is needed)`);
  }
}
/** Every file anywhere in the world (home, the hub's root, TMPDIR, the repository and its .git) with `e`'s bytes, but `e`'s own. */
export function copiesOf(w: World, e: Edit): string[] {
  const size = 65_536;
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path !== e.file) {
        try { if (statSync(path).size === size && digestOf(path) === e.digest) found.push(path); } catch { /* a file that went */ }
      }
    }
  };
  walk(w.tmp);
  return found;
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void> }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, and with DEEP_HUB_PLANT when given; the plant also goes to every
 * session made after. A hub that doesn't start (a plant the base doesn't list) is BLOCKED.
 */
export async function startHub(w: World, plant?: string): Promise<Hub> {
  w.plant = plant;
  const env = childEnv(w, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_CONFIRM: w.confirm });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((done) => child.on('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((done) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) done(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), root: w.root, child, exit };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((done, fail) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); fail(error); });
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
          if (line.error) fail(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else done(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; data: Line }
async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
/** The asks raised after `since` whose question names `command`. */
async function asksNaming(hub: Hub, since: number, command: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(command));
}
const askHandle = (ask: Ev) => `ask:${ask.id}`;
const asksShown = (asks: Ev[]) => asks.map((a) => `${askHandle(a)} ("${String(a.data.question)}")`).join(', ');
/** The staging the record holds for the call `id`: a `command.staged` event whose `data.call` is it. */
async function stagingOf(hub: Hub, id: string): Promise<Ev | undefined> {
  return (await allEvents(hub)).find((e) => e.kind === 'command.staged' && e.data?.call === id);
}
const stagedHandle = (staged: Ev) => `staged:${staged.id}`;

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands. `deep undo`, run by this test process, is
// outside every session's process tree, as your terminal is.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        done?.(line as unknown as Ran);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
  }
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w, { DEEP_HUB_PLANT: w.plant }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((done) => {
      this.pending.set(n, done);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

// ---- Claude Code sessions: hook payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
/** A session: its transcript, and its own Claude Code process that runs its hooks (made after the hub starts). */
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, Agent.start(w));
  return { id, cwd: w.repo, transcript };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/**
 * deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, a child of the
 * session's own Claude Code process. Stopped 30 s past Claude Code's PreToolUse timeout, so a reply later than that
 * timeout reads as one.
 */
function fire(body: Line, timeoutMs = HOOK_TIMEOUT_MS + 30_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id));
  if (!agent) throw Error(`BLOCKED: no Claude Code process for session ${String(body.session_id)}; make sessions with newSession`);
  return agent.run(['claude-code', String(body.hook_event_name)], String(body.cwd), JSON.stringify(body), timeoutMs);
}
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** A session's start and your prompt: SessionStart, then the prompt's transcript entry and its UserPromptSubmit. */
export async function begin(s: Session, text: string): Promise<void> {
  const started = await fire(payload(s, 'SessionStart'));
  if (started.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(started)}`);
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await fire(payload(s, 'UserPromptSubmit', { prompt: text }));
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
let calls = 0;
const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** One Bash call: its tool_use in the transcript, then its PreToolUse through deep-hook. */
export interface Pre { id: string; r: Ran }
export async function pre(s: Session, command: string): Promise<Pre> {
  const id = callId();
  const input = { command, description: command };
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: 'Bash', input }], 'tool_use'));
  const r = await fire(payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id }));
  return { id, r };
}
/**
 * Claude Code running an allowed shell call: `/bin/bash -c <command>` in the repository, as the world's user, then the
 * call's result in the transcript and its PostToolUse through deep-hook.
 */
export async function runCommand(w: World, s: Session, command: string, id: string): Promise<Ran> {
  const r = await run('/bin/bash', ['-c', command], { cwd: s.cwd, env: childEnv(w, { GIT_CONFIG_NOSYSTEM: '1' }), timeoutMs: 120_000 });
  const input = { command, description: command };
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: `${r.stdout}${r.stderr}` }] } });
  await fire(payload(s, 'PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } }));
  return r;
}
/**
 * deep-hook's own words, which only it prints when it decides a call without the hub's reply (crates/deep-hook
 * main.rs `forward`, `spool_by`, `watchdog`): a fail_closed entry's denial "(guard …, which holds while the hub doesn't
 * answer)", the watchdog's "deep-hook couldn't read …", and a spool that ran out of time.
 */
const OWN_WORDS = /which holds while the hub doesn't answer|^deep-hook: (?:spooled|could not spool)|deep-hook couldn't read/m;
/**
 * Why the hub never decided this call, or undefined when nothing shows that it didn't (#347's README, INCONCLUSIVE):
 * deep-hook's own words on stderr; no `tool.before` for the call within 10 s; a `tool.before` marked `late`; or the
 * hub's `session.reading` "deep-hook let PreToolUse <id> through as late", which it appends when it replays a spooled
 * copy at the next hook that reaches it, so a caller reads this after one and it waits up to `readingMs` for it.
 */
async function decidedAlone(hub: Hub, p: Pre, readingMs = 0): Promise<string | undefined> {
  const own = OWN_WORDS.exec(p.r.stderr);
  if (own) return `deep-hook decided it alone, its stderr in its own words ("${p.r.stderr.split('\n').find((l) => OWN_WORDS.test(l))}")`;
  let before: Ev | undefined;
  const deadline = Date.now() + 10_000;
  while (!(before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === p.id)) && Date.now() < deadline) await sleep(250);
  if (!before) return 'the hub recorded no tool.before for it in 10 s, so it never had the call';
  if (before.data.late === true) return 'its tool.before is the spooled copy, marked late';
  const until = Date.now() + readingMs;
  for (;;) {
    const reading = (await allEvents(hub)).find((e) => e.kind === 'session.reading' && String(e.data?.reading ?? '').includes(before.id) && /through as late/.test(String(e.data?.reading)));
    if (reading) return `the hub recorded "${String(reading.data.reading)}"`;
    if (Date.now() >= until) return undefined;
    await sleep(250);
  }
}
const lateWords = (command: string, p: Pre, why: string) => `\`${command}\` was decided without the hub: ${why} (${shown(p.r)}), so the hub never decided it; read at ${loadReading()}`;

/** `deep undo <handle>`, as you run it in your terminal (outside every session), the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export function undo(w: World, handle: string): Promise<Ran> {
  return run(NODE, [CLI, 'undo', handle], { env: childEnv(w), cwd: w.tmp, timeoutMs: 120_000 });
}

// ---- The judgements the criteria read (README, What each judgement reads).
/** A `data.files` digest: the SHA-256 in hex, with or without the `sha256:` prefix. */
const hexOf = (digest: unknown) => String(digest).replace(/^sha256:/, '');
export interface Staged { handle: string; event: Ev; pre: Pre; ran: Ran }
/**
 * What a destructive command is about to discard: the `edits`, and how their copy shows before it runs. `clone`: the
 * edit is a file in the tree, so a copy-on-write copy shares its blocks. `bytes`: the edit is in a stash entry, so the
 * copy is a file with its bytes, anywhere in the world. `gone` says why the run didn't discard them, or null if it did.
 */
export interface Discards { edits: Edit[]; copy: 'clone' | 'bytes'; gone(): string | null }
/** The tree's edits, which the run must leave without their bytes. */
export const treeEdits = (edits: Edit[]): Discards => ({
  edits,
  copy: 'clone',
  gone: () => {
    const kept = edits.filter((e) => digestOf(e.file) === e.digest);
    return kept.length ? `${kept.map((e) => e.path).join(', ')} still hold${kept.length === 1 ? 's' : ''} the edit` : null;
  },
});
function copyMissing(w: World, d: Discards): Edit[] {
  if (d.copy === 'clone') {
    const sizes = privateSizes(d.edits.map((e) => e.file));
    return d.edits.filter((e) => sizes.get(e.file) !== 0);
  }
  return d.edits.filter((e) => !copiesOf(w, e).length);
}
/**
 * "Staged before it runs": the agent's `command` is allowed at PreToolUse, with no ask naming it; at that moment,
 * before it runs, a copy of each edit exists; within 10 s the record holds the call's `command.staged`, whose
 * `data.files` lists the modified files, and only them, each with the digest of its bytes. Then the command runs, as
 * Claude Code would, and really discards them. A call allowed with no copy is run all the same, and fails, naming the
 * file.
 */
export async function expectStaged(w: World, hub: Hub, s: Session, command: string, d: Discards, who: string): Promise<Staged> {
  if (d.copy === 'clone') expectPrivate(d.edits.map((e) => e.file));
  const since = await lastPos(hub);
  const p = await pre(s, command);
  const said = decision(p.r);
  if (said !== 'allow') {
    const alone = await decidedAlone(hub, p);
    if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
    const asked = await asksNaming(hub, since, command);
    throw Error(`${who} \`${command}\` must run once ${d.edits.map((e) => e.path).join(', ')} are staged: deep-hook's PreToolUse ended ${said} (${shown(p.r)})${asked.length ? `, with ${asksShown(asked)}` : ''}; read at ${loadReading()}`);
  }
  // Claude Code runs the command as soon as the hook allows it: the copy must exist now.
  const missing = copyMissing(w, d);
  if (missing.length) {
    const ran = await runCommand(w, s, command, p.id);
    const alone = await decidedAlone(hub, p, 5000);
    if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
    throw Error(`${who} \`${command}\` ran with no copy of ${missing.map((e) => e.path).join(', ')}: at deep-hook's allow (${shown(p.r)}) no ${d.copy === 'clone' ? 'clone shares its blocks' : 'file in the world holds its bytes'}; run as Claude Code runs it (${shown(ran)}), ${d.gone() ?? 'its edit is lost'}, and the record holds ${(await stagingOf(hub, p.id)) ? 'a staging' : 'no staging'} for the call`);
  }
  let event: Ev | undefined;
  const deadline = Date.now() + 10_000;
  while (!(event = await stagingOf(hub, p.id)) && Date.now() < deadline) await sleep(250);
  must(event !== undefined, `${who} the record must hold the staging of \`${command}\`: 10 s after its PreToolUse allowed it, no command.staged event has data.call ${p.id}`);
  const handle = stagedHandle(event);
  const listed = event.data.files as { path?: unknown; digest?: unknown }[] | undefined;
  must(Array.isArray(listed), `${who} ${handle} must hold each staged copy with its digest, in data.files: its data is ${JSON.stringify(event.data)}`);
  const where = (f: { path?: unknown }) => resolve(w.repo, String(f.path));
  for (const e of d.edits) {
    const entry = listed.find((f) => where(f) === e.file);
    must(entry !== undefined, `${who} ${handle} must list ${e.path}, which \`${command}\` discards: data.files is ${JSON.stringify(listed)}`);
    must(hexOf(entry.digest) === e.digest, `${who} ${handle} must record ${e.path} with the SHA-256 of its bytes, ${e.digest}: data.files has ${JSON.stringify(entry)}`);
  }
  const extra = listed.filter((f) => !d.edits.some((e) => e.file === where(f)));
  must(!extra.length, `${who} ${handle} copies the modified files, and only them: data.files also lists ${JSON.stringify(extra)}`);
  const ran = await runCommand(w, s, command, p.id);
  const kept = d.gone();
  must(ran.code === 0 && kept === null, `BLOCKED: \`${command}\` must discard the edit when it runs: ${shown(ran)}${kept ? `, and ${kept}` : ''}`);
  await sleep(2000);
  const asked = await asksNaming(hub, since, command);
  must(!asked.length, `${who} \`${command}\` is staged, so it runs with no ask: ${asksShown(asked)} asks about it`);
  return { handle, event, pre: p, ran };
}
/**
 * "`deep undo staged:<id>` restores each file by digest": it exits 0, each file again has the SHA-256 it had before
 * the command, and `git status` lists those files and nothing else. Prints the issue's proof line: the tree before and
 * after, the staged copy with its digests, and the undo.
 */
export async function expectRestored(w: World, staged: Staged, d: Discards, command: string, who: string): Promise<void> {
  const after = d.edits.map((e) => ({ path: e.path, digest: digestOf(e.file) }));
  const r = await undo(w, staged.handle);
  must(r.code === 0, `${who} \`deep undo ${staged.handle}\` must undo the run of \`${command}\`, exit 0: ${shown(r)}`);
  for (const e of d.edits) {
    const now = digestOf(e.file);
    must(now === e.digest, `${who} after \`deep undo ${staged.handle}\`, ${e.path} must have the digest it had before \`${command}\`, ${e.digest}: it has ${now}`);
  }
  const paths = d.edits.map((e) => e.path).sort();
  const status = changed(w);
  must(JSON.stringify(status) === JSON.stringify(paths), `${who} after \`deep undo ${staged.handle}\`, git status must list ${paths.join(', ')} and nothing else: it lists ${JSON.stringify(status)}`);
  console.log(`proof #1294 ${JSON.stringify({ command, handle: staged.handle, before: d.edits.map((e) => ({ path: e.path, digest: e.digest })), staged: staged.event.data.files, afterRun: after, afterUndo: d.edits.map((e) => ({ path: e.path, digest: digestOf(e.file) })) })}`);
}
/**
 * "Runs with no staging and no ask": the agent's `command` is allowed at PreToolUse; at the allow no copy of `watched`
 * is anywhere in the world; it runs, as Claude Code runs it, with `watched` untouched; 2 s on the record holds no
 * staging of the call and no ask raised since names it. `where` says why it isn't to be staged.
 */
export async function expectFree(w: World, hub: Hub, s: Session, command: string, watched: Edit, where: string, who: string): Promise<void> {
  const since = await lastPos(hub);
  const p = await pre(s, command);
  const said = decision(p.r);
  if (said !== 'allow') {
    const alone = await decidedAlone(hub, p);
    if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
    const asked = await asksNaming(hub, since, command);
    throw Error(`${who} \`${command}\` ${where} must run with no staging and no ask: deep-hook's PreToolUse ended ${said} (${shown(p.r)})${asked.length ? `, and ${asksShown(asked)} asks about it` : ''}`);
  }
  const copies = copiesOf(w, watched);
  const ran = await runCommand(w, s, command, p.id);
  must(ran.code === 0, `BLOCKED: \`${command}\` must succeed in the test's repository: ${shown(ran)}`);
  must(digestOf(watched.file) === watched.digest, `BLOCKED: \`${command}\` ${where} must leave ${watched.path} as it was`);
  await sleep(2000);
  const staged = await stagingOf(hub, p.id);
  must(staged === undefined, () => `${who} \`${command}\` (call ${p.id}) was staged ${where}: the record holds ${stagedHandle(staged!)} for it, ${JSON.stringify(staged!.data)}`);
  must(!copies.length, `${who} \`${command}\` (call ${p.id}) was staged ${where}: at its allow, ${copies.length} copies of ${watched.path} were in the world, such as ${copies.slice(0, 2).join(', ')}`);
  const asked = await asksNaming(hub, since, command);
  must(!asked.length, `${who} \`${command}\` (call ${p.id}) was asked about ${where}: ${asksShown(asked)}`);
  // Nothing staged and no ask is a pass only if the hub decided the call. The PostToolUse reached the hub, which
  // replays a spooled copy then; a late one shows as the hub's reading within 5 s.
  const alone = await decidedAlone(hub, p, 5000);
  if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
}
/**
 * "Past its ceiling, the command becomes an authority ask": `command` isn't allowed; deep-hook replies before the
 * hook timeout; an `ask.created` of kind authority names it; each edit keeps its bytes; nothing is staged for the call;
 * and no partial copy is left 20 s after the reply. A call deep-hook allows is run, and fails.
 */
export async function expectAsked(w: World, hub: Hub, s: Session, command: string, edits: Edit[], who: string): Promise<void> {
  const since = await lastPos(hub);
  const p = await pre(s, command);
  const said = decision(p.r);
  if (said === 'allow') {
    const ran = await runCommand(w, s, command, p.id);
    const late = await decidedAlone(hub, p, 5000);
    if (late) throw new Inconclusive(`${who} ${lateWords(command, p, late)}`);
    throw Error(`${who} \`${command}\` ran with no ask: deep-hook's PreToolUse allowed it (${shown(p.r)}); run as Claude Code runs it (${shown(ran)}), ${edits.filter((e) => digestOf(e.file) !== e.digest).length} of its ${edits.length} edits are gone`);
  }
  const alone = await decidedAlone(hub, p);
  if (alone) throw new Inconclusive(`${who} ${lateWords(command, p, alone)}`);
  must(!p.r.timedOut && p.r.ms < HOOK_TIMEOUT_MS, `${who} the reply to \`${command}\` must come before the agent's hook timeout, ${HOOK_TIMEOUT_MS / 1000} s: deep-hook took ${(p.r.ms / 1000).toFixed(1)} s (${shown(p.r)})`);
  const asks = await asksNaming(hub, since, command);
  must(asks.length > 0, `${who} \`${command}\` must become an authority ask: no ask names it; deep-hook's PreToolUse ended ${said} (${shown(p.r)})`);
  must(asks[0]!.data.kind === 'authority', `${who} the ask for \`${command}\` must be an authority ask: ${askHandle(asks[0]!)} was filed as ${String(asks[0]!.data.kind)} ("${String(asks[0]!.data.question)}")`);
  for (const e of edits) must(digestOf(e.file) === e.digest, `${who} after the ask for \`${command}\`, ${e.path} must keep its edit`);
  const staged = await stagingOf(hub, p.id);
  must(staged === undefined, () => `${who} \`${command}\` must not be staged past the ceiling: the record holds ${stagedHandle(staged!)} for it, ${JSON.stringify(staged!.data)}`);
  const deadline = Date.now() + 20_000;
  let left = edits.flatMap((e) => copiesOf(w, e));
  while (left.length && Date.now() < deadline) {
    await sleep(500);
    left = edits.flatMap((e) => copiesOf(w, e));
  }
  must(!left.length, `${who} the partial copy must be dropped: 20 s after the ask, ${left.length} copies of the edits are left, such as ${left.slice(0, 3).join(', ')}`);
}
/**
 * "Denied, naming the command for you to run", with the hub stopped: deep-hook alone denies `command`, and its denial
 * holds the command and says it is to run (a wording such as "ask the person to run …"). What went wrong, or null.
 */
export function denialProblem(p: Pre, command: string): string | null {
  if (decision(p.r) !== 'deny') return `\`${command}\` must be denied with the hub stopped: deep-hook's PreToolUse ended ${decision(p.r)} (${shown(p.r)})`;
  const words = `${p.r.stdout}\n${p.r.stderr}`;
  if (!words.includes(command)) return `the denial of \`${command}\` must name the command for you to run: ${shown(p.r)}`;
  if (!/\bto run\b/i.test(words)) return `the denial of \`${command}\` must say the command is for you to run: ${shown(p.r)}`;
  return null;
}
