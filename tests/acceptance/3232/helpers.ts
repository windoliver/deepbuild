// Test-side tools for #3232 (README). Every world is a record a real hub made, and every change a run makes is one a
// real hub recorded: the change is appended through the record and asks core with the hub stopped (#26's `seed`, as
// #1463's and #2018's worlds do), the hub starts again and builds the rows it builds for anyone, and whatever it
// appended is fed to the running replica in log order, as the hub's stream delivers it (#2021's way). A session's turn
// is its agent's hooks on the hub's hook entry; the hold is #1101's, on the hub's test clock. The window is the real
// `deep-drive` (#124) on its virtual clock at the reference window; the live window is the real `deep-app`, read from
// outside its process by probe.swift.
//
// Reused by import: #16's homes, hub, hook wire, connections and PID cleanup; #26's seeding; #2018's world, its
// `Seeder` and `quiet`; #2021's recorded hook payloads; #1101's build of `deep-drive` and its world's parts.
// Copied, as the house does: the replica's client (#1461's), #1101's world with the hub on the wall clock, #3229's
// reference-Mac gate.
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  allEvents, childEnv, control, makeHome, nextSeq, NODE, own, REPO, run, sendHook, sha256, startHub, stopHub, tempDir, ulid, waitFor,
  type Ev, type Hub, type Session,
} from '../16/helpers.ts';
import { seed } from '../26/helpers.ts';
import { cleanup as cleanup2018, quiet, Seeder, type World } from '../2018/helpers.ts';
import { payloadOf, written, type Said } from '../2021/helpers.ts';
import { driveBin, type World as PushWorld } from '../1101/helpers.ts';
import { FLICKS, readOf, said, type AxNode, type Entry, type Frame, type Posted, type Read, type Shot, type SNode, type Snapshot } from './judges.ts';

export { quiet, REPO, Seeder, sha256, type Ev, type Hub, type World };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MIN = 60_000;
export const SECOND = 1000;
export type Line = Record<string, any>;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const cleanup = cleanup2018;
/** The reference window, in points; bounds and pictures are at 2×. */
export const REFERENCE = { width: 1512, height: 982 } as const;
export const flicks = (ms: number): number => Math.round((ms * FLICKS) / 1000);
/** crates/deep-replica's NOW: where a replica launched on a fixture starts its clock (#1101's worlds start theirs a minute on). */
export const NOW = 1_800_000_000_000;
export const byId = (s: Snapshot, id: string): SNode | undefined => { const all: SNode[] = []; const walk = (n: SNode): void => { all.push(n); for (const c of n.children ?? []) walk(c); }; walk(s.tree); return all.find((n) => n.id === id); };

// ---- Builds (README, How to run). `deep-drive` is #1101's, plain and planted, each built in a grant of the build
// throttle and copied out of the target folder. This suite adds the real app, the same way, and its own probe.

