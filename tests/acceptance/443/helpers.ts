// Test-side tools for the #443 acceptance tests: the binaries the base already has, `deep-show` (the canvas core's
// scenario binary, with #420's `geometry`, #200's `registries` and startup refusal, and #185's `schedule`),
// `deep-text` (the one shaper's own binary, #390/#856) and `deep-gpu` (#378's `view3d`), each built once per file
// and driven by JSON lines; the documents the tests use; the fields this suite adds (README: The surface under
// test) parsed into types; and the reviewed CPU checks the criteria are held to: welding, the Euler characteristic
// per closed part, and ink offsets. Each check a criterion's wrong program must fail returns its failures as
// sentences that name what failed. Nothing here stands in for the shaper, an outline source, the extrude builder,
// the registry, the seal or the renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/443 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #443.359bd359',
  2: 'AC2 #443.f3f6eafa',
  3: 'AC3 #443.33177d47',
  4: 'AC4 #443.c78c7ccd',
  5: 'AC5 #443.aea1cba1',
} as const;

/** Every test's own timeout: each starts freshly built binaries; none has a time budget. */
export const SLOW = 1_800_000;

/** The issue's numbers. */
export const DEPTH = 0.1;
export const KERN_TOLERANCE = 1e-6;
export const SAMPLES = 1000;
export const OUTLINE_SOURCE = 'outline.source@1';
/** This suite's names (README: The surface under test). */
export const KIT_RULE = 'covers_2d_fill';
export const PLANTED_ENTRY = 'drops_counter';
/** outline.source@1's three entries: each by its form of `outline`, with its module and its kit fixture. */
export const ENTRIES = [
  { name: 'text', module: 'text', fixture: 'OB' },
  { name: 'path', module: 'marks2d', fixture: 'square_hole' },
  { name: 'vector', module: 'vector', fixture: 'ring' },
] as const;

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
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** True when `needle` appears anywhere in the JSON of `value` (a name held as data). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);

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
/** Fails with a message starting INCONCLUSIVE: never a pass. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder under its own name.

/** A deep-show feature set (`--no-default-features --features <set>[,<test feature>…]`), deep-text, or deep-gpu. */
export type Build =
  | { bin: 'deep-show'; set: 'core' | 'full'; with?: ('test-leave-out-vector' | 'test-scene3d-reads-vector')[] }
  | { bin: 'deep-text' }
  | { bin: 'deep-gpu' };
