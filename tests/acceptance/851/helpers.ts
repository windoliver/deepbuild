// Test-side tools for the #851 acceptance tests (README: The surface under test), after #184's, #555's and #189's
// carry suites (their helpers copied and cut down; nothing is imported from another suite). They assemble this suite's
// level programs with its own assembler (wat/), read each level item's region map from the logic module's own `check`
// (`deep-logic`), build `deep-drive` (the replica, with env-plants), run a pool of its processes as the hub's replica,
// install the playtest plug-in (packages/checks/playtest) in an extension host and run its `shell.journeys` check
// through `runCheck`, and read the rows each journey's plays returned. Every play, row, hash, box, glyph, failure and
// refusal read here is the implementation's own; every expected value comes from the issue's text, the design and this
// suite's fixture shell. Nothing stands in for the replica, the logic module, the host or the plug-in. Processes are
// the children this file started, stopped by PID; nothing is stopped by name or port.
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

/** Each criterion's ID: `#851.` and the first 8 hex digits of the SHA-256 of its text alone (scripts/proof-change.mjs). */
export const AC = {
  1: '#851.9ac2fbcf', 2: '#851.d9bf3012', 3: '#851.b6cf2eb0', 4: '#851.4125ce58', 5: '#851.938e41a6',
  6: '#851.2badf2f3', 7: '#851.ad15698c', 8: '#851.651a914b', 9: '#851.27357504', 10: '#851.5b5156e7',
} as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// The issue's values and the design's.

/** The reference window (1512 × 982) and the phone size (2400 × 1080), in the view's pixels. */
export const REFERENCE: [number, number] = [1512, 982];
export const PHONE: [number, number] = [2400, 1080];
export const DEVICES = ['keys', 'pad', 'touch'] as const;
export type Device = (typeof DEVICES)[number];
/** Paused at level step 1,200, held 30 s of wall clock, compared at level step 3,600. */
export const PAUSE = { at: 1200, hold: 30, to: 3600 } as const;
/** The shell's steps a second, so 30 s held is 1,800 shell steps on the virtual clock (Check input: shell journeys). */
export const SHELL_HZ = 60;
/** Back reaches the title within 3 presses. */
export const BACK_PRESSES = 3;
/** No two controls overlap past 1 px; none is under 24 × 24 px. */
export const OVERLAP_PX = 1;
export const MIN_SIDE_PX = 24;
/** The six screens in the shell's order: a screen's index is its place here (Recipe: shell@1 game shell). */
export const SCREENS = ['title', 'settings', 'levels', 'pause', 'game_over', 'credits'] as const;
export type Screen = (typeof SCREENS)[number];
/** The glyph each device shows for each prompt action (Recipe: shell@1 game shell: Glyphs). */
export const GLYPHS: Record<Device, Record<'confirm' | 'back' | 'pause' | 'adjust', string>> = {
  keys: { confirm: 'Enter', back: 'Esc', pause: 'Esc', adjust: '← →' },
  pad: { confirm: '(A)', back: '(B)', pause: '(Menu)', adjust: '(D-pad)' },
  touch: { confirm: 'Tap', back: 'Back', pause: 'Pause', adjust: 'Drag' },
};
export const HASH = /^[0-9a-f]{64}$/;
export const HEX = /^[0-9a-f]{16,64}$/;

// ---------------------------------------------------------------------------------------------------
// Plain tools and the failure rules.