const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
const BIN = join(tmpdir(), `da3232-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const SOURCES = ['Cargo.toml', 'Cargo.lock', '.cargo', 'rust-toolchain.toml', 'crates', 'vendor', 'contracts', 'brand', 'adapters', 'packages/contracts/schemas'];
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  return readdirSync(path).filter((n) => n !== 'target' && n !== 'node_modules' && n !== '.git').reduce((m, n) => Math.max(m, newestMtime(join(path, n))), s.mtimeMs);
}
let sources: number | undefined;
const fresh = (file: string): boolean => existsSync(file) && statSync(file).mtimeMs > (sources ??= Math.max(...SOURCES.map((p) => newestMtime(join(REPO, p)))));
const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
/** One build in a grant of the machine's build throttle, with #1172's build environment; BLOCKED when it fails. */
export async function throttled(script: string, what: string, cwd = REPO): Promise<void> {
  if (process.platform !== 'darwin') blocked(`the replica and the app draw on macOS only; this is ${process.platform}`);
  const r = await run(NODE, [join(REPO, 'scripts/throttle.mjs'), 'build', '--wait', '240', '--', '/bin/sh', '-c', script], { cwd, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 480 * MIN });
  if (r.code !== 0) blocked(`the build of ${what} failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-2000)}`);
}
let app: Promise<string> | undefined;
/** The real app, `deep-app` as shipped, copied out of the target folder; used as it is while newer than every Rust source. */
export function appBin(): Promise<string> {
  const copy = join(BIN, 'deep-app');
  app ??= (fresh(copy) ? Promise.resolve() : throttled([`mkdir -p ${q(BIN)}`, 'cargo build --locked -q -p deep-app --bin deep-app', `cp ${q(join(TARGET, 'debug', 'deep-app'))} ${q(copy)}`].join(' && '), 'deep-app')).then(() => copy);
  return app;
}
/** The CLI and the hub a world needs, built; BLOCKED otherwise, never a pass. */
export function needCli(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm ci --ignore-scripts and npm run build --workspaces first');
  if (!existsSync(join(REPO, 'packages/hub/dist/rows.js'))) blocked('no built hub at packages/hub/dist/rows.js; run npm run build --workspaces first');
}

// ---- The machine (design: The reference Macs), from #3229's gate with the same three Macs.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
async function read(cmd: string, ...args: string[]): Promise<string> {
  const r = await run(cmd, args, { timeoutMs: 20 * SECOND });
  if (r.code !== 0) throw Error(`${cmd} ${args.join(' ')} exited ${String(r.code)}`);
  return r.stdout.trim();
}
/** Why this isn't one of the design's reference Macs, or null when it is. */
export async function referenceProblem(): Promise<string | null> {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const [model, chip, gib] = [await read('sysctl', '-n', 'hw.model'), await read('sysctl', '-n', 'machdep.cpu.brand_string'), Math.round(Number(await read('sysctl', '-n', 'hw.memsize')) / 2 ** 30)];
    return REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib) ? null : `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
}
/** Why a budget read on this machine now doesn't count, or null on a fit reference Mac: mains, no Low Power Mode, nominal heat, a load within its cores. */
export async function machineProblem(): Promise<string | null> {
  const machine = await referenceProblem();
  if (machine) return machine;
  try {
    const batt = await read('pmset', '-g', 'batt');
    if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0] ?? ''}`;
    // A Mac whose pmset prints no lowpowermode line is asked through NSProcessInfo, as scripts/benchmark.mjs asks.
    const low = /^\s*lowpowermode\s+(\d)/m.exec(await read('pmset', '-g'))?.[1] ?? ({ true: '1', false: '0' } as Record<string, string>)[await read('osascript', '-l', 'JavaScript', '-e', 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.isLowPowerModeEnabled')];
    if (low !== '0') return low === '1' ? 'Low Power Mode is on' : 'Low Power Mode state unknown';
    const therm = await read('pmset', '-g', 'therm');
    if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const load = loadavg()[0]!;
  return load > cpus().length ? `load ${load.toFixed(1)} is past the ${cpus().length} cores` : null;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface Seen { snapshot: Snapshot; rows: Line[]; log_pos: number; address: string | null }
export interface Closed { posted: Posted[] | undefined; frames: Frame[] | undefined }
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  private readonly gone: Promise<void>;
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(line) as Line; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    this.gone = new Promise((resolve) => child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); resolve(); }));
  }
  /**
   * A replica whose HOME is `home` (a world's, so `record_copy` reads its hub); `plant` its DEEP_HUB_PLANT, in the
   * `env-plants` build; `bin` another `deep-drive` than this checkout's.
   */
  static async start(home: string, o: { plant?: string; bin?: string } = {}): Promise<Drive> {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    const bin = o.bin ?? await driveBin(o.plant !== undefined);
    const dir = tempDir();
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const confirm = join(dir, 'confirm');
    writeFileSync(confirm, 'confirmed\n');
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const d = new Drive(child);
    const ready = await d.next(10 * MIN);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${d.err.slice(-600)}`);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms); // deadline: a replica that never answers a call is BLOCKED, naming the call
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Line): Promise<Line> {
    const reply = this.next(30 * MIN);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 400)}`);
    return reply;
  }
  launch(launch: Line): Promise<Line> { return this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch }); }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, rows: (r.rows ?? []) as Line[], log_pos: Number(r.log_pos ?? 0), address: (r.address ?? null) as string | null };
  }
  /** Runs the clock to `t` flicks since launch: a frame each 60th of a second, or with `stepMs` a frame each `stepMs`, the last shorter (#2028). */
  async waitTo(t: number, stepMs?: number): Promise<void> {
    if (t <= this.t) return;
    const ms = Math.ceil(((t - this.t) * 1000) / FLICKS);
    await this.must(`running the replica's clock ${ms} ms`, { call: 'wait_for', wait_for: { t, ...(stepMs ? { step_ms: stepMs } : {}) }, timeout: ms + 2000 });
  }
  /** Lets `ms` of the replica's clock pass with no input. */
  wait(ms: number, stepMs?: number): Promise<void> { return this.waitTo(this.t + flicks(ms), stepMs); }
  /** A replica launched on a fixture: its clock run on to `ms` since the epoch, unless it is past it already. */
  at(ms: number, stepMs = 1000): Promise<void> { return this.waitTo(flicks(ms - NOW), stepMs); }
  open(address: string): Promise<Line> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  feed(session: string, event: Line): Promise<Line> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  /** How the hub the app reads answers from now on (#1461). */
  hub(state: 'answering' | 'stopped'): Promise<Line> { return this.must(`the hub ${state}`, { call: 'hub', hub: { state } }); }
  /** Every view renders again at the next frame (#1482). */
  refresh(): Promise<Line> { return this.must('a redraw of every view', { call: 'refresh' }); }
  /** The replica's own screenshot of what `locator` names: a picture, or its word for why there is none (`locate.none`: the window doesn't draw it). */
  async shot(what: string, locator: Line): Promise<Shot> {
    const r = await this.call({ call: 'screenshot', screenshot: { target: 'locator', locator } });
    return r.ok === true ? { what, ok: true } : { what, ok: false, ...(typeof r.error?.code === 'string' ? { code: r.error.code as string } : {}), said: said(r.error ?? r, 300) };
  }
  /** A screenshot of the window: its hash and its size in device pixels. */
  async windowShot(): Promise<{ sha256: string; w: number; h: number }> {
    const r = await this.must('a screenshot of the window', { call: 'screenshot', screenshot: { target: 'window' } });
    return { sha256: String(r.sha256), w: Number(r.w), h: Number(r.h) };
  }
  /** Closes the replica: the notifications its notifier posted (its trace's `notifications`) and, in the mode that draws only what a real window would, every frame of its clock. */
  async close(): Promise<Closed> {
    const closed = await this.must('close', { call: 'close' });
    let trace: Line = {};
    try { trace = JSON.parse(readFileSync(String(closed.trace?.path), 'utf8')) as Line; } catch { /* the judges say what is missing */ }
    return { posted: Array.isArray(trace.notifications) ? (trace.notifications as Posted[]) : undefined, frames: Array.isArray(closed.frames?.list) ? (closed.frames.list as Frame[]) : undefined };
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    let timer: NodeJS.Timeout | undefined;
    // deadline: a replica that doesn't exit once its input ends is killed, by its PID
    const late = new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); });
    await Promise.race([this.gone, late]);
    clearTimeout(timer);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---- A run: a world's hub, one replica that follows it, and what the hub appends fed in log order.

