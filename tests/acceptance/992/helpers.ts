// Test-side tools for #992's acceptance tests (README.md): temp homes, the hub as a process (`deep hub run`) on the
// hub's test clock, its socket's `events.read`, `inbox.read` and `test.clock`, `deep status` as the CLI prints it, the
// Claude Code stand-in (fixtures/agent.mjs) whose hooks are the real deep-hook binary, the replay of a recorded session
// (adapters/corpus/claude-code) or of this suite's stand-in session (fixtures/sessions), and the app's sidebar row read
// in the replica (app.rs). Parts are adapted from tests/acceptance/83/helpers.ts and 18/binding/helpers.ts (same repo,
// same license); this suite keeps its own copy so a redraft of those never moves it.
//
// Safety: every folder is under /tmp/dh992-* (a socket path must fit in 104 bytes on macOS); HOME is a temp folder for
// every process a test starts, so nothing reads or writes the real ~/.deepbuild or ~/.claude. cargo, which builds and
// runs the replica, gets the toolchain's own CARGO_HOME and RUSTUP_HOME and the temp HOME. Processes are stopped by
// PID only, never by name or port. No test runs a live agent or reaches the network.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { activePlant } from '@deepbuild/hub';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const HERE = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const AGENT = join(HERE, 'fixtures/agent.mjs');
const STUB = join(HERE, 'fixtures/stub-bin.sh');
export const STAND_INS = join(HERE, 'fixtures/sessions');
export const CORPUS = join(REPO, 'adapters/corpus/claude-code');

// ---- The criteria's IDs (README: Criteria to tests): the first 8 hex digits of SHA-256 of each criterion's text.
export const AC1 = 'AC1 #992.45c71d36';
export const AC2 = 'AC2 #992.34978db2';
export const AC3 = 'AC3 #992.45c506d1';
export const AC4 = 'AC4 #992.f70129f6';

/** The replica's clock (deep_replica::NOW): a record handed to the app has its times moved so the hub's now falls on it. */
export const NOW = 1_800_000_000_000;
/** The issue's ten minutes with no hook. */
export const TEN_MINUTES = 600_000;
/** The words `deep status` gives a session's state (packages/hub/src/status.ts), and so the app's row must too. */
export const WORDS = ['needs you', 'stuck', 'flagged', 'working', 'finished', 'quiet'] as const;
export type Word = (typeof WORDS)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });

/** The newest Claude Code version the facts cover. */
export const COVERED = (() => {
  const v = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions;
  return v[v.length - 1]!;
})();

// ---- Temp folders, and the processes this suite started (stopped by PID only).
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh992-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes its temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A fresh home: `<tmp>/h` is HOME; `<tmp>/bin` first on PATH holds stand-ins for claude, launchctl and systemctl. */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(STUB, join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  return { tmp, home, bin };
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE, XDG, forge or billing variable of this process's, then `extra`. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C', PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}` });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${String(error)}`, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-2500))}`;

/** BLOCKED unless the built CLI and deep-hook are there (README: How to run). */
export function built(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the CLI isn't built (${CLI}); run npm run build --workspaces`);
  if (!existsSync(HOOK)) throw Error(`BLOCKED: deep-hook isn't built (${HOOK}); run cargo build -p deep-hook`);
}

// ---- The hub: `deep hub run`, its clock the wall clock's until test.clock steps it forward (DEEP_HUB_TEST_CLOCK_STEPS).
export interface Hub { pid: number; h: Home; socket: string; root: string; child: ChildProcess; plant?: string; output(): string }
export async function startHub(h: Home, plant?: string | undefined): Promise<Hub> {
  built();
  const env = childEnv(h, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_CLOCK_STEPS: '1' });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-20_000)));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out = (out + d).slice(-20_000);
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  const root = join(h.home, '.deepbuild');
  return { pid: child.pid!, h, socket: join(root, 'hub.sock'), root, child, ...(plant ? { plant } : {}), output: () => out };
}

