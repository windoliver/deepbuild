// Test-side tools for the #3605 acceptance tests (README: The surface under test), after #851's (its helpers copied and
// cut down; nothing is imported from another suite). They assemble this suite's level programs with its own assembler
// (wat/), read each level item's region map from the logic module's own `check` (`deep-logic`), build `deep-drive`
// (the replica, with env-plants), run a pool of its processes as the hub's replica, install the playtest plug-in
// (packages/checks/playtest) in an extension host and run its `shell.journeys` check through `runCheck`, and read the
// rows each play returned. A level's track is replayed with no shell on one of the pool's replicas, as the replica's
// play mode plays any piece. Every row, hash, text, track and failure read here is the implementation's own; every
// expected value comes from the issue's text, the design and this suite's fixture shell. Processes are the children this
// file started, stopped by PID; nothing is stopped by name or port.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';

export type Obj = { [key: string]: any };
export type { CheckResult };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: `#3605.` and the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: '#3605.2b30a7aa', 2: '#3605.0f6b90fe', 3: '#3605.e582fe2c', 4: '#3605.fd7b096d', 5: '#3605.1380fa30',
  6: '#3605.840dc1ba', 7: '#3605.50677298', 8: '#3605.47c041ca', 9: '#3605.14ffdae4',
} as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;

/** The reference window, in the view's pixels. */
export const REFERENCE: [number, number] = [1512, 982];
export const DEVICES = ['keys', 'pad', 'touch'] as const;
export type Device = (typeof DEVICES)[number];
export const SCREENS = ['title', 'settings', 'levels', 'pause', 'game_over', 'credits'] as const;
export type Screen = (typeof SCREENS)[number];
export const HEX = /^[0-9a-f]{16,64}$/;
/** A step of a 60 Hz level, in flicks (705,600,000 a second). */
export const STEP_FLICKS = 705_600_000 / 60;

// ---------------------------------------------------------------------------------------------------
// Plain tools and the failure rules.

/** A run that can't be judged here fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
/** The replica renders on macOS only and its binaries exit elsewhere: off macOS a replica test is INCONCLUSIVE. */
export function macOnly(): void {
  if (process.platform !== 'darwin') inconclusive('the shell plays in a replica (deep-replica), which runs on macOS only');
}
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** `text` as a whole word or number, not part of a longer one; case ignored. */
export const word = (text: string): RegExp => new RegExp(`(^|[^0-9A-Za-z_])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z_])`, 'i');
/** No gaps; the message lists them. */
export function none(gaps: readonly string[], what: string): void {
  expect(gaps, `${what}:\n  ${gaps.slice(0, 40).join('\n  ')}`).toEqual([]);
}

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-3605-${tag}-`)));
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
// Builds: cargo with the pinned toolchain's environment; this suite's assembler, deep-logic and deep-drive.

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUST_BINS = ['/opt/homebrew/opt/rustup/bin', join(process.env['HOME'] ?? '/', '.cargo', 'bin')].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(':')}:${process.env['PATH'] ?? ''}` } : {}),
};
let bins = '';
const built = new Map<string, { bin: string; error: string }>();
/** A binary built once per file and copied out of the target folder; a test that uses a failed build fails with cargo's error. */
function binary(name: string, args: string[], cwd: string, from: string, env: NodeJS.ProcessEnv = {}): string {
  let b = built.get(name);
  if (!b) {
    if (!bins) bins = tempDir('bins');
    const bin = join(bins, name);
    const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
    const error = run.error ? `cargo could not run: ${run.error.message}` : run.status !== 0
      ? `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 12).join('\n')}` : '';
    if (!error) copyFileSync(from, bin);
    b = { bin, error };
    built.set(name, b);
  }
  expect(b.error, `${name} builds on this host`).toBe('');
  return b.bin;
}
const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-3605-wat');
const assemblerBin = (): string => binary('acceptance-3605-wat', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR,
  join(WAT_TARGET, 'debug', 'acceptance-3605-wat'), { CARGO_TARGET_DIR: WAT_TARGET });
