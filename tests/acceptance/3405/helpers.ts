// Shared test-side tools for issue #3405's acceptance tests (README): the three recordings the corpus must hold and
// the BLOCKED gate on them, a temp world (a home with the shipped default guards, one git repository with a worktree
// per session), the hub as a process with its test settings and its plant option, the record read back through the
// hub's socket (`events.read`), Claude Code sessions driven through the real deep-hook binary as children of their own
// agent process (fixtures/agent.mjs), each with an inbox address exported to its hooks as Claude Code exports it, a
// recorded session replayed hook by hook through deep-hook into a real hub, and your terminal (`deep inbox answer`).
// Adapted from tests/acceptance/352/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft
// of that one never moves these tests. Nothing here stands in for DeepBuild.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const FACTS_FILE = join(REPO, 'adapters/claude-code.facts.json');
export const readFactsFile = (): { versions: string[] } & Record<string, unknown> => JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as { versions: string[] };
/** The newest Claude Code version the facts cover: the recordings are made on it, and every scripted transcript carries it. */
export const NEWEST = readFactsFile().versions.at(-1)!;
export const CORPUS = join(REPO, 'adapters/corpus');
export const SET = join(CORPUS, 'claude-code', NEWEST);

/** Each criterion's ID: `#3405.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #3405.3974b666';
export const AC2 = 'AC2 #3405.b702681c';
export const AC3 = 'AC3 #3405.6a385342';
export const AC4 = 'AC4 #3405.d215a9a6';
export const AC5 = 'AC5 #3405.ef7df801';
export const AC6 = 'AC6 #3405.ff99b700';
export const AC7 = 'AC7 #3405.329d0b1a';
export const AC8 = 'AC8 #3405.5893703f';

/**
 * The three recordings AC1 names (chosen; README, Surfaces): session folders in the corpus's existing layout under
 * adapters/corpus/claude-code/<NEWEST>/.
 */