/** A run that can't be judged here fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** The replica renders on macOS only and its binaries exit elsewhere: off macOS a replica test is INCONCLUSIVE. */
export function macOnly(): void {
  if (process.platform !== 'darwin') inconclusive('the shell journeys play in a replica (deep-replica, on deep-app), which runs on macOS only');
}
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** `text` as a whole word or number, not part of a longer one; case ignored. */
export const word = (text: string): RegExp => new RegExp(`(^|[^0-9A-Za-z_])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z_])`, 'i');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-851-${tag}-`)));
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
      ? `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => /error|warning: unused/.test(l)).slice(0, 12).join('\n')}` : '';
    if (!error) copyFileSync(from, bin);
    b = { bin, error };
    built.set(name, b);
  }
  expect(b.error, `${name} builds on this host`).toBe('');
  return b.bin;
}
const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-851-wat');
const assemblerBin = (): string => binary('acceptance-851-wat', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR,
  join(WAT_TARGET, 'debug', 'acceptance-851-wat'), { CARGO_TARGET_DIR: WAT_TARGET });
/** `deep-logic`, the logic module's runner, for the level items' region maps (README: Fixtures). */
const logicBin = (): string => binary('deep-logic', ['build', '--locked', '--bin', 'deep-logic'], REPO, join(TARGET, 'debug', 'deep-logic'));
/** `deep-drive`, the replica, with env-plants, so DEEP_DRIVE_PLANT names a planted replica (debug only). */
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
  expect(reply['ok'], `${what}: the logic module admits the probe piece: ${show(reply)}`).toBe(true);
  return Object.fromEntries(Object.entries(reply['items'] as Obj).map(([id, item]) => [id, (item['layout']['entries'] as Obj[]).map((e) => ({
    region: String(e['region']), name: String(e['name']), offset: Number(e['offset']), size: Number(e['size']),
  }))]));
}
export function regionAt(map: Region[], region: 'reads' | 'writes', name: string): Region {
  const e = map.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the region map has no ${region} entry ${name}: ${JSON.stringify(map)}`);
  return e;
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
    const first = await r.next(300_000);
    expect(first['ready'], `deep-drive says {"ready": true}${plant ? ` with DEEP_DRIVE_PLANT=${plant}` : ''}: ${show(first, 400)} ${r.log()}`).toBe(true);
    return r;
  }
  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true, stderr: this.log() });
    return new Promise((done) => {
      const timer = setTimeout(() => done({ timedOut: ms }), ms);
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

/** The fixture shell and its planted twins as the hub knows them, `<doc>@1`. */
const ulid = (n: number): string => `01JB851S${String(n).padStart(18, '0')}`;
export const DOC = {
  shell: ulid(1), unlockAll: ulid(2), readsLevel1: ulid(3), dragOnly: ulid(4), noBack: ulid(5), backCovers: ulid(6), unbound: ulid(7),
} as const;
const DOCS = new Map<string, { document: Obj; assets: Record<string, string> }>();
/** Keeps a shell document as revision 1 of `doc`, with the programs its levels name by sha256; its `<doc>@<rev>`. */
export function putShell(doc: string, document: Obj, programs: Program[]): string {
  DOCS.set(`${doc}@1`, { document, assets: Object.fromEntries(programs.map((p) => [p.sha, p.b64])) });
  return `${doc}@1`;
}
export const shellDoc = (at: string): Obj => {
  const d = DOCS.get(at);
  if (!d) throw Error(`no shell ${at}`);
  return d.document;
};

/** One play as a replica got it and answered it: the shell's `<doc>@<rev>`, the call's fields (document and assets left out) and the reply. */
export interface Played { piece: string; call: Obj; reply: Obj; replica: number }
/** Replica processes (`deep-drive`), each playing one call at a time; every play is logged with its whole reply. */
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[]) { this.free = replicas.map((_, i) => i); }
  /** `n` replicas of the debug build, each planted with `plant` when given (DEEP_DRIVE_PLANT). */
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
  /**
   * The hub's replica (README: The surface): the host's play call, `{call: "play", piece: "<doc>@<rev>", seed, shell:
   * {journey, device, size, …}}`, played on a free replica as `{call: "play", document, assets, seed, shell, …}` with the
   * shell's document and the programs its levels name.
   */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const d = DOCS.get(String(piece));
    if (!d) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    const i = await this.take();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', document: d.document, assets: d.assets, ...run });
      this.log.push({ piece: String(piece), call: run, reply, replica: i });
      return reply;
    } finally {
      this.give(i);
    }
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
// The hub: an extension host with the playtest plug-in, which holds the check kind shell.journeys beside playtest.

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
export const JOURNEYS_KIND = 'shell.journeys';

/** The playtest plug-in's manifest declares the check kind shell.journeys (Check input: shell journeys: "the playtest plug-in's, beside playtest"). */
export function journeysDeclared(): void {
  expect(existsSync(join(PLAYTEST_DIR, 'deepbuild.json')), 'the playtest plug-in is a first-party package at packages/checks/playtest').toBe(true);
  const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  expect(m['checks'], `the playtest plug-in's manifest declares the check kind ${JOURNEYS_KIND} beside playtest`).toContain(JOURNEYS_KIND);
}

export interface Hub { host: Obj; pool: Pool }
/**
 * A fresh extension host whose replica is a pool of `n` replicas (planted with `plant` when given), with the playtest
 * plug-in installed under a grant of every DOC and loaded. The manifest is read first, so a base without the kind fails
 * before any build.
 */
