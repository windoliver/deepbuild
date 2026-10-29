// Shared test-side tools for issue #303's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings and the OS-confirmation stub; a git repository the sessions work in; the definitions the
// kernel is handed and the test work source's readings), the hub as a process with its test settings, the record read
// back through the hub's socket (`events.read`), Claude Code sessions driven through the real deep-hook binary with
// payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code), and your answer through
// `deep inbox answer`. The process, socket, world and session parts are adapted from tests/acceptance/321/helpers.ts
// and tests/acceptance/18/mapping/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of
// theirs never moves these tests. Nothing here stands in for DeepBuild: every reading comes from the real hub,
// deep-hook and CLI. The test plays Claude Code: it fires each hook through deep-hook, as a child of the session's own
// process (fixtures/agent.mjs), and runs a call only when deep-hook's PreToolUse allows it.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const DAY = 86_400_000;

/** Each criterion's ID: `#303.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = 'AC1 #303.b4187956';
export const AC2 = 'AC2 #303.c7678fa6';
export const AC3 = 'AC3 #303.64edb131';
export const AC4 = 'AC4 #303.01978d67';
export const AC5 = 'AC5 #303.c870ae54';
export const AC6 = 'AC6 #303.f3b51cf5';
export const AC7 = 'AC7 #303.1bdbea79';
export const AC8 = 'AC8 #303.0ca34012';
export const AC9 = 'AC9 #303.8c347a59';
export const AC10 = 'AC10 #303.fd687f1e';
export const AC11 = 'AC11 #303.447eb97a';
export const AC12 = 'AC12 #303.323ca6a1';

/** The prompts the issue names, word for word, and the ones this suite adds (README, The prompts). */
export const BEHAVIOR = 'make the auth middleware reject expired tokens';
export const QUESTION = 'explain how the auth middleware checks expiry';
export const MIDTURN_QUESTION = 'why did you pick bcrypt?';
export const MIDTURN_BEHAVIOR = 'also add a test for expired tokens';
export const RENAME = 'Rename the getUser function to fetchUser.';
export const RATE_LIMIT = 'Add a rate limit of five login attempts per minute.';
export const RESET_EMAIL = 'Send a password reset email when a user asks for one.';
export const MALFORMED = 'also return 401 with a JSON error body when the token is malformed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
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
export async function failureOf(judge: () => unknown): Promise<string | null> {
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
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh303-'));
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
/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE settings or billing keys of this process's. */
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
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
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- The definitions the kernel is handed, and the test work source (README, The surface under test).
/** One requirement of a handed definition, in the issue's Fields (with the design's on_base and asserts). */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[] }
/** A definition the kernel is handed for an ask: by the prompt's exact text (`ask`) or by a work item (`issue`). */
export interface Draft { ask?: string; issue?: string; requirements: Requirement[]; deliverables: string[]; budget: null; waives?: { id: string; source_line: string }[] }
/** A test work source's reading, in work.item@1's fields; `body` is the text itself here. */
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' | 'collaborator' | 'outside' }[]; updated: string }

