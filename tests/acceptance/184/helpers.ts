// Test-side tools for the #184 acceptance tests (README: The surface). They build `deep-drive` and drive its `play`
// call over stdin, one process a replica; hand those replicas to an extension host as the hub's replica; install the
// playtest plug-in from packages/checks/playtest and the maze player (fixtures/maze-player) in that host and run their
// checks through `runCheck`; and judge a run with the verdict engine. Every play, track, value, hash, frame, outcome
// and refusal read here is the implementation's own; the expected values come from the issue's text, this suite's
// programs and the logic module's own bakes. Nothing stands in for the replica, the host, the plug-in or the verdict.
// Processes are stopped by PID (the child handles this file started); nothing is stopped by name or port.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { verdict, type Run, type Source, type Verdict } from '../../../packages/verdicts/src/index.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';

export type Obj = { [key: string]: any };
export type { CheckResult };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's tag (scripts/proof-change.mjs: `#184.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = {
  1: '#184.5a3904f8', 2: '#184.f5950275', 3: '#184.7131c480', 4: '#184.66d5f782', 5: '#184.430caa9a',
  6: '#184.9cae67c4', 7: '#184.25600094', 8: '#184.8c80cb23', 9: '#184.1d76cea0', 10: '#184.396b3e5c',
  11: '#184.a01f1ce5', 12: '#184.af2d1b3a', 13: '#184.0bdc1a84', 14: '#184.8ba629a5', 15: '#184.694b8a04',
} as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;
export const FLICKS = 705_600_000;
/** The maze's step at 60 Hz, in flicks. */
export const STEP_60 = FLICKS / 60;
/** The issue's playtest: 20 runs per bot, a seed, 120 s, stuck when the token stays 10 s. */
export const RUNS = 20;
export const SEED = 184;
export const SPAN_S = 120;
export const WITHIN_S = 10;
export const STEPS_120 = SPAN_S * 60;
export const STUCK_STEPS = WITHIN_S * 60;
export const MEASURE = 'maze.cell';
export const WON = 'maze.won';
export const HASH = /^[0-9a-f]{64}$/;
export const HEX = /^[0-9a-f]{16,64}$/;

/** A run that can't be judged here fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** The replica renders on macOS only and its binaries exit elsewhere: off macOS a replica test is INCONCLUSIVE. */
export function macOnly(): void {
  if (process.platform !== 'darwin') inconclusive('the replica (deep-replica, on deep-app) runs on macOS only and its binaries exit on any other OS');
}

export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** `text` as a whole word or number, not part of a longer one. */
export const word = (text: string): RegExp => new RegExp(`(^|[^0-9A-Za-z_])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z_])`);
/** JSON with every object's keys sorted, to compare two values parsed apart. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/** A value an array path holds at a step: its list of `count` values, the first of them for a count of 1. */
export const scalar = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

/** Run i's seed: hash(the check's seed, i), the first 8 bytes of SHA-256(seed as u64 LE, i as u32 LE) big-endian, shifted right 11 bits to a JSON-safe integer (README: The surface). */
export function runSeed(seed: number, i: number): number {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(seed));
  b.writeUInt32LE(i, 8);
  return Number(createHash('sha256').update(b).digest().readBigUInt64BE(0) >> 11n);
}

