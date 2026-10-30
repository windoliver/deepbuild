// Shared test-side tools for issue #340's session-flow acceptance tests (README): a temp world (a home with the shipped
// default guards and your ask settings, a git repository the sessions work in, the definitions the kernel is handed),
// the hub as a process with its test settings, the record read back through the hub's socket (`events.read`), and
// Claude Code and Codex sessions driven through the real deep-hook binary with payloads, transcripts and rollouts
// shaped like the corpus's (adapters/corpus). The process, socket, world and Claude Code session parts are adapted
// from tests/acceptance/303/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of
// theirs never moves these tests. Nothing here stands in for DeepBuild: every reading comes from the real hub and
// deep-hook. The test plays the agent: it fires each hook through deep-hook, as a child of the session's own process
// (fixtures/agent.mjs), and runs a call only when deep-hook's PreToolUse allows it.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#340.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = 'AC1 #340.e5f83881';
export const AC2 = 'AC2 #340.2dc7b69b';
export const AC3 = 'AC3 #340.ff3d5215';
export const AC4 = 'AC4 #340.0abe1257';
export const AC5 = 'AC5 #340.ba97030c';

/** The prompts this suite types (README, The prompts). The first four are #303's, word for word. */
export const BEHAVIOR = 'make the auth middleware reject expired tokens';
export const RATE_LIMIT = 'Add a rate limit of five login attempts per minute.';
export const RESET_EMAIL = 'Send a password reset email when a user asks for one.';
export const MALFORMED = 'also return 401 with a JSON error body when the token is malformed';
export const MIDTURN_BEHAVIOR = 'also add a test for expired tokens';
export const MIDTURN_QUESTION = 'why did you pick bcrypt?';
/** The Claude desktop app's resume prompt, as the corpus's 2.1.299 desktop-resume session has it. */
export const RESUME = 'The app was quit while you were working. Please continue from where you left off.';

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
const newestOf = (file: string): string => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = newestOf('claude-code.facts.json');
/** The newest Codex version the facts cover, which each rollout's session_meta names. */
export const CODEX_COVERED = newestOf('codex.facts.json');
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
export class Inconclusive extends Error {}
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
  const dir = realpathSync(mkdtempSync('/tmp/dh340f-'));
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
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 900))}, stderr ${JSON.stringify(r.stderr.slice(0, 400))}`;

// ---- What deep-hook's stdout tells the agent and the person (README, What the tests read in hook output).
/** deep-hook's stdout as the agent reads it: one JSON object, or undefined for none. */
export const replyOf = (r: Ran): Line | undefined => parseObject(r.stdout.trim());
/** What the hook gives the agent as context: `hookSpecificOutput.additionalContext`. */
export const contextOf = (r: Ran): string => { const c = replyOf(r)?.hookSpecificOutput?.additionalContext; return typeof c === 'string' ? c : ''; };
/** What the hook shows the person in the chat: Claude Code's `systemMessage`, the hook reply's user-visible message. */
export const visibleOf = (r: Ran): string => { const m = replyOf(r)?.systemMessage; return typeof m === 'string' ? m : ''; };

// ---- The definitions the kernel is handed (#303's DEEP_HUB_TEST_DRAFTS, which the base has).
/** One requirement of a handed definition, in #303's fields. */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[] }
/** A definition the kernel is handed for an ask, by the prompt's exact text. */
export interface Draft { ask: string; requirements: Requirement[]; deliverables: string[]; budget: null }
export const req = (id: string, text: string): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [],
});
/** The definition handed for a prompt: one requirement per ID, each with the given text. */
export const draftFor = (ask: string, ids: string[] = ['R1', 'R2'], text: (id: string) => string = (id) => `${ask}: ${id} holds`): Draft => ({
  ask, requirements: ids.map((id) => req(id, text(id))), deliverables: ['src/auth.ts'], budget: null,
});

/**
 * The three asks AC1 and AC5 open in one session, each with a handed definition whose requirement IDs are its own
 * (R1-R5, R6-R9, R10-R12) and whose texts are long enough that listing every one in full can't fit in 500 tokens by
 * any count; each is typed in its own turn, with a Read, an Edit and a stop.
 */
export const OPEN_ASKS: { text: string; ids: string[]; file: string; from: string; to: string }[] = [
  { text: BEHAVIOR, ids: ['R1', 'R2', 'R3', 'R4', 'R5'], file: 'src/auth.ts', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' },
  { text: RATE_LIMIT, ids: ['R6', 'R7', 'R8', 'R9'], file: 'src/auth.ts', from: 'export function', to: 'export const LIMIT = 5;\nexport function' },
  { text: RESET_EMAIL, ids: ['R10', 'R11', 'R12'], file: 'src/cart.ts', from: 'await fetch', to: 'void 0;\n  await fetch' },
];
export const OPEN_IDS = OPEN_ASKS.flatMap((a) => a.ids);
const longText = (ask: string) => (id: string) => `${id}: ${ask}. The behavior holds for every caller of the login and session routes, on every supported runtime, including when the clock is skewed by up to five minutes, when the request arrives over a proxy that rewrites headers, and when the store that keeps sessions is briefly unavailable and the request is retried.`;
export const OPEN_DRAFTS = (): Draft[] => OPEN_ASKS.map((a) => draftFor(a.text, a.ids, longText(a.text)));
/**
 * Types the three asks in the session and waits until each has locked its handed definition (#303's part, which this
 * issue builds on: without it there is nothing to send again, so its absence is BLOCKED, not a failure of #340).
 */
export async function openAsks(hub: Hub, s: Session): Promise<void> {
  for (const a of OPEN_ASKS) {
    await s.typed(a.text);
    await s.read(a.file);
    await s.edit(a.file, a.from, a.to);
    await s.stop(`Done: ${a.text}`);
  }
  const events = await settle(hub, (all) => OPEN_ASKS.every((a) => { const ref = taskOf(askNamed(all, s, a.text)); return ref !== undefined && lockedFor(all, ref).length > 0; }), 60_000);
  const locked: string[] = [];
  for (const a of OPEN_ASKS) {
    const ref = taskOf(askNamed(events, s, a.text));
    const lock = ref ? lockedFor(events, ref)[0] : undefined;
    if (!lock) throw Error(`BLOCKED: the ask "${a.text}" must hold a locked definition before the compaction (#303): ${said(askNamed(events, s, a.text))}`);
    locked.push(...((lock.data.requirements ?? []) as { id: string }[]).map((r) => r.id));
  }
  if (locked.join() !== OPEN_IDS.join()) throw Error(`BLOCKED: the locked definitions hold the handed requirement IDs ${OPEN_IDS.join(', ')}: ${locked.join(', ')}`);
}

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface World { tmp: string; home: string; root: string; repo: string; drafts: string; base: string }
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your ask settings. `<tmp>/repo` is a git repository with one commit on main (`base`),
 * the folder every session works in. `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS.
 */
export function makeWorld(o: { drafts?: Draft[] } = {}): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function checkToken(token: { exp: number }): boolean {\n  return token.exp > 0;\n}\n');
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export async function syncCart(): Promise<void> {\n  await fetch("/cart");\n}\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node -e 0' } }, null, 2)}\n`);
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), drafts, base };
}
function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; plant: string | undefined; stderr(): string }
/**
 * Starts `deep hub run` (from `cli`, this checkout's unless given) with DEEP_HUB_TEST_DRAFTS, and DEEP_HUB_PLANT when
 * given. A hub that doesn't start (a plant the program doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: { plant?: string | undefined; cli?: string } = {}): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_PLANT: o.plant });
  const child = spawn(NODE, [o.cli ?? CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, plant: o.plant, stderr: () => err };
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
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; session?: string; data: Line; [key: string]: unknown }
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
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 500)}` : 'no event');

/** A session's prompts and messages (user.ask), in log order. */
export const asksOf = (events: readonly Ev[], s: { id: string }): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === s.id);
/** Every user.ask of the session with exactly this text. */
export const asksNamed = (events: readonly Ev[], s: { id: string }, text: string): Ev[] => asksOf(events, s).filter((e) => e.data.text === text);
export const askNamed = (events: readonly Ev[], s: { id: string }, text: string): Ev | undefined => asksNamed(events, s, text)[0];
/** The thread the session's start recorded. */
export const threadOf = (events: readonly Ev[], s: { id: string }): string | undefined => events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread as string | undefined;
/** The tasks opened under a thread, in log order. */
export const tasksIn = (events: readonly Ev[], thread: string | undefined): Ev[] => events.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The task a prompt opened, as its user.ask names it: its one entry in `tasks`, or undefined. */
export const taskOf = (ask: Ev | undefined): string | undefined => (Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined);
const asksShown = (events: readonly Ev[], s: { id: string }): string => asksOf(events, s).map(said).join('; ') || 'none';

