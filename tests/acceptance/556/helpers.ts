// Test-side tools for the #556 acceptance tests (README: The surface). They reuse #184's replica process (`Replica`,
// `driveBin`, the `env-plants` debug build and the release build) and plain tools, and #555's assembler; run a pool of
// `deep-drive` processes as the hub's replica, each started with a plant when a test names one; open a hub (an
// extension host with the playtest plug-in installed and loaded); run the plug-in's kinds through `runCheck`; hand
// the plug-in's kit a replica of its own; and hold this suite's own breadth-first search over a recorded floor, the
// oracle a floor's expected cells come from. Every play, value, hash, floor and failure read here is the
// implementation's own; the expected values come from the issue's text, this suite's fixtures and the replica's own
// values. Nothing stands in for the replica, the host or the plug-in. Processes are #184's helpers' children, stopped
// by PID.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { REPO, Replica, driveBin, show, tempDir, type DriveBuild, type Obj } from '../184/helpers.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';

export { REPO, canon, driveBin, inconclusive, macOnly, runSeed, sha256, show, word, type Obj } from '../184/helpers.ts';
export { assemble } from '../555/helpers.ts';
export type { CheckResult };

/** Each criterion's tag (scripts/proof-change.mjs: `#556.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = {
  1: '#556.9ac3832b', 2: '#556.92ad8bdf', 3: '#556.abf74c91', 4: '#556.2024793e', 5: '#556.eb50d272', 6: '#556.d8d26095', 7: '#556.cd2aad65',
} as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;
/** A path's values in a play's reply, one a step, or [] when the play didn't ask for it. */
export const valuesOf = (reply: Obj, path: string): unknown[] => {
  const v = (reply['values'] as Obj | undefined)?.[path];
  return Array.isArray(v) ? v : [];
};
/** A value an array path holds at a step: its list of `count` values, the first of them for a count of 1. */
export const scalar = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);

// ---------------------------------------------------------------------------------------------------
// The hub's pieces, by `<doc>@1`, and the plug-in kit's own, by `<name>@1`.

const ulid = (n: number): string => `01JC556P${String(n).padStart(18, '0')}`;
export const DOC = {
  crawler: ulid(1), walled: ulid(2), vault: ulid(3), noturn: ulid(4), flow: ulid(5), stale: ulid(6), rising: ulid(7),
  hex: ulid(8), map: ulid(9), noTeleporter: ulid(10),
} as const;
const PIECES = new Map<string, Obj>();
/** Keeps `piece` as revision 1 of `doc`; its `<doc>@<rev>`. */
export function putPiece(doc: string, piece: Obj): string {
  PIECES.set(`${doc}@1`, piece);
  return `${doc}@1`;
}
export const pieceOf = (at: string): Obj => {
  const p = PIECES.get(at);
  if (!p) throw Error(`no piece ${at}`);
  return p;
};
/** The kit's pieces (README: The surface: `reachPieces()`), each `{piece, assets}`, played as `<name>@1`. */
const KIT_PIECES = new Map<string, Obj>();
export function adoptKitPieces(pieces: Record<string, Obj>): void {
  for (const [name, p] of Object.entries(pieces)) KIT_PIECES.set(name, p);
}
/** A play's piece and its programs: a hub piece by `<doc>@<rev>`, or a kit piece by `<name>@<rev>`. */
function resolve(at: string): Obj | undefined {
  const own = PIECES.get(at);
  if (own) return { piece: own };
  const kit = KIT_PIECES.get(at.slice(0, at.lastIndexOf('@')));
  return kit ? { piece: kit['piece'], assets: kit['assets'] } : undefined;
}

// ---------------------------------------------------------------------------------------------------
// A pool of replicas, each one `deep-drive` process playing one call at a time; every play is logged with its reply.

