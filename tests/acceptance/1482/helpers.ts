// Test-side tools for the #1482 acceptance tests (README: The surface under test). The replica is `deep-drive` (#124),
// driven over its stdin in #1546's mode that draws only the frames GPUI says the window needs. Every frame, view name,
// notify, count, tile and clock reading below comes from its `close` report, every accessibility tree from its
// `accessibility` call. Nothing here stands in for the replica, the app or GPUI: this file holds the journeys (the
// calls a test makes), the fixture record, and the judges (what a report must hold), which the criteria's planted
// programs must fail. #124's helpers build the debug binary, give each process a temp home and stop every process by
// its PID; nothing is stopped by name or port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { DRIVE_BIN, REPO, buildDrive, nodesOf, own, t26, tempDir, type Node, type Obj } from '../124/helpers.ts';

export { cleanup, requireMacos } from '../124/helpers.ts';
export { REPO, type Node, type Obj };

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

/** AC1's window: 968 × 792 points at scale 2, which is 1936 × 1584 device pixels. */
export const SIZE: [number, number] = [968, 792];
export const SCALE = 2;
const DEVICE: [number, number] = [SIZE[0] * SCALE, SIZE[1] * SCALE];
/** "Hovering 200 rows". */
export const HOVERS = 200;
/** "compared with the last in 64 × 32 tiles", device pixels; the last column and row are partial. */
const TILE: [number, number] = [64, 32];
export const TILES = Math.ceil(DEVICE[0] / TILE[0]) * Math.ceil(DEVICE[1] / TILE[1]);
/** "At most 1% of frames in the journey have zero changed tiles". */
const ZERO_TILE_SHARE = 0.01;
/** Half a second of the replica's clock, in flicks (705,600,000 a second, #124). */
const SETTLE = 705_600_000 / 2;
/** The two list lengths: "a 1,000-row list" and "the same list at 10,000 rows". */
export const ROWS = 1_000;
export const ROWS_10K = 10_000;

/** The list's view and the pages, by the names the app registers them under (crates/deep-app/src/views.rs). */
export const LIST_VIEW = 'deepbuild/sidebar';
export const SESSION_PAGE = 'deepbuild/session';

/** The wrong programs (README: The planted programs). Each is read only in a build with the env-plants feature. */
export const HUB_PLANT = {
  hoverNotifiesRoot: 'hover-notifies-root',
  animatesUnchanged: 'animates-unchanged',
  buildsRowOutOfView: 'builds-row-out-of-view',
  pageRedrawsEverySession: 'page-redraws-every-session',
  setterSkipsCompare: 'setter-skips-compare',
  pageRedrawsWithList: 'page-redraws-with-list',
} as const;
export const DRIVE_PLANT = {
  notifiesRootPerMove: 'notifies-root-per-move',
  readBackFails: 'read-back-fails',
  dropsNotifyRecord: 'drops-notify-record',
  wheelNotifiesEveryEvent: 'wheel-notifies-every-event',
  reuseDropsAccessibility: 'reuse-drops-accessibility',
} as const;

// ---------------------------------------------------------------------------------------------------
// The fixture record (README: The fixture): n sessions, each the hub's row for the list (#1463's `row.set`), in one
// project, queued, with no time of their own, so nothing on screen ticks while a journey runs.

const NOW = 1_800_000_000_000;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');
export const sessionId = (i: number): string => `01KB1482${pad(i, 18)}`;
/** The session the fixture gives a reading of its state, which AC12 writes again unchanged. */
export const READ_SESSION = 3;

/** Session i's row, as the hub builds it for the list; `change` overrides fields. */
function rowOf(i: number, change: Obj = {}): Obj {
  const id = sessionId(i);
  return {
    id: `session:${id}`, session: id, listed: true, order: pad(i, 10), title: `Row ${pad(i, 5)}`, project: 'bench',
    word: 'queued', entry: 'idle', unread: false, why: '', ...change,
  };
}
/** A record event as the hub's stream delivers it; the replica gives it its log_pos, ts and session. */
const event = (id: string, kind: string, data: Obj, extra: Obj = {}): Obj => ({ v: 1, id, kind, writer: 'core', actor: 'you', scope: 'you', ...extra, data });
/** The hub writing session i's row (`row.set`, #1463). */
export const rowSet = (id: string, i: number, change: Obj = {}): Obj => event(id, 'row.set', rowOf(i, change));
/** The core's reading of session i's state (`session.state`), as the fixture holds it for READ_SESSION. */
export const stateReading = (id: string, i: number): Obj => event(id, 'session.state', { state: 'queued', cause: 'hook' }, { subject: `session:${sessionId(i)}` });