/** A prompt you typed that asks for a change: one user.ask from person, naming one task, a task.created under the thread. */
export function expectTask(events: readonly Ev[], s: { id: string }, text: string, who: string): string {
  const ask = askNamed(events, s, text);
  must(ask !== undefined, `${who} the prompt "${text}" must be recorded as a user.ask: the session's are ${asksShown(events, s)}`);
  must(ask!.data.from === 'person', `${who} the prompt "${text}", typed by you, must be recorded from: person: ${said(ask)}`);
  const ref = taskOf(ask);
  must(ref !== undefined, `${who} the prompt "${text}", typed by you, asks for a change, so it opens a task as a typed prompt does: its user.ask names ${JSON.stringify(ask!.data.tasks)}: ${said(ask)}`);
  const thread = threadOf(events, s);
  must(tasksIn(events, thread).some((e) => e.data.task_ref === ref), `${who} the prompt "${text}" must open its task ${ref} under the session's thread ${thread ?? '(none recorded)'}: the thread holds ${tasksIn(events, thread).map(said).join('; ') || 'no task.created'}`);
  return ref!;
}
/**
 * One automatic prompt, recorded once with its origin and never as your ask: exactly one user.ask with its text, with
 * `from` the given origin and `tasks: []`, and no user.ask of the session with its text from person.
 */