/** The step ceiling of a figure piece's logic item stepping at `hz` on the app (Budget classes; the logic module's metering record). */
export function ceiling(hz: number): number {
  const metering = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-logic', 'metering.json'), 'utf8')) as { ns_per_fuel: { app: number } };
  const FIGURE_CPU_MS = 4;
  return Math.floor((FIGURE_CPU_MS * 1e6 * 0.75) / Math.max(1, Math.ceil(hz / 60)) / metering.ns_per_fuel.app);
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders and the processes this file started.

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-184-${tag}-`)));
  made.push(dir);
  return dir;
}
const children: ChildProcess[] = [];
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null && c.pid) try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 120_000);

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-drive` (crates/deep-replica), copied out under its build's name, once per process.

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** The builds this suite drives: the planted replicas a test names with DEEP_DRIVE_PLANT need `env-plants` (debug only). */
export type DriveBuild = 'debug' | 'release' | 'release-unkept';
const DRIVE_BUILDS: Record<DriveBuild, { args: string[]; profile: string }> = {
  debug: { args: ['--features', 'env-plants'], profile: 'debug' },
  release: { args: ['--release'], profile: 'release' },
  'release-unkept': { args: ['--release', '--features', 'test-renders-unkept-frames'], profile: 'release' },
};
let bins = '';
const built = new Map<DriveBuild, { bin: string; error: string }>();
export function driveBin(b: DriveBuild): string {
  let made1 = built.get(b);
  if (!made1) {
    if (!bins) bins = tempDir('bins');
    const args = ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', ...DRIVE_BUILDS[b].args];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (run.error) blocked(`cargo could not run: ${run.error.message}`);
    const bin = join(bins, `deep-drive-${b}`);
    const error = run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => /error|warning: unused/.test(l)).slice(0, 12).join('\n')}`;
    if (!error) copyFileSync(join(TARGET, DRIVE_BUILDS[b].profile, 'deep-drive'), bin);
    made1 = { bin, error };
    built.set(b, made1);
  }
  expect(made1.error, `deep-drive builds (${b})`).toBe('');
  return made1.bin;
}

// ---------------------------------------------------------------------------------------------------
// One replica process: `deep-drive --out <dir>`, `{"ready": true}`, then one JSON line back per call.

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private readonly stderr: string[] = [];
  private constructor(readonly child: ChildProcess, readonly out: string) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const text = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let line: Obj;
        try { line = JSON.parse(text) as Obj; } catch { line = { unparsed: text.slice(0, 400) }; }
        this.waiting.shift()?.(line);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.stderr.push(d); if (this.stderr.length > 200) this.stderr.shift(); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true, stderr: this.log() }); });
  }
  get pid(): number { return this.child.pid!; }
  log(): string { return this.stderr.join('').slice(-2000); }
  /** Starts `bin`, with DEEP_DRIVE_PLANT set to `plant` when given, its HOME a fresh folder; waits for `{"ready": true}`. */
  static async start(bin: string, plant?: string): Promise<Replica> {
    const dir = tempDir('replica');
    const out = join(dir, 'out');
    const home = join(dir, 'home');
    mkdirSync(out, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env['DEEP_DRIVE_PLANT'];
    if (plant) env['DEEP_DRIVE_PLANT'] = plant;
    const child = spawn(bin, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    const r = new Replica(child, out);
    const first = await r.next(300_000);
    if (first['ready'] !== true) throw Error(`deep-drive didn't say {"ready": true}${plant ? ` with DEEP_DRIVE_PLANT=${plant}` : ''}: ${show(first, 400)} ${r.log()}`);
    return r;
  }
  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((done) => {
      const timer = setTimeout(() => done({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); done(line); });
    });
  }
  async call(line: Obj, ms = 1_800_000): Promise<Obj> {
    const answer = this.next(ms);
    this.child.stdin!.write(`${JSON.stringify(line)}\n`);
    const reply = await answer;
    if (reply['exited'] || reply['timedOut'] || reply['unparsed'] !== undefined) throw Error(`deep-drive gave no JSON reply to ${String(line['call'])}: ${show(reply, 600)}`);
    return reply;
  }
}

/** The programs bots name, by sha256, handed to the replica with every play (the hub's asset store). */
const ASSETS = new Map<string, string>();
export function keepAsset<P extends { sha: string; b64: string }>(p: P): P {
  ASSETS.set(p.sha, p.b64);
  return p;
}
/** The pieces the hub knows, by `<doc>@<rev>`. */
const PIECES = new Map<string, Obj>();
const ulid = (n: number): string => `01JB184P${String(n).padStart(18, '0')}`;
export const DOC = { clean: ulid(1), stuck: ulid(2), walled: ulid(3), trap: ulid(4), heavy: ulid(5), other: ulid(9) } as const;
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