export interface Hubbed { home: string; hub: Hub }
export class Stage<W extends Hubbed = World> {
  /** The views' clock at the replica's launch, ms since the epoch: exact once an event was fed (its reply's `ts`). */
  private launched: number | undefined;
  private constructor(readonly w: W, readonly d: Drive, private fed: number) {}
  /**
   * A replica at the reference window: on a copy of the world's record (`launch.from: "record_copy"`, in the world's
   * HOME), or with `fixture` on that events file, its clock from NOW (#1101's worlds).
   */
  static async on<W extends Hubbed>(w: W, o: { plant?: string; fixture?: string; launch?: Line; bin?: string } = {}): Promise<Stage<W>> {
    const d = await Drive.start(o.fixture ? makeHome() : w.home, { ...(o.plant ? { plant: o.plant } : {}), ...(o.bin ? { bin: o.bin } : {}) });
    try {
      await d.launch({ ...(o.fixture ? { from: 'fixture', fixture: o.fixture } : { from: 'record_copy' }), size: [REFERENCE.width, REFERENCE.height], ...o.launch });
      return new Stage(w, d, (await d.see()).log_pos);
    } catch (error) {
      await d.stop();
      throw error;
    }
  }
  /** One record event into the replica's record, at the next `log_pos` and the views' clock now; then one frame of its clock. */
  async feed(session: string, event: Line): Promise<Line> {
    const before = this.d.t;
    const reply = await this.d.feed(session, event);
    if (this.launched === undefined && typeof reply.ts === 'number') this.launched = reply.ts - Math.floor((before * 1000) / FLICKS);
    return reply;
  }
  /** Every event the hub appended since the last feed, fed to the replica in log order, each one frame of its clock. */
  async feedNew(): Promise<Ev[]> {
    const conn = await control(this.w.hub);
    let all: Ev[];
    try { all = await allEvents(conn); } finally { conn.close(); }
    const got = all.filter((e) => e.log_pos > this.fed);
    for (const e of got) {
      const { log_pos: _pos, ts: _ts, ...event } = e;
      await this.feed(e.session ?? '', event);
      this.fed = e.log_pos;
    }
    return got;
  }
  /** As `feedNew`, once the hook stamped `seq` has its event in the record (up to 10 s) and the log is still. */
  async feedAfter(seq: string): Promise<Ev[]> {
    const conn = await control(this.w.hub);
    try {
      await waitFor(async () => (await allEvents(conn)).some((e) => e.seq === seq), 10_000, `the hook ${seq}'s event`).catch(() => undefined);
    } finally { conn.close(); }
    await quiet(this.w.hub, 600);
    return this.feedNew();
  }
  /** The window's announcements now. */
  async read(): Promise<Read> { return readOf((await this.d.see()).snapshot); }
  /** An entry's time on the views' clock, in ms since the epoch. */
  at = (e: Entry): number => (this.launched ?? blocked('no event was fed, so the views\' clock at the replica\'s launch is unknown')) + Math.round((e.t * 1000) / FLICKS);
  /** A row of the list as the window holds it, by id. */
  async row(id: string): Promise<Line | undefined> { return (await this.d.see()).rows.find((r) => r.id === id); }
  async stop(): Promise<void> { await this.d.stop(); }
}