export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});
/** The definition handed for a prompt: two requirements, R1 and R2, drawn from the prompt's text. */
export const draftFor = (ask: string, o: Partial<Draft> = {}): Draft => ({
  ask, requirements: [req('R1', `${ask}: the change works`), req('R2', `${ask}: a test covers it`)], deliverables: ['src/auth.ts'], budget: null, ...o,
});
/** Every prompt this suite types, each with a definition handed for it: a wrong kernel that opens a task for one would lock it. */
export const ALL_DRAFTS = (): Draft[] => [BEHAVIOR, QUESTION, MIDTURN_QUESTION, MIDTURN_BEHAVIOR, RENAME, RATE_LIMIT, RESET_EMAIL, MALFORMED].map((t) => draftFor(t));

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The drafted check file the repo holds at its base commit (AC12): it fails until the change is made. */
export const CHECK_FILE = '.deepbuild/checks/expired-token.sh';
export const CHECK_BYTES = '#!/bin/sh\n# Drafted check: an expired token is rejected with 401.\nnode -e "process.exit(require(\'./src/auth.js\').rejectsExpired ? 0 : 1)"\n';
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string; base: string }
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your ask settings. `<tmp>/repo` is a git repository with one commit on main (`base`),
 * the folder every session works in, holding the drafted check file under `.deepbuild/`. `<tmp>/confirm` says
 * `confirmed` (DEEP_HUB_TEST_CONFIRM). `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS, `<tmp>/work.json` DEEP_HUB_TEST_WORK.
 */
export function makeWorld(o: { drafts?: Draft[]; readings?: Reading[] } = {}): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function checkToken(token: { exp: number }): boolean {\n  return token.exp > 0;\n}\n');
  writeFileSync(join(repo, 'src', 'users.ts'), 'export function getUser(id: string) {\n  return { id };\n}\n');
  writeFileSync(join(repo, CHECK_FILE), CHECK_BYTES, { mode: 0o755 });
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node -e 0' } }, null, 2)}\n`);
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? ALL_DRAFTS() }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: o.readings ?? [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base };
}
function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; readyAt: number; clock: number | undefined; plant: string | undefined; stderr(): string }
export interface HubOptions { plant?: string | undefined; clock?: number | undefined }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS and DEEP_HUB_TEST_WORK, and with DEEP_HUB_PLANT
 * and DEEP_HUB_TEST_CLOCK (the hub's clock starts there and moves with real time) when given. A hub that doesn't start
 * (a plant the base doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)),
  });
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
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: o.clock, plant: o.plant, stderr: () => err };
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
export function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
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
/** One event as `events.read` returns it. */
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; actor?: string; scope?: string; subject?: string; session?: string; seq?: string; data: Line; [key: string]: unknown }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const events = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
/** Reads the log until `done` holds, or `timeoutMs` passes; resolves with the last read either way, so the test's own assertions say what is missing. */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** An event's kind and data in one line, for failure messages. */
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 700)}` : 'no event');

/** The session's prompts, in log order. */
export const asksOf = (events: readonly Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === s.id);
export const askNamed = (events: readonly Ev[], s: Session, text: string): Ev | undefined => asksOf(events, s).find((e) => e.data.text === text);
/** The thread the session's start recorded. */
export const threadOf = (events: readonly Ev[], s: Session): string | undefined => events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread as string | undefined;
/** The tasks opened under a thread, in log order. */
export const tasksIn = (events: readonly Ev[], thread: string | undefined): Ev[] => events.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The task a prompt opened, as its user.ask names it: its one entry in `tasks`, or undefined. */
export const taskOf = (ask: Ev | undefined): string | undefined => (Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined);
/** The issue's message handle form: `session:<id>#<message>`. */
export const MESSAGE_HANDLE = /^session:[0-9A-Za-z]+#[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A prompt the kernel turned into a task (README, What "opens a task" means): its user.ask names exactly one task in
 * `tasks`, a task.created under the session's thread has that task_ref, and, when `handle`, it is a message handle.
 */
export function expectTask(events: readonly Ev[], s: Session, text: string, who: string, o: { handle?: boolean } = {}): string {
  const ask = askNamed(events, s, text);
  must(ask !== undefined, `${who} the prompt "${text}" must be recorded as a user.ask: the session's are ${asksOf(events, s).map(said).join('; ') || 'none'}`);
  const ref = taskOf(ask);
  must(ref !== undefined, `${who} the prompt "${text}" asks for new or changed behavior, so its user.ask must name the one task it opens in tasks: ${said(ask)}`);
  const thread = threadOf(events, s);
  const created = tasksIn(events, thread).filter((e) => e.data.task_ref === ref);
  must(created.length === 1, `${who} the prompt "${text}" must open one task under the session's thread (${thread ?? 'no thread recorded'}): a task.created with task_ref ${ref}; the thread holds ${tasksIn(events, thread).map(said).join('; ') || 'no task.created'}`);
  if (o.handle) must(MESSAGE_HANDLE.test(ref!), `${who} the task "${text}" opens is keyed by its message handle (session:<id>#<message>): ${ref}`);
  return ref!;
}
/**
 * A prompt that opens no task, no drafting job and no definition (README): its user.ask records `tasks: []` (the
 * message names what it opened instead), and the session's thread holds only the tasks the other prompts opened, with
 * definitions only for those.
 */