export const RECORDINGS = {
  /** A message between two sessions on one machine, in the terminal. */
  terminal: 'peer-message-terminal',
  /** A message between two sessions on one machine, in the Claude desktop app. */
  desktop: 'peer-message-desktop',
  /** A channel's event from a server of our own behind Claude Code's development flag. */
  channel: 'channel-event',
} as const;
/** events.jsonl tags: the corpus's existing tag for another session's message, and a new one for a channel's event (chosen). */
export const TAG = { message: 'other-session-message', channel: 'channel-event' } as const;
/** The variables Claude Code exports to its hooks for a session's inbox (issue: Claude Code's page on messages between sessions). */
export const SOCKET_VAR = 'CLAUDE_CODE_MESSAGING_SOCKET';
export const TOKEN_VAR = 'CLAUDE_CODE_MESSAGING_TOKEN';
/** The planted wrong programs the criteria name (chosen names; README, Plants). The implementer adds each. */
export const PLANT = {
  /** AC3: a hub whose loop rule holds the receiver alone. Selected with DEEP_HUB_PLANT on the hub. */
  receiverAlone: 'loop-holds-receiver-alone',
  /** AC4: a hub that names another session as the sender of a message from an address no live session reported. */
  namesOther: 'names-other-session-for-unreported-address',
  /** AC6: a hub with no count for a channel's events. */
  channelUncounted: 'channel-without-count',
  /** AC7: deep-hook whose SessionStart report carries the token's value; DEEP_HUB_PLANT in deep-hook's env-plants build. */
  tokenInReport: 'session-start-reports-token',
} as const;

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
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- The recordings, and the gate every criterion but AC1 stands behind (issue: "Without them every other criterion
// here reads BLOCKED, never PASS").
export interface Case { payload: Line; expect?: Line[]; tag?: string; env?: Record<string, string>; line: number; [key: string]: unknown }
export interface Recording { name: string; dir: string; ref: string; meta: Line; cases: Case[]; transcript: Line[] }
const jsonLines = (path: string): Line[] => readFileSync(path, 'utf8').split('\n').flatMap((l) => (l.trim() ? [parseObject(l) ?? {}] : []));
/** One recording of the newest covered version's set, as the corpus keeps it, or undefined when its folder or a file is missing. */
export function readRecording(name: string): Recording | undefined {
  const dir = join(SET, name);
  if (!['session.json', 'events.jsonl', 'transcript.jsonl'].every((f) => existsSync(join(dir, f)))) return undefined;
  const cases = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').map((text, i) => ({ text, line: i + 1 })).filter(({ text }) => text.trim())
    .map(({ text, line }) => ({ ...(parseObject(text) ?? {}), line }) as Case);
  return { name, dir, ref: `claude-code/${NEWEST}/${name}`, meta: parseObject(readFileSync(join(dir, 'session.json'), 'utf8')) ?? {}, cases, transcript: jsonLines(join(dir, 'transcript.jsonl')) };
}
export const missingRecordings = (): string[] => Object.values(RECORDINGS).filter((name) => !readRecording(name)).map((name) => `adapters/corpus/claude-code/${NEWEST}/${name}`);
/** The three recordings; with any missing the test reads BLOCKED (skipped with the reason), never PASS. */
export function needRecordings(ctx: { skip: (note?: string) => void }): { terminal: Recording; desktop: Recording; channel: Recording } | undefined {
  const missing = missingRecordings();
  if (missing.length) {
    ctx.skip(`BLOCKED: AC1's recordings are missing (${missing.join(', ')}), so this criterion can't be judged (issue: without them every other criterion reads BLOCKED)`);
    return undefined;
  }
  return { terminal: readRecording(RECORDINGS.terminal)!, desktop: readRecording(RECORDINGS.desktop)!, channel: readRecording(RECORDINGS.channel)! };
}
export const caseRef = (rec: Recording, c: Case): string => `${rec.ref}/events.jsonl:${c.line}`;
export const eventOf = (c: Case): string => String(c.payload?.hook_event_name ?? '');
/** A prompt's transcript entry: the user entry whose promptId is the payload's prompt_id (the facts' origin join). */
export function entryOf(rec: Recording, c: Case): Line | undefined {
  const id = c.payload?.prompt_id;
  if (typeof id !== 'string') return undefined;
  const all = rec.transcript.filter((e) => e.type === 'user' && e.promptId === id);
  return all.find((e) => e.turnOrigin !== undefined || e.origin !== undefined) ?? all[0];
}
/** The recorded prompts whose entry has turnOrigin peer and origin.kind `kind`. */
export const promptsOfKind = (rec: Recording, kind: string): Case[] =>
  rec.cases.filter((c) => eventOf(c) === 'UserPromptSubmit' && entryOf(rec, c)?.turnOrigin === 'peer' && entryOf(rec, c)?.origin?.kind === kind);
/** Each recorded session's inbox address: the CLAUDE_CODE_MESSAGING_SOCKET its SessionStart line's `env` holds (chosen). */
export function reported(rec: Recording): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of rec.cases) if (eventOf(c) === 'SessionStart' && typeof c.env?.[SOCKET_VAR] === 'string') out.set(String(c.payload.session_id), c.env[SOCKET_VAR]);
  return out;
}
/** Whether an entry's origin.from names a reported path: the path behind `uds:` (owner's comment), macOS's /private/tmp read as /tmp. */
export function joins(from: unknown, path: string): boolean {
  if (typeof from !== 'string' || !path) return false;
  const norm = (p: string) => p.replace(/^uds:/, '').replace(/^\/private\/tmp\//, '/tmp/');
  return norm(from) === norm(path);
}
/** The recorded session whose reported address the message's origin.from names, if any, never its receiver. */
export function senderOf(rec: Recording, c: Case): string | undefined {
  const from = entryOf(rec, c)?.origin?.from;
  for (const [id, path] of reported(rec)) if (id !== c.payload.session_id && joins(from, path)) return id;
  return undefined;
}
/** A channel's server's name as its entry gives it: the origin's string field naming it (server, source or name), else its only other string. */
export function serverOf(entry: Line | undefined): { field: string; name: string } | undefined {
  const origin = entry?.origin;
  if (!isObj(origin)) return undefined;
  const strings = Object.entries(origin).filter(([k, v]) => k !== 'kind' && typeof v === 'string' && v.length > 0) as [string, string][];
  const named = strings.find(([k]) => /server|source|name/i.test(k)) ?? (strings.length === 1 ? strings[0] : undefined);
  return named && { field: `origin.${named[0]}`, name: named[1] };
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dl3405-'));
  made.push(dir);
  return dir;
}

// ---- Processes and listeners this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
const servers: net.Server[] = [];
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s), closes its inboxes and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  // deadline: a process gets 3 s to exit on SIGTERM before SIGKILL.
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const s of servers.splice(0)) s.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account, or reach a forge; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK'];
/** The environment a child gets: HOME the test's home, and no DEEP_, GIT_, XDG_, CLAUDE or CODEX settings, forge tokens or billing keys of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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
    // deadline: the caller's bound on the command, default 60 s.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

/** Your ask settings (#319's shape), with no batching, so every ask shows when it's raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; base: string }
/**
 * `<tmp>/h` is HOME for every process: `<home>/.deepbuild` holds the shipped default guards and your ask settings.
 * `<tmp>/repo` is a git repository with one commit on main (`base`). `<tmp>/confirm` says `confirmed`
 * (DEEP_HUB_TEST_CONFIRM) and `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS, with no definitions.
 */
