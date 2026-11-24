// Tools for #2750's acceptance tests (README: The world). Nothing here stands in for DeepBuild: the hub is the built
// `deep hub run` in a temp HOME, the CLI is the built `deep`, the record is seeded through the real record
// (packages/record) with the hub stopped, the repos are real git repositories under a temp folder, and GitHub is the
// fixture forge (forge.ts), real HTTP on 127.0.0.1. The fixture is fixture.ts's and the judges are judges.ts's.
//
// Adapted from tests/acceptance/26/helpers.ts (a home, the hub as a process, its socket's line protocol, seeding with
// the hub stopped) and tests/acceptance/46/helpers.ts (the child environment, the forge's settings), same repo, same
// license; this suite keeps its own copy, so a redraft of theirs never moves these tests.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild; no network but 127.0.0.1; no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { Month, REPO_NAME, Shop, YOU, type Planned } from './fixture.ts';
import { readingOf, type Row } from './judges.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** The token the hub reads and could post with: the fixture forge takes any. */
export const TOKEN = 'test-gate-token';

// Each criterion's ID, as scripts/proof-change.mjs's criterionId computes it from the issue's text.
export const AC1 = 'AC1 #2750.8eb13c6b';
export const AC2 = 'AC2 #2750.230902ce';
export const AC3 = 'AC3 #2750.8f4da496';
export const AC4 = 'AC4 #2750.6b561f56';
export const AC5 = 'AC5 #2750.099939a8';
export const AC6 = 'AC6 #2750.e41e681f';

/** A test's limit: a hub's start can take minutes on a loaded machine, and no test waits on the clock for anything else. */
export const TIMEOUT = 15 * 60_000;
/** How long a test waits before it says nothing was posted, raised or sent. */
export const QUIET_MS = 5000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

// ---- Temp folders and processes. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2750-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closing: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID, closes the forges and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await Promise.all(closing.splice(0).map((close) => close().catch(() => undefined)));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const rootOf = (home: string): string => join(home, '.deepbuild');
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** What a child gets: HOME the test's home and none of this process's DEEP_, CLAUDE*, CODEX*, GIT_, GH_ or OTEL_ settings or tokens. */
function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|OTEL_|GH_|GITHUB_|TMUX)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
interface Ran { code: number | null; stdout: string; stderr: string }
function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

// ---- The record: the fixture's events, appended through the real record with the hub stopped.
type Obj = Record<string, unknown>;
/** The published fixture of `verdict.made@2` with this outcome: the rest of a verdict's data, which this suite doesn't set. */
function verdictData(outcome: unknown): Obj {
  const found = (fixtures('verdict.made@2') as unknown as { data: Obj }[]).find((f) => f.data.outcome === outcome) ?? blocked(`verdict.made@2 publishes no fixture with outcome ${String(outcome)}`);
  return structuredClone(found.data);
}
/** Seeds `<home>/.deepbuild/ledger.db` with the fixture's events, oldest first, each at its own time; then closes it. */
export async function seed(home: string, events: readonly Planned[]): Promise<void> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  let now = events[0]?.ts ?? Date.now();
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  try {
    for (const e of events) {
      now = e.ts;
      let data: Obj = e.data;
      if (e.kind === 'verdict.made') {
        const rest = verdictData(e.data.outcome);
        data = { ...rest, ...e.data, key: { ...(rest.key as Obj), commit: e.data.commit } };
      }
      await record.append(
        { writer: e.writer, actor: 'you', scope: 'you', project: 'shop', ...(e.session ? { session: e.session } : {}), ...(e.writer === 'hook' ? { agent: 'claude-code' } : {}) },
        { v: e.v, id: e.id, kind: e.kind, ts: e.ts, ...(e.subject ? { subject: e.subject } : {}), data: data as never },
      );
    }
  } finally {
    await record.close();
  }
}

