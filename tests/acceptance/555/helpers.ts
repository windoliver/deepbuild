// Test-side tools for the #555 acceptance tests (README: The surface). They reuse #184's replica process (`Replica`,
// `driveBin`) and its plain tools, run a pool of `deep-drive` processes as the hub's replica, install the playtest
// plug-in (packages/checks/playtest) in an extension host and run its checks through `runCheck`, and read each run the
// replica played. Every play, track, value, hash and refusal read here is the implementation's own; the expected
// values come from the issue's text, this suite's crawler and the replica's own plays. Nothing stands in for the
// replica, the host or the plug-in. Processes are #184's helpers' children, stopped by PID.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, expect } from 'vitest';
import { Replica, REPO, blocked, canon, driveBin, played, runSeed, sha256, show, tempDir, type Obj } from '../184/helpers.ts';
import type { Program } from '../533/helpers.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';

export { canon, driveBin, macOnly, none, runSeed, show, word, type Obj } from '../184/helpers.ts';
export type { CheckResult, Program };

/** Each criterion's tag (scripts/proof-change.mjs: `#555.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = { 1: '#555.c6cb5bbb', 2: '#555.2e7fd78d', 3: '#555.4e926f67', 4: '#555.f6861216' } as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;
export const FLICKS = 705_600_000;
/** The crawler's step at 60 Hz, in flicks. */
export const STEP_60 = FLICKS / 60;

/** A value an array path holds at a step: its list of `count` values, the first for a count of 1. */
export const scalar = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);
/** A value at row r of an array path's list. */
export const rowOf = (v: unknown, r: number): number => Number(Array.isArray(v) ? v[r] : r === 0 ? v : NaN);

// ---------------------------------------------------------------------------------------------------
// #533's assembler (tests/acceptance/533/wat, read only), built from a copy outside the repo: at the base the repo's
// .cargo/config.toml patches have outgrown that crate's lockfile, so `cargo build --locked` of it in place fails
// ("cannot update the lock file"). The copy's lock leaves out its `[[patch.unused]]` entries, which name only the
// repo's patches, and every package stays at its locked version.

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const copy = join(tempDir('wat-crate'), 'wat');
  cpSync(join(REPO, 'tests', 'acceptance', '533', 'wat'), copy, { recursive: true });
  const lock = join(copy, 'Cargo.lock');
  writeFileSync(lock, readFileSync(lock, 'utf8').replace(/\n\[\[patch\.unused\]\]\n(?:[^\n[][^\n]*\n?)*/g, '\n'));
  const target = join(TARGET, 'acceptance-555-wat');
  const env: NodeJS.ProcessEnv = {
    ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(copy, 'Cargo.toml')], { cwd: copy, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) blocked(`cargo could not run: ${run.error.message}`);
  if (run.status !== 0) blocked(`#533's assembler (tests/acceptance/533/wat) didn't build from its copy: ${(run.stderr ?? '').slice(-2000)}`);
  watBin = join(target, 'debug', 'acceptance-533-wat');
  return watBin;
}
const assembled = new Map<string, Program>();
/** WebAssembly text assembled (and validated) by #533's assembler. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = tempDir('wat');
  const file = join(dir, `${name}.wat`);
  writeFileSync(file, text);
  const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`the assembler refused ${name}: ${(run.stderr ?? '').slice(-2000)}`);
  const bytes = readFileSync(join(dir, `${name}.wasm`));
  const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
  assembled.set(`${name}\n${text}`, p);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The hub's pieces and a pool of replicas.

/** The crawler and its twins as the hub knows them, `<doc>@1`. */
const ulid = (n: number): string => `01JB555P${String(n).padStart(18, '0')}`;
export const DOC = { crawler: ulid(1), lag: ulid(2), nofight: ulid(3), sinker: ulid(4), noturn: ulid(5), potion: ulid(6) } as const;
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