export function expectAutomatic(events: readonly Ev[], s: { id: string }, text: string, from: string, who: string, what: string): Ev {
  const all = asksNamed(events, s, text);
  const person = all.filter((e) => e.data.from === 'person');
  must(!person.length, `${who} ${what} must never be recorded as your ask: ${person.length} user.ask of it from: person (${person.map(said).join('; ')})`);
  must(all.length === 1, `${who} ${what} must be recorded once, as one user.ask with from: ${from}: the session holds ${all.length} with its text (${all.map(said).join('; ') || 'none'}); its user.asks are ${asksShown(events, s)}`);
  const ask = all[0]!;
  must(ask.data.from === from, `${who} ${what} must be recorded with from: ${from}: ${said(ask)}`);
  must(Array.isArray(ask.data.tasks) && ask.data.tasks.length === 0, `${who} ${what} must open no task, its user.ask recording tasks: [], yet it opened ${JSON.stringify(ask.data.tasks)}: ${said(ask)}`);
  return ask;
}
/** The thread holds only the tasks `expected` names: an automatic prompt opened none. */
export function expectOnlyTasks(events: readonly Ev[], s: { id: string }, expected: readonly (string | undefined)[], who: string): void {
  const thread = threadOf(events, s);
  const others = tasksIn(events, thread).filter((e) => !expected.includes(String(e.data.task_ref)));
  must(!others.length, `${who} no automatic continuation opens a task: the thread ${thread} holds tasks no typed prompt opened: ${others.map(said).join('; ')}`);
}

// ---- Each session's agent (fixtures/agent.mjs): one long-lived process per session, the parent of every deep-hook
// run of that session, as the agent is of its hook commands. The hub binds the session to it.
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
  static start(w: World, env: Record<string, string>): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, env), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number, bin?: string): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs, ...(bin ? { bin } : {}) })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

/** What deep-hook's output tells the agent: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = replyOf(r);
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow')) return 'allow';
  return 'other';
}

let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** One hook run, with the event it was. */
export interface Fired { event: string; ran: Ran }