/** One play as a replica got it and answered it: the piece's `<doc>@<rev>` (when played through the hub), the call's fields and the reply. */
export interface Played { piece: string | null; call: Obj; reply: Obj; ms: number; replica: number }
/**
 * Replica processes, each playing one call at a time; every play is logged with its reply, so a test reads what each
 * run and replay recorded. A play goes to the first free replica.
 */
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  static async open(starts: { bin: string; plant?: string }[]): Promise<Pool> {
    const replicas = await Promise.all(starts.map((s) => Replica.start(s.bin, s.plant)));
    return new Pool(replicas);
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
  /** `{"call": "play", …run, "piece": Piece, "assets"}` on a free replica; its reply. */
  async play(run: Obj, piece: string | null = null): Promise<Obj> {
    const i = await this.take();
    const at = performance.now();
    try {
      const { piece: body, ...rest } = run;
      const reply = await this.replicas[i]!.call({ call: 'play', piece: body, ...rest, assets: Object.fromEntries(ASSETS) });
      this.log.push({ piece, call: rest, reply, ms: performance.now() - at, replica: i });
      return reply;
    } finally {
      this.give(i);
    }
  }
  /** The hub's replica (README: The surface): the host's play call, its piece resolved by `<doc>@<rev>`. */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const body = PIECES.get(String(piece));
    if (!body) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    return this.play({ ...run, piece: body }, String(piece));
  };
  /** The PNG a replica kept for a frame hash, or null. */
  frameFile(hash: string): string | null {
    for (const r of this.replicas) {
      const file = join(r.out, 'frames', `${hash}.png`);
      if (existsSync(file)) return file;
    }
    return null;
  }
}

/** A play's reply, checked for the fields every play answers (README: The surface). */
export function played(reply: Obj, what: string): Obj {
  expect(reply['ok'], `${what}: the play answers ok: ${show(reply, 1200)}`).toBe(true);
  expect(String(reply['track']), `${what}: track is a sha256`).toMatch(HASH);
  expect(Array.isArray(reply['entries']), `${what}: entries is a list`).toBe(true);
  expect(reply['values'] !== null && typeof reply['values'] === 'object', `${what}: values is an object`).toBe(true);
  expect(Array.isArray(reply['checkpoints']) && reply['checkpoints'].length > 0, `${what}: checkpoints is a non-empty list`).toBe(true);
  expect(String(reply['final']), `${what}: final is a hash`).toMatch(HEX);
  expect(Array.isArray(reply['frames']), `${what}: frames is a list`).toBe(true);
  expect(Array.isArray(reply['step_times']), `${what}: step_times is a list`).toBe(true);
  expect(reply['fuel'] !== null && typeof reply['fuel'] === 'object', `${what}: fuel is an object`).toBe(true);
  expect(reply['ceilings'] !== null && typeof reply['ceilings'] === 'object', `${what}: ceilings is an object`).toBe(true);
  return reply;
}
/** The first index at which `pred` holds, or -1. */
export const firstStep = (list: unknown[], pred: (v: any, k: number) => boolean): number => list.findIndex(pred);
/** A play's bot entries at step k of a `stepFlicks` clock: those stamped in ((k − 1) × step, k × step]. */
export const entriesAt = (entries: Obj[], k: number, stepFlicks = STEP_60): Obj[] => entries.filter((e) => Number(e['t']) > (k - 1) * stepFlicks && Number(e['t']) <= k * stepFlicks);

// ---------------------------------------------------------------------------------------------------
// The playtest's runs, as the replica played them: each bot's run i (seed hash(seed, i)) and its replays.

const kindOf = (bot: Obj): string => ('logic' in bot ? `logic:${String(bot['logic']?.['program'])}` : 'policy');
export interface RunPlays { b: number; i: number; seed: number; play: Played; replays: Played[] }
/** Each run of `input` the log holds a bot play of, with the plays of its recorded track without a bot. */
export function runsOf(log: Played[], input: Obj): RunPlays[] {
  const mine = log.filter((p) => p.piece === input['piece']);
  const runs: RunPlays[] = [];
  (input['bots'] as Obj[]).forEach((bot, b) => {
    for (let i = 0; i < (input['runs'] as number); i++) {
      const seed = runSeed(input['seed'] as number, i);
      const play = mine.find((p) => p.call['bot'] && kindOf(p.call['bot']) === kindOf(bot) && p.call['seed'] === seed);
      expect(play, `bot ${b} run ${i} (seed ${seed}) was played in a replica with its bot`).toBeDefined();
      played(play!.reply, `bot ${b} run ${i}`);
      const replays = mine.filter((p) => !p.call['bot'] && p.call['track'] !== undefined && canon(p.call['track']) === canon(play!.reply['entries']));
      runs.push({ b, i, seed, play: play!, replays });
    }
  });
  return runs;
}
/** The hashes of the frames at `step` that any play of a run returned. */
export const framesAt = (r: RunPlays, step: number): string[] =>
  [r.play, ...r.replays].flatMap((p) => (p.reply['frames'] as Obj[]).filter((f) => f['step'] === step).map((f) => String(f['sha256'])));

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the playtest plug-in (packages/checks/playtest) and the maze player (fixtures).

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
export const PLAYTEST_KIND = 'playtest';
export const PLAYER_ID = 'test/maze-player';
export const PLAYER_KIND = 'ext.maze-player.play';
/** The playtest plug-in's entry, for its named exports (README: The surface); a path, so the suite type-checks at the base. */
export const playtestEntry = async (): Promise<Obj> => (await import(join(PLAYTEST_DIR, 'index.ts'))) as Obj;

