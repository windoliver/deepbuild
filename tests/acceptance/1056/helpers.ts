// Test-side tools for the #1056 acceptance tests: `deep-gpu` (#377's binary, with #417's and #149's `film2d` and #464's
// indexed basis) built once per file and driven by JSON lines; #464's pixel fixtures, generated here as #464's suite
// generates them, so a record of them is the record #464's two-GPU criteria read; this checkout's tree hash; the record
// reader and its twins (this Mac's record standing in for another GPU family's, as #380's and #140's twins do); and a
// run of one of #464's two-GPU tests, read-only, with its record named. Suites don't import each other, so what this
// file shares with #464's helpers is repeated here; only #464's base look (`fixtures/look.json`) is read from its
// folder, so the fixtures stay #464's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1056 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, whitespace collapsed (README). */
export const AC1 = 'AC1 #1056.77c08347';
export const AC2 = 'AC2 #1056.c717b851';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v, `${what} is a number, got ${shown(v)}`).toBe('number');
  return v as number;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const readJson = (path: string): JsonObject => obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);

/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test that needs what this machine lacks fails with this and its one unblock ask, never passes. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS draws the index targets; the GPU family names the record.

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws the index targets on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
export function chipName(): string {
  try { return execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
/** This chip's M number as its name gives it ("M5"), which the record's GPU names must carry. */
export function chipModel(): string {
  const m = /\bM\d+\b/.exec(chipName());
  if (!m) inconclusive(`this Mac's chip (${chipName() || 'unnamed'}) is not an Apple M chip, so it has no Apple GPU family`);
  return m[0];
}
/** This Mac's Metal GPU family, from its chip (M1 apple7, M2 apple8, M3 and M4 apple9, then apple(n + 5)), as #464's suite reads it. */
export function thisFamily(): string {
  const n = Number(chipModel().slice(1));
  return n === 1 ? 'apple7' : n === 2 ? 'apple8' : n === 3 || n === 4 ? 'apple9' : `apple${n + 5}`;
}
/** A family a twin stands in for: an M1's, or an M3's on an M1. */
export const otherFamily = (family: string): { family: string; chip: string } =>
  (family === 'apple7' ? { family: 'apple9', chip: 'Apple M3' } : { family: 'apple7', chip: 'Apple M1' });

/** Where this run leaves the records a second Mac carries over: DEEPBUILD_EVIDENCE_DIR/deep-1056-records, else under $TMPDIR. */
export function recordsDir(): string {
  const dir = join(process.env['DEEPBUILD_EVIDENCE_DIR'] ?? tmpdir(), 'deep-1056-records');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The tree hash of what is on disk in this checkout, uncommitted and untracked files too (`HEAD^{tree}` on a clean
 * checkout), as docs/parallel-proof.md defines it: written from a copy of the index, so the real one is untouched.
 */
export function checkoutTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1056-tree-'));
  const git = (args: string[], env: NodeJS.ProcessEnv = {}): string => {
    const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env } });
    expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
    return r.stdout.trim();
  };
  try {
    const source = resolve(REPO, git(['rev-parse', '--git-path', 'index']));
    const copy = join(dir, 'index');
    if (existsSync(source)) {
      copyFileSync(source, copy);
      utimesSync(copy, statSync(source).atime, statSync(source).mtime);
    }
    git(['add', '-A'], { GIT_INDEX_FILE: copy });
    return git(['write-tree'], { GIT_INDEX_FILE: copy });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

/** PATH with cargo: the one on PATH, else rustup's or the pinned toolchain's (README: Run them). */
export function cargoPath(): string {
  const extra = ['/opt/homebrew/opt/rustup/bin', join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin')].filter((d) => existsSync(d));
  return [process.env['PATH'] ?? '', ...extra].join(delimiter);
}
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, PATH: cargoPath(), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => {
  const t = process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1056-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1056-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario `{out, calls}` per line in, one line out.

/** One `deep-gpu run` scenario, accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-gpu run: ${r.error.message}`);
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one output line for the scenario').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu: replies').map((x, i) => obj(x, `deep-gpu: replies[${i}]`));
  expect(replies.length, 'deep-gpu: one reply per call').toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// #464's pixel fixtures, built as tests/acceptance/464's helpers, indexed.test.ts, see-through.test.ts and
// tables.test.ts build them (README: Fixtures).

const BASE_LOOK = readJson(join(REPO, 'tests', 'acceptance', '464', 'fixtures', 'look.json'));
function look2d(id: string, colors: Record<string, string>, change: JsonObject = {}): JsonObject {
  const palette = { ...obj(BASE_LOOK['palette'], 'palette') };
  const roles = { ...obj(BASE_LOOK['roles'], 'roles') };
  for (const [role, c] of Object.entries(colors)) { palette[`c-${role}`] = c; roles[role] = `c-${role}`; }
  return { ...BASE_LOOK, id, description: `The #464 acceptance look ${id}.`, palette, roles, ...change };
}
function doc2d(id: string, size: readonly [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Fixture ${id}`, description: `The #464 acceptance fixture ${id}.`, size: [...size], seed: 464,
    transport: { span: '8s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])), ...extra,
  };
}
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const rect = (id: string, order: string, box: [number, number, number, number], role: string, extra: JsonObject = {}): JsonObject =>
  item(id, 'rect@1', order, { box, paint: { fill: { role } } }, extra);
const circle = (id: string, order: string, center: [number, number], r: number, role: string): JsonObject =>
  item(id, 'circle@1', order, { center, r, paint: { fill: { role } } });
const line = (id: string, order: string, from: [number, number], to: [number, number], width: number, role: string): JsonObject =>
  item(id, 'path@1', order, { d: `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`, paint: { stroke: { role, width } } });
/** 320 × 180 at scale 4: the document and the frame are 1280 × 720. */
export const TARGET: [number, number] = [320, 180];
const SCALE = 4;
const FRAME_SIZE: [number, number] = [TARGET[0] * SCALE, TARGET[1] * SCALE];
const tbox = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x * SCALE, y * SCALE, w * SCALE, h * SCALE];
function indexedLook(id: string, colors: Record<string, string>, palette: string[], indexed: JsonObject = {}): JsonObject {
  return look2d(id, colors, { basis: { indexed: { size: TARGET, scale: SCALE, palette: ['ground', ...palette], tables: {}, protected: [], snap: 'integer', ...indexed } } });
}

/** A fixture as `index_record` takes it: its name, document, look, frame count and rate (60 fps when absent, as film2d). */
export interface Fixture { fixture: string; doc: JsonObject; look: JsonObject; frames: number; fps?: number }

/** #464's AC6 fixture (indexed.test.ts): a one-pixel stroke and a circle, one frame. */
const GRID: Fixture = {
  fixture: 'grid',
  doc: doc2d('grid-464', FRAME_SIZE, [
    line('wire', 'a0', [10.5 * 4, 20.5 * 4], [90.5 * 4, 60.5 * 4], 4, 'wire'),
    circle('coin', 'a1', [100 * 4, 100 * 4], 6 * 4, 'coin'),
  ]),
  look: indexedLook('grid-464', { wire: '#d9482b', coin: '#c98f2b' }, ['wire', 'coin']),
  frames: 1,
};
/** #464's AC3 fixture (indexed.test.ts): three groups under the tables none, flash and frozen, one frame. */
const TABLES_GROUPS: [string, string, number][] = [['plain', 'none', 20], ['flashed', 'flash', 120], ['frozen', 'frozen', 220]];
const TABLES: Fixture = {
  fixture: 'tables',
  doc: doc2d('tables-464', FRAME_SIZE, TABLES_GROUPS.flatMap(([g, table, x], k) => [
    item(g, 'group@1', `b${k}`, {}, { table }),
    rect(`${g}-body`, 'a0', tbox(x, 40, 40, 30), 'body', { parent: g }),
    rect(`${g}-trim`, 'a1', tbox(x, 80, 40, 10), 'trim', { parent: g }),
    rect(`${g}-guard`, 'a2', tbox(x, 100, 40, 20), 'guard', { parent: g }),
  ])),
  look: indexedLook('tables-464',
    { body: '#2c3e7b', trim: '#5f7f3b', guard: '#e3e4e6', flashbody: '#ffd9a0', flashtrim: '#fff4e0', ice: '#a8d8ff' },
    ['body', 'trim', 'guard', 'flashbody', 'flashtrim', 'ice'],
    { tables: { flash: { body: 'flashbody', trim: 'flashtrim' }, frozen: { body: 'ice', trim: 'ice' } }, protected: ['guard'] }),
  frames: 1,
};
/** #464's AC7 fixture (see-through.test.ts): the dithered puff over the wall and the shield, 38 frames at 24 fps. */
export const PUFF: Fixture = {
  fixture: 'puff',
  doc: doc2d('puff-464', FRAME_SIZE, [
    rect('wall', 'a0', tbox(40, 40, 100, 80), 'wall'),
    rect('shield', 'a1', tbox(96, 80, 16, 16), 'guard'),
    rect('puff', 'a2', tbox(48, 48, 64, 48), 'smoke', { adjust: { opacity: 0.5 } }),
  ]),
  look: indexedLook('puff-dither-464', { wall: '#2c3e7b', smoke: '#c8b4a0', guard: '#d9482b' }, ['wall', 'smoke', 'guard'], { protected: ['guard'], see_through: 'dither' }),
  frames: 38,
  fps: 24,
};
/** #464's AC9 fixture (tables.test.ts): the hero through the flash table on frames 100 to 104 of 106 at 100 fps. */
export const FLASH_PALETTE = ['ground', 'body', 'flashc', 'ice', 'guard'];
export const FLASH: Fixture = {
  fixture: 'flash',
  doc: doc2d('flash-464', FRAME_SIZE, [
    item('hero', 'group@1', 'a0', {}, { table: 'none' }),
    rect('hero-body', 'a0', tbox(40, 40, 40, 40), 'body', { parent: 'hero' }),
    rect('hero-cape', 'a1', tbox(90, 40, 30, 40), 'body', { parent: 'hero', table: 'frozen' }),
  ], {
    channels: { flash: { target: 'items/hero/table', type: 'enum', keys: { k0: { t: '0s', value: 'none', interp: 'hold' }, k1: { t: '1s', value: 'flash', interp: 'hold' }, k2: { t: '1.05s', value: 'none', interp: 'hold' } } } },
  }),
  look: indexedLook('flash-464', { body: '#2c3e7b', flashc: '#ffd9a0', ice: '#a8d8ff', guard: '#5f7f3b' }, ['body', 'flashc', 'ice', 'guard'],
    { tables: { flash: { body: 'flashc' }, frozen: { body: 'ice' } }, protected: ['guard'] }),
  frames: 106,
  fps: 100,
};
/** #464's three fixtures with a two-GPU clause. */
export const FIXTURES_464: Fixture[] = [GRID, TABLES, PUFF];

// ---------------------------------------------------------------------------------------------------
// The record (README: Surfaces this suite picked)

/** `index_record`: draws the fixture's every frame and writes its record and index targets into the scenario's `out`. */
export const indexRecordCall = (f: Fixture): JsonObject =>
  ({ call: 'index_record', fixture: f.fixture, doc: f.doc, look: f.look, frames: f.frames, ...(f.fps === undefined ? {} : { fps: f.fps }) });

/** Runs `index_record` for each fixture in one scenario whose `out` is `dir`, and reads the records it wrote there. */
export function makeRecords(bin: string, dir: string, fixtures: Fixture[]): IndexRecord[] {
  mkdirSync(dir, { recursive: true });
  runGpu(bin, dir, fixtures.map(indexRecordCall)).forEach((r, k) => answered(r, `index_record for ${fixtures[k]!.fixture}`));
  return fixtures.map((f) => readRecord(dir, f.fixture, thisFamily()));
}

export interface IndexRecord { path: string; dir: string; fixture: string; raw: JsonObject; family: string; tree: string; frames: string[] }
/** Reads `index-record-<fixture>-<family>.json` from `dir`: its family, tree hash and per-frame index hashes in frame order. */
export function readRecord(dir: string, fixture: string, family: string): IndexRecord {
  const name = `index-record-${fixture}-${family}.json`;
  const path = join(dir, name);
  expect(existsSync(path), `the record ${name} is in ${dir}`).toBe(true);
  const raw = readJson(path);
  const what = `the record ${name}`;
  const frames = arr(raw['frames'], `${what}: frames`).map((x, i) => {
    const f = obj(x, `${what}: frames[${i}]`);
    expect(num(f['frame'], `${what}: frames[${i}].frame`), `${what}: frames[${i}] is frame ${i}`).toBe(i);
    const h = str(f['indices'], `${what}: frames[${i}].indices`);
    expect(h, `${what}: frame ${i}'s index hash is a SHA-256`).toMatch(SHA);
    return h;
  });
  return { path, dir, fixture, raw, family: str(obj(raw['gpu'], `${what}: gpu`)['family'], `${what}: gpu.family`), tree: str(raw['tree'], `${what}: tree`), frames };
}
/** A frame's index target beside its record: `<sha256>.u16`, one little-endian u16 per target pixel, rows top-down. */
export function indexFile(rec: IndexRecord, frame: number): Buffer {
  const h = rec.frames[frame]!;
  const path = join(rec.dir, `${h}.u16`);
  expect(existsSync(path), `frame ${frame}'s index target ${h}.u16 is beside the record ${rec.path}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `frame ${frame}'s index target hashes to its name`).toBe(h);
  expect(bytes.length, `frame ${frame}'s index target holds ${TARGET[0]} × ${TARGET[1]} u16 indices`).toBe(TARGET[0] * TARGET[1] * 2);
  return bytes;
}

export interface TwinChange { family?: { family: string; chip: string }; tree?: string; pixel?: { frame: number; x: number; y: number } }
/**
 * A twin of this Mac's record, as a GPU of another family would write it, in its own folder with its index targets
 * beside it: `family` relabels the GPU (gpu.family, gpu.chip and the fingerprint's gpu), `tree` gives it another tree
 * hash, and `pixel` changes one pixel's index in one frame (the planted index), that frame's hash with it.
 */
export function twin(rec: IndexRecord, dir: string, change: TwinChange): string {
  mkdirSync(dir, { recursive: true });
  const body = JSON.parse(JSON.stringify(rec.raw)) as JsonObject;
  let family = rec.family;
  if (change.family) {
    family = change.family.family;
    const gpu = obj(body['gpu'], 'twin: gpu');
    gpu['family'] = change.family.family; gpu['chip'] = change.family.chip;
    if (isObject(body['fingerprint'])) body['fingerprint']['gpu'] = change.family.chip;
  }
  if (change.tree) body['tree'] = change.tree;
  for (const h of new Set(rec.frames)) copyFileSync(join(rec.dir, `${h}.u16`), join(dir, `${h}.u16`));
  if (change.pixel) {
    const { frame, x, y } = change.pixel;
    const bytes = Buffer.from(indexFile(rec, frame));
    const at = (y * TARGET[0] + x) * 2;
    bytes.writeUInt16LE(bytes.readUInt16LE(at) === 1 ? 2 : 1, at);
    const h = sha256(bytes);
    writeFileSync(join(dir, `${h}.u16`), bytes);
    obj(arr(body['frames'], 'twin: frames')[frame], `twin: frames[${frame}]`)['indices'] = h;
  }
  const path = join(dir, `index-record-${rec.fixture}-${family}.json`);
  writeFileSync(path, `${JSON.stringify(body, null, 1)}\n`);
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The comparison (README: Surfaces this suite picked)

export interface Cross { raw: JsonObject; result: string; asks: JsonObject[]; differs: JsonObject[] }
/** `cross_index` over record files: its result, its asks and what differs. */
export function crossIndex(bin: string, out: string, records: string[], what: string): Cross {
  const [r] = runGpu(bin, out, [{ call: 'cross_index', records }]);
  if (r!['code'] === 'unsupported_platform') inconclusive(`${what}: cross_index reports unsupported_platform`);
  const result = str(r!['result'], `${what}: cross_index's result (${shown(r)})`);
  const asks = r!['asks'] === undefined ? [] : arr(r!['asks'], `${what}: asks`).map((a, i) => obj(a, `${what}: asks[${i}]`));
  const differs = r!['differs'] === undefined ? [] : arr(r!['differs'], `${what}: differs`).map((d, i) => obj(d, `${what}: differs[${i}]`));
  return { raw: r!, result, asks, differs };
}
/** BLOCKED with exactly one unblock ask that says what to do, never PASS. */
export function blockedWithOneAsk(c: Cross, what: string): JsonObject {
  expect(c.result, `${what} is BLOCKED, never PASS: ${shown(c.raw)}`).toBe('BLOCKED');
  expect(c.asks.length, `${what}: exactly one ask: ${shown(c.raw['asks'])}`).toBe(1);
  const ask = c.asks[0]!;
  expect(ask['kind'], `${what}: the ask is an unblock ask`).toBe('unblock');
  expect(str(ask['ask'], `${what}: the ask's text`).length, `${what}: the ask says what unblocks it`).toBeGreaterThan(0);
  return ask;
}

// ---------------------------------------------------------------------------------------------------
// #464's two-GPU criteria, run read-only: its file, filtered to the one test, with its record named.

const CRITERIA_464: Record<string, { file: string; title: string }> = {
  grid: { file: 'indexed.test.ts', title: 'the stroke and the circle give the same indices on two GPUs' },
  tables: { file: 'indexed.test.ts', title: 'the pixel look gives the same indices on two GPUs' },
  puff: { file: 'see-through.test.ts', title: 'the dithered puff covers the same pixels on two GPUs' },
};
/** Runs #464's two-GPU test for `fixture` with DEEPBUILD_SECOND_GPU_464 naming `record`; its status and failure text. */
export function criterion464(fixture: string, record: string): { status: string; failure: string } {
  const c = CRITERIA_464[fixture]!;
  const dir = mkdtempSync(join(tmpdir(), 'deep-1056-464-'));
  try {
    const report = join(dir, 'report.json');
    const args = [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', 'tests/acceptance/464', '--no-file-parallelism', '--testTimeout=600000',
      '--reporter=json', `--outputFile=${report}`, c.file, '-t', c.title];
    const env = { ...process.env, PATH: cargoPath(), DEEPBUILD_SECOND_GPU_464: record, DEEPBUILD_EVIDENCE_DIR: join(dir, 'evidence') };
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env, timeout: 3_000_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    expect(existsSync(report), `#464's ${c.file} ran (exit ${r.status}): ${(r.stderr ?? '').slice(-1500)}`).toBe(true);
    const all = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: { assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[] })
      .testResults.flatMap((t) => t.assertionResults).filter((a) => a.fullName.includes(c.title));
    expect(all.length, `#464's ${c.file} has the one test "${c.title}"`).toBe(1);
    return { status: all[0]!.status, failure: (all[0]!.failureMessages ?? []).join('\n').slice(0, 1500) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