// ---- The line protocol: a cli connection with the control token.
class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  static open(path: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path}`)); }, 5000);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, 30_000);
    if (!reply) throw Error(`no reply to ${method} within 30 s`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
/** Every event in the log, paged by log_pos through `events.read`. */
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
/** The asks in your inbox (`inbox.read`). */
export const inboxRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => ((await conn.call('inbox.read')).asks ?? []) as Line[]);
/** Steps the hub's clock forward by `ms` (test.clock) and gives the hub's time after it; 0 reads the time. */
export const stepClock = (hub: Hub, ms: number): Promise<number> => control(hub, async (conn) => Number((await conn.call('test.clock', { advance_ms: ms })).now));

// ---- `deep status`, as the CLI prints it (packages/hub/src/status.ts: render).
export interface StatusRead { state: Word | string | undefined; why: string; text: string }
/** `deep status` with HOME the test's home. */
export async function deepStatus(h: Home, plant?: string): Promise<string> {
  const r = await run(NODE, [CLI, 'status'], { env: childEnv(h, { DEEP_HUB_PLANT: plant }), timeoutMs: 60_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep status must read the hub and exit 0: ${shown(r)}`);
  return r.stdout;
}
/**
 * What `deep status` says of one session: its row's state and why (`  <id8>  <state>  <agent>  <why>`), or, with no row,
 * quiet when the folded line counts it (`<n> quiet, by repo: …`; every hub here holds one session).
 */
export function statusOf(text: string, session: string): StatusRead {
  const row = text.split('\n').find((l) => l.startsWith(`  ${session.slice(0, 8)}  `));
  if (row) {
    const [, state = '', , why = ''] = row.trim().split(/\s{2,}/);
    return { state, why, text };
  }
  if (/^\d+ quiet, by repo: /m.test(text)) return { state: 'quiet', why: '', text };
  return { state: undefined, why: '', text };
}
/** Polls `deep status` until the session reads `want` or `ms` pass; the last reading either way. */
export async function statusWithin(h: Home, session: string, ms: number, want: (s: StatusRead) => boolean, plant?: string): Promise<StatusRead> {
  const deadline = Date.now() + ms;
  for (;;) {
    const read = statusOf(await deepStatus(h, plant), session);
    if (want(read) || Date.now() >= deadline) return read;
    await sleep(250);
  }
}

// ---- Recorded sessions: the corpus's (adapters/corpus/claude-code/<version>/<name>/) and this suite's stand-ins.
export interface CaseLine { payload: Line; tag?: string; expect?: Line[] }
export interface Recorded { name: string; source: 'corpus' | 'stand-in'; dir: string; version: string; lines: CaseLine[]; transcript: string }
const versionKey = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? p.padStart(8, '0') : p)).join('.');
function load(name: string, source: Recorded['source'], dir: string, version: string): Recorded {
  const lines = jsonLines(readFileSync(join(dir, 'events.jsonl'), 'utf8')) as CaseLine[];
  const transcript = existsSync(join(dir, 'transcript.jsonl')) ? readFileSync(join(dir, 'transcript.jsonl'), 'utf8') : '';
  return { name, source, dir, version, lines, transcript };
}
/** The corpus's recorded Claude Code session of this name, from the newest version set holding it; undefined if none does. */
export function recorded(name: string): Recorded | undefined {
  if (!existsSync(CORPUS)) return undefined;
  const versions = readdirSync(CORPUS).filter((v) => existsSync(join(CORPUS, v, name, 'events.jsonl'))).sort((a, b) => versionKey(b).localeCompare(versionKey(a)));
  return versions[0] ? load(name, 'corpus', join(CORPUS, versions[0], name), versions[0]) : undefined;
}
/** The recorded session, or BLOCKED naming the folder and tags the README asks the corpus to hold. */
export function mustRecord(name: string, what: string): Recorded {
  const r = recorded(name);
  if (!r) throw Error(`BLOCKED: no recorded session adapters/corpus/claude-code/<version>/${name}/ (${what}); README: What the implementation must provide, 1`);
  return r;
}
/** This suite's stand-in for the recorded session (fixtures/sessions/<name>/), written from Claude Code's hooks reference. */
export const standIn = (name: string): Recorded => load(name, 'stand-in', join(STAND_INS, name), COVERED);
export const label = (r: Recorded) => (r.source === 'corpus' ? `adapters/corpus/claude-code/${r.version}/${name(r)}` : `tests/acceptance/992/fixtures/sessions/${name(r)}`);
const name = (r: Recorded) => r.name;
export const hookOf = (l: CaseLine): string => String(l.payload.hook_event_name);
export const tagged = (r: Recorded, tag: string): number => r.lines.findIndex((l) => l.tag === tag);
/** The line tagged `tag`, or BLOCKED naming the session and the tag. */
export function mustTag(r: Recorded, tag: string, hook: string): number {
  const at = tagged(r, tag);
  if (at < 0 || hookOf(r.lines[at]!) !== hook) throw Error(`BLOCKED: ${label(r)} holds no ${hook} tagged ${tag} (README: What the implementation must provide, 1)`);
  return at;
}