export async function openHub(o: { replicas?: number; plant?: string } = {}): Promise<Hub> {
  journeysDeclared();
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
export const SEED = 851;
/**
 * What the play journeys press in each level, and how long one may take (README: Fixtures): collect at level steps 600,
 * 1,800 and 3,000 and finish at 3,700, so level 1 is still playing at 3,600, the pause journey's `to`, and is completed
 * at 3,700; levels 2 and 3 are completed by their first collect.
 */
export const LEVEL = { actions: { collect: [600, 1800, 3000], finish: [3700] }, span: 4000 } as const;
export type Journey = 'title_to_level' | 'unlock' | 'carry' | 'pause' | 'credits' | 'back' | 'focus' | 'prompts' | 'layout' | 'wired';
/**
 * Check input: shell journeys, as the spec's `play` holds it (README: The surface): the shell's `<doc>@<rev>`, the
 * seed, the journeys (all when left out), the devices, the sizes, the level presses, the issue's pause and the design's
 * budget of 30 steps.
 */
export function journeysInput(piece: string, o: { journeys?: Journey[]; devices?: Device[]; sizes?: [number, number][] } = {}): Obj {
  return {
    piece, seed: SEED, ...(o.journeys ? { journeys: o.journeys } : {}), devices: o.devices ?? [...DEVICES], sizes: o.sizes ?? [REFERENCE, PHONE],
    level: LEVEL, pause: PAUSE, budget: 30,
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

// ---------------------------------------------------------------------------------------------------
// A shell play's reply (Check input: shell journeys: "A run, in a replica"), read row by row.

/** One shell step's row, with the screen as its ID (null while a level plays) and enabled as a list of control IDs. */
export interface Row {
  step: number; screen: Screen | null; level: number; level_step: number; paused: boolean; unlocked: boolean[];
  focus: string | null; enabled: string[]; prompts: Record<string, string>; device: string | null; hash: string;
}
export interface ControlBox { box: number[]; enabled: boolean; kind: string; text: number[] | null }
export interface ShellReply {
  rows: Row[]; screens: Partial<Record<Screen, { controls: Record<string, ControlBox>; frame: string | null }>>;
  entered: { level: number; step: number; carry: string | null; arrays: Record<string, number[]> }[];
  carry: { level: number; step: number; sha256: string; arrays: Record<string, number[]> }[];
  refused: { code: string; message: string } | null; recording: string | null;
}
const screenOf = (v: unknown): Screen | null => {
  if (typeof v === 'number') return v >= 0 ? (SCREENS[v] ?? null) : null;
  if (typeof v === 'string' && v !== 'none') return v as Screen;
  return null;
};
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : [Number(v)]);
const arraysOf = (v: unknown): Record<string, number[]> => Object.fromEntries(Object.entries((v ?? {}) as Obj).map(([k, x]) => [k, numbers(x)]));
const noneOr = <T>(v: unknown, f: (x: unknown) => T): T | null => (v === null || v === undefined || v === 'none' ? null : f(v));
/** A play's reply, checked for the fields every shell play answers (README: The surface), as rows and screens. */
export function shellReply(reply: Obj, what: string): ShellReply {
  expect(reply['ok'], `${what}: the play answers ok: ${show(reply, 1200)}`).toBe(true);
  const s = reply['shell'] as Obj | undefined;
  expect(s !== null && typeof s === 'object', `${what}: the play answers its shell rows in \`shell\`: ${show(reply, 600)}`).toBe(true);
  expect(Array.isArray(s!['steps']), `${what}: shell.steps is a list, one row a shell step`).toBe(true);
  const rows: Row[] = (s!['steps'] as Obj[]).map((r) => ({
    step: Number(r['step']), screen: screenOf(r['screen']), level: r['level'] === null || r['level'] === undefined ? -1 : Number(r['level']),
    level_step: Number(r['level_step'] ?? -1), paused: r['paused'] === true || r['paused'] === 1,
    unlocked: (Array.isArray(r['unlocked']) ? r['unlocked'] : []).map((u: unknown) => u === true || u === 1),
    focus: typeof r['focus'] === 'string' && r['focus'] !== 'none' ? r['focus'] : null,
    enabled: Array.isArray(r['enabled']) ? (r['enabled'] as unknown[]).map(String) : Object.entries((r['enabled'] ?? {}) as Obj).filter(([, on]) => on === true).map(([id]) => id),
    prompts: Object.fromEntries(Object.entries((r['prompts'] ?? {}) as Obj).map(([k, g]) => [k, String(g)])),
    device: typeof r['device'] === 'string' && r['device'] !== 'none' ? r['device'] : null, hash: String(r['hash']),
  }));
  const screens = Object.fromEntries(Object.entries((s!['screens'] ?? {}) as Obj).map(([name, v]) => [screenOf(name) ?? name, {
    controls: Object.fromEntries(Object.entries((v?.['controls'] ?? {}) as Obj).map(([id, c]) => [id, {
      box: numbers(c?.['box']), enabled: c?.['enabled'] !== false, kind: String(c?.['kind']), text: noneOr(c?.['text'], numbers),
    }])),
    frame: noneOr(v?.['frame'], String),
  }]));
  const entered = ((s!['entered'] ?? []) as Obj[]).map((e) => ({ level: Number(e['level']), step: Number(e['step']), carry: noneOr(e['carry'], String), arrays: arraysOf(e['arrays']) }));
  const carry = ((s!['carry'] ?? []) as Obj[]).map((c) => ({ level: Number(c['level']), step: Number(c['step']), sha256: String(c['sha256']), arrays: arraysOf(c['arrays']) }));
  const refused = noneOr(s!['refused'], (x) => ({ code: String((x as Obj)['code']), message: String((x as Obj)['message']) }));
  return { rows, screens, entered, carry, refused, recording: noneOr(s!['recording'], String) };
}
/** Rows that hold a step, each with a full-state hash. */
export function stepped(r: ShellReply, what: string): Row[] {
  expect(r.rows.length, `${what}: the play holds one row a shell step`).toBeGreaterThan(0);
  const bad = r.rows.filter((x) => !HEX.test(x.hash)).slice(0, 3);
  expect(bad.map((x) => `step ${x.step}: ${x.hash}`), `${what}: each row holds the shell's full-state hash`).toEqual([]);
  return r.rows;
}

/** The plays a check made of `piece`'s `journey`, by device and size when given (the call's `shell`). */
export function playsOf(pool: Pool, piece: string, journey: Journey, o: { device?: Device; size?: [number, number] } = {}): Played[] {
  return pool.log.filter((p) => p.piece === piece && p.call['shell']?.['journey'] === journey
    && (o.device === undefined || p.call['shell']?.['device'] === o.device)
    && (o.size === undefined || show(p.call['shell']?.['size']) === show(o.size)));
}
/** The plays of a journey for each device the check named, each answered as a shell play. */
export function devicePlays(pool: Pool, piece: string, journey: Journey, devices: readonly Device[], size: [number, number]): Map<Device, ShellReply[]> {
  const out = new Map<Device, ShellReply[]>();
  for (const d of devices) {
    const plays = playsOf(pool, piece, journey, { device: d, size });
    expect(plays.length, `the ${journey} journey was played in a replica with ${d} at ${size.join(' × ')}`).toBeGreaterThan(0);
    out.set(d, plays.map((p, i) => shellReply(p.reply, `${journey} with ${d} (play ${i})`)));
  }
  return out;
}
/** The full-state hash at level step `k` of level `level`: the hash of the first row at which it reached that step, or null. */
export const hashAtLevelStep = (rows: Row[], level: number, k: number): string | null => rows.find((x) => x.level === level && x.level_step === k)?.hash ?? null;

// ---------------------------------------------------------------------------------------------------
// Frames and boxes.

/** The letterbox of the shell's 1280 × 720 screens in a view of `size`: each box in the view's pixels. */
export function letterboxed(box: number[], size: [number, number], doc: [number, number]): number[] {
  const s = Math.min(size[0] / doc[0], size[1] / doc[1]);
  const ox = (size[0] - doc[0] * s) / 2;
  const oy = (size[1] - doc[1] * s) / 2;
  return [box[0]! * s + ox, box[1]! * s + oy, box[2]! * s, box[3]! * s];
}
/** How far two boxes overlap along x and along y, in px (0 when they don't). */
export function overlap(a: number[], b: number[]): [number, number] {
  const x = Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!);
  const y = Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!);
  return [Math.max(0, x), Math.max(0, y)];
}
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
/** A folder the shown evidence is copied to and kept: $SHELL851_SHOWN, or a fresh temp folder this suite never deletes. */
export function shownDir(): string {
  const dir = process.env['SHELL851_SHOWN'] ?? realpathSync(mkdtempSync(join(tmpdir(), 'deep-851-shown-')));
  mkdirSync(dir, { recursive: true });
  return dir;
}
