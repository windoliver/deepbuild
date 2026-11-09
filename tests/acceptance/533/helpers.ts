// Test-side tools for the #533 acceptance tests (README: The surface under test), cut down from #532's and #238's
// suites (nothing imported across suites). They assemble this suite's WebAssembly programs with its own assembler
// (wat/), drive the logic module's runner `deep-logic` (sessions a test writer appends to, bakes), and build and drive
// `deep-show run` per Cargo feature set. Nothing here stands in for the logic module, the seal or the kit: every
// entry, step hash, array, digest, verdict and refusal read here is the implementation's own; the expected values
// come from the issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/533 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on a Mac with Homebrew's rustup (kept off the default PATH there). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: a fresh deep-show build per feature set takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#533.1487ce3d', 2: '#533.cbdc85ec', 3: '#533.40063163', 4: '#533.6d69e833' } as const;

export const FLICKS = 705_600_000;
export const STEP_60 = FLICKS / 60;
export const MIB = 1024 * 1024;
export const HASH64 = /^[0-9a-f]{16}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isSafeInteger(value), `${what} is an integer, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** `name` as a whole word (module names hold dots). */
export const word = (name: string): RegExp => new RegExp(`(^|[^a-z0-9.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9.])`);

// ---------------------------------------------------------------------------------------------------
// Builds and processes.

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^help:|^\s{6}/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

let binsDir = '';
function bins(): string {
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-533-bins-'));
  return binsDir;
}
const built = new Map<string, { bin: string; error: string }>();
/** `cargo build --locked --bin <bin> [--no-default-features --features …]` in the checkout, copied out under its own name, once per process. */
function buildBin(binName: string, features: string[] | null): string {
  const key = `${binName}:${features?.join('+') ?? 'default'}`;
  let made = built.get(key);
  if (!made) {
    const to = join(bins(), exe(`${binName}-${features?.join('+') ?? 'default'}`));
    const args = ['build', '--locked', '--bin', binName, ...(features ? ['--no-default-features', '--features', features.join(',')] : [])];
    const error = cargo(args, REPO, {});
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(binName)), to);
    made = { bin: to, error };
    built.set(key, made);
  }
  expect(made.error, `${binName} builds (cargo build --locked --bin ${binName}${features ? ` --no-default-features --features ${features.join(',')}` : ''})`).toBe('');
  return made.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

export interface Started { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function parseLines(stdout: string): JsonValue[] {
  return stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
}
export function start(cmd: string, args: string[], inputs: JsonValue[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(cmd, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  // A process that exits before reading its input (an unknown --planted name) is EPIPE here: its status says why.
  if (run.error && !timedOut && (run.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${cmd} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  return { status: run.status, signal: run.signal, timedOut, lines: parseLines(stdout), stdout, stderr: run.stderr ?? '' };
}
/** One reply per call from a run that exited 0; each failure names the process. */
export function replies(s: Started, calls: JsonValue[], what: string): JsonObject[] {
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(s.status, `${what} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${what}: one reply per call (stdout: ${s.stdout.slice(0, 600)})`).toBe(calls.length);
  return s.lines.map((l, i) => obj(l, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 160)})`));
}

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by this suite's own assembler (wat/: the `wat` crate, outside the workspace).

export interface Program { name: string; bytes: Buffer; b64: string; sha: string }

