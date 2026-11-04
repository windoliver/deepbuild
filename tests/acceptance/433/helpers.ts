// Test-side tools for the #433 acceptance tests: `deep-show` (the canvas core's scenario binary), built once per
// file and driven by one JSON line; the scenario with the first-party packs installed, documents and calls; what a
// `deep_show` reply says a recipe instance expanded to (#306's `expansions`); the `geometry` rows with the `world`
// field this suite adds (README: The surface under test); the refusal check; and the planted names. The CPU
// references the criteria are held to are in reference.ts. Nothing here stands in for a pack, a builder or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { apply, fmt, fmtV, godotWorld, type Box, type M34, type V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/433 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #433.f24f739a',
  2: 'AC2 #433.91c3ce63',
  3: 'AC3 #433.d62fb708',
  4: 'AC4 #433.ee555415',
  5: 'AC5 #433.f44f926c',
} as const;

/** Each test spawns cargo or the binary; none has a time budget. */
export const SLOW = 900_000;

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
export function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

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

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show` in the `full` build set, built once per file and copied out under its own name.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];

/** Builds deep-show before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-433-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${CARGO.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe('deep-show')), join(dir, exe('deep-show')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO.join(' ')}`).toBe('');
    return join(dir, exe('deep-show'));
  };
}

/** A fresh temporary folder per test (the scenario's evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-433-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The first-party packs (README: The surface under test), each a folder under packs/ as #420's composites are.

export interface Pack { id: string; version: string; dir: string }
const pack = (name: string): Pack => ({ id: `deepbuild/${name}`, version: '1.0.0', dir: join(REPO, 'packs', `${name}-1.0.0`) });
export const PACKS = { familiar: pack('familiar'), godot: pack('godot'), unreal: pack('unreal'), blender: pack('blender') } as const;
export const packAt = (p: Pack): string => `${p.id}@${p.version}`;

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #306, #420), documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type ShowPlanted = 'familiar_copies_angles' | 'familiar_copies_position' | 'familiar_widens_portrait' | 'familiar_looks_plus_z' | 'familiar_copies_spot_power';

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: familiar names', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted. */
export const DOC = { a: '01JB433D000000000000000001', b: '01JB433D000000000000000002' } as const;

/** A scenario: the agent's session, the process table, one visible panel per document, the packs installed before the first call, an optional `planted`, and the calls. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], packs: readonly Pack[], planted?: ShowPlanted): JsonObject {
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
    packs: packs.map((p) => ({ id: p.id, dir: p.dir })),
  };
  if (planted) out['planted'] = planted;
  return out;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: SLOW - 60_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-show run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `deep-show run exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(answer['ok'], `deep-show run refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}

/**
 * A scene document around `items` (an agent's payload: no `id`, no `layers`), naming `packs`, with a still camera
 * of its own (`cam`) and the frame `size` (default 1920 × 1080).
 */