export const FULL: Build = { bin: 'deep-show', set: 'full' };
export const CORE: Build = { bin: 'deep-show', set: 'core' };
export const NO_VECTOR: Build = { bin: 'deep-show', set: 'full', with: ['test-leave-out-vector'] };
export const READS_VECTOR: Build = { bin: 'deep-show', set: 'full', with: ['test-scene3d-reads-vector'] };
export const TEXT: Build = { bin: 'deep-text' };
export const GPU: Build = { bin: 'deep-gpu' };

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
function argsOf(b: Build): string[] {
  if (b.bin === 'deep-show') return ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', [b.set, ...(b.with ?? [])].join(',')];
  return ['build', '--locked', '--bin', b.bin];
}
export const buildName = (b: Build): string => (b.bin === 'deep-show' ? ['deep-show', b.set, ...(b.with ?? [])].join('+') : b.bin);
function cargoBuild(b: Build): string {
  const args = argsOf(b);
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (b: Build) => string {
  let dir = '';
  const made = new Map<string, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-443-bins-'));
    for (const b of builds) {
      const name = buildName(b);
      if (made.has(name)) continue;
      const error = cargoBuild(b);
      const path = join(dir, exe(name.replace(/[^a-z0-9.-]/g, '_')));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(b.bin)), path);
      made.set(name, { path, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b: Build): string => {
    const entry = made.get(buildName(b));
    if (!entry) throw Error(`the file didn't list the build ${buildName(b)} in useBuilds`);
    expect(entry.error, `the binary builds: cargo ${argsOf(b).join(' ')}`).toBe('');
    return entry.path;
  };
}

/** A fresh temporary folder per test (evidence store, documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-443-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Starting a binary: JSON lines in, one JSON line out per line in; or deep-show's one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = SLOW - 60_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
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

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #420), documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type ShowPlanted = 'outline_ignores_fill_rule' | 'extrude_own_advance';
/** Startup `--planted` names #200 already defines, which this suite runs on outline.source@1. */
export type StartPlanted = `kit_admits_all:${typeof OUTLINE_SOURCE}` | 'hashes_every_entry';

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: 3D titles', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted. */
export const DOC = { a: '01JB443D000000000000000001', b: '01JB443D000000000000000002', c: '01JB443D000000000000000003', d: '01JB443D000000000000000004' } as const;

/** A scenario: the agent's session, the process table, one visible panel per document, an optional `planted`, and the calls. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: ShowPlanted): JsonObject {
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
  if (planted) out['planted'] = planted;
  return out;
}

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject, startPlanted?: StartPlanted): JsonObject[] {
  const args = ['run', ...(startPlanted ? ['--planted', startPlanted] : [])];
  return accepted(start(bin, args, [sc]), `deep-show ${args.join(' ')}`, arr(sc['calls'], 'the scenario\'s calls').length);
}

/** Puts `bytes` in the evidence store at their SHA-256, as the hub keeps bytes (`<2 hex>/<62 hex>`), and returns it. */
export function putBytes(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(store, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
/** The two SVG fixtures (README: Fixtures). */
export const RING_SVG = (): Buffer => readFileSync(fixturePath('ring.svg'));
export const HAIRLINE_SVG = (): Buffer => readFileSync(fixturePath('hairline.svg'));

/** A text outline in the look's body font (the default role, written out), `size` the em in metres. */
export const textOutline = (text: string, extra: JsonObject = {}): JsonObject => ({ text, font: 'body', size: 1, ...extra });
/** An `extrude@1` 0.1 m deep with no bevel, at the origin. */
export const extrude = (outline: JsonObject, extra: JsonObject = {}): JsonObject => ({ kind: 'extrude@1', params: { outline, depth: DEPTH, ...extra } });
/** A `vector@1` item over the SVG whose SHA-256 is `src`, its black mapped to the ink role. */
export const vectorItem = (src: string, alt: string): JsonObject =>
  ({ kind: 'vector@1', params: { src, size: [100, 100], colors: { '#000000': 'ink' }, alt } });

/** A still camera looking at the titles from the front (+Z), slightly above. */
export const CAMERA: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0.4, 0.9, 3.2], target: [0.4, 0.35, 0], fov: 40 } };

/** A scene document as an agent sends it (no `id`, no `layers`), with a still camera; `modules` beyond scene3d as named. */
export function sceneDoc(title: string, items: Record<string, JsonObject>, modules: string[] = [], extra: JsonObject = {}): JsonObject {
  const all: Record<string, JsonObject> = { cam: CAMERA, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  const req: JsonObject = { scene3d: '^1' };
  for (const m of modules) req[m] = '^1';
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #443 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: req }, ...extra, items: withIds,
  };
}

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
/** #420's `geometry` call: the named items' final meshes at 0 s. */
export const geometryCall = (doc: string, items: string[]): JsonObject => ({ call: 'geometry', doc, items, t: '0s' });
export const REGISTRY: JsonObject = { call: 'registry' };
export const REGISTRIES: JsonObject = { call: 'registries' };
export const SCHEDULE: JsonObject = { call: 'schedule' };

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`),
      ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], path: typeof o['path'] === 'string' ? o['path'] : '', raw: o,
    };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice). */
export function admitted(reply: JsonObject, what: string): void {
  expect(errors(issues(reply, what)).map((e) => JSON.stringify(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => JSON.stringify(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}
/** A revision refused (`deep_show` outcome `refused`), with its error issues. */
export function refusedWith(reply: JsonObject, what: string): Issue[] {
  expect(reply['outcome'], `${what}: refused, got ${shown(reply)}`).toBe('refused');
  const errs = errors(issues(reply, what));
  expect(errs.length, `${what}: the refusal carries an error issue: ${shown(reply)}`).toBeGreaterThan(0);
  return errs;
}
/** An issue names `id` when its `ids` hold it (or `<id>#…`) or its `path` is under `items/<id>`. */
export const namesItem = (i: Issue, id: string): boolean =>
  i.ids.some((x) => x === id || x.startsWith(`${id}#`)) || i.path === `items/${id}` || i.path.startsWith(`items/${id}/`);