// ---- The Claude Code stand-in: one process, deep-hook its direct child per hook.
export class Agent {
  private n = 0;
  private readonly waiting = new Map<number, (line: Line) => void>();
  private constructor(readonly child: ChildProcess, readonly h: Home) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.waiting.get(line.n)?.(line);
    });
  }
  static start(h: Home, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, h);
  }
  get pid(): number { return this.child.pid!; }
  hook(event: string, payload: Line, cwd: string): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(n); reject(Error(`the agent stand-in gave no answer to ${event} in 90 s`)); }, 90_000);
      this.waiting.set(n, (line) => {
        clearTimeout(timer);
        this.waiting.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${event}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, op: 'hook', binary: HOOK, event, payload, cwd })}\n`);
    });
  }
  /** The terminal closes under the agent: its process is killed (SIGKILL, by PID), and gone. */
  async kill(): Promise<number> {
    process.kill(this.pid, 'SIGKILL');
    while (alive(this.pid)) await sleep(20);
    return Date.now();
  }
}

/**
 * One recorded session replayed into a hub of its own: its transcript copied where Claude Code keeps it under the
 * test's home, then each recorded hook payload, in order, through deep-hook run by the stand-in, with the recorded
 * working folder and transcript path moved into the test's folders and nothing else changed.
 */
export interface Replay { h: Home; hub: Hub; agent: Agent; session: string; cwd: string; transcript: string; recordedCwd: string; r: Recorded; replies: Line[] }
export async function replay(r: Recorded, o: { plant?: string | undefined; through?: number } = {}): Promise<Replay> {
  const h = makeHome();
  const hub = await startHub(h, o.plant);
  const first = r.lines[0]?.payload;
  if (!first) throw Error(`BLOCKED: ${label(r)} has no recorded hook`);
  const session = String(first.session_id);
  const recordedCwd = String(first.cwd);
  const cwd = join(h.tmp, 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  const entries = r.transcript.split(recordedCwd).join(cwd).split('\n').filter((l) => l.trim());
  writeFileSync(transcript, '');
  const agent = Agent.start(h, cwd);
  const replies: Line[] = [];
  const lines = r.lines.slice(0, o.through === undefined ? undefined : o.through + 1);
  const out: Replay = { h, hub, agent, session, cwd, transcript, recordedCwd, r, replies };
  // The transcript grows as the session ran: before each hook it holds every entry up to the last one naming a prompt
  // or call a hook so far named, and once a whole recording is replayed, all of it, as the recording left it.
  const ids: string[] = [];
  let written = 0;
  const grow = (upTo: number) => {
    if (upTo <= written) return;
    appendFileSync(transcript, `${entries.slice(written, upTo).join('\n')}\n`);
    written = upTo;
  };
  for (const line of lines) {
    for (const key of ['prompt_id', 'tool_use_id']) if (typeof line.payload[key] === 'string') ids.push(line.payload[key]);
    let last = -1;
    entries.forEach((e, i) => { if (ids.some((id) => e.includes(id))) last = i; });
    grow(last + 1);
    replies.push(await send(out, line.payload));
  }
  if (o.through === undefined) grow(entries.length);
  await settle(hub);
  return out;
}
/** The first recorded line tagged `tag` for `hook` in any Claude Code set (newest version first), or undefined. */
export function taggedLine(tag: string, hook: string): { r: Recorded; line: CaseLine } | undefined {
  if (!existsSync(CORPUS)) return undefined;
  for (const version of readdirSync(CORPUS).sort((a, b) => versionKey(b).localeCompare(versionKey(a)))) {
    for (const session of readdirSync(join(CORPUS, version))) {
      if (!existsSync(join(CORPUS, version, session, 'events.jsonl'))) continue;
      const r = load(session, 'corpus', join(CORPUS, version, session), version);
      const line = r.lines.find((l) => l.tag === tag && hookOf(l) === hook);
      if (line) return { r, line };
    }
  }
  return undefined;
}
/** One recorded payload sent into a replay's session: its session, working folder and transcript path moved to the replay's. */
export function send(rp: Replay, recordedPayload: Line): Promise<Line> {
  const moved = parseObject(JSON.stringify(recordedPayload).split(String(recordedPayload.cwd ?? rp.recordedCwd)).join(rp.cwd))!;
  Object.assign(moved, { session_id: rp.session, cwd: rp.cwd, transcript_path: rp.transcript });
  return rp.agent.hook(String(recordedPayload.hook_event_name), moved, rp.cwd);
}
/** Waits until the log stops growing for half a second (at most 10 s): what the hooks started is recorded. */
export async function settle(hub: Hub): Promise<void> {
  let last = -1;
  const deadline = Date.now() + 10_000;
  for (;;) {
    const n = (await allEvents(hub)).length;
    if (n === last || Date.now() > deadline) return;
    last = n;
    await sleep(500);
  }
}

// ---- The app's row in the replica (app.rs, README: The app's side).
export interface AppCase { name: string; events: Ev[] }
export interface AppRow { name: string; session: string; row: string; entry: string; glyph: string }
/**
 * The sidebar row the app draws for each case's record, read in the replica on gpui's virtual clock at NOW, the hub's
 * time once forApp moved the record: `cargo test -p deep-replica --test acceptance_992_app` with the cases in
 * DH992_APP_CASES, and DEEP_HUB_PLANT the plant in effect: the one a test names, else the hub's own (`activePlant`, its
 * public entry), which a proof lane's twin sets. BLOCKED when the target isn't registered or can't build or run here.
 */
export async function appRows(cases: readonly AppCase[], o: { plant?: string } = {}): Promise<Map<string, AppRow>> {
  const target = 'acceptance_992_app';
  const plant = o.plant ?? activePlant();
  const dir = tempDir();
  const manifest = cases.map((c, i) => {
    const fixture = join(dir, `${i}.events.jsonl`);
    writeFileSync(fixture, c.events.map((e) => JSON.stringify({ session_id: e.session ?? null, event: e })).filter((l) => !l.startsWith('{"session_id":null')).join('\n') + '\n');
    return { name: c.name, fixture };
  });
  const input = join(dir, 'cases.json');
  writeFileSync(input, JSON.stringify(manifest));
  const realHome = process.env.HOME ?? homedir();
  const home = join(dir, 'h');
  mkdirSync(home);
  const cargo = [join(realHome, '.cargo/bin/cargo'), 'cargo'].find((c) => c === 'cargo' || existsSync(c))!;
  const env: NodeJS.ProcessEnv = {
    PATH: `${join(realHome, '.cargo/bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home, LC_ALL: 'C',
    CARGO_HOME: process.env.CARGO_HOME ?? join(realHome, '.cargo'), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(realHome, '.rustup'),
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'),
    DH992_APP_CASES: input, ...(plant ? { DEEP_HUB_PLANT: plant } : {}),
  };
  const r = await run(cargo, ['test', '--locked', '-p', 'deep-replica', '--test', target], { env, cwd: REPO, timeoutMs: 1_800_000 });
  const rows = new Map<string, AppRow>();
  for (const l of r.stdout.split('\n')) {
    if (!l.startsWith('DH992 ')) continue;
    const row = parseObject(l.slice(6));
    if (row) rows.set(String(row.name), row as AppRow);
  }
  if (rows.size !== cases.length) {
    const why = /no test target named/.test(r.stderr) ? `crates/deep-replica/Cargo.toml registers no [[test]] ${target} (README: What the implementation must provide, 5)`
      : /could not compile|error\[/.test(r.stderr) ? 'the replica does not build here'
      : process.platform !== 'darwin' ? 'the replica runs on macOS only' : 'the replica did not read every case';
    throw Error(`BLOCKED: the app's side: ${why}: ${shown(r)}`);
  }
  return rows;
}
/** The state word an app row names: the one of `deep status`'s words it holds, case aside; several or none fails. */
export function wordOf(row: string): Word | string {
  const found = WORDS.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(row));
  return found.length === 1 ? found[0]! : `${found.length ? found.join(' and ') : 'none'} of ${WORDS.join(', ')}`;
}
/**
 * The record of a replay as the app gets it, read at the hub's time now: every event's `ts` moved by the same amount so
 * that the hub's now falls on the replica's NOW, and nothing else changed.
 */