export function expectNoTask(events: readonly Ev[], s: Session, text: string, who: string, expected: readonly string[] = []): void {
  const ask = askNamed(events, s, text);
  must(ask !== undefined, `${who} the prompt "${text}" must be recorded as a user.ask: the session's are ${asksOf(events, s).map(said).join('; ') || 'none'}`);
  must(Array.isArray(ask!.data.tasks) && ask!.data.tasks.length === 0, `${who} the prompt "${text}" must open no task, its user.ask recording tasks: [], yet it opened ${JSON.stringify(ask!.data.tasks)}: ${said(ask)}`);
  const thread = threadOf(events, s);
  const others = tasksIn(events, thread).filter((e) => !expected.includes(String(e.data.task_ref)));
  must(!others.length, `${who} the prompt "${text}" must open no task: the thread ${thread} holds tasks no other prompt opened: ${others.map(said).join('; ')}`);
  const drafting = events.filter((e) => (e.kind.startsWith('definition.') || e.kind.startsWith('job.')) && (e.session === s.id || e.session === undefined)
    && (JSON.stringify(e.data ?? {}).includes(text) || (typeof e.data?.task_ref === 'string' && !expected.includes(e.data.task_ref))));
  must(!drafting.length, `${who} the prompt "${text}" must start no drafting job and lock no definition: ${drafting.map(said).join('; ')}`);
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands. The hub binds the session to it, so `deep
// inbox answer`, run by this test process, is outside every session's process tree, as your terminal is.
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
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: w.repo }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow')) return 'allow';
  return 'other';
}

let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  readonly hooks: { event: string; ran: Ran }[] = [];
  constructor(readonly w: World) {
    this.id = randomUUID();
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w));
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    this.hooks.push({ event, ran });
    return ran;
  }
  /** SessionStart, with its source: startup, resume, clear or compact. Returns deep-hook's run, its reply on stdout. */
  async start(source: 'startup' | 'resume' | 'clear' | 'compact' = 'startup'): Promise<Ran> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source, model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
    return r;
  }
  private async submit(text: string, entry: Line): Promise<Ran> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  typed(text: string): Promise<Ran> {
    return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  }
  /** A `/loop` iteration's prompt: a wake-up the loop scheduled (turnOrigin scheduled), as Claude Code 2.1.304 writes it. */
  scheduled(text: string): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' });
  }
  /** A background subagent's report, arriving as a prompt (origin.handback). */
  handback(text: string, agentId = 'a2711031fe8c87e48'): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'general-purpose', body: text, handback: true, handbackReportText: text } });
  }
  /** A message from another Claude Code session (turnOrigin peer, hostInjected), as the corpus's desktop-peer session has it. */
  peer(text: string, from = 'local_8f6f9e9a-898e-4858-aefe-44dfc1b77684'): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from, hostInjected: true } });
  }
  /** A message you type while the agent works: Claude Code's queue entry in the transcript, read at the next hook. */
  queue(text: string): void {
    writeFileSync(this.transcript, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: this.id, content: text })}\n`, { flag: 'a' });
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does), its
   * tool_result entry and PostToolUse. `during` runs between PreToolUse and PostToolUse, before the effect.
   */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => void; during?: () => void } = {}): Promise<{ id: string; allowed: boolean; before: Ran; after?: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (decision(before) !== 'allow') return { id, allowed: false, before };
    o.during?.();
    o.effect?.();
    const response = o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const after = await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { id, allowed: true, before, after };
  }
  /** The agent reads a file of the repository (Read). */
  async read(file: string, o: { during?: () => void } = {}): Promise<void> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    const r = await this.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } }, ...o });
    if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent edits a file of the repository (Edit), and the edit is made. */
  async edit(file: string, from: string, to: string): Promise<void> {
    const path = join(this.cwd, file);
    const r = await this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => writeFileSync(path, readFileSync(path, 'utf8').replace(from, to)),
    });
    if (!r.allowed) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words = 'Done.'): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
  /** SessionEnd, with its reason (`clear` for /clear). */
  end(reason = 'prompt_input_exit'): Promise<Ran> {
    return this.hook('SessionEnd', { reason });
  }
}

/** The session's stops, in log order. */
export const stopsOf = (events: readonly Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'agent.stop' && e.session === s.id);

/**
 * The hash the next claim recomputed for a task (README, The claim's recomputed hash): the first event after `after`
 * (a log position), other than a definition.*, whose data names the task's task_ref and carries a 64-hex `hash`.
 */
export function recomputedAt(events: readonly Ev[], ref: string, after: number): Ev | undefined {
  return events.find((e) => e.log_pos > after && !e.kind.startsWith('definition.') && e.data?.task_ref === ref && typeof e.data?.hash === 'string' && /^[0-9a-f]{64}$/.test(e.data.hash));
}

/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export async function answer(w: World, ask: Ev, option: string): Promise<Ran> {
  return run(NODE, [CLI, 'inbox', 'answer', `ask:${ask.id}`, option], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