const WAT_DIR = join(HERE, 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-533-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`this suite's assembler (tests/acceptance/533/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-533-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-533-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The runner `deep-logic` (README: deep-logic), JSON lines in, one reply per line.

export const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: criterion 2's wrong programs (README: Planted twins). */
export type LogicPlanted = 'read_region_orders_by_arrival' | 'read_region_drops_player';
export const logicBin = (): string => buildBin(LOGIC_BIN, null);
/** Runs `calls` through one `deep-logic [--planted p]` process on this host. */
export function onLogic(calls: JsonObject[], planted?: LogicPlanted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  return replies(start(logicBin(), args, calls), calls, `${LOGIC_BIN} ${args.join(' ')}`.trim());
}

export type WriteType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
export type Writes = Record<string, { type: WriteType; count?: number }>;
export interface ItemSpec { program: Program; reads?: string[]; writes: Writes }
/** A source's shape and delivery, as a piece declares the sources its items read (README: Piece). */
export interface SourceSpec { shape: 'scalar'; delivery: 'latest' | 'each'; max_per_step?: number }
export interface PieceSpec { seed: number; items: Record<string, ItemSpec>; controls?: string[]; sources?: Record<string, SourceSpec> }
/** A piece as `deep-logic` takes it: the document's seed, its controls and sources, its logic items and their programs. */
export function piece(p: PieceSpec): JsonObject {
  const assets: JsonObject = {};
  const items: JsonObject = {};
  for (const [id, spec] of Object.entries(p.items)) {
    assets[spec.program.sha] = spec.program.b64;
    const params: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
    if (spec.reads) params['reads'] = spec.reads;
    items[id] = { kind: 'logic@1', params };
  }
  return {
    seed: p.seed,
    ...(p.controls ? { controls: Object.fromEntries(p.controls.map((c) => [c, { kind: 'slider' }])) } : {}),
    ...(p.sources ? { sources: p.sources as unknown as JsonObject } : {}),
    items, assets,
  };
}

/** A control entry a test writer appends, stamped by the writer (Input track). */
export interface ControlEntry { t: number; seq: number; control: string; value: number; writer: 'you' | 'peer'; player: number }
/** A value a reading's source delivers: the logic module stamps it (Logic: readings). */
export interface Delivery { reading: string; value: number; as_of: number }

export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
export const openCall = (p: JsonObject, track: JsonValue[] = []): JsonObject => ({ call: 'open', piece: p, track });
export const appendCall = (session: string, entry: ControlEntry | Delivery): JsonObject => ({ call: 'append', session, entry: entry as unknown as JsonObject });
export const stepCall = (session: string, to: number): JsonObject => ({ call: 'step', session, to });
export const bakeCall = (p: JsonObject, track: JsonValue[], steps: number): JsonObject => ({ call: 'bake', piece: p, track, steps });

export interface Layout { digest: string; entries: { region: string; name: string; offset: number; size: number }[] }
function layoutOf(v: JsonValue | undefined, what: string): Layout {
  const o = obj(v, what);
  const entries = arr(o['entries'], `${what}.entries`).map((e, i) => {
    const x = obj(e, `${what}.entries[${i}]`);
    return { region: str(x['region'], `${what}.entries[${i}].region`), name: str(x['name'], `${what}.entries[${i}].name`), offset: int(x['offset'], `${what}.entries[${i}].offset`), size: int(x['size'], `${what}.entries[${i}].size`) };
  });
  return { digest: str(o['digest'], `${what}.digest`), entries };
}
/** Where an item's region entry sits: its offset in its region. */
export function entryAt(l: Layout, region: 'reads' | 'writes', name: string): { offset: number; size: number } {
  const e = l.entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(l.entries)}`);
  return { offset: e.offset, size: e.size };
}
/** The layout `check` gives an item built from `layoutProbe` with these reads and writes. */
export function layoutFor(spec: ItemSpec, extra: Omit<PieceSpec, 'seed' | 'items'> = {}): Layout {
  const [reply] = onLogic([checkCall(piece({ seed: 533, ...extra, items: { probe: spec } }))]);
  expect(reply!['ok'], `check admits the layout probe's piece (ok: true): ${show(reply)}`).toBe(true);
  return layoutOf(obj(obj(reply!['items'], 'check: items')['probe'], 'check: items.probe')['layout'], 'check: items.probe.layout');
}