/** One play as a replica got it and answered it: the piece's `<doc>@<rev>`, the call's fields (assets and track left out, `track` its length), the reply as the log keeps it, its wall time. */
export interface Played { piece: string | null; call: Obj; reply: Obj; replica: number; ms: number }
export interface PoolOptions {
  /** The `DEEP_DRIVE_PLANT` each replica starts with (the `env-plants` build reads it). */
  plant?: string;
  /** The array paths whose values the log keeps (all others are dropped: a run's grid at every step is large). */
  keep?: readonly string[];
  /** The replica's build: #184's `debug` (env-plants) or `release`. */
  build?: DriveBuild;
}
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[], private readonly o: PoolOptions) { this.free = replicas.map((_, i) => i); }
  /** `n` replicas of the build `o.build` (#184's debug build with env-plants by default). */
  static async open(n: number, o: PoolOptions = {}): Promise<Pool> {
    const bin = driveBin(o.build ?? 'debug');
    return new Pool(await Promise.all(Array.from({ length: n }, () => Replica.start(bin, o.plant))), o);
  }
  private take(): Promise<number> {
    const i = this.free.shift();
    return i !== undefined ? Promise.resolve(i) : new Promise((done) => this.queue.push(done));
  }
  private give(i: number): void {
    const next = this.queue.shift();
    if (next) next(i);
    else this.free.push(i);
  }
  private kept(reply: Obj): Obj {
    const keep = new Set(this.o.keep ?? []);
    const values = reply['values'] && typeof reply['values'] === 'object' ? Object.fromEntries(Object.entries(reply['values'] as Obj).filter(([p]) => keep.has(p))) : reply['values'];
    const { step_times: _t, fuel: _f, frames: _fr, ...rest } = reply;
    return { ...rest, values };
  }
  /** `{"call": "play", …run}` on a free replica: the replica's whole reply (the log keeps it cut). */
  async play(run: Obj, piece: string | null = null): Promise<Obj> {
    const i = await this.take();
    const start = performance.now();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', ...run });
      const { piece: _body, assets: _assets, track, ...call } = run;
      this.log.push({ piece, call: { ...call, ...(Array.isArray(track) ? { track: track.length } : {}) }, reply: this.kept(reply), replica: i, ms: performance.now() - start });
      return reply;
    } finally {
      this.give(i);
    }
  }
  /** The hub's replica (README: The surface): the host's play call, its piece resolved by `<doc>@<rev>`. */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const body = resolve(String(piece));
    if (!body) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    return this.play({ ...run, ...body }, String(piece));
  };
  /** A play as the plug-in's own `Play` makes one (packages/checks/playtest/types.ts): its reply, a refusal thrown as its error's JSON. */
  readonly direct = async (piece: string, run: Obj): Promise<Obj> => {
    const reply = await this.hub({ ...run, call: 'play', piece });
    if (reply['ok'] !== true) throw Error(JSON.stringify(reply['error'] ?? reply));
    return reply;
  };
}
/** Whether a play ran no step: an error, or a play of no step (the owner's ruling on #184: refused before its first step). */
export const ranNoStep = (p: Played): boolean => p.reply['ok'] !== true || Number(p.reply['steps']) === 0;
/** A play of this suite's own, outside the hub, on `pool`: the piece at `<doc>@1`, its reply checked ok. */
export async function ownPlay(pool: Pool, at: string, run: Obj): Promise<Obj> {
  const reply = await pool.play({ ...run, piece: pieceOf(at) });
  expect(reply['ok'], `this suite's own play of ${at} answers ok: ${show(reply, 800)}`).toBe(true);
  return reply;
}
/** The plays of `piece` in `pool`'s log made with `bot` (by its kind's key) at `seed`, which ran steps: a run's plays. */
export function runPlays(pool: Pool, piece: string, kind: string, seed: number): Played[] {
  return pool.log.filter((p) => p.piece === piece && p.call['bot'] && kind in (p.call['bot'] as Obj) && p.call['seed'] === seed && p.reply['ok'] === true && Number(p.reply['steps']) > 0);
}

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the playtest plug-in (packages/checks/playtest), loaded under a grant of every DOC.

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
/** The playtest plug-in's entry, for its named exports; a path, so the suite type-checks at the base. */
export const playtestEntry = async (): Promise<Obj> => (await import(join(PLAYTEST_DIR, 'index.ts'))) as Obj;
/** The plug-in's kit module (README: The surface: `reachKit`, `reachPieces`); a path, so the suite type-checks at the base. */
export const kitModule = async (): Promise<Obj> => (await import(join(PLAYTEST_DIR, 'kit.ts'))) as Obj;
/** #555's `lockPlay(play)`: the interface as locked, or a refusal naming why. */
export async function lockPlay(play: Obj): Promise<Obj> {
  const entry = await playtestEntry();
  expect(typeof entry['lockPlay'], 'the playtest plug-in exports lockPlay(play) (#555)').toBe('function');
  return (await (async () => entry['lockPlay'](play))()) as Obj;
}