export async function forApp(rp: Replay, name = rp.r.name): Promise<AppCase> {
  const now = await stepClock(rp.hub, 0);
  const events = (await allEvents(rp.hub)).map((e) => ({ ...e, ts: e.ts + (NOW - now) }));
  return { name, events };
}


// ---- What a recorded case must hold to be the case its criterion names (README: What the implementation must provide, 1).
/** Hooks that say the agent moved on past a prompt: none may follow a prompt denied with Esc or left open as its terminal closed. */
export const MOVED_ON = ['PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'UserPromptSubmit'];
/** BLOCKED when a hook `moves` names follows line `at` of the recording: it isn't the case the criterion names. */
export function nothingAfter(r: Recorded, at: number, moves: (l: CaseLine) => boolean, what: string): void {
  const later = r.lines.slice(at + 1).find(moves);
  if (later) throw Error(`BLOCKED: ${label(r)} isn't ${what}: a ${hookOf(later)}${later.payload.notification_type ? ` (${later.payload.notification_type})` : ''} follows its line ${at + 1}`);
}
/** The PreToolUse a PermissionRequest prompts for: the latest one before it of the same tool and input. */
export function callOf(r: Recorded, at: number): string {
  const p = r.lines[at]!.payload;
  for (let i = at - 1; i >= 0; i--) {
    const q = r.lines[i]!.payload;
    if (q.hook_event_name === 'PreToolUse' && q.tool_name === p.tool_name && JSON.stringify(q.tool_input) === JSON.stringify(p.tool_input)) return String(q.tool_use_id);
  }
  throw Error(`BLOCKED: ${label(r)} has no PreToolUse for the ${p.tool_name} call its line ${at + 1} prompts for`);
}
/** The line of the hook that answers call `call` (PostToolUse or PostToolUseFailure) after line `at`. */
export function answerOf(r: Recorded, at: number, call: string): number {
  const i = r.lines.findIndex((l, j) => j > at && ['PostToolUse', 'PostToolUseFailure'].includes(hookOf(l)) && l.payload.tool_use_id === call);
  if (i < 0) throw Error(`BLOCKED: ${label(r)} has no PostToolUse for call ${call} after its line ${at + 1}: its prompt wasn't answered`);
  return i;
}
