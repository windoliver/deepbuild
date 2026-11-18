// The app, the web player and the replicas for criteria 3 and 5 (README: The surface). The app is `deep-show run` (#393's
// scenario binary, built and driven by #169's helpers); the web player is the bundle an `export` with `video.codec: web`
// writes, served and played in headless Chrome with WebGPU and read through `probe()` (#172's helpers); the replicas are
// `deep-drive` processes (#184's `Replica`) behind a hub's extension host with the playtest plug-in installed, as #555's
// suite opens one, here under a grant of this suite's document. Nothing stands in for the app, the player, the replica,
// the host or the plug-in: every value compared comes from them. Processes are #184's helpers' children and #172's
// server and browser, each stopped by its PID.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import { REPO, Replica, blocked, canon, driveBin, played, runSeed, show, tempDir } from '../184/helpers.ts';
import type { Obj } from './programs.ts';

export { present, presented, putEvidence, runShow, scenarioOf, useTemp } from '../169/helpers.ts';
export { done, play, useBrowsers, webExport, webReceiptOf, type Probe } from '../172/helpers.ts';
export type { CheckResult };

// ---------------------------------------------------------------------------------------------------
// `deep-show` (the `full` set), built once per file in its beforeAll and copied out. Cargo runs with rustup's proxy first
// on PATH, as #534's and #184's helpers run it for `deep-logic` and `deep-drive`, so the three builds share one target
// folder without rebuilding each other's crates (#172's helpers put the pinned toolchain's own cargo first on PATH).

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const SHOW_ARGS = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
/** `cargo build --locked --bin deep-show --no-default-features --features full`, in the file's beforeAll; the binary's path. */
export function useShowBin(timeout: number): () => string {
  let bin = '';
  let error = 'not built';
  beforeAll(() => {
    const env = {
      ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
      ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
    };
    const r = spawnSync('cargo', SHOW_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${SHOW_ARGS.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
    else {
      bin = join(tempDir('show860'), 'deep-show');
      copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
      error = '';
    }
  }, timeout);
  return () => {
    if (/cargo could not run/.test(error)) blocked(`${error}; this suite builds deep-show. Unblock: install rustup's cargo`);
    expect(error, `deep-show builds (cargo ${SHOW_ARGS.join(' ')})`).toBe('');
    return bin;
  };
}

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** The documents the app presents (`deep show`), and the piece the hub's replica plays (`<doc>@1`). */
export const DOC = { web: ulid('01JB860D', 1), match: ulid('01JB860D', 2), puzzle: ulid('01JB860P', 1) } as const;

// ---------------------------------------------------------------------------------------------------
// The app's `logic` call (#539, #213, #548): each step's hash and arrays per item, each checkpoint's full-state hash.

export interface AppRun { rows: Obj[]; checkpoints: { step: number; hash: string }[] }
export function appRun(reply: Obj | undefined, item: string, what: string): AppRun {
  expect(reply?.['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const rows = reply?.['steps'];
  expect(Array.isArray(rows), `${what}: steps is a list: ${show(reply, 600)}`).toBe(true);
  const list = reply?.['checkpoints']?.[item];
  expect(Array.isArray(list) && list.length > 0, `${what}: checkpoints.${item} lists the full-state hashes: ${show(reply?.['checkpoints'], 600)}`).toBe(true);
  const checkpoints = (list as Obj[]).map((c, i) => {
    expect(Number.isSafeInteger(c['step']) && typeof c['deep_hash'] === 'string', `${what}: checkpoints.${item}[${i}] is {step, deep_hash}`).toBe(true);
    return { step: c['step'] as number, hash: c['deep_hash'] as string };
  });
  return { rows: rows as Obj[], checkpoints };
}
/** Item `item`'s array `name` as the logic call's row for step k left it. */
export const rowArray = (run: AppRun, k: number, path: string): unknown => run.rows.find((r) => r['step'] === k)?.['arrays']?.[path];

// ---------------------------------------------------------------------------------------------------
// The hub's replicas (#184's play mode), each playing one call at a time; every play is logged with its reply.

const PIECES = new Map<string, Obj>();
/** Keeps `piece` as revision 1 of `doc`; its `<doc>@<rev>`. */
export function putPiece(doc: string, piece: Obj): string {
  PIECES.set(`${doc}@1`, piece);
  return `${doc}@1`;
}
export interface Played { piece: string | null; call: Obj; reply: Obj; replica: number }
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  /** `n` replicas: `deep-drive` (#184's debug build, `cargo build --locked -p deep-replica --bin deep-drive --features env-plants`). */
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
  async play(run: Obj, piece: string | null = null): Promise<Obj> {
    const i = await this.take();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', ...run });
      const { piece: _body, ...call } = run;
      this.log.push({ piece, call, reply, replica: i });
      return reply;
    } finally {
      this.give(i);
    }
  }
  /** The hub's replica (#184's README): the host's play call, its piece resolved by `<doc>@<rev>`. */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const body = PIECES.get(String(piece));
    if (!body) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    return this.play({ ...run, piece: body }, String(piece));
  };
}

/** Each run i of a playtest input as the replica played it: its bot's play (seed hash(seed, i)) and the plays of its recorded track without a bot. */
export interface RunPlays { i: number; seed: number; play: Played; replays: Played[] }
export function runsOf(log: Played[], input: Obj): RunPlays[] {
  const mine = log.filter((p) => p.piece === input['piece']);
  return Array.from({ length: input['runs'] as number }, (_, i) => {
    const seed = runSeed(input['seed'] as number, i);
    const play = mine.find((p) => p.call['bot'] !== undefined && p.call['seed'] === seed && p.reply['ok'] === true && Number(p.reply['steps']) > 0);
    expect(play, `run ${i} (seed ${seed}) was played in a replica with its bot`).toBeDefined();
    played(play!.reply, `run ${i}`);
    const replays = mine.filter((p) => !p.call['bot'] && p.call['seed'] === seed && Array.isArray(p.call['track']) && canon(p.call['track']) === canon(play!.reply['entries']));
    return { i, seed, play: play!, replays };
  });
}

const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
const PLAYTEST_ID = 'deepbuild/playtest';
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
/** A fresh extension host whose replica is `pool`'s, with the playtest plug-in installed under a grant of DOC.puzzle and loaded (#555's openHub). */
export async function openHub(pool: Pool): Promise<Obj> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = tempDir('hub860');
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
  const installed = await host['install']({ from: PLAYTEST_DIR, builtBy: null, grant: { docs: [DOC.puzzle] } });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${PLAYTEST_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const load = await host['load'](installed);
  expect(load.status === 'loaded' && load.place, `${PLAYTEST_ID} loads in the hub: ${show(load)}`).toBe('hub');
  return host;
}
/** One run of the `playtest` check with `input` as its spec's `play` (#184's spec), through the host's runCheck. */
export async function runPlaytest(host: Obj, input: Obj): Promise<CheckResult> {
  const spec = { kind: 'playtest', runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input };
  return (await host['runCheck']('playtest', spec, { checkout: tempDir('checkout860'), deadline: 3_600_000 })) as CheckResult;
}
export const shown = (r: CheckResult): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