export interface Player { config: string; seen: string }
export interface Hub { host: Obj; player: Player | null }
/**
 * A fresh extension host whose replica is `pool`'s (none when null), with the playtest plug-in installed under a grant
 * of every maze document and loaded (`loaded`), installed and never loaded (`off`), or not installed (`none`), and the
 * maze player installed and loaded under a grant of `player.docs` when given. `plant` selects a planted host.
 */
export async function openHub(o: { pool: Pool | null; playtest: 'loaded' | 'off' | 'none'; player?: { docs: string[] }; plant?: string }): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = tempDir('hub');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });

  const release: { id: string; version: string; digest: string }[] = [];
  if (o.playtest !== 'none') {
    expect(existsSync(join(PLAYTEST_DIR, 'deepbuild.json')), 'the playtest plug-in is a first-party package at packages/checks/playtest').toBe(true);
    const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
    expect([m['id'], m['checks']], 'its manifest names deepbuild/playtest and the check kind playtest').toEqual([PLAYTEST_ID, [PLAYTEST_KIND]]);
    release.push({ id: PLAYTEST_ID, version: String(m['version']), digest: hostEntry.packageDigest(PLAYTEST_DIR) });
  }
  let pkg = '';
  let player: Player | null = null;
  if (o.player) {
    pkg = tempDir('pkg-maze-player');
    cpSync(join(HERE, 'fixtures', 'maze-player'), pkg, { recursive: true });
    for (const e of readdirSync(pkg)) if (e.endsWith('.fixture')) renameSync(join(pkg, e), join(pkg, e.slice(0, -'.fixture'.length)));
    const config = join(tempDir('player'), 'config.json');
    player = { config, seen: join(dirname(config), 'seen.jsonl') };
    writeFileSync(join(pkg, 'player.json'), JSON.stringify({ config }));
    const manifestPath = join(pkg, 'deepbuild.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Obj;
    manifest['digest'] = hostEntry.packageDigest(pkg);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    release.push({ id: PLAYER_ID, version: String(manifest['version']), digest: hostEntry.packageDigest(pkg) });
  }
  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now,
    // README, The surface: the hub's replica, which plays a piece the hub resolves by <doc>@<rev>.
    replica: o.pool ? o.pool.hub : async () => ({ ok: false, error: { code: 'refused', message: 'this test\'s hub has no replica' } }),
    ...(o.plant ? { plant: o.plant } : {}),
  } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const mazes = Object.values(DOC).filter((d) => d !== DOC.other);
  if (o.playtest !== 'none') {
    const installed = await host['install']({ from: PLAYTEST_DIR, builtBy: null, grant: { docs: mazes } });
    if (o.playtest === 'loaded') {
      const conformance = await host['check'](installed);
      expect(conformance.passed, `${PLAYTEST_ID} passes conformance: ${show(conformance)}`).toBe(true);
      const load = await host['load'](installed);
      expect(load.status === 'loaded' && load.place, `${PLAYTEST_ID} loads in the hub: ${show(load)}`).toBe('hub');
    }
  }
  if (o.player) {
    const installed = await host['install']({ from: pkg, builtBy: null, grant: { docs: o.player.docs } });
    const conformance = await host['check'](installed);
    expect(conformance.passed, `${PLAYER_ID} passes conformance: ${show(conformance)}`).toBe(true);
    const load = await host['load'](installed);
    expect(load.status === 'loaded' && load.place, `${PLAYER_ID} loads in the hub: ${show(load)}`).toBe('hub');
  }
  return { host, player };
}