export function makeWorld(): World {
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
  writeFileSync(join(repo, 'src/cart.js'), 'module.exports = { total: (xs) => xs.reduce((a, b) => a + b, 0) };\n');
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0' }, null, 2)}\n`);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: 'acct-dl3405-0001', emailAddress: 'you@example.test' }, numStartups: 3, projects: {} }, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, base };
}
/** A worktree of the world's repo at `<tmp>/<name>`, on a new branch from main's base. Returns its real path. */
export function worktree(w: World, name: string, branch: string): string {
  const path = join(w.tmp, name);
  git(w.repo, ['worktree', 'add', '-q', '-b', branch, path, w.base]);
  return realpathSync(path);
}
/** The projects' trust decision as #348 records it (`openTrust`, before the hub starts), and Claude Code's workspace trust. */
export async function trust(w: World, folders: string[]): Promise<void> {
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openTrust } = await import('../../../packages/extension-host/src/index.ts');
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const t = await openTrust({ record, now: Date.now });
    for (const folder of [w.repo, ...folders]) await t.answer({ writer: 'app', actor: 'you', scope: 'you' }, folder, true);
  } finally {
    await record.close();
  }
  const claude = JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8')) as Line;
  for (const folder of [w.repo, ...folders]) claude.projects[folder] = { allowedTools: [], hasTrustDialogAccepted: true };
  writeFileSync(join(w.home, '.claude.json'), `${JSON.stringify(claude, null, 2)}\n`);
}

/**
 * A session's inbox: a Unix socket listening at `<tmp>/cc-socks/<pid>.sock`, named for the agent process that owns it as
 * Claude Code names its own (`/tmp/cc-socks/<pid>.sock`). It takes connections and reads nothing; DeepBuild sends it nothing.
 */
