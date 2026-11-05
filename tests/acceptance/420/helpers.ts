// Test-side tools for the #420 acceptance tests: the two binaries the base already has, `deep-show` (the
// canvas core's scenario binary, #393/#387/#306/#411) and `deep-gpu` (#377's GPU layer, with #378's
// `view3d`, #380's `from` and #379's `live`), each built once per file and driven by JSON lines; the calls
// and fields this suite adds (README: The surface under test) and their replies; the documents and packs the
// tests use; and the reviewed CPU references the criteria are held to: welding, open edges, the Euler
// characteristic, mesh area and volume, the closed forms of a revolved polygon, the Platonic solids and
// prisms, the pinhole projection, and PNG reading. Each check a criterion's wrong program must fail returns
// its failures as sentences that name what failed. Nothing here stands in for a builder, a modifier, the
// building module, the scheduler, the content-key cache, the GPU layer or the meter.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/420 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #420.822cf410',
  2: 'AC2 #420.0fd522a3',
  3: 'AC3 #420.1aa64c41',
  4: 'AC4 #420.fc311e1d',
  5: 'AC5 #420.adbf19b6',
  6: 'AC6 #420.2e5e696d',
  7: 'AC7 #420.c4a5924c',
  8: 'AC8 #420.34e8fe7a',
  9: 'AC9 #420.9d6960ba',
} as const;

/** The criteria's numbers (the issue's text). */
export const REL = 1e-6;
export const TEXTURE_PX = 2048;
export const QUADS_SEGMENTS = 12;
export const ALL_SEGMENTS = 18;
export const UNWELDED_QUADS = 24;
export const VISIBLE_EDGES = 9;
export const HIDDEN_EDGES = 3;
export const PARITY_SCENE = 'parity/geometry/watertight-builders.scene';
/** The design's numbers (Builder `ball`: tessellation): 561 vertices for a 32 × 16 UV ball, 540 for an icosahedron at detail 2. */
export const UV_BALL_32 = 561;
export const GEODESIC_ICOSA_2 = 540;
/** Building module: risers are at most 0.18 m. */
export const RISER_MAX = 0.18;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** One canonical text per JSON value (keys sorted at every depth). */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sorted(Object.keys(value)).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** `a` and `b` agree to `rel` relative (absolute when `b` is 0). */
export const close = (a: number, b: number, rel = REL): boolean => Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-300);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export function fixture(...parts: string[]): JsonObject {
  const value = JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${parts.join('/')} is not a JSON object`);
  return value;
}
/** The look the GPU tests draw with (fixtures/look.json, #378's acceptance look), with the fields a test changes. */
export const look = (change: JsonObject = {}): JsonObject => ({ ...fixture('look.json'), ...change });

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder under its own name.

/** `deep-show` in the `full` build set; `deep-gpu` shipped; `deep-gpu` with #379's `test-meter` (the test.gpu module). */
export type BinName = 'deep-show' | 'deep-gpu' | 'deep-gpu+test-meter';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
function argsOf(name: BinName): { bin: string; args: string[] } {
  if (name === 'deep-show') return { bin: 'deep-show', args: ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'] };
  if (name === 'deep-gpu') return { bin: 'deep-gpu', args: ['build', '--locked', '--bin', 'deep-gpu'] };
  return { bin: 'deep-gpu', args: ['build', '--locked', '--bin', 'deep-gpu', '--features', 'test-meter'] };
}
function cargoBuild(name: BinName): string {
  const { args } = argsOf(name);
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: (name: BinName) => string }
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-420-bins-'));
    for (const name of names) {
      if (made.has(name)) continue;
      const error = cargoBuild(name);
      const bin = join(dir, exe(name.replace('+', '-')));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(argsOf(name).bin)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary builds: cargo ${argsOf(name).args.join(' ')}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh temporary folder per test (evidence store, outputs, generated documents), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-420-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Writes a JSON file under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Starting a binary: one JSON line in, one JSON line out (#377, #393).

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

function accepted(s: Started, name: string, calls: number): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}

/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** Fails with an INCONCLUSIVE message off macOS: these pixels and fences come from the GPU layer on Metal. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws this on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #306), stored documents, patches, and this suite's calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type ShowPlanted =
  | 'torus_genus_0' | 'vertex_count_off_by_one' | 'cap_left_open' | 'ball_scaled'
  | 'flat_as_smooth' | 'slab_size_as_shading' | 'keeps_disabled_refs';

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: 3D scenes', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Document IDs the hub minted. */
export const docId = (n: number): string => ulid('01JB420D', n);
export const DOC = { a: docId(1), b: docId(2), c: docId(3) } as const;

export interface PackFixture { id: string; version: string; dir: string }
const pack = (id: string, version: string, folder: string): PackFixture => ({ id, version, dir: fixturePath('packs', folder) });
/** The test packs (README: Fixtures). */
export const LOWPOLY = pack('test/lowpoly', '1.0.0', 'test-lowpoly-1.0.0');
export const ROWS = pack('test/rows', '1.0.0', 'test-rows-1.0.0');
export const ROWS_TIMED = pack('test/timedrows', '1.0.0', 'test-timedrows-1.0.0');
export const ROWS_OPEN = pack('test/openrows', '1.0.0', 'test-openrows-1.0.0');
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;
export const packEntry = (p: PackFixture): JsonObject => ({ id: p.id, dir: p.dir });

export interface ScenarioExtra { packs?: readonly PackFixture[]; planted?: ShowPlanted }
/**
 * A scenario: the agent's session, the process table, one visible panel per document ID in `docs` (each document's
 * revisions come from the calls), `packs` installed before the first call, an optional `planted`, and the calls.
 */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docsOut: JsonObject = {};
  const panels: JsonObject = {};
  docs.forEach((id, i) => {
    docsOut[id] = { panel: `p${i + 1}` };
    panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] };
  });
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES, panels, docs: docsOut, calls,
  };
  if (extra.packs) out['packs'] = extra.packs.map(packEntry);
  if (extra.planted) out['planted'] = extra.planted;
  return out;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], [sc], 900_000);
  return accepted(s, 'deep-show run', arr(sc['calls'], 'the scenario\'s calls').length);
}

/** A scene document's envelope around `items` (an agent's payload shape: no `id`, no `layers`). */
export function sceneDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) {
    withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  }
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #420 acceptance fixture.`, size: [480, 360],
    ...('cam' in items ? { camera: 'cam' } : {}), requires: { modules: { scene3d: '^1' } }, ...extra, items: withIds,
  };
}