/**
 * A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. On the
 * `desktop` surface (the Claude desktop app, entrypoint claude-desktop), every prompt comes with the app's queue pair:
 * a `queue-operation` enqueue of its text and a dequeue a few ms later, before its transcript entry and its
 * UserPromptSubmit, as the corpus's 2.1.299 desktop sessions have it (README, Playing the agent).
 */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  readonly hooks: Fired[] = [];
  constructor(readonly w: World, readonly surface: 'terminal' | 'desktop' = 'desktop') {
    this.id = randomUUID();
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: surface === 'desktop' ? 'claude-desktop' : 'cli', CLAUDE_PROJECT_DIR: w.repo }));
  }
  private write(value: Line): void {
    writeFileSync(this.transcript, `${JSON.stringify(value)}\n`, { flag: 'a' });
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    this.write({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: this.surface === 'desktop' ? 'claude-desktop' : 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' });
    this.parent = uuid;
  }
  /** The queue's enqueue of a message: what a message typed while the agent works writes, and fires no hook. */
  queue(text: string): void {
    this.write({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: this.id, content: text });
  }
  /** The queue's dequeue: the app takes the oldest queued message off to submit it. */
  dequeue(): void {
    this.write({ type: 'queue-operation', operation: 'dequeue', timestamp: new Date().toISOString(), sessionId: this.id });
  }
  /** The desktop app's pair before a prompt: its enqueue, then its dequeue a few ms later. */
  async pair(text: string): Promise<void> {
    this.queue(text);
    await sleep(5);
    this.dequeue();
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    this.hooks.push({ event, ran });
    return ran;
  }
  /** A native binary run as a child of the session's Claude Code process, timed the same way as its hooks (AC5's floor). */
  floor(bin: string): Promise<Ran> {
    return agents.get(this.id)!.run([], this.cwd, '', 30_000, bin);
  }
  /** SessionStart, with its source: startup, resume, clear or compact. Returns deep-hook's run, its reply on stdout. */
  async start(source: 'startup' | 'resume' | 'clear' | 'compact' = 'startup'): Promise<Ran> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source, model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt: on the desktop the app's queue pair first, then its transcript entry, then UserPromptSubmit. */
  async submit(text: string, entry: Line, o: { pair?: boolean } = {}): Promise<Ran> {
    if (o.pair ?? this.surface === 'desktop') await this.pair(text);
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: entry.content ?? text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry, content: undefined });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  typed(text: string, o: { pair?: boolean } = {}): Promise<Ran> {
    return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }, o);
  }
  /** A prompt the desktop app sends itself (promptSource and turnOrigin sdk), as its resume prompt is. */
  sdk(text: string): Promise<Ran> {
    return this.submit(text, { promptSource: 'sdk', turnOrigin: 'sdk' });
  }
  /** A scheduled task's prompt (turnOrigin scheduled), as the corpus's 2.1.308 loop session has it. */
  scheduled(text: string): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled', queuePriority: 'later', queueSkipAttachments: true });
  }
  /** A background subagent's report (origin.handback), as the corpus's 2.1.308 subagent session has it. */
  handback(text: string, agentId: string): Promise<Ran> {
    return this.submit(text, { content: `Another Claude session sent a message:\n${text}`, isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'general-purpose', body: text, handback: true, handbackReportText: text } });
  }
  /** A message from another Claude Code session (turnOrigin peer, hostInjected), as the corpus's desktop-peer session has it. */
  peer(text: string, from = 'local_8f6f9e9a-898e-4858-aefe-44dfc1b77684'): Promise<Ran> {
    return this.submit(text, { content: `Another Claude session sent a message:\n${text}`, isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from, hostInjected: true } });
  }
  /** The assistant's tool_use entry and PreToolUse only: a call the app was quit in the middle of. */
  async begin(tool_name: string, tool_input: Line): Promise<Ran> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    return this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `during` (what happens while the call
   * runs, before it ends), its tool_result entry and PostToolUse. `agent` makes it a subagent's call (agent_id).
   */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => void; during?: () => void | Promise<void>; agent?: string } = {}): Promise<{ id: string; allowed: boolean; before: Ran; after?: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    const sub = o.agent ? { agent_id: o.agent, agent_type: 'general-purpose' } : {};
    if (!o.agent) this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id, ...sub });
    if (decision(before) !== 'allow') return { id, allowed: false, before };
    await o.during?.();
    o.effect?.();
    const response = o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    if (!o.agent) this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const after = await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40, ...sub });
    return { id, allowed: true, before, after };
  }
  /** The agent reads a file of the repository (Read). */
  async read(file: string, o: { during?: () => void | Promise<void> } = {}): Promise<{ before: Ran; after: Ran }> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    const r = await this.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } }, ...o });
    if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
    return { before: r.before, after: r.after! };
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
  /** The assistant's text, with no hook. */
  says(words: string): void {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words = 'Done.'): Promise<Ran> {
    this.says(words);
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
  /** SessionEnd, with its reason (`other` when the desktop app is quit). */
  end(reason = 'prompt_input_exit'): Promise<Ran> {
    return this.hook('SessionEnd', { reason });
  }
}