export async function inbox(w: World, pid: number): Promise<string> {
  const dir = join(w.tmp, 'cc-socks');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${pid}.sock`);
  const server = net.createServer((sock) => sock.destroy());
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve()); });
  return path;
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
/** Starts `deep hub run` with the base's test settings and, for a planted wrong program, DEEP_HUB_PLANT. A hub that doesn't start is BLOCKED. */
export async function startHub(w: World, plant?: string): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_STOP_HOLD_MS: '20000', ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-20_000)));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    // deadline: a hub that hasn't said ready in 2 minutes didn't start.
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${err.slice(-1500)}`);
  own(Number(ready.pid ?? child.pid));
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), root: w.root, child, exit, stderr: () => err };
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
export function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    // deadline: the hub answers a read within 30 s or the read failed.
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
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line; [key: string]: unknown }
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
/** Reads the log until `done` holds, or `timeoutMs` passes; resolves with the last read either way. */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  // deadline: the caller's bound on how long the record may take to show what it waits for.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 700)}` : 'no event');
export const listed = (events: readonly Ev[]): string => events.map(said).join('; ') || 'none';
export const asksAfter = (events: readonly Ev[], since: number): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since);

// ---- Naming a session: by its ID, its letters (the hub's `session:<letters>` handle) or its first 8 characters.
export const lettersOf = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
export const short = (id: string): string => id.slice(0, 8);
export const names = (text: string, id: string): boolean => text.includes(id) || text.includes(lettersOf(id)) || text.includes(short(id));
/** The user.ask events of a session, in order. */
export const asksOf = (events: readonly Ev[], session: string): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === session);
/** A prompt's user.ask: the `nth` (0-based) of the session's whose text is the prompt. */
export const promptAsk = (events: readonly Ev[], session: string, text: string, nth = 0): Ev | undefined => asksOf(events, session).filter((e) => e.data?.text === text)[nth];
/**
 * What the record says of a prompt's sender (README, Surfaces): the prompt's user.ask with its text left out, and every
 * other event that names that user.ask's ID. Read for the sessions it names and the values it holds.
 */
export function senderRecord(events: readonly Ev[], ask: Ev): string {
  const { text: _text, ...rest } = ask.data ?? {};
  const linked = events.filter((e) => e.id !== ask.id && JSON.stringify(e.data ?? {}).includes(ask.id));
  return JSON.stringify([rest, ...linked.map((e) => ({ kind: e.kind, data: e.data }))]);
}
/** The sessions among `ids` the record names as a prompt's sender, by full ID or letters (never by text). */
export const sendersNamed = (events: readonly Ev[], ask: Ev, ids: readonly string[]): string[] => {
  const blob = senderRecord(events, ask);
  return ids.filter((id) => blob.includes(id) || blob.includes(lettersOf(id)));
};
/** An ask's words: everything its data holds, as text. */
export const askText = (e: Ev): string => JSON.stringify(e.data ?? {});
/** The option of an ask whose id or label says "go on", as `deep inbox answer` takes it. */
export const goOnOption = (e: Ev): string | undefined => {
  const options = (Array.isArray(e.data?.options) ? e.data.options : Array.isArray(e.data?.ask?.options) ? e.data.ask.options : []) as Line[];
  return options.find((o) => /go.?on/i.test(`${o.id} ${o.label}`))?.id as string | undefined;
};

// ---- What a hook's reply told the agent, and whether it let the prompt go.
export function toldBy(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  if (!out) return r.code === 2 ? r.stderr : r.stdout.trim();
  const parts = [out.hookSpecificOutput?.additionalContext, out.reason, out.hookSpecificOutput?.permissionDecisionReason, r.code === 2 ? r.stderr : undefined];
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}
/** A hook deep-hook answered without the hub: past its deadline it spools the event and says so on stderr. */
export const late = (r: Ran): boolean => /deep-hook: spooled|missed its deadline/.test(r.stderr);
/** What deep-hook's output tells the agent: exit 2 or a deny/block decision stops the prompt; exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow' || d === 'approve')) return 'allow';
  return 'other';
}
/**
 * A hold that must have come: when the reply let the prompt go but came back without the hub's answer (past deep-hook's
 * deadline, on a loaded machine), nothing the hub decided can be read from it, so the reading is INCONCLUSIVE.
 */