const fixtures = new Map<number, string>();
/** The record with `n` rows, written once per process into a temp folder: its path. */
export function rowsFixture(n: number): string {
  const known = fixtures.get(n);
  if (known && existsSync(known)) return known;
  const lines: string[] = [];
  const at = NOW - 3_600_000;
  for (let i = 1; i <= n; i++) {
    lines.push(JSON.stringify({ session_id: sessionId(i), event: { ...rowSet(`01KB1482R${pad(i, 17)}`, i), ts: at + i, log_pos: i } }));
  }
  lines.push(JSON.stringify({ session_id: sessionId(READ_SESSION), event: { ...stateReading(`01KB1482S${pad(READ_SESSION, 17)}`, READ_SESSION), ts: at + n + 1, log_pos: n + 1 } }));
  const path = join(tempDir(), `rows-${n}.events.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  fixtures.set(n, path);
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The binaries. Debug, with the planted programs: #124's build (`cargo build --locked -p deep-replica --bin deep-drive
// --features env-plants`). Release, with the frame clocks: built here once per process and copied out of the target
// folder, so another build can't swap it mid-run.

const RELEASE_ARGS = ['build', '--release', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'frame-clocks'];
let release: { path: string; error: string } | undefined;
/** The release `deep-drive` with the `frame-clocks` feature; fails naming cargo's own words when it can't be built. */
export function releaseDrive(): string {
  if (!release) {
    const r = spawnSync('cargo', RELEASE_ARGS, { cwd: REPO, encoding: 'utf8', timeout: 5_400_000, maxBuffer: 64 * 1024 * 1024 });
    const built = join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'release', 'deep-drive');
    if (r.status === 0 && existsSync(built)) {
      const dir = mkdtempSync(join(tmpdir(), 'deep-1482-bin-'));
      const path = join(dir, 'deep-drive');
      copyFileSync(built, path);
      release = { path, error: '' };
    } else {
      const words = `${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /error|feature/i.test(l)).slice(0, 8).join('\n')}`;
      release = { path: '', error: words || `cargo exited ${String(r.status)}` };
    }
  }
  if (release.error) expect.fail(`the release bench doesn't build (cargo ${RELEASE_ARGS.join(' ')}): ${release.error}`);
  return release.path;
}
/** The debug `deep-drive` with the env-plants feature (#124's build). */
export function debugDrive(): string {
  buildDrive();
  return DRIVE_BIN;
}
/** Removes the copied release binary's folder. */
export function dropRelease(): void {
  if (release?.path) rmSync(join(release.path, '..'), { recursive: true, force: true });
  release = undefined;
}

// ---------------------------------------------------------------------------------------------------
// One `deep-drive --out <dir>` process: a JSON call per line on stdin, a JSON reply per line on stdout (#124).

class Proc {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private stderr = '';
  private constructor(readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: Obj;
        try { line = JSON.parse(text) as Obj; } catch { line = { unparsed: text.slice(0, 2000) }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr = (this.stderr + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.stderr }); });
  }

  static async start(bin: string, o: { plant?: string | undefined; hub?: string | undefined }): Promise<Proc> {
    const dir = tempDir();
    const out = join(dir, 'out');
    const home = join(dir, 'h');
    mkdirSync(out, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env = t26.childEnv(home, { DEEP_DRIVE_PLANT: o.plant, DEEP_HUB_PLANT: o.hub });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const proc = new Proc(child);
    const first = await proc.next(300_000);
    if (first.ready !== true) {
      expect.fail(`BLOCKED: deep-drive didn't say {"ready": true}${o.plant ? ` with DEEP_DRIVE_PLANT=${o.plant}` : ''}: ${JSON.stringify(first).slice(0, 400)} ${proc.stderr.slice(-800)}`);
    }
    return proc;
  }
  private next(timeoutMs: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.stderr });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: timeoutMs }), timeoutMs);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  async call(args: Obj, timeoutMs = 1_800_000): Promise<Obj> {
    const answer = this.next(timeoutMs);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const reply = await answer;
    if (reply.exited || reply.timedOut || reply.unparsed !== undefined) {
      expect.fail(`BLOCKED: deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`);
    }
    return reply;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 10_000;
    while (!this.exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    if (!this.exited && this.child.pid) try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------------------------------
// The report (README: close's frames report).

interface Tiles { changed: number; total: number }
export interface Frame {
  frame: number; step: number; t: number; drawn: boolean;
  notified: string[]; refreshed: boolean; rendered: string[]; reused: string[];
  rows: number; elements: number; tiles: Tiles | null;
  cpu_ms: number | null; gpu_ms: number | null; allocations: number | null;
}
interface Entity { name: string; view: boolean; parent: string | null }
export interface Report {
  claim: string; steps: { step: number; call: string; frames: number; drawn: number }[];
  arm: string; read_back: 'tiles' | 'off' | 'failed'; root: string;
  entities: Record<string, Entity>; list: Frame[];
  zero_tile_frames: number | null; changed_area: number | null;
}

/** Launch fields this folder adds, with their defaults. */
interface Launch { arm?: 'app' | 'blank' | 'lists'; read_back?: 'tiles' | 'off'; accessibility?: boolean; [key: string]: unknown }

/** One replica in #1546's dirty mode, its steps numbered as #1546 numbers them: every call after launch, from 1. */
export class Replica {
  steps = 0;
  /** The replica's clock, flicks since launch, as its last reply gave it. */
  t = 0;
  private constructor(readonly proc: Proc) {}

  /** A process (a planted one when named) and a replica in it; the launch reply must echo this folder's fields. */
  static async open(o: { bin: string; plant?: string | undefined; hub?: string | undefined; launch: Launch }): Promise<Replica> {
    const proc = await Proc.start(o.bin, { plant: o.plant, hub: o.hub });
    const launch = { frames: 'dirty', ...o.launch };
    const reply = await proc.call({ call: 'launch', launch });
    expect(reply.ok, `launch ${JSON.stringify(launch).slice(0, 300)}: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    expect(reply.frames, `launch answers frames: "dirty" (#1546): ${JSON.stringify(reply).slice(0, 400)}`).toBe('dirty');
    expect(reply.read_back, `launch answers the read-back it runs, read_back: ${JSON.stringify(launch.read_back ?? 'tiles')}: ${JSON.stringify(reply).slice(0, 400)}`).toBe(launch.read_back ?? 'tiles');
    expect(reply.arm, `launch answers its arm: ${JSON.stringify(reply).slice(0, 400)}`).toBe(launch.arm ?? 'app');
    expect(reply.accessibility, `launch answers whether accessibility is active: ${JSON.stringify(reply).slice(0, 400)}`).toBe(launch.accessibility ?? false);
    return new Replica(proc);
  }

  /** One step: its reply, whatever it says. */
  async call(args: Obj): Promise<Obj> {
    const reply = await this.proc.call(args);
    this.steps += 1;
    if (typeof reply.t === 'number') this.t = reply.t;
    return reply;
  }
  /**
   * Half a second of the clock with nothing done, after a setup step: whatever the setup set going settles before the
   * step a criterion judges, so nothing of it is counted there.
   */
  settle(): Promise<Obj> { return this.must({ call: 'wait_for', wait_for: { t: this.t + SETTLE }, timeout: 600_000 }, 'settle'); }
  /** One step that must succeed. */
  async must(args: Obj, what = String(args.call)): Promise<Obj> {
    const reply = await this.call(args);
    expect(reply.ok, `step ${this.steps} (${what}): ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
    return reply;
  }
  /** The pointer to a point in device pixels, with no locator: README, act hover at a point. */
  hoverAt(point: [number, number], what = `hover at ${point.join(', ')}`): Promise<Obj> {
    return this.must({ call: 'act', act: { kind: 'hover', point } }, what);
  }
  click(id: string): Promise<Obj> { return this.must({ call: 'act', locator: { id }, act: { kind: 'click' } }, `click ${id}`); }
  press(keys: string): Promise<Obj> { return this.must({ call: 'act', act: { kind: 'press', keys } }, `press ${keys}`); }
  type(id: string, text: string): Promise<Obj> { return this.must({ call: 'act', locator: { id }, act: { kind: 'type', text } }, `type ${text} in ${id}`); }
  /** `events` wheel events of `dy` points each at the element's centre, one a frame: README, act wheel. */
  wheel(id: string, dy: number, events: number): Promise<Obj> {
    return this.must({ call: 'act', locator: { id }, act: { kind: 'wheel', dy, events } }, `wheel ${events} × ${dy} on ${id}`);
  }
  feed(session: string, ev: Obj): Promise<Obj> { return this.must({ call: 'feed', feed: { session, event: ev } }, `feed ${String(ev.kind)}`); }
  open(address: string): Promise<Obj> { return this.must({ call: 'open', open: { address } }, `open ${address}`); }
  refresh(): Promise<Obj> { return this.must({ call: 'refresh' }, 'refresh'); }
  /** The last frame GPUI drew, as `see` reads it (#1546). */
  async see(): Promise<Obj> {
    return (await this.must({ call: 'see', see: { include: ['roles', 'names', 'values', 'bounds'] } }, 'see')).snapshot as Obj;
  }
  /** The accessibility tree the platform holds after the last frame GPUI drew: README, accessibility. */
  async accessibility(): Promise<Tree> {
    const reply = await this.must({ call: 'accessibility' }, 'accessibility');
    const tree = reply.accessibility as Tree;
    expect(tree && Array.isArray(tree.nodes) && typeof tree.active === 'boolean', `accessibility answers {active, focus, nodes}: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    return tree;
  }

  /** Closes the replica: its frames report, checked for its shape. */
  async close(): Promise<Report> {
    const reply = await this.proc.call({ call: 'close' });
    expect(reply.ok, `close: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    const r = reply.frames as Report | undefined;
    expect(r && Array.isArray(r.list), `close answers the frames report with its list of frames: ${JSON.stringify(reply.frames ?? reply).slice(0, 600)}`).toBe(true);
    expect(shapeProblems(r!, this.steps).slice(0, 10), 'the frames report holds every frame, and every entity a frame names').toEqual([]);
    return r!;
  }
  async stop(): Promise<void> { await this.proc.stop(); }
}

/** What's malformed in a report; empty when every frame and every entity it names is there as the README says. */
function shapeProblems(r: Report, steps: number): string[] {
  const out: string[] = [];
  const ids = (xs: unknown): xs is string[] => Array.isArray(xs) && xs.every((x) => typeof x === 'string');
  if (!['tiles', 'off', 'failed'].includes(r.read_back)) out.push(`read_back is ${JSON.stringify(r.read_back)}`);
  if (typeof r.entities !== 'object' || r.entities === null) return [...out, 'no entities table'];
  if (!r.entities[r.root]?.view) out.push(`the root ${JSON.stringify(r.root)} isn't a view in the entities table`);
  r.list.forEach((f, k) => {
    if (f.frame !== k + 1) out.push(`frame ${k + 1} is numbered ${f.frame}`);
    if (!Number.isInteger(f.step) || f.step < 1 || f.step > steps) out.push(`frame ${f.frame} is in step ${f.step}, not one of 1..${steps}`);
    if (typeof f.drawn !== 'boolean' || typeof f.refreshed !== 'boolean') out.push(`frame ${f.frame}: drawn and refreshed are booleans`);
    if (!ids(f.notified) || !ids(f.rendered) || !ids(f.reused)) out.push(`frame ${f.frame}: notified, rendered and reused are lists of entities`);
    for (const e of [...(f.notified ?? []), ...(f.rendered ?? []), ...(f.reused ?? [])]) if (!r.entities[e]) out.push(`frame ${f.frame} names entity ${e}, which the entities table doesn't hold`);
    if (!Number.isInteger(f.rows) || !Number.isInteger(f.elements) || f.rows < 0 || f.elements < 0) out.push(`frame ${f.frame}: rows and elements are counts`);
    if (!f.drawn && (f.rendered?.length || f.reused?.length || f.rows || f.elements || f.tiles !== null)) out.push(`frame ${f.frame} wasn't drawn but names views, rows, elements or tiles`);
    if (f.tiles !== null && (!Number.isInteger(f.tiles?.changed) || f.tiles!.total < 1 || f.tiles!.changed < 0 || f.tiles!.changed > f.tiles!.total)) out.push(`frame ${f.frame}: tiles ${JSON.stringify(f.tiles)}`);
  });
  for (const s of r.steps ?? []) {
    const drawn = r.list.filter((f) => f.step === s.step && f.drawn).length;
    if (drawn !== s.drawn) out.push(`step ${s.step} drew ${s.drawn} frames by #1546's count and ${drawn} by the list`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Reading a report.

export const framesOf = (r: Report, steps: Iterable<number>): Frame[] => { const s = new Set(steps); return r.list.filter((f) => s.has(f.step)); };
export const drawnOf = (r: Report, steps: Iterable<number>): Frame[] => framesOf(r, steps).filter((f) => f.drawn);
export const nameOf = (r: Report, e: string): string => r.entities[e]?.name ?? `entity ${e}`;
export const named = (r: Report, name: string): string[] => Object.keys(r.entities).filter((e) => r.entities[e]!.name === name);
/** The views an entity was rendered in, nearest first. */
function ancestors(r: Report, e: string): string[] {
  const out: string[] = [];
  for (let p = r.entities[e]?.parent ?? null; p !== null && !out.includes(p); p = r.entities[p]?.parent ?? null) out.push(p);
  return out;
}
/** Whether `e` is one of `of` or rendered inside one of them. */
const within = (r: Report, e: string, of: string[]): boolean => of.includes(e) || ancestors(r, e).some((a) => of.includes(a));
/** A frame as a person reads it. */
export const frameSaid = (f: Frame): string => `frame ${f.frame} (step ${f.step})`;

// ---------------------------------------------------------------------------------------------------
// The window and the hover journey (README: The hover journey).

export interface Row { id: string; center: [number, number]; bounds: [number, number, number, number] }
/** The list's session rows in a snapshot: a node whose id is a row's, `session:<id>` (its slots add `:<slot>`). */
function sessionRows(snapshot: Obj): (Node & { id: string })[] {
  return nodesOf(snapshot)
    .map((n) => n as Node & { id?: unknown })
    .filter((n): n is Node & { id: string } => typeof n.id === 'string' && /^session:[^:]+$/.test(n.id) && Array.isArray(n.bounds) && n.bounds[2] > 0 && n.bounds[3] > 0);
}
/** The list's rows a snapshot shows wholly inside the window, top to bottom. */
export function rowsOnScreen(snapshot: Obj, device: [number, number] = DEVICE): Row[] {
  return sessionRows(snapshot)
    .filter((n) => n.bounds[0] >= 0 && n.bounds[1] >= 0 && n.bounds[0] + n.bounds[2] <= device[0] && n.bounds[1] + n.bounds[3] <= device[1])
    .sort((a, b) => a.bounds[1] - b.bounds[1])
    .map((n) => ({ id: n.id, bounds: n.bounds, center: [Math.round(n.bounds[0] + n.bounds[2] / 2), Math.round(n.bounds[1] + n.bounds[3] / 2)] as [number, number] }));
}
/** How many of the list's rows a snapshot shows on screen at all: rows whose bounds meet the window, partly or wholly. */
function rowsShown(snapshot: Obj, device: [number, number] = DEVICE): number {
  return sessionRows(snapshot).filter((n) => n.bounds[0] < device[0] && n.bounds[1] < device[1] && n.bounds[0] + n.bounds[2] > 0 && n.bounds[1] + n.bounds[3] > 0).length;
}
/** A node of a snapshot by its id (#1459's author id), or undefined. */
export const byId = (snapshot: Obj, id: string): Node | undefined => nodesOf(snapshot).find((n) => (n as Node & { id?: unknown }).id === id);
/** Down the rows on screen and back up, from the first: `count` row indices, each next to the one before. */
function pingPong(rows: number, count: number): number[] {
  const out = [0];
  let at = 0, step = 1;
  while (out.length < count) {
    if (at + step < 0 || at + step >= rows) step = -step;
    at += step;
    out.push(at);
  }
  return out;
}
/** The hover journey's points: one into the list (a setup step), then `HOVERS` moves, each onto the next row. */
export function hoverPoints(rows: Row[], hovers = HOVERS): [number, number][] {
  expect(rows.length, `the window shows at least three of the list's rows to hover: ${rows.map((r) => r.id).join(', ')}`).toBeGreaterThanOrEqual(3);
  return pingPong(rows.length, hovers + 1).map((i) => rows[i]!.center);
}
/** Runs the points: the first as a setup step, the rest as the journey's steps, whose numbers it answers. */
export async function hover(r: Replica, points: [number, number][]): Promise<number[]> {
  await r.hoverAt(points[0]!, 'into the list');
  const steps: number[] = [];
  for (const p of points.slice(1)) {
    await r.hoverAt(p);
    steps.push(r.steps);
  }
  return steps;
}
/**
 * A replica on the 1,000-row list (or another size) at AC1's window: the rows wholly on screen, which the pointer
 * hovers, and how many rows the window shows at all, read once at launch.
 */
export async function onList(o: { bin: string; rows?: number | undefined; plant?: string | undefined; hub?: string | undefined; launch?: Launch | undefined }): Promise<{ r: Replica; rows: Row[]; shown: number }> {
  const r = await Replica.open({ bin: o.bin, plant: o.plant, hub: o.hub, launch: { from: 'fixture', fixture: rowsFixture(o.rows ?? ROWS), size: SIZE, scale: SCALE, ...o.launch } });
  const snapshot = await r.see();
  return { r, rows: rowsOnScreen(snapshot), shown: rowsShown(snapshot) };
}
/** The hover journey over the list, closed: its report, the journey's steps, the rows on screen and how many show. */
export async function hoverRun(o: { bin: string; rows?: number | undefined; plant?: string | undefined; hub?: string | undefined; launch?: Launch | undefined }): Promise<{ report: Report; steps: number[]; rows: Row[]; shown: number }> {
  const { r, rows, shown } = await onList(o);
  try {
    const steps = await hover(r, hoverPoints(rows));
    return { report: await r.close(), steps, rows, shown };
  } finally {
    await r.stop();
  }
}

// ---------------------------------------------------------------------------------------------------
// The hover judge (README: The judges): the same for the shipped app and for every wrong program.

interface Judged { claim: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; findings: string[]; unjudged: string[] }
const verdict = (findings: string[], unjudged: string[]): Judged => ({ claim: findings.length ? 'FAIL' : unjudged.length ? 'INCONCLUSIVE' : 'PASS', findings, unjudged });

/**
 * A pointer moving over the list repaints only the views it changed. Over the journey's steps: every frame GPUI drew
 * names a notify or a refresh and the views it rendered (else INCONCLUSIVE, AC6); no view outside the list is notified
 * and the window never refreshes (else FAIL naming the view, AC2 and AC5); every drawn frame was read back (else
 * INCONCLUSIVE, AC4), and at most 1% of them changed no tile (else FAIL naming the views notified in them, AC3).
 */
export function judgeHover(r: Report, steps: number[]): Judged {
  const frames = framesOf(r, steps);
  const drawn = frames.filter((f) => f.drawn);
  const findings: string[] = [];
  const unjudged: string[] = [];
  if (!drawn.length) unjudged.push('the journey drew no frame, so it shows nothing about what a frame repaints');
  for (const f of drawn) {
    if (!f.notified.length && !f.refreshed) unjudged.push(`${frameSaid(f)} drew, naming neither a notify nor a refresh`);
    if (!f.rendered.length) unjudged.push(`${frameSaid(f)} drew, naming no view it rendered`);
  }
  const list = named(r, LIST_VIEW);
  if (!list.length) unjudged.push(`no entity is named ${LIST_VIEW}, the list's view`);
  else {
    for (const f of frames) {
      for (const e of f.notified) {
        if (r.entities[e]?.view && !within(r, e, list)) findings.push(`${frameSaid(f)}: ${nameOf(r, e)} was notified by a pointer move over the list, and it is neither the list nor in it`);
      }
      if (f.refreshed) findings.push(`${frameSaid(f)}: the window refreshed on a pointer move over the list, so every view rendered`);
    }
  }
  const unread = drawn.filter((f) => f.tiles === null);
  if (r.read_back !== 'tiles' || unread.length) {
    unjudged.push(`the read-back is ${r.read_back} and ${unread.length} of ${drawn.length} drawn frames have no tiles, so frames that changed nothing can't be counted`);
  } else {
    const zero = drawn.filter((f) => f.tiles!.changed === 0);
    if (zero.length > ZERO_TILE_SHARE * drawn.length) {
      const by = new Map<string, number>();
      for (const f of zero) for (const e of f.notified) by.set(nameOf(r, e), (by.get(nameOf(r, e)) ?? 0) + 1);
      const views = [...by].map(([name, n]) => `${name} (${n})`).join(', ') || (zero.some((f) => f.refreshed) ? 'a refresh' : 'nothing named');
      findings.push(`${zero.length} of ${drawn.length} frames changed no tile, more than 1%: notified in them ${views}`);
    }
  }
  return verdict(findings, unjudged);
}

/**
 * The wrong reader AC5 names: it only counts the views each frame repaints, and fails a frame of the planted run that
 * renders more of them than any frame of the same journey's clean run does.
 */
export function countsOnly(planted: Report, plantedSteps: number[], clean: Report, cleanSteps: number[]): Judged {
  const most = Math.max(0, ...drawnOf(clean, cleanSteps).map((f) => f.rendered.length));
  const over = drawnOf(planted, plantedSteps).filter((f) => f.rendered.length > most);
  return verdict(over.map((f) => `${frameSaid(f)} rendered ${f.rendered.length} views, more than the clean run's most, ${most}`), []);
}

/** What keeps a reader's verdict from meeting AC2 and AC5: it must FAIL the run, naming the window's root view. */
export function rootNamedProblems(v: Judged, rootName: string): string[] {
  if (v.claim !== 'FAIL') return [`the reader reads ${v.claim}, not FAIL`];
  return v.findings.some((f) => f.includes(rootName)) ? [] : [`no finding names the window's root view, ${rootName}: ${v.findings.slice(0, 3).join('; ')}`];
}

// ---------------------------------------------------------------------------------------------------
// Counts, for the journeys any machine runs (README: The count journeys).

/** A step's frames as counts: how many passed and drew, and each drawn frame's views by name, its notifies and rows. */
export function countsOf(r: Report, steps: number[]): Obj[] {
  const names = (es: string[]): string[] => es.map((e) => nameOf(r, e)).sort();
  return steps.map((step) => {
    const frames = framesOf(r, [step]);
    return {
      step, frames: frames.length, drawn: frames.filter((f) => f.drawn).length,
      each: frames.filter((f) => f.drawn || f.notified.length || f.refreshed).map((f) => ({
        drawn: f.drawn, refreshed: f.refreshed, notified: names(f.notified), rendered: names(f.rendered), reused: names(f.reused), rows: f.rows, elements: f.elements,
      })),
    };
  });
}

/** Rendered views in `frames` that are `of` or inside them, by name with the frame. */
export function renderedWithin(r: Report, frames: Frame[], of: string[]): string[] {
  return frames.flatMap((f) => f.rendered.filter((e) => within(r, e, of)).map((e) => `${frameSaid(f)} rendered ${nameOf(r, e)}`));
}
/** Rendered views in `frames` outside the list: neither the list, nor in it, nor a view the list sits in. */
export function renderedOutsideList(r: Report, frames: Frame[]): string[] {
  const list = named(r, LIST_VIEW);
  const holds = new Set(list.flatMap((e) => ancestors(r, e)));
  return frames.flatMap((f) => f.rendered.filter((e) => !within(r, e, list) && !holds.has(e)).map((e) => `${frameSaid(f)} rendered ${nameOf(r, e)}, outside the list`));
}
/** Each frame that built more of the list's rows than the window shows, naming the count. */
export function rowsOverScreen(frames: Frame[], onScreen: number): string[] {
  return frames.filter((f) => f.rows > onScreen).map((f) => `${frameSaid(f)} built ${f.rows} rows; ${onScreen} are on screen`);
}
/** Every notify and every drawn frame in `frames`, naming the entity: what an equal write must not cause (AC12). */
export function equalWriteProblems(r: Report, frames: Frame[]): string[] {
  return frames.flatMap((f) => [
    ...f.notified.map((e) => `${frameSaid(f)}: ${nameOf(r, e)} was notified`),
    ...(f.drawn ? [`${frameSaid(f)} was drawn${f.refreshed ? ' by a refresh' : ''}`] : []),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Accessibility trees (README: accessibility, AC8).

interface A11yNode { id: string; role: string; name: string | null; value: unknown; bounds: number[] | null; actions: string[]; children: string[] }
export interface Tree { active: boolean; focus: string | null; nodes: A11yNode[] }
const nodeSaid = (n: A11yNode): string => `${n.role} ${JSON.stringify(n.name)} (node ${n.id})`;
/** How `drawn` differs from `refreshed`, node for node in tree order, naming the first node that differs, and the focus. */
export function treeProblems(drawn: Tree, refreshed: Tree): string[] {
  const out: string[] = [];
  const at = new Map(drawn.nodes.map((n) => [n.id, n]));
  for (const want of refreshed.nodes) {
    const got = at.get(want.id);
    if (!got) { out.push(`${nodeSaid(want)} is in the frame after a refresh and not in the frame that reused its view`); break; }
    const fields = (['role', 'name', 'value', 'bounds', 'actions', 'children'] as const).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
    if (fields.length) { out.push(`${nodeSaid(want)} differs in ${fields.join(', ')}: ${fields.map((k) => `${JSON.stringify(got[k])} against ${JSON.stringify(want[k])}`).join('; ')}`); break; }
  }
  if (!out.length && drawn.nodes.length !== refreshed.nodes.length) out.push(`the frame that reused views holds ${drawn.nodes.length} nodes, the frame after a refresh ${refreshed.nodes.length}`);
  if (!out.length && JSON.stringify(drawn.nodes.map((n) => n.id)) !== JSON.stringify(refreshed.nodes.map((n) => n.id))) out.push('the two trees hold the same nodes in a different order');
  if (drawn.focus !== refreshed.focus) out.push(`the focus is ${JSON.stringify(drawn.focus)} in the frame that reused views and ${JSON.stringify(refreshed.focus)} after a refresh`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Timing (README: AC1 and AC11's timing). The lane's rule is scripts/benchmark.mjs's judgeLimit, imported, never copied.

interface Lane {
  judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }): { status: string; reason?: string; margin?: number };
  fingerprint(): Obj;
}
let laneModule: Lane | undefined;
async function lane(): Promise<Lane> {
  laneModule ??= (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Lane;
  return laneModule;
}
/** Nearest-rank percentile. */
export function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}
export const load = (): number => loadavg()[0]!;
/**
 * Several limits, each on five runs, judged by the lane on this machine's fingerprint and the runs' loads. Every
 * verdict is printed first; then the test fails `INCONCLUSIVE:` when any is, and fails naming each one that isn't PASS.
 */
export async function judgeAll(limits: { what: string; limit: number; runs: number[] }[], loads: { start: number; end: number }[]): Promise<void> {
  const { judgeLimit, fingerprint } = await lane();
  const machine = fingerprint();
  const judged = limits.map((l) => ({ ...l, r: judgeLimit({ limit: l.limit, runs: l.runs, fingerprint: machine, loads }) }));
  for (const j of judged) console.log(`${j.what}: ${j.r.status}, runs ${j.runs.map((x) => x.toFixed(3)).join(', ')} against ${j.limit}${j.r.reason ? `: ${j.r.reason}` : ''}`);
  const failed = judged.filter((j) => j.r.status === 'FAIL' || j.r.status === 'BLOCKED');
  if (failed.length) expect.fail(failed.map((j) => `${j.what}: ${j.r.status}: ${j.r.reason ?? ''} (runs ${j.runs.join(', ')}, limit ${j.limit})`).join('; '));
  const open = judged.filter((j) => j.r.status !== 'PASS');
  if (open.length) expect.fail(`INCONCLUSIVE: ${open.map((j) => `${j.what}: ${j.r.reason ?? j.r.status}`).join('; ')}; this is not a pass`);
}