/**
 * One change to the record, as a real hub records it: the hub stops (by its PID), `fill` appends through the record
 * and asks core at the wall clock's now (#2018's `Seeder`), the hub starts on the same record and builds what it
 * builds for anyone, and everything it appended is fed to the replica. The events fed.
 */
export async function changed(stage: Stage<World>, fill: (s: Seeder, at: number) => Promise<void>): Promise<Ev[]> {
  const w = stage.w;
  await stopHub(w.hub);
  const at = Date.now();
  await seed(w.home, (sd) => fill(new Seeder(sd, w), at), at);
  w.hub = await startHub({ home: w.home, env: { DEEP_HUB_TEST_CONFIRM: w.confirm } }, 2 * MIN);
  await quiet(w.hub);
  return stage.feedNew();
}

// ---- A session's turn, as its agent's hooks say it (#2021's recorded payloads, through the hub's hook entry).

/** A world's session as its agent knows it: its transcript where its agent keeps it under the world's HOME (#16's `newSession`). */
export const sessionOf = (w: { home: string }, s: { id: string; cwd: string }): Session => ({ agent: 'claude-code', id: s.id, cwd: s.cwd, transcript: join(w.home, '.claude/projects', s.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${s.id}.jsonl`) });
export class Turn {
  private readonly pid: number;
  private promptId: string | undefined;
  constructor(private readonly stage: Stage<World>, private readonly s: Session) {
    const child = spawn('/bin/sleep', ['86400'], { stdio: 'ignore' });
    own(child.pid);
    this.pid = child.pid!;
  }
  /** One hook from the session's agent, at the wall clock's now; what the hub appended for it, fed. */
  async hook(event: string, o: Said = {}): Promise<Ev[]> {
    const at = Date.now();
    if (event === 'UserPromptSubmit') {
      this.promptId = randomUUID();
      written(this.s, at, { prompt: o.prompt ?? 'carry on', promptId: this.promptId });
    }
    const turn = this.promptId ? { promptId: this.promptId } : {};
    // The agent writes a call to its transcript before its PreToolUse, and its result before the hook that ends it.
    if (o.call && event === 'PreToolUse') written(this.s, at, { call: o.call });
    if (o.call && event === 'PostToolUse') written(this.s, at, { result: o.call, output: o.response ?? '', ...turn });
    const seq = nextSeq(at);
    const sent = await sendHook(this.stage.w.hub.socket, { v: 1, agent: 'claude-code', event, seq, id: ulid(at), matched: [], payload: payloadOf(this.s, event, { ...o, ...turn }), pid: this.pid, ppid: this.pid }, 30_000);
    if (sent.end !== 'reply' || sent.error) blocked(`the hub didn't take the session's ${event} hook: ${sent.end} ${said(sent.error ?? '')}`);
    return this.stage.feedAfter(seq);
  }
}

// ---- The live world (AC10): #1101's world with one change, its hub on the wall clock, so the real app and the hub
// read the same time. The shipped default guards hold a session's push with an authority ask, as in #1101's suite.

const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
async function git(cwd: string, args: string[], home: string): Promise<void> {
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' };
  const r = await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, env });
  if (r.code !== 0) blocked(`git ${args.join(' ')}: ${r.stderr}`);
}
export async function liveWorld(): Promise<PushWorld> {
  needCli();
  if (!existsSync(join(TARGET, 'debug', 'deep-hook'))) blocked('no deep-hook under target/debug, where the hub looks for it; run cargo build --locked -p deep-hook --bin deep-hook first');
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const tools = join(home, 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: `${tools}:/usr/bin:/bin` } }, null, 2)}\n`);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const place = tempDir();
  const repo = join(place, 'shop');
  const remote = join(place, 'shop-origin.git');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.js'), 'export const checkToken = (token) => token.exp > Date.now() / 1000;\n');
  await git(place, ['init', '-q', '--bare', remote], home);
  await git(repo, ['init', '-q', '-b', 'main'], home);
  await git(repo, ['add', '.'], home);
  await git(repo, ['commit', '-q', '-m', 'base'], home);
  await git(repo, ['remote', 'add', 'origin', remote], home);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ numStartups: 3, projects: { [repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_STOP_HOLD_MS: '5000' };
  const hub = await startHub({ home, env }, 10 * MIN);
  await quiet(hub);
  // `base` is the hub's clock less the wall clock: none here, so a hook is stamped at the wall clock's now.
  return { home, root, repo, remote, hub, env, base: 0, stepped: 0, tries: [], waiting: [] };
}

// ---- The real app, read from outside its process (probe.swift): AC10.

let compiled: Promise<string> | undefined;
/** The probe, compiled once a run; BLOCKED, naming where it stopped, when it can't be made. */
function probeBin(): Promise<string> {
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, `probe-${sha256(readFileSync(join(SUITE, 'probe.swift'))).slice(0, 12)}`);
    if (!existsSync(out)) {
      const r = await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out], { timeoutMs: 30 * MIN });
      if (r.code !== 0) blocked(`the platform can't be read: swiftc couldn't compile the probe that reads AppKit's tree (exit ${String(r.code)}): ${r.stderr.slice(-600)}`);
    }
    return out;
  })();
  return compiled;
}
async function probe<T>(...args: string[]): Promise<T> {
  const r = await run(await probeBin(), args, { timeoutMs: MIN });
  if (r.code !== 0) blocked(`the platform can't be read: probe ${args[0] ?? ''} failed (exit ${String(r.code)}): ${r.stderr.slice(-400)}`);
  return JSON.parse(r.stdout) as T;
}
/** What stops a reading of the real window before anything is started: BLOCKED, naming it. */
export async function canReadWindows(): Promise<void> {
  if (process.platform !== 'darwin') blocked(`the platform can't be read: AppKit's tree is read on macOS, and this is ${process.platform}`);
  const access = await probe<{ ax: boolean; locked: boolean }>('access');
  if (!access.ax) blocked('the platform can\'t be read: this process has no Accessibility permission, so AppKit\'s tree of the real window can\'t be read from outside it; grant it to the app the tests run under');
  if (access.locked) blocked('the platform can\'t be read: the session is locked, so no window can be the key one');
}
export class RealApp {
  private err = '';
  private constructor(private readonly child: ChildProcess, readonly pid: number) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  /** Starts the real app in `home`, waits for its window and sets it to the reference window. */
  static async launch(home: string): Promise<RealApp> {
    const child = spawn(await appBin(), [], { cwd: REPO, env: childEnv(home, {}), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    const a = new RealApp(child, child.pid!);
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`the platform can't be read: deep-app exited (${String(child.exitCode ?? child.signalCode)}) before its window: ${a.err.slice(-800)}`);
      return (await probe<number[][]>('windows', String(a.pid))).length > 0;
    }, 3 * MIN, 'the real app\'s window').catch((e: Error) => blocked(e.message.startsWith('BLOCKED: ') ? e.message.slice('BLOCKED: '.length) : `the platform can't be read: deep-app showed no window in 3 minutes: ${a.err.slice(-800)}`));
    await a.tree();
    await probe<number[]>('place', String(a.pid), String(REFERENCE.width), String(REFERENCE.height));
    return a;
  }
  /** The process's windows as an assistive client reads them. */
  tree(): Promise<AxNode[]> { return probe<AxNode[]>('tree', String(this.pid)); }
  /** Brings the app forward; whether its window is then the one in front, and the main one. */
  front(): Promise<{ front: boolean; main: boolean }> { return probe('front', String(this.pid)); }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const gone = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.kill('SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    // deadline: an app that ignores SIGTERM is killed, by its PID
    const late = new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); });
    await Promise.race([gone, late]);
    clearTimeout(timer);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}