export function heldMust(r: Ran, message: string): void {
  if (decision(r) === 'deny') return;
  if (late(r)) throw Error(`INCONCLUSIVE: ${message} (but its reply came back without the hub's answer, past deep-hook's deadline, at a 1-minute load of ${loadavg()[0]!.toFixed(0)} on ${availableParallelism()} cores)`);
  throw Error(`${message}: ${shown(r)}`);
}

// ---- Each session's agent process (fixtures/agent.mjs): the parent of every deep-hook run of that session.
class Agent {
  private static n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(readonly child: ChildProcess) {
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
        done?.(line);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
  }
  get pid(): number { return this.child.pid!; }
  static start(w: World, cwd: string, hook: string): Agent {
    const child = spawn(NODE, [AGENT, hook], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, env: Record<string, string>, timeoutMs: number): Promise<Ran> {
    const n = ++Agent.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve as (line: Line) => void);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, env, timeoutMs })}\n`);
    });
  }
}

const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
/** Who sent a message: the address its entry's origin.from gives, the process its agent verified, and its name. */
export interface Peer { address: string; pid: number; name: string }
/** A message's prompt as Claude Code 2.1.308 wraps it for the receiving session. */
export const wrap = (from: Peer, body: string): string => `<cross-session-message from="${from.address}" from-name="${from.name}" from-mode="prompting">\n${body}\n</cross-session-message>`;

/**
 * A Claude Code session: its transcript, its own Claude Code process (fixtures/agent.mjs), the variables that process
 * exports to every hook (`env`: its inbox's CLAUDE_CODE_MESSAGING_SOCKET and _TOKEN), and its hooks through deep-hook.
 */
export class ClaudeSession {
  readonly transcript: string;
  prompt: string | undefined;
  private parentUuid: string | null = null;
  private turn = 0;
  private constructor(readonly w: World, readonly cwd: string, readonly id: string, readonly agent: Agent, public env: Record<string, string>) {
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  /** A session in `cwd`: `id` a recorded one or a new one; `hook` the deep-hook binary its hooks run (the built one by default). */
  static open(w: World, cwd: string, o: { id?: string; env?: Record<string, string>; hook?: string } = {}): ClaudeSession {
    return new ClaudeSession(w, cwd, o.id ?? randomUUID(), Agent.start(w, cwd, o.hook ?? DEEP_HOOK), o.env ?? {});
  }
  /** A session with an inbox of its own: its address exported to its hooks with a token, as Claude Code does before any hook runs. */
  static async withInbox(w: World, cwd: string, name = `work-${tag(2)}`): Promise<ClaudeSession & { peer: Peer }> {
    const s = ClaudeSession.open(w, cwd);
    const address = await inbox(w, s.agent.pid);
    s.env = { [SOCKET_VAR]: address, [TOKEN_VAR]: tag(16) };
    return Object.assign(s, { peer: { address: `uds:${address}`, pid: s.agent.pid, name } });
  }
  get pid(): number { return this.agent.pid; }
  /** Appends one transcript entry as written (a recorded one), keeping the chain of parents. */
  raw(entry: Line): void {
    if (typeof entry.uuid === 'string') this.parentUuid = entry.uuid;
    writeFileSync(this.transcript, `${JSON.stringify(entry)}\n`, { flag: 'a' });
  }
  entry(value: Line): void {
    const uuid = randomUUID();
    this.raw({ parentUuid: this.parentUuid, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: NEWEST, gitBranch: 'HEAD' });
  }
  /** `deep-hook claude-code <event>` with a whole payload on stdin, the session's env laid over its agent's, as a child of its agent process. */
  fire(event: string, payload: Line, env: Record<string, string> = {}, timeoutMs = 150_000): Promise<Ran> {
    return this.agent.run(['claude-code', event], this.cwd, JSON.stringify(payload), { ...this.env, ...env }, timeoutMs);
  }
  hook(event: string, fields: Line = {}): Promise<Ran> {
    return this.fire(event, { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields });
  }
  async start(): Promise<Ran> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook of ${this.id} must end with exit 0: ${shown(r)}`);
    return r;
  }
  private async submit(text: string, entry: Line): Promise<Ran> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: entry.content ?? text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry, ...(entry.content ? { content: undefined } : {}) });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook of ${this.id} must end with exit 0 or 2: ${shown(r)}`);
    return r;
  }
  /** A prompt you typed (turnOrigin human): origin `person`. */
  typed(text: string): Promise<Ran> { return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }); }
  /**
   * A message from another session as Claude Code 2.1.308 writes it in the terminal (docs/spikes/3406/logs/
   * 2.1.308-terminal-manual-target-sibling.jsonl): queued, then its entry with turnOrigin peer and origin.from the
   * sender's inbox address (`uds:<path>`) beside the process it verified; the prompt is the wrapped message.
   */
  async message(from: Peer, body: string): Promise<Ran> {
    const wrapped = wrap(from, body);
    this.raw({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: this.id, content: wrapped });
    this.raw({ type: 'queue-operation', operation: 'dequeue', timestamp: new Date().toISOString(), sessionId: this.id });
    return this.submit(wrapped, {
      isMeta: true, permissionMode: 'default', promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer',
      content: `Another Claude session sent a message:\n${wrapped}`,
      origin: { kind: 'peer', from: from.address, verifiedPeerPid: from.pid, msg_id: randomUUID(), name: from.name, fromMode: 'prompting', body },
    });
  }
  /**
   * A prompt shaped as a recorded one: the recorded entry (its origin as recorded) under a new prompt ID in this
   * session, and the recorded prompt's text, then its UserPromptSubmit.
   */
  async like(entry: Line, prompt: string): Promise<Ran> {
    this.prompt = randomUUID();
    const origin = isObj(entry.origin) ? { ...entry.origin, ...(typeof entry.origin.msg_id === 'string' ? { msg_id: randomUUID() } : {}) } : entry.origin;
    this.raw({ ...entry, origin, parentUuid: this.parentUuid, uuid: randomUUID(), promptId: this.prompt, timestamp: new Date().toISOString(), sessionId: this.id, cwd: this.cwd });
    const r = await this.hook('UserPromptSubmit', { prompt });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook of ${this.id} must end with exit 0 or 2: ${shown(r)}`);
    return r;
  }
  async stop(words = 'Done.'): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/** `deep <args…>` from your terminal: the test process, outside every session's process tree. */