// ---- The hub as a process, and its socket's line protocol (#16).
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
/** `deep hub run` with HOME at `home`, the fixture forge as GitHub and a token it could post with. */
async function startHub(home: string, forge: string): Promise<Hub> {
  if (!existsSync(CLI)) blocked(`the hub and the CLI run from dist/, and ${CLI.slice(REPO.length + 1)} isn't built: run \`npm run build --workspaces\``);
  const tmp = dirname(home);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  writeFileSync(join(tmp, 'work.json'), JSON.stringify({ readings: [] }));
  const env = childEnv(home, { DEEP_HUB_TEST_FORGE: forge, GH_TOKEN: TOKEN, DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), DEEP_HUB_TEST_WORK: join(tmp, 'work.json') });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) blocked(`the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out };
}
/** SIGTERM to the hub, by its PID, and waits for it to exit. */
async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { owned.delete(hub.pid); return; }
  const deadline = Date.now() + 60_000;
  while (alive(hub.pid) && hub.child.exitCode === null && hub.child.signalCode === null && Date.now() < deadline) await sleep(25);
  if (hub.child.exitCode === null && hub.child.signalCode === null) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (hub.child.exitCode === null && hub.child.signalCode === null) await sleep(25);
  owned.delete(hub.pid);
}
/** One connection holding the control token, read from `<home>/.deepbuild/control.token`, as `deep` holds it. */
class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private closed = false;
  private readonly sock: net.Socket;
  private constructor(sock: net.Socket) {
    this.sock = sock;
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.closed = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  static async open(hub: Hub): Promise<Conn> {
    const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
    const conn = new Conn(net.connect(hub.socket));
    if (!(await conn.line((lines) => lines[0], 60_000))) blocked(`no hello from the hub at ${hub.socket}`);
    conn.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const answer = await conn.line((lines) => lines[1], 60_000);
    if (answer?.role !== 'cli') blocked(`the hub refused the cli hello: ${JSON.stringify(answer)}`);
    return conn;
  }
  private line(pick: (lines: Line[]) => Line | undefined, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        const found = pick(this.lines);
        if (found || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  /** One method call; resolves with its result, and a refusal or no reply is BLOCKED. */
  async call(method: string, params: Line, timeoutMs: number): Promise<Line> {
    const id = `t2750#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.line((lines) => lines.find((l) => l.id === id), timeoutMs);
    if (!reply) blocked(`no reply to ${method} within ${timeoutMs} ms`);
    if (!('result' in reply!)) blocked(`${method} was refused: ${JSON.stringify(reply!.error).slice(0, 600)}`);
    return reply!.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub);
  try { return await use(conn); } finally { conn.close(); }
}
/** The rows `numbers.read` gives: every reading, as the Numbers list holds them. */
export const numbersRead = (hub: Hub): Promise<unknown[]> => control(hub, async (conn) => {
  const rows = (await conn.call('numbers.read', {}, 300_000)).rows as unknown;
  return Array.isArray(rows) ? rows : blocked(`numbers.read gave no rows: ${JSON.stringify(rows).slice(0, 300)}`);
});
export interface Ev { id: string; kind: string; ts: number; data: Line; log_pos: number; session?: string; subject?: string }
/** Every event in the hub's log, paged by log_pos through `events.read`. */
export const eventsRead = (hub: Hub): Promise<Ev[]> => control(hub, async (conn) => {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const page = (await conn.call('events.read', { after, limit: 1000 }, 120_000)).events as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page.at(-1)!.log_pos;
  }
});