/** `deep-logic`, the logic module's runner, for the level items' region maps (README: Fixtures). */
const logicBin = (): string => binary('deep-logic', ['build', '--locked', '--bin', 'deep-logic'], REPO, join(TARGET, 'debug', 'deep-logic'));
/** `deep-drive`, the replica, with env-plants, so DEEP_DRIVE_PLANT names a planted shell (debug only). */
export const driveBin = (): string => binary('deep-drive', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'], REPO, join(TARGET, 'debug', 'deep-drive'));

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
const assembled = new Map<string, Program>();
/** WebAssembly text assembled into a Program by this suite's assembler, which validates it. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = tempDir('wat');
  const file = join(dir, `${name}.wat`);
  writeFileSync(file, text);
  const run = spawnSync(assemblerBin(), [dir, file], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`the assembler refused ${name}: ${(run.stderr ?? '').slice(-2000)}`);
  const bytes = readFileSync(join(dir, `${name}.wasm`));
  const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
  assembled.set(`${name}\n${text}`, p);
  return p;
}

/** One region entry of a logic item's region map, as the logic module's `check` reports it. */
export interface Region { region: string; name: string; offset: number; size: number }
/** The region map `deep-logic`'s `check` gives each item of `piece` (`{seed, controls, items, assets}`). */
export function regionMaps(piece: Obj, what: string): Record<string, Region[]> {
  const run = spawnSync(logicBin(), [], { cwd: REPO, input: `${JSON.stringify({ call: 'check', piece })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const line = (run.stdout ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  let reply: Obj;
  try { reply = JSON.parse(line) as Obj; } catch { throw Error(`${what}: deep-logic gave no JSON reply: ${line.slice(0, 600)} ${(run.stderr ?? '').slice(-600)}`); }
  expect(reply['ok'], `${what}: the logic module admits a level item that lists settings: {mains: 230}: ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(reply['items'] as Obj).map(([id, item]) => [id, (item['layout']['entries'] as Obj[]).map((e) => ({
    region: String(e['region']), name: String(e['name']), offset: Number(e['offset']), size: Number(e['size']),
  }))]));
}
export function regionAt(map: Region[], region: 'reads' | 'writes', name: string): Region {
  const e = map.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the region map has no ${region} entry ${name}: ${JSON.stringify(map)}`);
  return e;
}
/**
 * The read entry a listed setting takes (README: Fields): the reads entry named `mains`, or `settings.mains` (any
 * prefix ending in `.` or `/`), which a level reads as a number control's entries.
 */
export function settingAt(map: Region[], name: string): Region {
  const e = map.find((x) => x.region === 'reads' && (x.name === name || x.name.endsWith(`.${name}`) || x.name.endsWith(`/${name}`)));
  expect(e, `the logic module's region map gives the level's listed setting ${name} a read entry: ${JSON.stringify(map)}`).toBeDefined();
  return e!;
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
    const first = await r.next(300_000); // deadline: a cold replica's first line on a loaded machine
    expect(first['ready'], `deep-drive says {"ready": true}${plant ? ` with DEEP_DRIVE_PLANT=${plant}` : ''}: ${show(first, 400)} ${r.log()}`).toBe(true);
    return r;
  }
  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((done) => {
      const timer = setTimeout(() => done({ timedOut: ms }), ms); // deadline: a reply that never comes ends the call
      this.waiting.push((line) => { clearTimeout(timer); done(line); });
    });
  }
  async call(line: Obj, ms = 3_000_000): Promise<Obj> {
    const answer = this.next(ms);
    this.child.stdin!.write(`${JSON.stringify(line)}\n`);
    const reply = await answer;
    if (reply['exited'] || reply['timedOut'] || reply['unparsed'] !== undefined) throw Error(`deep-drive gave no JSON reply to ${String(line['call'])}: ${show(reply, 600)}`);
    return reply;
  }
}

// ---------------------------------------------------------------------------------------------------
// The hub's documents and a pool of replicas.

const ulid = (n: number): string => `01JB3605S${String(n).padStart(17, '0')}`;
/** The fixture shell and its planted documents as the hub knows them, `<doc>@1`; `again` is the fixture shell kept a second time, so a second check run's plays are told apart. */
export const DOC = { shell: ulid(1), noCustom: ulid(2), setsVolts: ulid(3), readsCustom: ulid(4), again: ulid(5) } as const;
const DOCS = new Map<string, { document: Obj; assets: Record<string, string> }>();
/** Keeps a shell document as revision 1 of `doc`, with the programs its levels name by sha256; its `<doc>@<rev>`. */
export function putShell(doc: string, document: Obj, programs: Program[]): string {
  DOCS.set(`${doc}@1`, { document, assets: Object.fromEntries(programs.map((p) => [p.sha, p.b64])) });
  return `${doc}@1`;
}

/** One play as a replica got it and answered it: the shell's `<doc>@<rev>`, the call's fields (document and assets left out) and the reply. */
export interface Played { piece: string; call: Obj; reply: Obj }
/** Replica processes (`deep-drive`), each playing one call at a time; every play through the hub is logged with its whole reply. */
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  static async open(n: number, plant?: string): Promise<Pool> {
    const bin = driveBin();
    return new Pool(await Promise.all(Array.from({ length: n }, () => Replica.start(bin, plant))));
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
  /** A call played on a free replica, outside the hub (a level's replay, a level played alone). */
  async direct(line: Obj): Promise<Obj> {
    const i = await this.take();
    try { return await this.replicas[i]!.call(line); } finally { this.give(i); }
  }
  /**
   * The hub's replica: the host's play call, `{call: "play", piece: "<doc>@<rev>", seed, shell: {journey, device, size,
   * moves, launch, …}}`, played on a free replica as `{call: "play", document, assets, seed, shell, …}` with the shell's
   * document and the programs its levels name. Any other field the host passes (a level's `track` for a replay, say)
   * goes through unchanged.
   */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const d = DOCS.get(String(piece));
    if (!d) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    const reply = await this.direct({ call: 'play', document: d.document, assets: d.assets, ...run });
    this.log.push({ piece: String(piece), call: run, reply });
    return reply;
  };
  /** The files every replica of the pool wrote under its `--out` folder. */
  files(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(p);
      }
    };
    for (const r of this.replicas) if (existsSync(r.out)) walk(r.out);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the playtest plug-in, which holds the check kind shell.journeys.

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
export const JOURNEYS_KIND = 'shell.journeys';

export interface Hub { host: Obj; pool: Pool }
/** A fresh extension host whose replica is a pool of `n` replicas (planted with `plant` when given), with the playtest plug-in installed under a grant of every DOC and loaded. */
export async function openHub(o: { replicas?: number; plant?: string } = {}): Promise<Hub> {
  const pool = await Pool.open(o.replicas ?? 1, o.plant);
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
  return { host, pool };
}
/** A hub opened once for a file's tests, on first use. */
export function hubOnce(o: { replicas?: number; plant?: string } = {}): () => Promise<Hub> {
  let opened: Promise<Hub> | undefined;
  return () => (opened ??= openHub(o));
}

/** The journeys' seed. */
export const SEED = 3605;
/** What a level plays: its finish action at its step 900, so a level played to its end is completed at its step 900. */
export const FINISH_AT = 900;
export const LEVEL_POLICY = { actions: { finish: [FINISH_AT] }, span: 1200 } as const;

/**
 * A move of the `moves` journey (README: The moves journey): activate a control on the shown screen, set a choice to a
 * value, the device's back or pause, or play the loaded level until its step k has run (or until it is left).
 */
export type Move = { activate: string } | { set: string; value: number } | { back: true } | { pause: true } | { play: number | 'left' };
export type Journey = 'moves' | 'relaunch' | 'layout';
/** Check input: shell journeys, as the spec's `play` holds it, with this suite's `moves` (README). */
export function journeysInput(piece: string, o: { journeys: Journey[]; moves?: Move[]; devices?: Device[]; sizes?: [number, number][] }): Obj {
  return {
    piece, seed: SEED, journeys: o.journeys, ...(o.moves ? { moves: o.moves } : {}), devices: o.devices ?? ['keys'], sizes: o.sizes ?? [REFERENCE],
    level: LEVEL_POLICY, budget: 30,
  };
}
export const journeysSpec = (input: Obj): Obj => ({ kind: JOURNEYS_KIND, runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null, play: input });
export async function runJourneys(hub: Hub, input: Obj): Promise<CheckResult> {
  return (await hub.host['runCheck'](JOURNEYS_KIND, journeysSpec(input), { checkout: tempDir('checkout'), deadline: DEADLINE })) as CheckResult;
}
export const shown = (r: CheckResult): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
/** The failures whose message starts with `code` (the plug-in's convention: a failure's message starts with its code). */
export const failuresOf = (r: CheckResult, code: string): CheckResult['failures'] =>
  r.failures.filter((f) => f.message.startsWith(code) && !/^[0-9A-Za-z_.]/.test(f.message.slice(code.length, code.length + 1)));
/** The message after its code, so a word is read from what it names. */
export const rest = (m: string, code: string): string => m.slice(code.length);
/** A check result that passed on its own counted tests. */
export function passed(r: CheckResult, what: string): void {
  expect(r.outcome, `${what}: ${shown(r)}`).toBe('passed');
  expect(r.testsRun, `${what} counts the runs it played`).toBeGreaterThan(0);
}
/** A check result that failed. */
export function failed(r: CheckResult, what: string): void {
  expect(r.outcome, `${what} fails: ${shown(r)}`).toBe('failed');
}

// ---------------------------------------------------------------------------------------------------
// A shell play's reply, read row by row (README: The surface under test).

export interface Row {
  step: number; screen: Screen | null; level: number; level_step: number; paused: boolean; unlocked: boolean[];
  enabled: string[]; device: string | null; hash: string;
  /** The shell's `done` (one bool a level) and `custom` (one number a declared setting, in declared order). */
  done: boolean[]; custom: number[];
  /** The loaded level's arrays, `<logic ID>.<array>`, as its last step left them, and its own full-state hash. */
  values: Record<string, number[]>; level_hash: string | null;
}
export interface LevelTrack { level: number; entries: Obj[]; steps: number | null }
export interface ShellReply {
  rows: Row[]; screens: Partial<Record<Screen, { frame: string | null; texts: Record<string, string> }>>;
  track: unknown[]; level_tracks: LevelTrack[]; refused: { code: string; message: string } | null; stopped: Obj | null;
}
const screenOf = (v: unknown): Screen | null => {
  if (typeof v === 'number') return v >= 0 ? (SCREENS[v] ?? null) : null;
  if (typeof v === 'string' && v !== 'none') return v as Screen;
  return null;
};
const truth = (u: unknown): boolean => u === true || u === 1;
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : v === undefined || v === null ? [] : [Number(v)]);
const noneOr = <T>(v: unknown, f: (x: unknown) => T): T | null => (v === null || v === undefined || v === 'none' ? null : f(v));
/** `custom` as a list in declared order, given as a list or as `{name → value}`. */
const customOf = (v: unknown, names: readonly string[]): number[] => (Array.isArray(v) ? v.map(Number) : v && typeof v === 'object' ? names.map((n) => Number((v as Obj)[n])) : []);
/** A play's reply as rows, screens and level tracks; `names` are the shell's declared settings, in order. */
export function shellReply(reply: Obj, what: string, names: readonly string[] = ['mains']): ShellReply {
  expect(reply['ok'], `${what}: the play answers ok: ${show(reply, 1200)}`).toBe(true);
  const s = reply['shell'] as Obj | undefined;
  expect(s !== null && typeof s === 'object', `${what}: the play answers its shell rows in \`shell\`: ${show(reply, 600)}`).toBe(true);
  expect(Array.isArray(s!['steps']), `${what}: shell.steps is a list, one row a shell step`).toBe(true);
  const rows: Row[] = (s!['steps'] as Obj[]).map((r) => ({
    step: Number(r['step']), screen: screenOf(r['screen']), level: r['level'] === null || r['level'] === undefined ? -1 : Number(r['level']),
    level_step: Number(r['level_step'] ?? -1), paused: truth(r['paused']),
    unlocked: (Array.isArray(r['unlocked']) ? r['unlocked'] : []).map(truth),
    enabled: Array.isArray(r['enabled']) ? (r['enabled'] as unknown[]).map(String) : Object.entries((r['enabled'] ?? {}) as Obj).filter(([, on]) => on === true).map(([id]) => id),
    device: typeof r['device'] === 'string' && r['device'] !== 'none' ? r['device'] : null, hash: String(r['hash']),
    done: (Array.isArray(r['done']) ? r['done'] : []).map(truth),
    custom: customOf(r['custom'], names),
    values: Object.fromEntries(Object.entries((r['values'] ?? {}) as Obj).map(([k, x]) => [k, numbers(x)])),
    level_hash: noneOr(r['level_hash'], String),
  }));
  const screens = Object.fromEntries(Object.entries((s!['screens'] ?? {}) as Obj).map(([name, v]) => [screenOf(name) ?? name, {
    frame: noneOr(v?.['frame'], String),
    texts: Object.fromEntries(Object.entries((v?.['texts'] ?? {}) as Obj).map(([id, t]) => [id, String(t)])),
  }]));
  const level_tracks = ((s!['level_tracks'] ?? []) as Obj[]).map((t) => ({
    level: Number(t['level']), entries: Array.isArray(t['entries']) ? (t['entries'] as Obj[]) : [], steps: t['steps'] === undefined || t['steps'] === null ? null : Number(t['steps']),
  }));
  const refused = noneOr(s!['refused'], (x) => ({ code: String((x as Obj)['code']), message: String((x as Obj)['message']) }));
  return { rows, screens, track: Array.isArray(s!['track']) ? (s!['track'] as unknown[]) : [], level_tracks, refused, stopped: noneOr(s!['stopped'], (x) => x as Obj) };
}
/** Rows that hold a step, each with a full-state hash and a `done` element for each of `levels` levels. */
export function stepped(r: ShellReply, what: string, levels = 6): Row[] {
  expect(r.refused, `${what}: the shell's check admits it`).toBeNull();
  expect(r.rows.length, `${what}: the play holds one row a shell step`).toBeGreaterThan(0);
  const bad = r.rows.filter((x) => !HEX.test(x.hash)).slice(0, 3);
  expect(bad.map((x) => `step ${x.step}: ${x.hash}`), `${what}: each row holds the shell's full-state hash`).toEqual([]);
  const short = r.rows.filter((x) => x.done.length !== levels).slice(0, 3);
  expect(short.map((x) => `step ${x.step}: done ${show(x.done)}`), `${what}: each row holds the shell's done, one element a level`).toEqual([]);
  return r.rows;
}

/** The plays a check made of `piece`'s `journey`, by device when given (the call's `shell`), in the order played. */
export function playsOf(pool: Pool, piece: string, journey: Journey, device?: Device): Played[] {
  return pool.log.filter((p) => p.piece === piece && p.call['shell']?.['journey'] === journey && (device === undefined || p.call['shell']?.['device'] === device));
}
/** The one play of `journey` with `device`, answered as a shell play. */
export function onePlay(pool: Pool, piece: string, journey: Journey, device: Device, what: string): ShellReply {
  const plays = playsOf(pool, piece, journey, device);
  expect(plays.length, `${what}: the ${journey} journey was played once in a replica with ${device}`).toBe(1);
  return shellReply(plays[0]!.reply, what);
}

/** The level step k of level `level` in a run's rows: the first row at which it had run k + 1 steps, or undefined. */
export const atLevelStep = (rows: Row[], level: number, k: number): Row | undefined => rows.find((x) => x.level === level && x.level_step === k + 1);
/** The runs of consecutive rows in which level `level` is loaded: each load's rows. */
export function loads(rows: Row[], level: number): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] | null = null;
  for (const r of rows) {
    if (r.level === level) { if (!cur) { cur = []; out.push(cur); } cur.push(r); } else cur = null;
  }
  return out;
}
export const doneOf = (r: Row): string => r.done.map((d) => (d ? '1' : '0')).join('');
/**
 * A failure names level `i` (its index): by its `name`, as `done[<i>]`, or as `level <n>` counted from 1 (the shell's
 * own messages) or from 0 (the issue's). The scenarios that read this involve no level the other count would name.
 */
export const namesLevel = (m: string, i: number, name: string): boolean =>
  word(name).test(m) || m.includes(`done[${i}]`) || word(`level ${i + 1}`).test(m) || word(`level ${i}`).test(m);

// ---------------------------------------------------------------------------------------------------
// Frames.

/** A PNG's width and height from its header, or null when the bytes aren't a PNG. */
export function pngSize(bytes: Buffer): [number, number] | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(sig)) return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
/** The file among `files` whose bytes hash to `sha`, or null. */
export function fileByHash(files: string[], sha: string): string | null {
  return files.find((f) => sha256(readFileSync(f)) === sha) ?? null;
}
/** A folder the shown evidence is copied to and kept: $SHELL3605_SHOWN, or a fresh temp folder this suite never deletes. */
export function shownDir(): string {
  const dir = process.env['SHELL3605_SHOWN'] ?? realpathSync(mkdtempSync(join(tmpdir(), 'deep-3605-shown-')));
  mkdirSync(dir, { recursive: true });
  return dir;
}