export function sceneDoc(title: string, items: Record<string, JsonObject>, packs: readonly Pack[], size: [number, number] = [1920, 1080]): JsonObject {
  const all: Record<string, JsonObject> = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [6, 5, 8], target: [0, 0, 0], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #433 acceptance fixture.`, size, camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, packs: packs.map(packAt), items: withIds,
  };
}

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
/** #420's `geometry` call over every item with geometry (derived items by their derived IDs). */
export const geometryCall = (doc: string): JsonObject => ({ call: 'geometry', doc, t: '0s' });

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
function entries(reply: JsonObject, key: 'issues' | 'notices', what: string): Issue[] {
  return arr(reply[key] ?? [], `${what}: ${key}`).map((v, i) => {
    const o = obj(v, `${what}: ${key}[${i}]`);
    return { code: String(o['code']), severity: String(o['severity'] ?? (key === 'notices' ? 'notice' : '')), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o };
  });
}
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice). */
export function admitted(reply: JsonObject, what: string): void {
  expect(entries(reply, 'issues', what).filter((i) => i.severity === 'error').map((e) => JSON.stringify(e.raw)), `${what}: no error issue`).toEqual([]);
  expect(entries(reply, 'notices', what).filter((n) => n.code === 'unknown_kind').map((n) => JSON.stringify(n.raw)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// What an instance expanded to, and `geometry` rows.

/** A derived item a recipe instance wrote, as the `deep_show` reply's `expansions` row holds it (#306). */
export interface Derived { id: string; kind: string; item: JsonObject }
/** The derived items `instance` expanded to in this reply, in the row's order; none when it has no row. */
export function derivedOf(reply: JsonObject, instance: string): Derived[] {
  const rows = arr(reply['expansions'] ?? [], 'expansions').map((r, i) => obj(r, `expansions[${i}]`));
  const row = rows.find((r) => r['instance'] === instance);
  if (!row) return [];
  return Object.entries(obj(row['derived'], `expansions: ${instance}.derived`)).map(([id, v]) => {
    const item = obj(v, `expansions: ${instance}.derived.${id}`);
    return { id, kind: String(item['kind']), item };
  });
}
/** The one derived item of `kind` `instance` expanded to; the failure says what it found instead. */
export function oneOfKind(reply: JsonObject, instance: string, kind: string): { found?: Derived; problem?: string } {
  const all = derivedOf(reply, instance);
  const of = all.filter((d) => d.kind === kind);
  if (of.length === 1) return { found: of[0]! };
  return { problem: `${instance}: expands to ${of.length} ${kind} items (it expanded to ${all.length === 0 ? 'nothing' : all.map((d) => `${d.id} ${d.kind}`).join(', ')})` };
}
/** A number at `params/<key>` of a derived item, or undefined. */
export const paramOf = (d: Derived, key: string): JsonValue | undefined => (isObject(d.item['params']) ? d.item['params'][key] : undefined);

/** A builder item's row: its mesh in its own space and its world matrix (this suite's `world`). */
export interface MeshRow { id: string; positions: V3[]; world: M34 }
/** Every row of a `geometry` reply that carries a mesh, by ID. */
export function meshRows(reply: JsonObject, what: string): Map<string, MeshRow> {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const out = new Map<string, MeshRow>();
  arr(reply['items'], `${what}: items`).forEach((r, i) => {
    const o = obj(r, `${what}: items[${i}]`);
    if (o['positions'] === undefined) return;
    const id = String(o['id']);
    const positions = arr(o['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
    const w = arr(o['world'], `${what}: ${id}.world (this suite's field)`);
    expect(w.length, `${what}: ${id}.world has three rows`).toBe(3);
    const world = w.map((row, k) => {
      const q = arr(row, `${what}: ${id}.world[${k}]`);
      expect(q.length, `${what}: ${id}.world[${k}] has four numbers`).toBe(4);
      return q.map((x, j) => num(x, `${what}: ${id}.world[${k}][${j}]`));
    }) as M34;
    out.set(id, { id, positions, world });
  });
  return out;
}

/** A row's vertices placed in the world by its own `world`. */
export const placed = (row: MeshRow): V3[] => row.positions.map((p) => apply(row.world, p));
/** The axis-aligned box of `points` as they are. */
export function aabb(points: readonly V3[]): Box {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
  return { min, max };
}
/**
 * The matrix our item applies to the library's own local box of `size`, centred on its origin: W · B, where B takes
 * that box onto the box of our mesh in its own space (a scale per axis and a move), so a builder whose mesh sits
 * elsewhere in its own space is judged by where its item puts the library's geometry.
 */
export function effectiveWorld(row: MeshRow, size: V3): M34 {
  const local = aabb(row.positions);
  const s: V3 = [0, 1, 2].map((k) => (local.max[k]! - local.min[k]!) / size[k]!) as V3;
  const c: V3 = [0, 1, 2].map((k) => (local.max[k]! + local.min[k]!) / 2) as V3;
  const W = row.world;
  return [0, 1, 2].map((i) => [W[i]![0] * s[0], W[i]![1] * s[1], W[i]![2] * s[2], W[i]![0] * c[0] + W[i]![1] * c[1] + W[i]![2] * c[2] + W[i]![3]]) as M34;
}

/** The tool-word packs by the name tool-words.json gives them. */
export const toolPack = (name: string): Pack => {
  const p = (PACKS as Record<string, Pack>)[name];
  if (!p) throw Error(`tool-words.json names no pack ${name}`);
  return p;
};

/**
 * One tool-word case of tool-words.json against what its instance expanded to (`reply`) and built (`rows`): each
 * `expect` key, within 1e-9 (relative for power). Each failure names the case's ID and the field.
 */
export function toolCaseProblems(c: JsonObject, reply: JsonObject, rows: Map<string, MeshRow>): string[] {
  const id = String(c['id']);
  const e = obj(c['expect'], `${id}.expect`);
  const params = obj(c['params'], `${id}.params`);
  const out: string[] = [];
  const close = (a: number, b: number, rel = false): boolean => Math.abs(a - b) <= 1e-9 * (rel ? Math.abs(b) : 1);
  if (e['world'] === 'godot') {
    const built = derivedOf(reply, id).filter((d) => rows.has(d.id));
    if (built.length !== 1) return [`${id}: expands to ${built.length} built items, not one (${derivedOf(reply, id).map((d) => `${d.id} ${d.kind}`).join(', ') || 'nothing'})`];
    const A = effectiveWorld(rows.get(built[0]!.id)!, v3(e['size'], `${id}.expect.size`));
    const G = godotWorld(v3(params['position'], `${id}.params.position`), v3(params['rotation'], `${id}.params.rotation`), v3(params['scale'], `${id}.params.scale`));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      if (!close(A[i]![j]!, G[i]![j]!)) out.push(`${id}: ${j < 3 ? 'rotation' : 'position'}: world[${i}][${j}] is ${fmt(A[i]![j]!, 9)}, Godot's ${fmt(G[i]![j]!, 9)}`);
    }
    return out;
  }
  const { found, problem } = oneOfKind(reply, id, String(e['kind']));
  if (!found) return [problem!];
  if (e['power'] !== undefined) {
    const power = num(paramOf(found, 'power'), `${found.id}.params.power`);
    if (!close(power, e['power'] as number, true)) out.push(`${id}: power is ${fmt(power, 9)} lm, not ${fmt(e['power'] as number, 9)} lm (${String(c['conversion'])})`);
  }
  if (e['outer'] !== undefined) {
    const outer = num(paramOf(found, 'outer'), `${found.id}.params.outer`);
    if (!close(outer, e['outer'] as number)) out.push(`${id}: outer is ${fmt(outer, 9)}°, not ${fmt(e['outer'] as number, 9)}° (${String(c['conversion'])})`);
  }
  if (e['pos'] !== undefined || e['up'] !== undefined) {
    const at = found.item['at'];
    const pos = isObject(at) && at['pos'] !== undefined ? v3(at['pos'], `${found.id}.at.pos`) : ([0, 0, 0] as V3);
    if (e['pos'] !== undefined) {
      const want = v3(e['pos'], `${id}.expect.pos`);
      if ([0, 1, 2].some((k) => !close(pos[k]!, want[k]!))) out.push(`${id}: at.pos is ${fmtV(pos)} m, not ${fmtV(want)} m`);
    }
    if (e['up'] !== undefined) {
      const up = e['up'] as number, horizontal = e['horizontal'] as number;
      if (!close(pos[1], up)) out.push(`${id}: up: at.pos is ${fmtV(pos)} m, ${fmt(pos[1])} m up, not ${fmt(up)} m (${String(c['conversion'])})`);
      if (!close(Math.hypot(pos[0], pos[2]), horizontal)) out.push(`${id}: at.pos is ${fmtV(pos)} m, ${fmt(Math.hypot(pos[0], pos[2]))} m from the vertical axis, not ${fmt(horizontal)} m (${String(c['conversion'])})`);
    }
  }
  return out;
}

/**
 * A section of tool-words.json through `deep-show run`: its cases in one document (with the tool-word packs they
 * name), its refusal in a second; every case's and the refusal's failures.
 */
export function toolSection(bin: string, evidence: string, section: JsonObject, title: string): string[] {
  const cases = arr(section['cases'], `${title}: cases`).map((c, i) => obj(c, `${title}: cases[${i}]`));
  const refusal = obj(section['refusal'], `${title}: refusal`);
  const packs = [...new Set([...cases, refusal].map((c) => String(c['pack'])))].map(toolPack);
  const items: Record<string, JsonObject> = {};
  for (const c of cases) items[String(c['id'])] = { kind: c['recipe']!, params: c['params']! };
  const refused = String(refusal['id']);
  const [shownReply, geo, refusedReply] = runShow(bin, scenario(evidence, [DOC.a, DOC.b], [
    show(DOC.a, sceneDoc(title, items, packs)),
    geometryCall(DOC.a),
    show(DOC.b, sceneDoc(`${title}: a word with no mapping`, { [refused]: { kind: refusal['recipe']!, params: refusal['params']! } }, packs)),
  ], packs));
  admitted(shownReply!, title);
  const rows = meshRows(geo!, `geometry of ${title}`);
  return [...cases.flatMap((c) => toolCaseProblems(c, shownReply!, rows)), ...refusalProblems(refusedReply!, refused, String(refusal['word']))];
}

/**
 * The refusal a criterion asks for: the revision's issues or notices hold an entry at `items/<instance>/params/<word>`
 * (the word or value with no mapping, named), and the instance isn't drawn as anything else: a presented revision
 * holds no derived item of it. Each failure names the instance and the word.
 */
export function refusalProblems(reply: JsonObject, instance: string, word: string): string[] {
  const path = `items/${instance}/params/${word}`;
  const all = [...entries(reply, 'issues', `${instance}'s revision`), ...entries(reply, 'notices', `${instance}'s revision`)];
  const out: string[] = [];
  if (!all.some((e) => e.path === path || e.path.startsWith(`${path}/`))) {
    out.push(`${instance}: no issue or notice at ${path} refuses ${word}; the revision's issues and notices were ${shown(all.map((e) => e.raw))}`);
  }
  const drawn = derivedOf(reply, instance);
  if (reply['outcome'] === 'presented' && drawn.length > 0) {
    out.push(`${instance}: ${word} has no mapping, yet the instance is drawn as ${drawn.map((d) => `${d.id} ${d.kind}`).join(', ')}`);
  }
  return out;
}