/**
 * A Codex session: its rollout under `<home>/.codex/sessions`, its own Codex process, and its hooks fired through
 * `deep-hook codex <event>`, with payloads and rollout lines shaped like the corpus's codex goal and desktop-heartbeat
 * sessions (session_meta first; each turn a task_started, a turn_context naming its turn_id and the user message that
 * opens it; every hook payload carries the turn's turn_id).
 */
export class CodexSession {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  readonly hooks: Fired[] = [];
  turn: string | undefined;
  private ordinal = 0;
  constructor(readonly w: World) {
    this.id = `01a1${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-a${tag(2).slice(1)}-${tag(6)}`;
    this.cwd = w.repo;
    this.transcript = join(w.home, '.codex/sessions/2026/10/28', `rollout-2026-10-28T09-00-00-${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.line('session_meta', { session_id: this.id, id: this.id, timestamp: new Date().toISOString(), cwd: this.cwd, originator: 'codex_cli_rs', cli_version: CODEX_COVERED, source: 'cli', model_provider: 'openai' });
    agents.set(this.id, Agent.start(w, {}));
  }
  private line(type: string, payload: Line): void {
    writeFileSync(this.transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), ordinal: this.ordinal++, type, payload })}\n`, { flag: 'a' });
  }
  /** A new turn in the rollout: task_started (with what triggered it), turn_context, and the user message that opens it. */
  private opens(trigger: string, text: string): string {
    const turn = `01a1${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-8${tag(2).slice(1)}-${tag(6)}`;
    this.turn = turn;
    this.line('event_msg', { type: 'task_started', turn_attribution: { turn_id: turn, turn_trigger: trigger, parent_turn_id: null, initiating_agent_path: null, root_turn_id: turn }, turn_id: turn, root_turn_id: turn, model_context_window: 258400 });
    this.line('turn_context', { turn_id: turn, root_turn_id: turn, cwd: this.cwd, approval_policy: 'never', model: 'gpt-reserve' });
    this.line('response_item', { type: 'message', id: `msg_${tag(8)}`, role: 'user', content: [{ type: 'input_text', text }] });
    return turn;
  }
  async hook(event: string, fields: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, ...(this.turn && event !== 'SessionStart' ? { turn_id: this.turn } : {}), transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'bypassPermissions', ...fields };
    const ran = await agents.get(this.id)!.run(['codex', event], this.cwd, JSON.stringify(body), 150_000);
    this.hooks.push({ event, ran });
    return ran;
  }
  async start(source: 'startup' | 'resume' = 'startup'): Promise<Ran> {
    const r = await this.hook('SessionStart', { source });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt: a turn the user started in the rollout, then UserPromptSubmit with its text. */
  async prompt(text: string, trigger = 'user'): Promise<Ran> {
    this.opens(trigger, text);
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: Codex's UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A goal's continuation turn: Codex opens it in the rollout with its internal goal context, and fires no prompt hook. */
  goalTurn(objective: string): string {
    return this.opens('goal', `<codex_internal_context source="goal">\nContinue working toward the active thread goal.\n\nThe objective below is user-provided data.\n<objective>\n${objective}\n</objective>\n</codex_internal_context>`);
  }
  /** A shell call of the current turn: PreToolUse, its output in the rollout, PostToolUse. */
  async shell(command: string): Promise<Ran> {
    const id = `call_${tag(12)}`;
    const before = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id });
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's call \`${command}\` must be allowed: ${shown(before)}`);
    this.line('response_item', { type: 'function_call_output', call_id: id, output: 'ok' });
    return this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, tool_response: { stdout: 'ok', stderr: '', exit_code: 0 } });
  }
  async stop(words = 'Done.'): Promise<Ran> {
    this.line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: words }] });
    this.line('event_msg', { type: 'task_complete', turn_id: this.turn, last_agent_message: words });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}