/** The array paths a logged reply keeps (a run's values may hold the whole grid a step; the log keeps these). */
const KEPT = new Set(['crawler.depth', 'crawler.dead', 'crawler.won', 'crawler.hp', 'crawler.cell', 'crawler.turn', 'crawler.legal', 'crawler.nlegal', 'crawler.accepted', 'crawler.refused', 'crawler.rooms', 'crawler.grid']);
/** One play as a replica got it and answered it: the piece's `<doc>@<rev>` (when played through the hub), the call's fields (assets left out) and the reply, its values cut to KEPT. */
export interface Played { piece: string | null; call: Obj; reply: Obj; replica: number }
const kept = (reply: Obj, call: Obj): Obj => {
  if (reply['values'] === null || typeof reply['values'] !== 'object') return reply;
  // A grid is kept only for this suite's own plays, which ask for it over a step or two.
  const ownGrid = call['bot'] === undefined && call['track'] === undefined;
  const values = Object.fromEntries(Object.entries(reply['values'] as Obj).filter(([p]) => KEPT.has(p) && (p !== 'crawler.grid' || ownGrid)));
  return { ...reply, values };
};
/** Replica processes (#184's `deep-drive`), each playing one call at a time; every play is logged with its reply. */
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  /** `n` debug replicas (`deep-drive` with env-plants, #184's build). */
  static async open(n: number): Promise<Pool> {
    const bin = driveBin('debug');
    return new Pool(await Promise.all(Array.from({ length: n }, () => Replica.start(bin))));
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
  /** `{"call": "play", …run}` on a free replica; its whole reply (the log keeps it cut). */
  async play(run: Obj, piece: string | null = null): Promise<Obj> {
    const i = await this.take();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', ...run });
      const { piece: _body, assets: _assets, ...call } = run;
      this.log.push({ piece, call, reply: kept(reply, call), replica: i });
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
}

// ---------------------------------------------------------------------------------------------------
// The runs of a playtest, as the replica played them.

/** A bot's kind: the first of policy, logic, legal, explorer and descender it holds. */
export const KINDS = ['policy', 'logic', 'legal', 'explorer', 'descender'] as const;
export const kindOf = (bot: unknown): string => (bot && typeof bot === 'object' ? KINDS.find((k) => k in (bot as Obj)) ?? 'none' : 'none');
export interface RunPlays { b: number; i: number; seed: number; play: Played; replays: Played[] }
/**
 * Each run of `input` the log holds a bot play of (bot b's run i: seed hash(seed, i), a bot of b's kind), with the plays
 * of its recorded track at its seed without a bot (runs of one policy can record one track, so the seed tells them apart).
 */
export function runsOf(log: Played[], input: Obj): RunPlays[] {
  const mine = log.filter((p) => p.piece === input['piece']);
  const runs: RunPlays[] = [];
  (input['bots'] as Obj[]).forEach((bot, b) => {
    for (let i = 0; i < (input['runs'] as number); i++) {
      const seed = runSeed(input['seed'] as number, i);
      const play = mine.find((p) => kindOf(p.call['bot']) === kindOf(bot) && p.call['seed'] === seed && p.reply['ok'] === true && Number(p.reply['steps']) > 0);
      expect(play, `bot ${b} (${kindOf(bot)}) run ${i} (seed ${seed}) was played in a replica with its bot`).toBeDefined();
      played(play!.reply, `bot ${b} run ${i}`);
      const replays = mine.filter((p) => !p.call['bot'] && p.call['seed'] === seed && Array.isArray(p.call['track']) && canon(p.call['track']) === canon(play!.reply['entries']));
      runs.push({ b, i, seed, play: play!, replays });
    }
  });
  return runs;
}
/** A path's values in a play's reply, one a step, or undefined when the play didn't ask for it. */
export const valuesOf = (reply: Obj, path: string): unknown[] | undefined => {
  const v = (reply['values'] as Obj | undefined)?.[path];
  return Array.isArray(v) ? v : undefined;
};
/** The first step at which a path's value (row 0) satisfies `pred`, or -1. */
export const firstStep = (list: unknown[] | undefined, pred: (v: number) => boolean): number => (list ?? []).findIndex((v) => pred(scalar(v)));
/** Whether a play of a check ran no step: each reply an error or a play of no step (the owner's ruling on #184: refused before its first step). */
export const ranNoStep = (p: Played): boolean => p.reply['ok'] !== true || Number(p.reply['steps']) === 0;

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the playtest plug-in (packages/checks/playtest), loaded under a grant of every DOC.

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
export const PLAYTEST_KIND = 'playtest';
/** The playtest plug-in's entry, for its named exports; a path, so the suite type-checks at the base. */
export const playtestEntry = async (): Promise<Obj> => (await import(join(PLAYTEST_DIR, 'index.ts'))) as Obj;
/** The plug-in's `lockPlay(play)` (README: The surface): the interface as locked, or a refusal naming why. */
export async function lockPlay(play: Obj): Promise<Obj> {
  const entry = await playtestEntry();
  expect(typeof entry['lockPlay'], 'the playtest plug-in exports lockPlay(play), which locks a play interface in the brief').toBe('function');
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
  const dir = tempDir('hub555');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  expect(existsSync(join(PLAYTEST_DIR, 'deepbuild.json')), 'the playtest plug-in is a first-party package at packages/checks/playtest').toBe(true);
  const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
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

/** A playtest's check spec: its input in `play`, as #184's. */
export const playtestSpec = (input: Obj): Obj => ({ kind: PLAYTEST_KIND, runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input });
export async function runPlaytest(hub: Hub, input: Obj): Promise<CheckResult> {
  return (await hub.host['runCheck'](PLAYTEST_KIND, playtestSpec(input), { checkout: tempDir('checkout555'), deadline: DEADLINE })) as CheckResult;
}
export const shown = (r: CheckResult): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
/** The failure whose test is `test` and whose message starts with `code`. */
export const failureOf = (r: CheckResult, test: string, code: string): CheckResult['failures'][number] | undefined =>
  r.failures.find((f) => f.test === test && f.message.startsWith(code));