export interface Hub { host: Obj }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
/** A fresh extension host whose replica is `pool`'s, with the playtest plug-in installed under a grant of every DOC and loaded. */
export async function openHub(pool: Pool): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  expect(existsSync(join(PLAYTEST_DIR, 'deepbuild.json')), 'the playtest plug-in is a first-party package at packages/checks/playtest').toBe(true);
  const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  expect(m['checks'], `the plug-in's manifest lists the kind grid.reach beside playtest: ${show(m['checks'])}`).toEqual(expect.arrayContaining(['playtest', 'grid.reach']));
  expect(m['codes'], `the plug-in's manifest lists the codes grid.unreached and grid.flow: ${show(m['codes'])}`).toEqual(expect.arrayContaining(['grid.unreached', 'grid.flow', 'play.missing']));
  const dir = tempDir('hub556');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  const release = [{ id: PLAYTEST_ID, version: String(m['version']), digest: hostEntry.packageDigest(PLAYTEST_DIR) }];
  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now, replica: pool.hub,
  } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const installed = await host['install']({ from: PLAYTEST_DIR, builtBy: null, grant: { docs: Object.values(DOC) } });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${PLAYTEST_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const load = await host['load'](installed);
  expect(load.status === 'loaded' && load.place, `${PLAYTEST_ID} loads in the hub: ${show(load)}`).toBe('hub');
  return { host };
}

/**
 * The plug-in's kit for kind grid.reach (README: The surface): `reachKit(replica)` from its kit.ts, its pieces
 * (`reachPieces()`) adopted so this suite's replicas play them, each play through `pool`, a planted replica's
 * (`replica(plant)`) through a pool of its own.
 */
export async function reachKit(pool: Pool): Promise<Obj> {
  const m = await kitModule();
  expect(typeof m['reachKit'], 'the plug-in\'s kit.ts exports reachKit(replica): check.kind@1\'s kit for kind grid.reach').toBe('function');
  expect(typeof m['reachPieces'], 'and reachPieces(): the pieces its cases name').toBe('function');
  adoptKitPieces(m['reachPieces']() as Record<string, Obj>);
  const planted = new Map<string, Promise<Pool>>();
  const replica = (plant: string | null) => async (piece: string, run: Obj): Promise<Obj> => {
    if (plant === null) return pool.direct(piece, run);
    if (!planted.has(plant)) planted.set(plant, Pool.open(1, { plant }));
    return (await planted.get(plant)!).direct(piece, run);
  };
  return m['reachKit'](replica) as Obj;
}
/** A fill of the kit: its reference (`clean`), or the planted fill of that name. */
export function fillOf(kit: Obj, name: string): Obj {
  if (name === 'clean') {
    const cleans = kit['clean']() as Obj[];
    expect(cleans.length, 'the kit has a reference fill').toBeGreaterThan(0);
    return cleans[0]!;
  }
  const p = (kit['planted'] as Obj[]).find((x) => x['name'] === name);
  expect(p, `the kit plants a grid.reach runner named ${name}: ${show((kit['planted'] as Obj[]).map((x) => x['name']))}`).toBeDefined();
  return p!['fill'] as Obj;
}
/** A kit fill's check.kind@1 `run(spec, ctx)`: grid.reach on `spec` (its `reach` and `play`), playing through the kit's replica. */
export async function runFill(fill: Obj, spec: Obj): Promise<Result> {
  return (await fill['run'](spec, { checkout: tempDir('fill556'), deadline: DEADLINE, now: Date.now })) as Result;
}

// ---------------------------------------------------------------------------------------------------
// The plug-in's kinds through runCheck, and the result's fields (README: The surface).

const base = { runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null };
/** A playtest's spec: its input in `play` (#184). */
export const playtestSpec = (input: Obj): Obj => ({ kind: 'playtest', ...base, play: input });
/** A grid.reach spec: its own input in `reach`, and the input of the playtest it names in `play` (as #1048's rules.legal). */
export const reachSpec = (reach: Obj, playtest: Obj): Obj => ({ kind: 'grid.reach', ...base, reach, play: playtest });
/** A rules.legal spec (#1048): its own input in `legal`, and the input of the playtest it names in `play`. */
export const legalSpec = (legal: Obj, playtest: Obj): Obj => ({ kind: 'rules.legal', ...base, legal, play: playtest });