/** A still camera for the CPU tests' documents. */
export const CAMERA: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [6, 5, 8], target: [0, 0.5, 0], fov: 40 } };

export const REGISTRY: JsonObject = { call: 'registry' };
export const KINDS: JsonObject = { call: 'kinds' };
export const PACKS: JsonObject = { call: 'packs' };
export const installPack = (p: PackFixture): JsonObject => ({ call: 'install_pack', ...packEntry(p) });
/**
 * The agent's `deep_show`: a whole revision of `document` with its issues (#393). A revision that differs from
 * the last one at one path is how these tests patch that path, as #387's suite does; an item it drops is named
 * in `removes`.
 */
export const show = (doc: string, document: JsonObject, removes: string[] = []): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'], ...(removes.length ? { removes } : {}) });
export const revisionsOf = (doc: string): JsonObject => ({ call: 'revisions', doc });
export const evalCall = (doc: string, t = '0s', clean = false): JsonObject => ({ call: 'eval', doc, t, ...(clean ? { clean: true } : {}) });
export interface GeometryOptions { items?: string[]; t?: string; stage?: 'built' | 'final'; estimate_only?: boolean }
export const geometryCall = (doc: string, o: GeometryOptions = {}): JsonObject => ({ call: 'geometry', doc, ...(o as unknown as JsonObject) });

export const outcome = (reply: JsonObject): string => String(reply['outcome']);
export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'] ?? [], `${what}: issues[${i}].ids`), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
/**
 * A whole revision that was presented with no error issue and no item skipped: a kind the build doesn't know is
 * skipped with the notice `unknown_kind` (the base's), which would leave the item out of every later call.
 */
