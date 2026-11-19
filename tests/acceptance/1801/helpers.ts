// Test-side tools for the #1801 acceptance tests (README): `deep-show` built per Cargo feature set and driven as
// `deep-show run` (#393's scenario, #411's deep_query call), the world its scenarios share, the fixtures (the door,
// the posters, the city, the cost scene and the pointer board), pictures put into the evidence store by their hash,
// the judges each criterion's planted program must fail (each returns its failures as sentences that name what
// failed), and the timing judge (scripts/benchmark.mjs's rule). Nothing here stands in for refs_to, cost, the patch
// refusal, the meter or the kit.
//
// Safety: every folder is a fresh temp folder removed after its test or file; HOME is a temp folder (cargo alone
// keeps yours); the agent's own CLAUDE_* and DEEP_* variables are removed; every process runs to its end under
// spawnSync's own timeout, so none is left behind; no network.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1801 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', SHOW);

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
/** Cargo keeps your HOME, so it finds its own registry, toolchain and build cache; nothing else does. */
const CARGO_ENV = { ...process.env };
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1801-home-')));
process.env.HOME = HOME;
afterAll(() => { rmSync(HOME, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${brief(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${brief(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${brief(value)}`).toBe(true);
  return value as number;
}
export const brief = (value: JsonValue | undefined, n = 1500): string => (JSON.stringify(value) ?? 'undefined').slice(0, n);
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => canon(a) === canon(b);
/** JSON with object keys sorted, so two values compare by content. */
function canon(v: JsonValue | undefined): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'undefined';
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one naming each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

export const FULL: readonly string[] = ['full'];
/** README: the kit's test canvas module `test.kit.pointer`, which doesn't declare its reference. */
export const POINTER: readonly string[] = ['full', 'test-kit-pointer'];
/** README: the same module with `points_to` declared as a reference. */
export const DECLARED: readonly string[] = ['full', 'test-kit-pointer-declared'];
const nameOf = (features: readonly string[]): string => features.join('+');

function cargoBuild(features: readonly string[]): string {
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features.join(',')];
  const r = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Locking|Updating/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds every listed feature set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuilds(sets: readonly (readonly string[])[]): { bin(features: readonly string[]): string } {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1801-bins-'));
    for (const features of sets) {
      const name = nameOf(features);
      if (made.has(name)) continue;
      const error = cargoBuild(features);
      const bin = join(dir, `${SHOW}-${name}`);
      if (error === '') copyFileSync(BUILT, bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(features) {
      const entry = made.get(nameOf(features));
      if (!entry) throw Error(`the file didn't list the build ${nameOf(features)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW} with features ${features.join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393's convention).

/** One run of `deep-show run`, timed from spawn to exit; its replies, one per call. */
export function runTimed(bin: string, scenario: JsonObject): { replies: JsonObject[]; ms: number } {
  const started = performance.now();
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - started;
  if (r.error) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stderr: ${(r.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies, ms };
}
export const run = (bin: string, scenario: JsonObject): JsonObject[] => runTimed(bin, scenario).replies;

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1801-ev-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The world: the agent's session (alpha), the process table, one panel, the documents the hub minted.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: door rig', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
const PANELS: JsonObject = { main: { rect: [0, 0, 1200, 800] } };
/** Alpha's writer layer in a shared document, by its writer (`agent:<thread>`, #96). */
export const ALPHA_WRITER = `agent:${ALPHA.thread}`;

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = {
  door: ulid('01JC1801D', 1), posters: ulid('01JC1801D', 2), city: ulid('01JC1801D', 3),
  cost: ulid('01JC1801D', 4), meter: ulid('01JC1801D', 5), pointer: ulid('01JC1801D', 6),
} as const;
export const patchId = (n: number): string => ulid('01JC1801P', n);

/**
 * A scenario with alpha's session, the process table and the panel; each doc on `main`, a shared one with the
 * document stored at revision 0 (`{document}`, #96), and the scenario's own extra fields (`planted`).
 */
export function scenario(evidence: string, docs: Record<string, JsonObject | null>, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  for (const [id, d] of Object.entries(docs)) out[id] = { panel: 'main', ...(d ?? {}) };
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: out, ...extra, calls };
}

/** Alpha's deep_show of a whole revision. */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
/** Alpha's patch through deep_show (#96): `{patch, doc, base, reason, ops}`. */
export const patch = (doc: string, n: number, base: number, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, patch: { patch: patchId(n), doc, base, reason: 'a #1801 test patch', ops } });
/** README: refs_to, alpha's deep_query of the rows that name `target`. */
export const refsTo = (doc: string, target: string, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, what: 'refs_to', target, ...extra });
/** README: cost, alpha's deep_query of the document's costs at 0 s, ranked by `by`, every row kept. */
export const costOf = (doc: string, by: Column): JsonObject =>
  ({ call: 'deep_query', session: ALPHA.id, doc, what: 'cost', t: '0s', by, cap: 1000 });
/** README: the kit's `references` part over one module. */
export const kitCall = (module: string): JsonObject => ({ call: 'kit', modules: [module], parts: ['references'] });

/** A deep_show reply's outcome is presented, or the test fails naming the reply. */
export function presented(reply: JsonObject | undefined, what: string): number {
  expect(reply?.['outcome'], `${what} is presented: ${brief(reply, 2000)}`).toBe('presented');
  return num(reply!['rev'], `${what}: rev`);
}

// ---------------------------------------------------------------------------------------------------
// Reading replies (README: refs_to and cost)

export interface Ref { path: string; kind: string }
export const rows = (reply: JsonObject | undefined, what: string): JsonObject[] =>
  arr(reply?.['rows'], `${what}: the reply's rows (${brief(reply, 800)})`).map((r, i) => obj(r, `${what}: rows[${i}]`));
export const coverage = (reply: JsonObject | undefined, what: string): JsonObject => obj(reply?.['coverage'], `${what}: the reply's coverage block (${brief(reply, 800)})`);
const refOf = (r: JsonObject): string => `${String(r['kind'])} at ${String(r['path'])}`;

/**
 * refs_to `target` answers exactly the rows `expected` names, each by its naming field's path and its kind of
 * reference, once each. Every failure names the target and the kind and path of the row it is about.
 */
export function refsFailures(target: string, got: JsonObject[], expected: readonly Ref[]): string[] {
  const out: string[] = [];
  const it = `refs_to ${target}`;
  if (got.length !== expected.length) out.push(`${it} gives ${got.length} rows; the document's own count is ${expected.length}`);
  const seen = new Set<string>();
  for (const r of got) {
    const key = refOf(r);
    if (seen.has(key)) out.push(`${it} gives the ${key} row twice`);
    seen.add(key);
    if (!expected.some((e) => e.path === r['path'] && e.kind === r['kind'])) out.push(`${it} gives a row the document doesn't hold: ${key}`);
  }
  for (const e of expected) {
    if (!got.some((r) => r['path'] === e.path && r['kind'] === e.kind)) out.push(`${it} is missing the ${e.kind} row at ${e.path}`);
  }
  return out;
}

/**
 * The refusal of a patch that deletes `target` is refused, and its `ref_unresolved` issue that names `target` has
 * as its `actual` exactly `refs`, the rows refs_to gives, in the same order. Every failure names the row it is about.
 */
export function refusalFailures(target: string, reply: JsonObject, refs: readonly JsonObject[]): string[] {
  const out: string[] = [];
  const it = `the refusal of the patch deleting ${target}`;
  if (reply['outcome'] !== 'refused') return [`the patch deleting ${target} was ${brief(reply['outcome'])}, not refused as today: ${brief(reply, 800)}`];
  const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
  const naming = issues.filter((i) => i['code'] === 'ref_unresolved' && Array.isArray(i['ids']) && i['ids'].includes(target));
  // The rows are objects; an issue whose actual lists IDs (as a list field's value would) isn't the list of rows.
  const listed = naming.find((i) => Array.isArray(i['actual']) && i['actual'].length > 0 && i['actual'].every((r) => isObject(r)));
  if (!listed) return [`${it} has no ref_unresolved issue naming ${target} whose actual lists the rows that name it (issues ${brief(issues, 1200)})`];
  const actual = listed['actual'] as JsonObject[];
  refs.forEach((r, i) => {
    if (!same(actual[i], r)) out.push(`${it}: row ${i + 1} of refs_to's ${refs.length}, the ${refOf(r)}, is ${actual[i] === undefined ? 'missing from' : `not at its place in (found ${brief(actual[i], 300)})`} its actual`);
  });
  for (const r of actual.slice(refs.length)) out.push(`${it}: its actual lists a row refs_to doesn't give: ${refOf(r)}`);
  return out;
}

/** The meter's columns (README: cost). */
export const COLUMNS = ['cpu_ms', 'gpu_ms', 'gpu_mb', 'decoded_mb'] as const;
export type Column = (typeof COLUMNS)[number];
/** What a cost row is: an item by `id`, an asset by `asset`, or a pass by `pass`. */
export const costRowName = (r: JsonObject): string => (typeof r['id'] === 'string' ? `item ${r['id']}` : typeof r['asset'] === 'string' ? `asset ${r['asset']}` : typeof r['pass'] === 'string' ? `pass ${r['pass']}` : brief(r, 200));

/**
 * Each column's rows sum to the meter's total for the frame within 1%. A column that sums short names each shared
 * asset (`assets`: hash and what it is) that no row holds.
 */
export function sumFailures(costRows: readonly JsonObject[], totals: Record<Column, number>, assets: readonly { sha256: string; what: string }[]): string[] {
  const out: string[] = [];
  for (const c of COLUMNS) {
    const sum = costRows.reduce((s, r) => s + (typeof r[c] === 'number' ? r[c] : Number.NaN), 0);
    const total = totals[c];
    if (!Number.isFinite(sum)) { out.push(`${c}: a row carries no number for ${c}`); continue; }
    if (Math.abs(sum - total) <= 0.01 * Math.abs(total)) continue;
    const missing = assets.filter((a) => !costRows.some((r) => r['asset'] === a.sha256)).map((a) => `no row holds the shared asset ${a.sha256} (${a.what})`);
    out.push(`${c}: the rows sum to ${sum.toPrecision(6)}, the meter's total for the frame is ${total.toPrecision(6)} (${(((sum - total) / (total || 1)) * 100).toFixed(1)}%)${missing.length ? `; ${missing.join('; ')}` : ''}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Pictures in the evidence store (Asset: one checked read by a 64-hex name).

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG of `w × h` texels all `rgba`. */
export function png(w: number, h: number, rgba: readonly [number, number, number, number]): Buffer {
  const line = Buffer.alloc(w * 4 + 1);
  for (let x = 0; x < w; x++) Buffer.from(rgba).copy(line, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => line));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
/** Puts `bytes` into the evidence store at `root` by its layout; returns its SHA-256. */
export function stored(root: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures)

const camera = (position: number[], target: number[]): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', position, target, fov: 45, near: 0.1, far: 500 } });
const box = (id: string, order: string, size: number[], pos: number[], extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'mark.box@1', name: id, order, params: { size }, at: { pos }, ...extra });

/** The door scene's envelope: a 3D scene through `cam`, with scene3d and motion. */
const DOOR_ENVELOPE: JsonObject = {
  format: 1, profile: 'scene', title: 'Door', description: 'A door with two handles, a lamp aimed at it, a sign its angle drives and two instances of it.',
  size: [320, 240], camera: 'cam', requires: { modules: { scene3d: '^1', motion: '^1' } },
};
/** The shared document at revision 0: alpha's layer and nothing in it (#96's seed). */
export const doorSeed = (): JsonObject => ({ ...DOOR_ENVELOPE, layers: { 'alpha-main': { writer: ALPHA_WRITER, title: 'Claude Code: door rig', order: 'a0' } }, items: {} });
/**
 * Alpha's whole revision of the door scene (AC1, AC4): the door is the target of the lamp's look_at constraint `aim`,
 * read by the driver `sway`'s var `a`, the parent of `handle.left` and `handle.right`, and the one prototype of the
 * instancer `doors`. Nothing else names it.
 */
export function doorScene(): JsonObject {
  return {
    ...DOOR_ENVELOPE,
    items: Object.fromEntries([
      camera([6, 4, 8], [0, 1, 0]),
      box('door', 'a1', [1, 2, 0.1], [0, 1, 0]),
      box('handle.left', 'a2', [0.1, 0.1, 0.1], [-0.4, 0, 0.1], { parent: 'door' }),
      box('handle.right', 'a3', [0.1, 0.1, 0.1], [0.4, 0, 0.1], { parent: 'door' }),
      box('lamp', 'a4', [0.2, 0.2, 0.2], [3, 2, 2]),
      box('sign', 'a5', [0.6, 0.4, 0.05], [-3, 1, 0]),
      { id: 'doors', kind: 'instance@1', name: 'Doors', order: 'a6', params: { of: ['door'], pos: [[4, 0, -3], [6, 0, -3]] } },
    ].map((i) => [String(i['id']), i])),
    constraints: { aim: { owner: 'lamp', kind: 'look_at', target: 'door' } },
    drivers: { sway: { target: 'items/sign/at/rot/1', expr: 'a * 0.5', vars: { a: 'items/door/at/rot/1' } } },
  };
}
/** The five rows that name the door (README: the reference kinds), as the document holds them. */
export const DOOR_REFS: readonly Ref[] = [
  { path: 'constraints/aim/target', kind: 'constraint' },
  { path: 'drivers/sway/vars/a', kind: 'driver_binding' },
  { path: 'items/doors/params/of/0', kind: 'instancer' },
  { path: 'items/handle.left/parent', kind: 'parent' },
  { path: 'items/handle.right/parent', kind: 'parent' },
];

/** The posters' picture (AC2): a 4 × 4 green PNG, put into the evidence store by the test. */
export const POSTER_PNG = (): Buffer => png(4, 4, [20, 180, 60, 255]);
/** A hash nothing names and no store holds: the hash of a text no test writes anywhere. */
export const UNNAMED = sha256('#1801: a picture nothing names');
/**
 * The posters (AC2), a shared document at revision 0 with two layers: alpha's holds one box; yours holds the camera,
 * three image marks whose `asset` is `picture`, and a material whose base color map is `picture`. No `assets` map.
 */
export function postersSeed(picture: string): JsonObject {
  const image = (id: string, order: string, x: number): JsonObject =>
    ({ id, kind: 'mark.image@1', layer: 'you-main', name: id, order, params: { asset: picture, alt: 'A green square', size: [64, 64] }, at: { pos: [x, 1, 0] } });
  return {
    format: 1, profile: 'scene', title: 'Posters', description: 'Three posters of one picture and a material made from it, beside an agent\'s box.',
    size: [320, 240], camera: 'cam', requires: { modules: { scene3d: '^1' } },
    layers: { 'alpha-main': { writer: ALPHA_WRITER, title: 'Claude Code: door rig', order: 'a0' }, 'you-main': { writer: 'you:you', title: 'You', order: 'a1' } },
    items: {
      'alpha.box': { id: 'alpha.box', kind: 'mark.box@1', layer: 'alpha-main', name: 'Box', order: 'a0', params: { size: [1, 1, 1] } },
      cam: { ...camera([0, 4, 12], [0, 1, 0]), layer: 'you-main' },
      'img.a': image('img.a', 'b0', -2), 'img.b': image('img.b', 'b1', 0), 'img.c': image('img.c', 'b2', 2),
      'mat.green': { id: 'mat.green', kind: 'material@1', layer: 'you-main', name: 'Green', order: 'b3', params: { maps: { base_color: picture } } },
    },
  };
}
/** The fields that name the posters' picture: three items' `asset` and the material's base color map. */
export const POSTER_PATHS: readonly string[] = ['items/img.a/params/asset', 'items/img.b/params/asset', 'items/img.c/params/asset', 'items/mat.green/params/maps/base_color'];

/** The city (AC3): 5,000 items, a camera, the shared material `stone` and 4,998 blocks, every eighth of the first 4,800 in stone. */
export const CITY_ITEMS = 5000;
export const STONE = 'stone';
const blockId = (i: number): string => `b${String(i).padStart(4, '0')}`;
export function city(): JsonObject {
  const items: JsonObject = {
    cam: camera([0, 80, 160], [0, 0, 0]),
    [STONE]: { id: STONE, kind: 'material@1', name: 'Stone', order: 'a1', params: { base_color: [0.6, 0.6, 0.55, 1], roughness: 0.8 } },
  };
  for (let i = 0; i < CITY_ITEMS - 2; i++) {
    items[blockId(i)] = box(blockId(i), `b${String(i).padStart(4, '0')}`, [1, 1 + (i % 7), 1], [(i % 70) * 2 - 70, 0, Math.floor(i / 70) * 2 - 70], i % 8 === 0 && i < 4800 ? { material: STONE } : {});
  }
  return { format: 1, profile: 'scene', title: 'City', description: 'A city of 5,000 items, 600 of its blocks in one shared stone.', size: [640, 480], camera: 'cam', requires: { modules: { scene3d: '^1' } }, items };
}
/** The fields that name the stone, as the city holds them: each stone block's `material`. */
export function stonePaths(doc: JsonObject): string[] {
  return Object.values(obj(doc['items'], 'the city\'s items')).filter((i) => isObject(i) && i['material'] === STONE).map((i) => `items/${String((i as JsonObject)['id'])}/material`);
}

/** The cost scene's texture (AC5): 4,096 × 2,048 RGBA, so its mip chain fits the document's 64 MB decoded cap. */
export const TEXTURE_PNG = (): Buffer => png(4096, 2048, [180, 120, 60, 255]);
export const MESH = 'ground';
/**
 * The cost scene (AC5): one 4,096 px texture, the base color map of the material `poster` that two panels wear; one
 * 200,000-triangle mesh, the plate `ground` (a 500 × 200 grid, two triangles a cell); and 300 small rects. `budget`
 * names its class and any caps it tightens.
 */
export function costScene(texture: string, budget: JsonObject): JsonObject {
  const items: JsonObject = {
    cam: camera([0, 6, 14], [0, 0, 0]),
    [MESH]: { id: MESH, kind: 'plate@1', name: 'Ground', order: 'a1', params: { grid: [500, 200], size: [10, 4] } },
    poster: { id: 'poster', kind: 'material@1', name: 'Poster', order: 'a2', params: { maps: { base_color: texture } } },
    'panel.a': box('panel.a', 'a3', [2, 1, 0.05], [-2, 1, 0], { material: 'poster' }),
    'panel.b': box('panel.b', 'a4', [2, 1, 0.05], [2, 1, 0], { material: 'poster' }),
  };
  for (let i = 0; i < 300; i++) {
    const id = `r${String(i).padStart(3, '0')}`;
    items[id] = { id, kind: 'rect@1', name: `Rect ${i}`, order: `c${String(i).padStart(3, '0')}`, params: { box: [(i % 30) * 10, Math.floor(i / 30) * 10, 6, 6], paint: { fill: { role: 'muted' } } } };
  }
  return { format: 1, profile: 'scene', title: 'Costs', description: 'One large texture, one dense mesh and 300 small rects.', size: [640, 480], camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget, items };
}

/** The pointer board (AC6): a rect `t1` and a `test.kit.pointer@1` item `p1` whose `points_to` names it. */
export function pointerBoard(): JsonObject {
  return {
    format: 1, profile: 'board', title: 'Pointer', description: 'A rect, and a test pointer whose points_to names it.', size: [320, 200],
    requires: { modules: { 'test.kit.pointer': '^1' } },
    items: {
      t1: { id: 't1', kind: 'rect@1', name: 'Target', order: 'a0', params: { box: [20, 20, 40, 40], paint: { fill: { role: 'muted' } } } },
      p1: { id: 'p1', kind: 'test.kit.pointer@1', name: 'Pointer', order: 'a1', params: { box: [80, 20, 40, 40], points_to: 't1' } },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Timing (technical design: Numbers version 0 has to hold; scripts/benchmark.mjs's judgeLimit)

export interface Reading { ms: number; load: { start: number; end: number } }
/** One reading, with the one-minute load average at its start and its end. */
export function reading(measure: () => number): Reading {
  const start = loadavg()[0]!;
  const ms = measure();
  return { ms, load: { start, end: loadavg()[0]! } };
}
/**
 * The design's rule on five readings taken after warm-up: PASS when all five are within `limit`, FAIL when all five
 * are over it by more than the margin, INCONCLUSIVE otherwise, and off a reference Mac on mains power with Low Power
 * Mode off, the thermal state nominal and the load under the core count. Anything but PASS fails the test, an
 * INCONCLUSIVE one with a message that starts `INCONCLUSIVE:`.
 */
export async function judgeWithin(what: string, readings: readonly Reading[], limit: number): Promise<void> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as {
    fingerprint(): JsonObject;
    judgeLimit(o: { limit: number; runs: number[]; fingerprint: JsonObject; loads: { start: number; end: number }[] }): { status: string; reason?: string };
  };
  const runs = readings.map((r) => r.ms);
  const verdict = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads: readings.map((r) => r.load) });
  const shown = `${what}: five runs ${runs.map((ms) => ms.toFixed(3)).join(', ')} ms against ${limit} ms: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`;
  console.log(shown);
  expect(verdict.status, verdict.status === 'INCONCLUSIVE' ? `INCONCLUSIVE: ${shown}` : shown).toBe('PASS');
}