/** A recorded floor as grid.reach's result lists it. */
export interface Floor { run: string; seed: number; depth: number; step: number; hash: string; reached: boolean; unreached: number[][]; nearest: number[] | null }
/** A failing run of the flow form. */
export interface Flowed { run: string; step: number; cell: number[]; why: string }
/** grid.reach's result beside check.kind@1's (README: The surface). */
export interface Reach { floors: Floor[]; coverage: Record<string, number>; distinct: Record<string, number>; flow: Flowed[]; search_ms?: number }
export type Result = CheckResult & { reach?: Reach };
export async function runCheck(hub: Hub, spec: Obj): Promise<Result> {
  return (await hub.host['runCheck'](String(spec['kind']), spec, { checkout: tempDir('checkout556'), deadline: DEADLINE })) as Result;
}
export const shown = (r: Result): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
/** The failures whose message starts with `code`, of `test` when given. */
export const failuresOf = (r: Result, code: string, test?: string): CheckResult['failures'] =>
  r.failures.filter((f) => f.message.startsWith(code) && (test === undefined || f.test === test));
/** grid.reach's own result, checked for its fields' shapes. */
export function reachOf(r: Result): Reach {
  const x = r.reach as Reach | undefined;
  expect(x !== null && typeof x === 'object', `the result carries grid.reach's own: reach {floors, coverage, distinct, flow}: ${shown(r)}`).toBe(true);
  expect(Array.isArray(x!.floors) && Array.isArray(x!.flow), `reach.floors and reach.flow are lists: ${show(x, 600)}`).toBe(true);
  expect(x!.coverage !== null && typeof x!.coverage === 'object' && x!.distinct !== null && typeof x!.distinct === 'object', `reach.coverage and reach.distinct are {depth: count}: ${show(x, 600)}`).toBe(true);
  return x!;
}
/** A number a message names after `label ` (`seed 123`, `depth 2`, `step 608`), or undefined. */
export function named(message: string, label: string): number | undefined {
  const m = message.match(new RegExp(`(?:^|[^A-Za-z_])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (-?\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : undefined;
}
/** A cell a message names as `<label> [x, y]` (`cell [14, 14]`, `nearest [3, 9]`), or undefined. */
export function cellNamed(message: string, label: string): [number, number] | undefined {
  const m = message.match(new RegExp(`(?:^|[^A-Za-z_])${label} \\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\]`));
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

// ---------------------------------------------------------------------------------------------------
// This suite's own breadth-first search over a floor: the oracle for what grid.reach must find (design: Check input:
// `grid.reach`; Play interface `game.play@1`; Mark set: hex grid's neighbours by cube distance).

export interface GridIface {
  size: number[]; layers?: number; shape?: string; hex?: { orient?: string; offset?: string }; moves?: number;
  classes: Record<string, number[]>; locks?: Record<string, number>;
}
const PASSABLE = new Set(['open', 'door', 'key', 'exit']);
/** A value's class: the class whose values hold it; a value no class holds counts as blocked. */
export function classOf(g: GridIface, v: number): string {
  return Object.entries(g.classes).find(([, vs]) => vs.includes(v))?.[0] ?? 'blocked';
}
/** A cell's index from (x, Y), Y = layer × height + y: Y × width + x. */
export const indexOf = (g: GridIface, [x, y]: readonly number[]): number => y! * g.size[0]! + x!;
export const cellOf = (g: GridIface, i: number): [number, number] => [i % g.size[0]!, Math.floor(i / g.size[0]!)];
const parity = (n: number): number => ((n % 2) + 2) % 2;
/**
 * A cell's neighbours on its own layer: 4 or 8 on a square grid, as `moves` says; on a hex grid the 6 cells at cube
 * distance 1, converted by the grid's orient and offset (odd: the odd rows, or columns when flat, are shifted).
 */
export function neighbours(g: GridIface, i: number, offsetOverride?: 'odd' | 'even'): number[] {
  const [w, h] = [g.size[0]!, g.size[1]!];
  const [x, Y] = cellOf(g, i);
  const layer = Math.floor(Y / h);
  const y = Y - layer * h;
  let out: [number, number][];
  if (g.shape === 'hex') {
    const pointy = g.hex?.orient !== 'flat';
    const odd = (offsetOverride ?? g.hex?.offset ?? 'odd') !== 'even';
    const sign = odd ? -1 : 1;
    const [q, r] = pointy ? [x - (y + sign * parity(y)) / 2, y] : [x, y - (x + sign * parity(x)) / 2];
    const back = ([a, b]: [number, number]): [number, number] => (pointy ? [a + (b + sign * parity(b)) / 2, b] : [a, b + (a + sign * parity(a)) / 2]);
    out = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(([dq, dr]) => back([q + dq!, r + dr!]));
  } else {
    const four: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const eight: [number, number][] = [...four, [1, -1], [1, 1], [-1, 1], [-1, -1]];
    out = (g.moves === 8 ? eight : four).map(([dx, dy]) => [x + dx, y + dy]);
  }
  return out.filter(([a, b]) => a >= 0 && a < w && b >= 0 && b < h).map(([a, b]) => (layer * h + b) * w + a);
}
/**
 * The cells the search reaches from `starts` (indices) over open, door, key and exit cells, with key-and-door closure:
 * a locked cell opens once a cell holding its key value under `locks` is reached, every key kept, and the search runs
 * again until nothing more opens. `links` rows of (from, to, two_way) add their to cell as a neighbour of their from
 * cell, and back when two-way; a cell on another layer is reached only through one. `offset` takes a hex grid's
 * neighbours by another offset than it declares (a planted runner's).
 */
export function search(g: GridIface, cells: number[], starts: number[], links: number[][] = [], offset?: 'odd' | 'even'): Set<number> {
  const linked = new Map<number, number[]>();
  const add = (a: number, b: number): void => { linked.set(a, [...(linked.get(a) ?? []), b]); };
  for (const [from, to, two] of links) { add(from!, to!); if (two) add(to!, from!); }
  const opened = new Set<number>();
  for (;;) {
    const reached = new Set<number>(starts);
    const queue = [...starts];
    while (queue.length) {
      const c = queue.shift()!;
      for (const n of [...neighbours(g, c, offset), ...(linked.get(c) ?? [])]) {
        if (reached.has(n)) continue;
        const v = cells[n]!;
        const k = classOf(g, v);
        if (PASSABLE.has(k) || (k === 'locked' && opened.has(v))) { reached.add(n); queue.push(n); }
      }
    }
    const held = new Set([...reached].map((c) => cells[c]!));
    const more = Object.entries(g.locks ?? {}).filter(([lv, kv]) => !opened.has(Number(lv)) && held.has(kv)).map(([lv]) => Number(lv));
    if (!more.length) return reached;
    for (const lv of more) opened.add(lv);
  }
}
/**
 * The cells grid.reach must reach on a floor, in the order its failure names the first unreached one (README: The
 * surface): each goal in the order `goals` lists them (a class's cells in row-major order), then each cell of a class
 * in `every`, in row-major order, without repeats.
 */
export function mustReach(g: GridIface, cells: number[], goals: (string | number[])[], every: string[]): number[] {
  const out: number[] = [];
  const push = (i: number): void => { if (!out.includes(i)) out.push(i); };
  for (const goal of goals) {
    if (typeof goal === 'string') cells.forEach((v, i) => { if (classOf(g, v) === goal) push(i); });
    else push(indexOf(g, goal));
  }
  cells.forEach((v, i) => { if (every.includes(classOf(g, v))) push(i); });
  return out;
}
/** The reached cell nearest `cell`: the smallest |dx| + |dy| (y running through the layers), ties to the smaller index. */
export function nearestTo(g: GridIface, reached: Set<number>, cell: number): number {
  const [cx, cy] = cellOf(g, cell);
  let best = -1;
  let dist = Infinity;
  for (const r of [...reached].sort((a, b) => a - b)) {
    const [x, y] = cellOf(g, r);
    const d = Math.abs(x - cx) + Math.abs(y - cy);
    if (d < dist) { dist = d; best = r; }
  }
  return best;
}
/** A floor's hash (README: The surface): SHA-256, hex, of its cells as i32 little-endian, row-major, layer by layer. */
export function floorHash(cells: number[]): string {
  const b = Buffer.alloc(4 * cells.length);
  cells.forEach((v, i) => b.writeInt32LE(v, 4 * i));
  return createHash('sha256').update(b).digest('hex');
}
/** What this suite's search finds on one floor: the cell a failure names (or none), the reached cell nearest it, and every unreached cell grid.reach must reach. */
export function judgeFloor(g: GridIface, cells: number[], starts: number[], goals: (string | number[])[], every: string[], links: number[][] = [], offset?: 'odd' | 'even'): { cell: [number, number] | null; nearest: [number, number] | null; unreached: number[]; reached: Set<number> } {
  const reached = search(g, cells, starts, links, offset);
  const unreached = mustReach(g, cells, goals, every).filter((i) => !reached.has(i));
  const first = unreached[0];
  return {
    cell: first === undefined ? null : cellOf(g, first), nearest: first === undefined ? null : cellOf(g, nearestTo(g, reached, first)), unreached, reached,
  };
}