export function admitted(reply: JsonObject, what: string): void {
  const errs = errors(issues(reply, what));
  expect(errs.map((e) => canon(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).map((n) => obj(n, `${what}: a notice`)).filter((n) => n['code'] === 'unknown_kind');
  expect(skipped.map((n) => canon(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(outcome(reply), `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

// eval (#387): nodes with their keys, results and how each was had.
export interface Node { operator: string; module: string; phase: string; item: string | null; key: string; result: string; run: 'ran' | 'hit' | 'kept' }
export function nodesOf(reply: JsonObject, what: string): Node[] {
  expect(reply['outcome'], `${what}: the frame was evaluated: ${shown(reply)}`).toBe('evaluated');
  return arr(reply['nodes'], `${what}: nodes`).map((v, i) => {
    const o = obj(v, `${what}: nodes[${i}]`);
    const run = str(o['run'], `${what}: nodes[${i}].run`);
    expect(['ran', 'hit', 'kept'], `${what}: nodes[${i}].run`).toContain(run);
    return {
      operator: str(o['operator'], `${what}: nodes[${i}].operator`), module: str(o['module'], `${what}: nodes[${i}].module`),
      phase: str(o['phase'], `${what}: nodes[${i}].phase`), item: o['item'] === null ? null : str(o['item'], `${what}: nodes[${i}].item`),
      key: str(o['key'], `${what}: nodes[${i}].key`), result: str(o['result'], `${what}: nodes[${i}].result`), run: run as Node['run'],
    };
  });
}
export const nodeName = (n: Node): string => `${n.operator} on ${n.item ?? 'the document'}`;
export const ofItem = (nodes: Node[], item: string): Node[] => nodes.filter((n) => n.item === item);

// geometry (this suite): an item's built mesh.
export interface ClosedPart { name: string; triangles: number[]; genus: number }
export interface StackRow { kind: string; class: string; reads_time: boolean; enabled: boolean }
export interface Geometry {
  id: string; kind: string; declared: number; built: boolean; key: string;
  positions: V3[]; normals: V3[]; indices: number[];
  closed: ClosedPart[]; attributes: Record<string, JsonObject>; outputs: JsonObject; stack: StackRow[]; raw: JsonObject;
}
export interface GeometryReply { builds: number; items: Map<string, Geometry> }
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
export function geometryOf(reply: JsonObject, what = 'the geometry call'): GeometryReply {
  answered(reply, what);
  const items = new Map<string, Geometry>();
  for (const [i, v] of arr(reply['items'], `${what}: items`).entries()) {
    const o = obj(v, `${what}: items[${i}]`);
    const id = str(o['id'], `${what}: items[${i}].id`);
    const at = `${what}: ${id}`;
    const built = o['positions'] !== undefined;
    const positions = built ? arr(o['positions'], `${at}: positions`).map((p, k) => v3(p, `${at}: positions[${k}]`)) : [];
    const normals = o['normals'] === undefined ? [] : arr(o['normals'], `${at}: normals`).map((p, k) => v3(p, `${at}: normals[${k}]`));
    const indices = built ? arr(o['indices'], `${at}: indices`).map((x, k) => num(x, `${at}: indices[${k}]`)) : [];
    const closed = built ? Object.entries(obj(o['closed'] ?? {}, `${at}: closed`)).map(([name, c]) => {
      const q = obj(c, `${at}: closed.${name}`);
      return { name, triangles: arr(q['triangles'], `${at}: closed.${name}.triangles`).map((x, k) => num(x, `${at}: closed.${name}.triangles[${k}]`)), genus: num(q['genus'], `${at}: closed.${name}.genus`) };
    }) : [];
    const stack = arr(o['stack'] ?? [], `${at}: stack`).map((s, k): StackRow => {
      const q = obj(s, `${at}: stack[${k}]`);
      return { kind: str(q['kind'], `${at}: stack[${k}].kind`), class: str(q['class'], `${at}: stack[${k}].class`), reads_time: q['reads_time'] === true, enabled: q['enabled'] !== false };
    });
    items.set(id, {
      id, kind: str(o['kind'], `${at}: kind`), declared: num(obj(o['declared'], `${at}: declared`)['vertices'], `${at}: declared.vertices`), built,
      key: str(o['key'], `${at}: key`), positions, normals, indices, closed,
      attributes: Object.fromEntries(Object.entries(obj(o['attributes'] ?? {}, `${at}: attributes`)).map(([k, a]) => [k, obj(a, `${at}: attributes.${k}`)])),
      outputs: obj(o['outputs'] ?? {}, `${at}: outputs`), stack, raw: o,
    });
  }
  return { builds: num(reply['builds'], `${what}: builds`), items };
}
export function itemOf(g: GeometryReply, id: string, what: string): Geometry {
  const item = g.items.get(id);
  expect(item, `${what}: the reply holds ${id}; it holds ${JSON.stringify([...g.items.keys()])}`).toBeDefined();
  return item!;
}

// kinds (this suite): every kind's schema, dirty map, reads, fixture and sweep values.
export interface KindRow {
  kind: string; module: string; params: Record<string, JsonObject>; dirty: Record<string, string>; reads: string[] | null;
  fixture: { document: JsonObject; item: string } | null; sweep: Record<string, [JsonValue, JsonValue]>;
}
export function kindsOf(reply: JsonObject, what = 'the kinds call'): KindRow[] {
  answered(reply, what);
  return arr(reply['kinds'], `${what}: kinds`).map((v, i): KindRow => {
    const o = obj(v, `${what}: kinds[${i}]`);
    const kind = str(o['kind'], `${what}: kinds[${i}].kind`);
    const at = `${what}: ${kind}`;
    const dirty = Object.fromEntries(Object.entries(obj(o['dirty'] ?? {}, `${at}: dirty`)).map(([p, c]) => [p, str(c, `${at}: dirty[${p}]`)]));
    const sweep = Object.fromEntries(Object.entries(obj(o['sweep'] ?? {}, `${at}: sweep`)).map(([p, pair]): [string, [JsonValue, JsonValue]] => {
      const a = arr(pair, `${at}: sweep[${p}]`);
      expect(a.length, `${at}: sweep[${p}] is [from, to]`).toBe(2);
      return [p, [a[0]!, a[1]!]];
    }));
    let fx: KindRow['fixture'] = null;
    if (o['fixture'] !== undefined && o['fixture'] !== null) {
      const f = obj(o['fixture'], `${at}: fixture`);
      fx = { document: obj(f['document'], `${at}: fixture.document`), item: str(f['item'], `${at}: fixture.item`) };
    }
    return {
      kind, module: str(o['module'], `${at}: module`),
      params: Object.fromEntries(Object.entries(obj(o['params'] ?? {}, `${at}: params`)).map(([p, s]) => [p, obj(s, `${at}: params.${p}`)])),
      dirty, reads: o['reads'] === undefined ? null : strs(o['reads'], `${at}: reads`), fixture: fx, sweep,
    };
  });
}

/** `registry` (#305, #411): every kind with the canvas module that registers it. */
export function registryKinds(reply: JsonObject): Record<string, string> {
  const kinds = obj(reply['kinds'], 'registry: kinds');
  return Object.fromEntries(Object.entries(kinds).map(([k, m]) => [k, str(m, `registry: kinds[${k}]`)]));
}

/** Sets the value at a path of the item grammar (`params/a/b`, `params/list/2`) inside `item`, in place. */
export function setPath(item: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split('/');
  let at: JsonValue = item;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next: JsonValue | undefined = Array.isArray(at) ? at[Number(key)] : (at as JsonObject)[key];
    if (next === undefined || next === null || typeof next !== 'object') {
      const made: JsonObject = {};
      if (Array.isArray(at)) at[Number(key)] = made; else (at as JsonObject)[key] = made;
      at = made;
    } else at = next;
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(at)) at[Number(last)] = value; else (at as JsonObject)[last] = value;
}

// ---------------------------------------------------------------------------------------------------
// Meshes: the reviewed CPU references (parity suite: "CPU references … stay reviewed test code").

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point. */
export const WELD = 1e-6;
export const weldKey = (p: V3): string => p.map((x) => Math.round(x / WELD)).join(',');
export interface Welded { ids: number[]; points: V3[] }
export function weld(positions: V3[]): Welded {
  const at = new Map<string, number>();
  const points: V3[] = [];
  const ids = positions.map((p) => {
    const k = weldKey(p);
    let id = at.get(k);
    if (id === undefined) { id = points.length; at.set(k, id); points.push(p); }
    return id;
  });
  return { ids, points };
}
/** The triangles of `indices` (all of them, or `only`), as welded point IDs, degenerate ones (two equal welded corners) left out. */
export function weldedTriangles(g: Geometry, w: Welded, only?: number[]): [number, number, number][] {
  const count = g.indices.length / 3;
  const list = only ?? Array.from({ length: count }, (_, i) => i);
  const out: [number, number, number][] = [];
  for (const t of list) {
    const a = w.ids[g.indices[3 * t]!]!; const b = w.ids[g.indices[3 * t + 1]!]!; const c = w.ids[g.indices[3 * t + 2]!]!;
    if (a === b || b === c || c === a) continue;
    out.push([a, b, c]);
  }
  return out;
}
export interface Topology { V: number; E: number; F: number; open: number; nonManifold: number; misoriented: number }
/** V, E and F of a triangle set on welded points, and its edges used once (open), more than twice, or twice the same way. */
export function topology(tris: [number, number, number][]): Topology {
  const uses = new Map<string, { n: number; dirs: number }>();
  const verts = new Set<number>();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      verts.add(p);
      const k = p < q ? `${p}-${q}` : `${q}-${p}`;
      const e = uses.get(k) ?? { n: 0, dirs: 0 };
      e.n++; e.dirs += p < q ? 1 : -1;
      uses.set(k, e);
    }
  }
  let open = 0; let nonManifold = 0; let misoriented = 0;
  for (const e of uses.values()) {
    if (e.n === 1) open++;
    else if (e.n > 2) nonManifold++;
    else if (e.dirs !== 0) misoriented++;
  }
  return { V: verts.size, E: uses.size, F: tris.length, open, nonManifold, misoriented };
}
/** The surface area of a triangle set. */
export function areaOf(points: V3[], tris: [number, number, number][]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += length(cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!))) / 2;
  return s;
}
/** The signed volume a closed, outward-wound triangle set encloses (divergence theorem). */
export function volumeOf(points: V3[], tris: [number, number, number][]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += dot(points[a]!, cross(points[b]!, points[c]!)) / 6;
  return s;
}
/** Every triangle of the geometry (indices into positions, unwelded). */
export function allTriangles(g: Geometry): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = 0; t < g.indices.length / 3; t++) out.push([g.indices[3 * t]!, g.indices[3 * t + 1]!, g.indices[3 * t + 2]!]);
  return out;
}

/** What a closed builder must be (AC5): its count, finite positions, and each closed part watertight with V − E + F = 2 − 2g. */
export function meshProblems(name: string, g: Geometry, expectGenera: number[] | null): string[] {
  const out: string[] = [];
  if (!g.built) return [`${name}: not built`];
  if (g.positions.length !== g.declared) out.push(`${name}: declares ${g.declared} vertices and builds ${g.positions.length}`);
  if (g.indices.length % 3 !== 0 || g.indices.length === 0) out.push(`${name}: ${g.indices.length} indices is not a whole, non-empty triangle list`);
  if (g.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= g.positions.length)) out.push(`${name}: an index points past its ${g.positions.length} positions`);
  if (g.positions.some((p) => p.some((x) => !Number.isFinite(x)))) out.push(`${name}: a position is not finite`);
  if (out.length) return out;
  const w = weld(g.positions);
  if (expectGenera !== null) {
    const got = g.closed.map((c) => c.genus).sort((a, b) => a - b);
    const want = [...expectGenera].sort((a, b) => a - b);
    if (canon(got) !== canon(want)) out.push(`${name}: its closed parts have genera ${JSON.stringify(got)}; the fixture expects ${JSON.stringify(want)}`);
  }
  for (const part of g.closed) {
    const tris = weldedTriangles(g, w, part.triangles);
    const t = topology(tris);
    const chi = t.V - t.E + t.F;
    if (t.open > 0) out.push(`${name}: closed part ${part.name} has ${t.open} open edges`);
    if (t.nonManifold > 0) out.push(`${name}: closed part ${part.name} has ${t.nonManifold} edges on more than two triangles`);
    if (t.misoriented > 0) out.push(`${name}: closed part ${part.name} has ${t.misoriented} edges its two triangles wind the same way`);
    if (chi !== 2 - 2 * part.genus) out.push(`${name}: closed part ${part.name} declares genus ${part.genus}, but on welded positions V − E + F = ${t.V} − ${t.E} + ${t.F} = ${chi}, not ${2 - 2 * part.genus}`);
  }
  return out;
}
/** Area and volume against a closed form, each to 1e-6 relative (AC5); volume over every closed part. */
export function measureProblems(name: string, g: Geometry, want: { area?: number; volume?: number }): string[] {
  const out: string[] = [];
  const w = weld(g.positions);
  const tris = weldedTriangles(g, w);
  if (want.area !== undefined) {
    const a = areaOf(w.points, tris);
    if (!close(a, want.area)) out.push(`${name}: area ${a} m², the closed form ${want.area} m² (relative ${Math.abs(a - want.area) / want.area})`);
  }
  if (want.volume !== undefined) {
    const v = g.closed.reduce((s, part) => s + volumeOf(w.points, weldedTriangles(g, w, part.triangles)), 0);
    if (!close(v, want.volume)) out.push(`${name}: volume ${v} m³, the closed form ${want.volume} m³ (relative ${Math.abs(v - want.volume) / want.volume})`);
  }
  return out;
}

// Closed forms (each from its params alone).
/** A box's area and volume. */
export const boxForm = (s: V3): { area: number; volume: number } => ({ area: 2 * (s[0] * s[1] + s[1] * s[2] + s[2] * s[0]), volume: s[0] * s[1] * s[2] });
/** A polygon prism: plan area A, perimeter P, height h. */
export const prismForm = (A: number, P: number, h: number): { area: number; volume: number } => ({ area: 2 * A + P * h, volume: A * h });
/**
 * A polygon outline [[r, y]] revolved in n even segments (a lathe; a tube on a straight path is the same prism):
 * each outline edge sweeps n planar trapezoids between regular n-gons of circumradius r1 and r2, and the solid's
 * cross-section at height y is the n-gon of circumradius r(y). An open outline with flat caps closes through the axis.
 */
export function latheForm(outline: [number, number][], n: number, closed: boolean): { area: number; volume: number } {
  const pts = closed ? [...outline] : [[0, outline[0]![1]] as [number, number], ...outline, [0, outline[outline.length - 1]![1]] as [number, number]];
  const s = Math.sin(Math.PI / n); const c = Math.cos(Math.PI / n);
  let area = 0; let swept = 0;
  for (let i = 0; i < pts.length; i++) {
    // On an open outline the edge back along the axis (r = 0 at both ends) adds nothing to either sum.
    const [r1, y1] = pts[i]!; const [r2, y2] = pts[(i + 1) % pts.length]!;
    area +=n * (r1 + r2) * s * Math.hypot((r2 - r1) * c, y2 - y1);
    swept += ((y2 - y1) * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
  }
  return { area, volume: (n / 2) * Math.sin((2 * Math.PI) / n) * Math.abs(swept) };
}
/** A regular octahedron of circumradius r. */
export const octaForm = (r: number): { area: number; volume: number } => ({ area: 4 * Math.sqrt(3) * r * r, volume: (4 / 3) * r ** 3 });
/** A regular icosahedron of circumradius r (edge a = r ÷ sin 72°). */
export function icosaForm(r: number): { area: number; volume: number } {
  const a = r / Math.sin((2 * Math.PI) / 5);
  return { area: 5 * Math.sqrt(3) * a * a, volume: (5 / 12) * (3 + Math.sqrt(5)) * a ** 3 };
}
/** A polygon's area by the shoelace formula, and its perimeter. */
export function polygon(points: [number, number][]): { area: number; perimeter: number } {
  let a = 0; let p = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!; const [x2, y2] = points[(i + 1) % points.length]!;
    a += x1 * y2 - x2 * y1; p += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perimeter: p };
}
/** A polygon clipped to an axis-aligned rectangle (Sutherland–Hodgman). */
export function clipToRect(points: [number, number][], rect: [number, number, number, number]): [number, number][] {
  const [x0, y0, x1, y1] = rect;
  const edges: ((p: [number, number]) => number)[] = [(p) => p[0] - x0, (p) => x1 - p[0], (p) => p[1] - y0, (p) => y1 - p[1]];
  let poly = points;
  for (const inside of edges) {
    const next: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!; const b = poly[(i + 1) % poly.length]!;
      const da = inside(a); const db = inside(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    poly = next;
    if (poly.length === 0) break;
  }
  return poly;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377), its `view3d` (#378, #380) and `live` (#379).

/** `deep-gpu --planted` names this suite adds (README: Planted programs). */
export type GpuPlanted = 'particles_integrate' | 'edges_unwelded' | 'edges_skip_depth' | 'releases_at_revision';
export interface Startup { backend?: 'noop'; planted?: GpuPlanted }
export const startArgs = (s: Startup = {}): string[] =>
  ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];
/** One scenario, accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = startArgs(startup);
  return accepted(start(bin, args, [{ out, calls }]), `deep-gpu ${args.join(' ')}`, calls.length);
}

/** A whole document as a session holds it (#378): one writer layer, every item in it. */
export function sessionDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const d = sceneDoc(title, items, extra);
  d['id'] = `doc-420-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  d['layers'] = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
  for (const v of Object.values(obj(d['items'], 'items'))) if (isObject(v)) v['layer'] = 'main';
  return d;
}

export interface View3Call {
  doc: string; look: JsonObject; size: [number, number];
  frames?: number; fps?: number; from?: number;
  targets?: ('final' | 'linear' | 'ids')[]; capture?: 'every' | number[]; counts?: boolean;
}
export const view3d = (c: View3Call): JsonObject => ({ call: 'view3d', ...(c as unknown as JsonObject) });
export interface Frame3 {
  frame: number; pixel_hash: string | null; ids: string | null; picks: Map<number, string> | null;
  segments: Map<string, [V3, V3][]> | null;
}
export function view3Reply(reply: JsonObject, what = 'the view3d call'): Frame3[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const pixel = f['pixel_hash'] === null || f['pixel_hash'] === undefined ? null : str(f['pixel_hash'], `${at}.pixel_hash`);
    let picks: Map<number, string> | null = null;
    if (f['picks'] !== undefined && f['picks'] !== null) {
      picks = new Map(Object.entries(obj(f['picks'], `${at}.picks`)).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    }
    let segments: Map<string, [V3, V3][]> | null = null;
    if (f['segments'] !== undefined && f['segments'] !== null) {
      segments = new Map(Object.entries(obj(f['segments'], `${at}.segments`)).map(([id, list]) => [id, arr(list, `${at}.segments[${id}]`).map((s, k): [V3, V3] => {
        const pair = arr(s, `${at}.segments[${id}][${k}]`);
        expect(pair.length, `${at}.segments[${id}][${k}] is [a, b]`).toBe(2);
        return [v3(pair[0], `${at}.segments[${id}][${k}][0]`), v3(pair[1], `${at}.segments[${id}][${k}][1]`)];
      })]));
    }
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: pixel, ids: f['ids'] === undefined || f['ids'] === null ? null : str(f['ids'], `${at}.ids`), picks, segments };
  });
}
export function frameAt(frames: Frame3[], n: number, what: string): Frame3 {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

// PNG and the object-ID target (#378).
export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba, channels };
}
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
/** The object-ID target: pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws (#378). */
export function readIds(out: string, f: Frame3, what: string): Ids {
  expect(f.ids, `${what}: the ID target is written`).toMatch(SHA);
  const file = readFileSync(join(out, `${f.ids}.png`));
  expect(sha256(file), `${what}: the ID target's file hashes to its name`).toBe(f.ids);
  const png = decodePng(file);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const picks = f.picks!;
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}

/** #378's pinhole: position, target, +Y up, fov across the wider side. A world point to frame px and its depth. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.position);
  const z = dot(d, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}

// live (#379), with this suite's `hold` event and `fences`, `binds` and `errors` reports.
export const W = { alpha: 'agent:alpha' } as const;
export interface Open { session: string; writer: string; doc: string; size?: [number, number] }
export type LiveEvent =
  | { frame: number; revise: { session: string; doc: string } }
  | { frame: number; hold: { session: string; until: number } };
export interface LiveSpec { frames: number; sessions: Open[]; events?: LiveEvent[]; report?: ('memory' | 'fences' | 'binds' | 'errors' | 'hashes')[]; fps?: number }
export const liveCall = (spec: LiveSpec): JsonObject => ({ call: 'live', look: look(), ...(spec as unknown as JsonObject) });
export interface Held { writer: string; count_bytes: number; results: { key: string; bytes: number }[] }
export interface LiveFrame { frame: number; binds: Map<string, string[]>; writers: Held[] }
export interface Fence { seq: number; event: string; session: string | null; frame: number | null; resource: string | null; bytes: number | null }
export interface DeviceError { frame: number | null; session: string | null; code: string; resource: string | null; message: string }
export interface Live { frames: LiveFrame[]; fences: Fence[]; errors: DeviceError[] }
const optNum = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
const optStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
export function liveReply(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): LiveFrame => {
    const o = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${String(o['frame'])}`;
    const binds = new Map<string, string[]>();
    for (const [j, view] of arr(o['views'], `${at}: views`).entries()) {
      const w = obj(view, `${at}: views[${j}]`);
      binds.set(str(w['session'], `${at}: views[${j}].session`), strs(w['binds'], `${at}: views[${j}].binds`));
    }
    const writers = arr(o['writers'], `${at}: writers`).map((h, j): Held => {
      const q = obj(h, `${at}: writers[${j}]`);
      return {
        writer: str(q['writer'], `${at}: writers[${j}].writer`), count_bytes: num(q['count_bytes'], `${at}: writers[${j}].count_bytes`),
        results: arr(q['results'], `${at}: writers[${j}].results`).map((r, k) => {
          const x = obj(r, `${at}: writers[${j}].results[${k}]`);
          return { key: str(x['key'], `${at}: a result's key`), bytes: num(x['bytes'], `${at}: a result's bytes`) };
        }),
      };
    });
    return { frame: num(o['frame'], `${what}: frames[${i}].frame`), binds, writers };
  });
  const fences = arr(reply['fences'], `${what}: fences`).map((v, i): Fence => {
    const o = obj(v, `${what}: fences[${i}]`);
    return { seq: num(o['seq'], `${what}: fences[${i}].seq`), event: str(o['event'], `${what}: fences[${i}].event`), session: optStr(o['session']), frame: optNum(o['frame']), resource: optStr(o['resource']), bytes: optNum(o['bytes']) };
  });
  const errs = arr(reply['errors'], `${what}: errors`).map((v, i): DeviceError => {
    const o = obj(v, `${what}: errors[${i}]`);
    return { frame: optNum(o['frame']), session: optStr(o['session']), code: str(o['code'], `${what}: errors[${i}].code`), resource: optStr(o['resource']), message: str(o['message'] ?? '', `${what}: errors[${i}].message`) };
  });
  return { frames, fences, errors: errs };
}