export function deep(w: World, args: string[]): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm }), cwd: w.tmp, timeoutMs: 120_000 });
}
/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export function answer(w: World, ask: Ev, option: string): Promise<Ran> {
  return deep(w, ['inbox', 'answer', `ask:${ask.id}`, option]);
}

// ---- A recorded session replayed through deep-hook into a real hub (README, Replaying a recording).
export interface Replay { rec: Recording; sessions: Map<string, ClaudeSession>; folders: string[]; fired: Map<Case, Ran> }
/**
 * Sets up a replay: one worktree and one agent process per recorded session, each with its transcript in this world.
 * Trust and the hub come after (the worktrees must exist before trust is recorded).
 */
export function prepare(w: World, rec: Recording): Replay {
  const ids = [...new Set(rec.cases.map((c) => String(c.payload?.session_id ?? '')).filter(Boolean))];
  const sessions = new Map<string, ClaudeSession>();
  const folders: string[] = [];
  ids.forEach((id, i) => {
    const cwd = worktree(w, `r${i}`, `replay/s${i}`);
    folders.push(cwd);
    const start = rec.cases.find((c) => c.payload?.session_id === id && eventOf(c) === 'SessionStart');
    sessions.set(id, ClaudeSession.open(w, cwd, { id, env: { ...(start?.env ?? {}) } }));
  });
  return { rec, sessions, folders, fired: new Map() };
}
/**
 * Replays every recorded hook but SessionEnd, in the recorded order, each through deep-hook as a child of its session's
 * agent process with the env its line records laid over its session's. Each session's transcript entries are written
 * ahead of its hooks up to the next prompt not yet submitted, so a prompt's entry is there when its hook reads it.
 * SessionEnd is left out so both sessions stay live for what a test does next.
 */