// ---- The world: a fixture, a home whose record holds the fixture's events, and the hub that reads both.
export class World<F extends Shop | Month> {
  readonly tmp: string;
  readonly home: string;
  readonly fixture: F;
  hub: Hub | undefined;
  private constructor(tmp: string, home: string, fixture: F) {
    this.tmp = tmp;
    this.home = home;
    this.fixture = fixture;
  }
  /**
   * Builds the fixture under a temp folder, writes your settings with the repo's delivery rule on, so a status could be
   * posted (#46: `github.delivery`), and seeds the record. The hub isn't started yet.
   */
  static async make<F extends Shop | Month>(build: (dir: string) => Promise<F>): Promise<World<F>> {
    const tmp = tempDir();
    const fixture = await build(tmp);
    closing.push(() => fixture.forge.close());
    const home = join(tmp, 'h');
    mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
    writeFileSync(join(rootOf(home), 'config.json'), `${JSON.stringify({ github: { delivery: { [REPO_NAME]: 'on' }, yours: [YOU] } }, null, 2)}\n`);
    await seed(home, fixture.record());
    return new World(tmp, home, fixture);
  }
  async start(): Promise<Hub> { return (this.hub = await startHub(this.home, this.fixture.forge.url)); }
  async stop(): Promise<void> {
    if (this.hub) await stopHub(this.hub);
    this.hub = undefined;
  }
  /** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
  deep(args: readonly string[], timeoutMs = 600_000): Promise<Ran> { return run(NODE, [CLI, ...args], { env: childEnv(this.home), cwd: this.tmp, timeoutMs }); }
  /**
   * The reading as you get it: `deep numbers refresh`, which reads each repo your sessions worked in from the forge
   * and returns once it has, then `numbers.read`. BLOCKED when the refresh can't run or doesn't name the fixture's repo.
   */
  async read(): Promise<{ rows: unknown[]; reading: Row | undefined; unread: string[] }> {
    const hub = this.hub ?? blocked('the hub must be started before the reading is made');
    const ran = await this.deep(['numbers', 'refresh', '--json']);
    const said = parseObject(ran.stdout);
    if (ran.code !== 0 || !said || !Array.isArray(said.repos)) blocked(`\`deep numbers refresh --json\` must exit 0 and print what it read: exit ${String(ran.code)}: ${ran.stdout.slice(0, 600)}${ran.stderr.slice(0, 1200)}`);
    if (!(said!.repos as unknown[]).includes(REPO_NAME)) blocked(`\`deep numbers refresh\` must read ${REPO_NAME}, the repo the record's sessions worked in: it read ${JSON.stringify(said!.repos)}`);
    const rows = await numbersRead(hub);
    return { rows, reading: readingOf(rows, REPO_NAME), unread: Array.isArray(said!.unread) ? (said!.unread as unknown[]).map(String) : [] };
  }
  /** The event log's files, `<home>/.deepbuild/ledger.db` and SQLite's own beside it. Read with the hub stopped. */
  ledger(): string[] { return readdirSync(rootOf(this.home)).filter((name) => name.startsWith('ledger.db')).map((name) => join(rootOf(this.home), name)); }
  /** Takes away everything but the event log that a reading could be read from: the forge stops answering, and the repos and clones are removed. */
  async strip(): Promise<void> {
    await this.fixture.forge.close();
    rmSync(join(this.tmp, 'github.com'), { recursive: true, force: true });
    rmSync(join(this.tmp, 'work'), { recursive: true, force: true });
  }
}
/** A copy of an event log's files in a folder of its own, to rebuild from more than once. */
export function keepLedger(files: readonly string[]): string[] {
  const dir = join(tempDir(), 'log');
  mkdirSync(dir);
  return files.map((file) => { const to = join(dir, file.slice(dirname(file).length + 1)); copyFileSync(file, to); return to; });
}
/**
 * A hub started on an event log alone: a new home that holds nothing but a copy of the log's files, with `forge` (a
 * forge that no longer answers) as GitHub. With `replay`, the record first drops every table built from the log and
 * replays it (`rebuild`, packages/record's public entry). Resolves with the rows of its first `numbers.read` and how
 * long the whole took, the replay included, and stops the hub.
 */
export async function rebuilt(ledger: readonly string[], forge: string, o: { replay: boolean }): Promise<{ rows: unknown[]; reading: Row | undefined; ms: number }> {
  const home = join(tempDir(), 'h');
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  for (const file of ledger) copyFileSync(file, join(rootOf(home), file.slice(dirname(file).length + 1)));
  const t0 = performance.now();
  if (o.replay) {
    const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => Date.now() });
    try { await record.rebuild(); } finally { await record.close(); }
  }
  const hub = await startHub(home, forge);
  try {
    const rows = await numbersRead(hub);
    return { rows, reading: readingOf(rows, REPO_NAME), ms: performance.now() - t0 };
  } finally {
    await stopHub(hub);
  }
}

// ---- The machine: the perf lane's own rule for a limit (scripts/benchmark.mjs), as tests/acceptance/2513 reads it.
/** The one-minute load average, which `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => Obj; judgeLimit: (o: unknown) => Obj }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/**
 * Five runs after a warm-up, judged on a reference Mac on mains power, Low Power Mode off, thermal state nominal, the
 * load at each run's start and end within the cores: `status` PASS, FAIL, or INCONCLUSIVE with its `reason`.
 */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<Obj> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why a timing taken on this machine now couldn't count, or '' when it could: the lane's verdict on five zero runs at this load. */
export async function machineProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v.status === 'PASS' ? '' : String(v.reason ?? v.status);
}