// ---------------------------------------------------------------------------------------------------
// `geometry` replies (#420): a builder item's final mesh and its closed parts.

export type V3 = [number, number, number];
export interface ClosedPart { name: string; triangles: number[]; genus: number }
export interface Geometry { id: string; positions: V3[]; indices: number[]; closed: ClosedPart[]; raw: JsonObject }
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
/** The row of `id` in a `geometry` reply, built. */
export function geometryOf(reply: JsonObject, id: string, what: string): Geometry {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['items'], `${what}: items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const o = rows.find((r) => r['id'] === id);
  expect(o, `${what}: the reply holds ${id}: ${shown(reply)}`).toBeDefined();
  const at = `${what}: ${id}`;
  const positions = arr(o!['positions'], `${at}: positions`).map((p, k) => v3(p, `${at}: positions[${k}]`));
  const indices = arr(o!['indices'], `${at}: indices`).map((x, k) => num(x, `${at}: indices[${k}]`));
  expect(indices.length % 3 === 0 && indices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length), `${at}: indices are whole triangles into its ${positions.length} positions`).toBe(true);
  const closed = Object.entries(obj(o!['closed'] ?? {}, `${at}: closed`)).map(([name, c]) => {
    const q = obj(c, `${at}: closed.${name}`);
    const triangles = arr(q['triangles'], `${at}: closed.${name}.triangles`).map((x, k) => num(x, `${at}: closed.${name}.triangles[${k}]`));
    expect(triangles.every((t) => Number.isInteger(t) && t >= 0 && t < indices.length / 3), `${at}: closed.${name}'s triangles index its triangles`).toBe(true);
    return { name, triangles, genus: num(q['genus'], `${at}: closed.${name}.genus`) };
  });
  return { id, positions, indices, closed, raw: o! };
}

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point (#420's reading). */
const WELD = 1e-6;
function weld(positions: V3[]): number[] {
  const at = new Map<string, number>();
  return positions.map((p) => {
    const k = p.map((x) => Math.round(x / WELD)).join(',');
    let id = at.get(k);
    if (id === undefined) { id = at.size; at.set(k, id); }
    return id;
  });
}
export interface Topology { V: number; E: number; F: number; open: number; nonManifold: number; misoriented: number }
/** V, E and F of one closed part on welded positions (degenerate triangles left out), and its bad edges. */
export function topology(g: Geometry, part: ClosedPart): Topology {
  const ids = weld(g.positions);
  const uses = new Map<string, { n: number; dirs: number }>();
  const verts = new Set<number>();
  let F = 0;
  for (const t of part.triangles) {
    const a = ids[g.indices[3 * t]!]!; const b = ids[g.indices[3 * t + 1]!]!; const c = ids[g.indices[3 * t + 2]!]!;
    if (a === b || b === c || c === a) continue;
    F++;
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
  return { V: verts.size, E: uses.size, F, open, nonManifold, misoriented };
}

/**
 * What a criterion asks of each closed part `name` → its V − E + F (labelled `label`, such as `glyph O`), and of
 * the parts as a whole: exactly those parts, each closed (every edge on two triangles wound opposite ways), and the
 * whole mesh `DEPTH` deep along z. Each failure names the part's label.
 */
export function shellFailures(g: Geometry, want: Record<string, { label: string; chi: number }>): string[] {
  const out: string[] = [];
  const names = g.closed.map((c) => c.name).sort();
  const wanted = Object.keys(want).sort();
  if (JSON.stringify(names) !== JSON.stringify(wanted)) out.push(`${g.id}: its closed parts are ${JSON.stringify(names)}, not ${JSON.stringify(wanted)} (one closed shell for each)`);
  for (const [name, { label, chi }] of Object.entries(want)) {
    const part = g.closed.find((c) => c.name === name);
    if (!part) { out.push(`${label} (part ${name}) builds no closed shell`); continue; }
    const t = topology(g, part);
    if (t.F === 0) { out.push(`${label} (part ${name}) has no triangles`); continue; }
    if (t.open > 0) out.push(`${label} (part ${name}) has ${t.open} open edges`);
    if (t.nonManifold > 0) out.push(`${label} (part ${name}) has ${t.nonManifold} edges on more than two triangles`);
    if (t.misoriented > 0) out.push(`${label} (part ${name}) has ${t.misoriented} edges its two triangles wind the same way`);
    const got = t.V - t.E + t.F;
    if (got !== chi) out.push(`${label} (part ${name}): V − E + F = ${t.V} − ${t.E} + ${t.F} = ${got}, not ${chi}`);
  }
  if (g.positions.length > 0) {
    const zs = g.positions.map((p) => p[2]);
    const deep = Math.max(...zs) - Math.min(...zs);
    if (Math.abs(deep - DEPTH) > 1e-9) out.push(`${g.id}: ${deep} m deep along z, not ${DEPTH} m`);
  } else out.push(`${g.id}: no positions`);
  return out;
}

/** The smallest x of the vertices of closed part `name` (its ink's left edge, in item space). */
export function inkLeft(g: Geometry, name: string, what: string): number {
  const part = g.closed.find((c) => c.name === name);
  expect(part, `${what}: ${g.id} has the closed part ${name}; it has ${JSON.stringify(g.closed.map((c) => c.name))}`).toBeDefined();
  let x = Infinity;
  for (const t of part!.triangles) for (let k = 0; k < 3; k++) x = Math.min(x, g.positions[g.indices[3 * t + k]!]![0]);
  expect(Number.isFinite(x), `${what}: ${g.id}'s part ${name} has vertices`).toBe(true);
  return x;
}

// ---------------------------------------------------------------------------------------------------
// deep://registries (#200's `registries`), the startup refusal (#200, #305), and `schedule`'s interfaces (#185).

export interface RuleResult { rule: string; verdict: string; raw: JsonObject }
export interface KitResult { verdict: string; rules: RuleResult[]; raw: JsonObject }
export function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`), raw: ro };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface Entry { name: string; origin: string; module: string | undefined; kit: KitResult; raw: JsonObject }
export interface Planted { name: string; result: KitResult; raw: JsonObject }
export interface Listed { name: string; owner: string; fill: string[]; kit: string[]; planted: Planted[]; entries: Entry[]; raw: JsonObject }
/** The registry `name` in a `registries` reply. */
export function theRegistry(reply: JsonObject, name: string, what = 'deep://registries'): Listed {
  const list = arr(reply['registries'], `${what}: registries`).map((v, i) => obj(v, `${what}: registries[${i}]`));
  const o = list.find((x) => x['kind'] === 'registry' && x['name'] === name);
  expect(o, `${what} lists the registry ${name}; it lists ${list.map((x) => String(x['name'])).join(', ') || 'nothing'}`).toBeDefined();
  const at = `${what}: ${name}`;
  return {
    name, owner: str(o!['owner'], `${at}.owner`), fill: arr(o!['fill'], `${at}.fill`).map(String),
    kit: arr(o!['kit'], `${at}.kit`).map((r, i) => str(obj(r, `${at}.kit[${i}]`)['rule'], `${at}.kit[${i}].rule`)),
    planted: arr(o!['planted'], `${at}.planted`).map((p, i) => {
      const po = obj(p, `${at}.planted[${i}]`);
      return { name: str(po['name'], `${at}.planted[${i}].name`), result: kitResult(po['result'], `${at}.planted[${i}].result`), raw: po };
    }),
    entries: arr(o!['entries'], `${at}.entries`).map((e, i) => {
      const eo = obj(e, `${at}.entries[${i}]`);
      return { name: str(eo['name'], `${at}.entries[${i}].name`), origin: str(eo['origin'], `${at}.entries[${i}].origin`), module: typeof eo['module'] === 'string' ? eo['module'] : undefined, kit: kitResult(eo['kit'], `${at}.entries[${i}].kit`), raw: eo };
    }),
    raw: o!,
  };
}

/** One startup and a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string, planted?: StartPlanted): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [REGISTRY] }]);
  expect(s.timedOut, `deep-show ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}
/** #200's refusal line: `{"ok": false, "code": "seal_refused", "reason", "modules", "registry"?, "entries"?, "rules"?, …}` and exit 2. */
export interface Refusal { reason: string; modules: string[]; registry: string | undefined; entries: JsonValue[]; raw: JsonObject }
export function refusalOf(s: Started, what: string): Refusal {
  expect(s.status, `${what}: the startup exits 2 with the seal's refusal; stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-800)}`).toBe(2);
  expect(s.lines.length, `${what}: the refusal is one line: ${s.stdout.slice(0, 800)}`).toBe(1);
  const raw = obj(s.lines[0], `${what}: the refusal`);
  expect([raw['ok'], raw['code']], `${what}: the line is the seal's refusal: ${shown(raw)}`).toEqual([false, 'seal_refused']);
  return {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '', modules: Array.isArray(raw['modules']) ? raw['modules'].map(String) : [],
    registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined, entries: Array.isArray(raw['entries']) ? raw['entries'] : [], raw,
  };
}

/** `schedule`'s `interfaces[name@major].digest` (deep://schedule, #185, as #489's suite reads it). */
export function interfaceDigest(reply: JsonObject, iface: string): string {
  const i = obj(obj(reply['interfaces'], 'deep://schedule: interfaces')[iface], `deep://schedule: interfaces["${iface}"]`);
  return str(i['digest'], `deep://schedule: interfaces["${iface}"].digest`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-text shape` (#856): the flat text's shaped run.

/** The width (the run's advance, logical px) of `text` shaped flat in the body font at `size`. */
export function flatWidth(bin: string, text: string, size: number): number {
  const s = start(bin, ['shape'], [{ text, font: 'body', size }]);
  expect(s.status, `deep-text shape exited 0: ${s.stdout.slice(0, 600)} ${s.stderr.slice(-600)}`).toBe(0);
  const o = obj(s.lines[0], `deep-text shape "${text}"`);
  expect(o['ok'], `deep-text shape "${text}" answered: ${shown(o)}`).toBe(true);
  return num(o['width'], `deep-text shape "${text}": width`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`'s `view3d` (#378): the renderer's own final target.

export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  return accepted(start(bin, ['run'], [{ out, calls }]), 'deep-gpu run', calls.length);
}
const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, modules: string[] = []): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  const req: JsonObject = { scene3d: '^1' };
  for (const m of modules) req[m] = '^1';
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #443 acceptance screenshot.`, size, camera: 'cam',
    requires: { modules: req }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, items: withIds,
  };
}
/** A physical-basis look with tone map none at scale 1 (#424's `PLAIN_LOOK`), its body font Inter as every look's. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-443-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #443 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
/** `view3d` of one frame's final target, the SVG store given. */
export const view3dCall = (doc: string, size: [number, number], store: string): JsonObject =>
  ({ call: 'view3d', doc, look: PLAIN_LOOK, size, frames: 1, capture: [0], targets: ['final'], store });
/** The final target's file of a one-frame `view3d` reply: the renderer's PNG, named by its SHA-256. */
export function finalPng(out: string, reply: JsonObject, what: string): Buffer {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const frame = obj(arr(reply['frames'], `${what}: frames`)[0], `${what}: frames[0]`);
  const hash = str(frame['final'], `${what}: frames[0].final`);
  expect(hash, `${what}: the final target is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.png`));
  expect(sha256(file), `${what}: the final target's file hashes to its name`).toBe(hash);
  return file;
}