/** Repeats `judge` until it finds nothing wrong or `ms` pass: the real app draws what its reader reads a moment after. */
export async function settled(judge: () => Promise<string[]>, ms: number): Promise<string[]> {
  let last: string[] = [];
  await waitFor(async () => { last = await judge(); return last.length === 0; }, ms, 'the real window to settle').catch(() => undefined);
  return last;
}

// ---- The merge base's replica (AC11): its tree from `git archive`, built in a folder of its own.

/** The merge base this suite was written on, pinned, so the comparison stays with the app before #3232 after it merges. */
export const BASE = '38706c8192f6e917cec944586a150dff04044de7';
export async function baseDrive(): Promise<string> {
  const dir = join(tmpdir(), `dd3232-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`, `base-${BASE.slice(0, 12)}`);
  const src = join(dir, 'src');
  if (!existsSync(join(src, 'Cargo.toml'))) {
    mkdirSync(src, { recursive: true });
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    const tar = join(dir, 'base.tar');
    // No worktree is added and no .git copied: the base's tree alone.
    const archived = await run('git', ['-C', REPO, 'archive', '--format=tar', '-o', tar, BASE], { env, timeoutMs: 10 * MIN });
    if (archived.code !== 0) blocked(`git archive of the merge base ${BASE.slice(0, 12)} failed: ${archived.stderr.slice(-400)}`);
    const unpacked = await run('tar', ['-x', '-C', src, '-f', tar], { env, timeoutMs: 10 * MIN });
    if (unpacked.code !== 0) blocked(`the merge base's tree couldn't be unpacked: ${unpacked.stderr.slice(-400)}`);
  }
  const target = join(dir, 'target');
  const bin = join(target, 'debug', 'deep-drive');
  if (!existsSync(bin)) await throttled(`cargo build --locked -q -p deep-replica --bin deep-drive --features deep-app/test-confirm --target-dir ${q(target)}`, `deep-drive at the merge base ${BASE.slice(0, 12)}`, src);
  return bin;
}