export interface StepRecord { step: number; hashes: Record<string, string | null>; arrays: Record<string, JsonValue[]> }
export function stepsOf(v: JsonValue | undefined, what: string): StepRecord[] {
  return arr(v, what).map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    const hashes = Object.fromEntries(Object.entries(obj(o['items'], `${what}[${i}].items`)).map(([id, x]) => {
      const h = obj(x, `${what}[${i}].items.${id}`)['hash'];
      if (h !== null) expect(str(h, `${what}[${i}].items.${id}.hash`), `${what}[${i}].items.${id}.hash is 16 hex digits`).toMatch(HASH64);
      return [id, (h ?? null) as string | null];
    }));
    const arrays = Object.fromEntries(Object.entries(obj(o['arrays'] ?? {}, `${what}[${i}].arrays`)).map(([k, x]) => [k, arr(x, `${what}[${i}].arrays.${k}`)]));
    return { step: int(o['step'], `${what}[${i}].step`), hashes, arrays };
  });
}
/** A session `step` reply: the steps this call ran and the session's input track as recorded so far. */
export function stepped(reply: JsonObject, what: string): { steps: StepRecord[]; track: JsonObject[] } {
  expect(reply['ok'], `${what} stepped the session (ok: true): ${show(reply)}`).toBe(true);
  return { steps: stepsOf(reply['steps'], `${what}.steps`), track: arr(reply['track'], `${what}.track`).map((e, i) => obj(e, `${what}.track[${i}]`)) };
}
/** One line per step, its hashes and arrays, for comparing two runs. */
export const rowOf = (s: StepRecord): string => JSON.stringify([s.step, Object.entries(s.hashes).sort(), Object.entries(s.arrays).sort()]);
/** The first step two runs' records differ at, or null. */
export function firstDiff(a: StepRecord[], b: StepRecord[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ? rowOf(a[i]!) : '(none)';
    const y = b[i] ? rowOf(b[i]!) : '(none)';
    if (x !== y) return `step ${a[i]?.step ?? b[i]?.step}: ${x.slice(0, 300)} against ${y.slice(0, 300)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// deep-show (as #185's and #238's suites drive it): builds per feature set, `run` scenarios, startup refusals.

export const SHOW_BIN = 'deep-show';
export const REFUSED_EXIT = 2;
/** The deep-show test features this suite uses (README: deep-show). */
export type ShowFeature = 'full' | 'test-logic-patch' | 'test-leave-out-physics' | 'test-logic-needs-physics';
export const deepShow = (features: ShowFeature[]): string => buildBin(SHOW_BIN, features);

const ulid = (n: number): string => `01JB533D${String(n).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3), d: ulid(4) } as const;
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: logic', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A scenario as #200's: your session, the process table, a panel and the documents on it. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: Object.fromEntries(Object.values(DOC).map((d) => [d, { panel: 'main' }])),
    calls,
  };
}
/** `deep-show run [--planted p]`: one scenario, accepted, one reply per call. */
export function runShow(binPath: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const [out] = replies(start(binPath, args, [sc]), [sc], `${SHOW_BIN} ${args.join(' ')}`);
  expect(out!['ok'], `${SHOW_BIN} run took the scenario: ${show(out)}`).toBe(true);
  const rs = arr(out!['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(rs.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return rs;
}
/** One startup and a `registry` call: exit 0 with the scenario answered, or exit 2 with the seal's one refusal line. */
export function startup(binPath: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(binPath, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_BIN} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}
export const started = (s: Started): boolean => s.status === 0 && isObject(s.lines[0]) && s.lines[0]['ok'] === true;
/** The seal's refusal line (#305, #185): `{ok: false, code: "seal_refused", reason, modules, interface?, ...}`. */
export function refusalLine(s: Started, what: string): JsonObject {
  expect(s.status, `${what} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(-1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `${what}: the refusal is one line`).toBe(1);
  const line = obj(s.lines[0], `${what}: the refusal line`);
  expect([line['ok'], line['code']], `${what}: the seal's refusal`).toEqual([false, 'seal_refused']);
  return line;
}
export const REGISTRY: JsonObject = { call: 'registry' };
export const SCHEDULE: JsonObject = { call: 'schedule' };
/** The canvas kit (#138) over one module, with #185's smaller fuzz counts. */
export const kitCall = (module: string): JsonObject => ({ call: 'kit', modules: [module], sequences: 100, param_sets: 50 });
/** A whole revision from your shell (`deep show`), with its issues. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** `eval` at `t` flicks, reading the named arrays as that frame reads them (#497). */
export const evalArrays = (doc: string, t: number, arrays: string[]): JsonObject => ({ call: 'eval', doc, t, arrays });

/** Keeps a program in the scenario's evidence store under its sha256 (`<2 hex>/<62 hex>`), where a document's asset is read from. */
export function putAsset(evidence: string, p: Program): void {
  const dir = join(evidence, p.sha.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, p.sha.slice(2)), p.bytes);
}
/** A logic item in a document (Logic `logic@1`): its program by hash, at 60 Hz. */
export const logicItem = (id: string, program: Program, params: JsonObject, order = 'z0'): JsonObject =>
  ({ id, kind: 'logic@1', name: `Logic ${id}`, order, params: { program: program.sha, step_rate: 60, ...params } });
/** A board as your shell sends it, five seconds long at 60 fps, requiring the logic module. */
export function board(title: string, seed: number, items: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'board', seed, title, description: `${title}, a board of the #533 acceptance suite.`, size: [640, 360],
    transport: { span: '5s', frame_rate: [60, 1] }, requires: { modules: { logic: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
export interface Issue { code: string; severity: string; text: string; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), text: `${String(o['what'] ?? '')} ${String(o['path'] ?? '')} ${String(o['module'] ?? '')}`, raw: o };
  });
}

/** A fresh folder per test (an evidence store), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-533-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