export async function replay(r: Replay): Promise<void> {
  const first = [...r.sessions.keys()][0]!;
  const pending = new Map<string, Line[]>([...r.sessions.keys()].map((id) => [id, []]));
  for (const e of r.rec.transcript) (pending.get(String(e.sessionId)) ?? pending.get(first)!).push(e);
  const prompts = new Map<string, Set<string>>([...r.sessions.keys()].map((id) => [id, new Set(r.rec.cases.filter((c) => c.payload?.session_id === id && eventOf(c) === 'UserPromptSubmit').map((c) => String(c.payload.prompt_id)))]));
  const submitted = new Set<string>();
  for (const c of r.rec.cases) {
    const id = String(c.payload?.session_id ?? '');
    const s = r.sessions.get(id);
    if (!s || eventOf(c) === 'SessionEnd') continue;
    if (eventOf(c) === 'UserPromptSubmit') submitted.add(String(c.payload.prompt_id));
    const queue = pending.get(id)!;
    while (queue.length) {
      const e = queue[0]!;
      if (typeof e.promptId === 'string' && prompts.get(id)!.has(e.promptId) && !submitted.has(e.promptId)) break;
      queue.shift();
      s.raw(typeof e.cwd === 'string' ? { ...e, cwd: s.cwd } : e);
    }
    const ran = await s.fire(eventOf(c), { ...c.payload, transcript_path: s.transcript, cwd: s.cwd }, { ...(c.env ?? {}) });
    r.fired.set(c, ran);
  }
}

// ---- Reading what reached the hub for a secret (AC7).
/** A value's forms a report could carry: itself, its first and last 12 characters, its SHA-256 and its base64. */
export function forms(value: string): string[] {
  return [value, value.slice(0, 12), value.slice(-12), createHash('sha256').update(value).digest('hex'), Buffer.from(value).toString('base64')];
}
/** The JSON paths in `value` whose string holds any of `needles`, as `a.b[0].c`. */
export function pathsHolding(value: unknown, needles: readonly string[], at = ''): string[] {
  if (typeof value === 'string') return needles.some((n) => value.includes(n)) ? [at || '(the whole value)'] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsHolding(v, needles, `${at}[${i}]`));
  if (isObj(value)) return Object.entries(value).flatMap(([k, v]) => [...(needles.some((n) => k.includes(n)) ? [`${at ? `${at}.` : ''}${k} (its name)`] : []), ...pathsHolding(v, needles, at ? `${at}.${k}` : k)]);
  return [];
}
/** Every file under `dir` whose bytes hold any of `needles`, by its path from `dir`. */
export function filesHolding(dir: string, needles: readonly string[], from = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return filesHolding(path, needles, from);
    if (!d.isFile() || statSync(path).size > 256 * 1024 * 1024) return [];
    const bytes = readFileSync(path);
    return needles.some((n) => bytes.includes(Buffer.from(n))) ? [path.slice(from.length + 1)] : [];
  });
}
/** deep-hook's spooled requests: what it would have sent the hub, byte for byte (design: Hook protocol). */
export const spooled = (w: World): Line[] => {
  const file = join(w.root, 'spool', 'spool.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').flatMap((l) => (l.trim() ? [parseObject(l) ?? { unreadable: l }] : [])) : [];
};

// ---- A copy of part of the corpus, for `node scripts/corpus.mjs replay --corpus <copy>`.
export function corpusCopy(w: World, names: readonly string[]): string {
  const out = join(w.tmp, 'corpus');
  for (const name of names) cpSync(join(SET, name), join(out, 'claude-code', NEWEST, name), { recursive: true });
  return out;
}