/** A playtest's check spec: its input in `play`, the one place the host reads a check's seeds, bots and tracks from. */
export const playtestSpec = (input: Obj): Obj => ({ kind: PLAYTEST_KIND, runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input });
/** The issue's playtest of a maze document: 20 runs a bot, seed 184, 120 s, stuck on maze.cell within 10 s, the goal won. */
export function playInput(piece: string, bots: Obj[], o: Obj = {}): Obj {
  return {
    piece, bots, runs: RUNS, seed: SEED, span: SPAN_S, stuck: { measure: MEASURE, by: 1, within: WITHIN_S },
    goals: [{ name: 'won', when: WON }], frames: { every: 0 }, ...o,
  };
}
export async function runPlaytest(hub: Hub, input: Obj): Promise<CheckResult> {
  return (await hub.host['runCheck'](PLAYTEST_KIND, playtestSpec(input), { checkout: tempDir('checkout'), deadline: DEADLINE })) as CheckResult;
}
/** What the maze player does on its next run (fixtures/maze-player): its plays, its testsRun and its evidence. */
export interface PlayerConfig { plays: { piece: string; run: Obj }[]; testsRun: number; evidence: 'tracks' | 'frames'; drop?: number }
export interface Seen { piece: string; run: Obj; reply: Obj }
/** One run of the maze player's check with `input` as its spec's `play`; the result and what each play returned. */
export async function runPlayer(hub: Hub, input: Obj, config: PlayerConfig): Promise<{ result: CheckResult; seen: Seen[] }> {
  const p = hub.player!;
  writeFileSync(p.seen, '');
  writeFileSync(p.config, JSON.stringify({ ...config, seen: p.seen }));
  const spec = { kind: PLAYER_KIND, runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input };
  const result = (await hub.host['runCheck'](PLAYER_KIND, spec, { checkout: tempDir('checkout'), deadline: DEADLINE })) as CheckResult;
  const seen = existsSync(p.seen) ? readFileSync(p.seen, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Seen) : [];
  return { result, seen };
}

export const shown = (r: CheckResult): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
/** The failure a run's test names (`bot <b> run <i>`) whose message starts with `code`. */
export const failureOf = (r: CheckResult, test: string, code: string): CheckResult['failures'][number] | undefined =>
  r.failures.find((f) => f.test === test && f.message.startsWith(code));

// ---------------------------------------------------------------------------------------------------
// The verdict on a claim whose one requirement one check covers, from that check's one run (as #68's suite judges).

const HEAD = 'c'.repeat(40);
const T0 = 1_761_955_200_000;
export function judge(result: CheckResult, source: Source): Verdict {
  const check = 'check:playtest';
  const run: Run = {
    run: 'run:playtest', check, claim: 'claim:184', commit: HEAD, digest: `d1:${sha256(check)}`, environment: { os: 'darwin' }, tools: {},
    outcome: result.outcome, started: T0, ended: T0 + 1, tests_run: result.testsRun, reads: [...result.read],
    failures: result.failures.map((f) => ({ test: f.test, message: f.message, cause: 'change:maze', frames: [{ file: f.file, line: f.line }], covers: [], case: null })),
    evidence: [], kept: true,
    ...(result.outcome === 'missing' ? { missing: { cause: result.failures.map((f) => f.message).join('; ') || 'missing', owner: 'you', since: T0 } } : {}),
  };
  return verdict({
    claim: 'claim:184', agent: 'session:agent', repo: 'repo:maze', task: 'task:184', commit: HEAD,
    requirements: [{ req: 'R1', depth: 'journey', oracle: 'code', on_base: 'passes' }],
    checks: [{ check, digest: run.digest, source, depth: 'journey', proof: 'journey', covers: ['R1'], environment: { os: 'darwin' }, tools: {} }],
    runs: [run], changes: [], waivers: [], now: T0 + 2,
  });
}

// ---------------------------------------------------------------------------------------------------
// The perf lane's tools (criteria 13 and 15).

export interface Bench {
  fingerprint(): Obj;
  judgeLimit(o: { limit: number; runs: number[]; fingerprint: Obj; loads: { start: number; end: number }[] }): { status: string; reason?: string; runs?: number[] };
  validateBudgets(current: unknown, base: unknown): void;
}
export const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
export const load = (): number => loadavg()[0] ?? Number.NaN;
export const readJson = (path: string): Obj => JSON.parse(readFileSync(path, 'utf8')) as Obj;
