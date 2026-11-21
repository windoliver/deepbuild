// Test-side tools for the #2457 acceptance tests (README: The surface under test). They drive what #524's suite drives,
// with its worlds, scenes, times and calls and the ones those stand on (../524/helpers.ts and ../522/helpers.ts,
// imported read only): `deep-physics` (#2009's build line, once per file) asked `check` and `bake` on a scene's world,
// and `deep-show run` asked `deep_show` and `geometry`. They add this issue's own: a cube written as a glTF 2.0 binary
// from vertices and triangles held here, put in an evidence store by its SHA-256, placed by a `mesh.asset@1` item, made
// the source of a soft volume, and the call field that names that store to `deep-physics`. Nothing here stands in for
// the asset reader, the weld, the physics module, the backend or the skin: every issue, count, particle and drawn
// vertex read here is the program's own, and every expected value is worked here from the fixture's own vertices and
// triangles and from the issue's numbers.
//
// No function here asserts. What a program answers and what a judge finds wrong with it come back as text, so each
// test's failing assertion is in its own file. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { REPO, TARGET, TIMEOUT, cargoError, isObject, show, type JsonObject, type JsonValue } from '../522/helpers.ts';
import { FPS, GROUND, cross, dot, sceneDoc, skin, softWorld, stepAt, weld, type V3 } from '../524/helpers.ts';

export { TIMEOUT, scenario, show, type JsonObject, type JsonValue } from '../522/helpers.ts';
export { FPS, FRAME, SAMPLED, dist, geometryCall, showCall, stepAt, type V3 } from '../524/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = { 1: '#2457.abde2f93', 2: '#2457.d36df7b1' } as const;

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: Fixtures): a cube as a glTF file holds it, from vertices and triangles held here.

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }

/** The cube's side, m, and the corner of it nearest −x, −y, −z, in the file's own space: neither 1 m nor at the origin. */
export const SIDE = 0.5;
export const LOW: V3 = [0.25, 0, -1.5];
/** Where the scene places the asset's item (`at.pos`), m: the cube's underside 0.5 m above the ground plane y = 0. */
export const AT: V3 = [1.5, 0.5, 0.75];

/**
 * A cube's corner c = 4 × (x high) + 2 × (y high) + (z high), and each face's four corners counter-clockwise seen from
 * outside (glTF's front face; +Y up, right-handed), so every triangle's normal points out.
 */
const FACES = {
  '+y': [2, 3, 7, 6], '-x': [0, 1, 3, 2], '+z': [1, 5, 7, 3], '-y': [0, 4, 5, 1], '+x': [4, 6, 7, 5], '-z': [0, 2, 6, 4],
} as const;
export type Face = keyof typeof FACES;
/** The order the file holds its faces in, and the corner of its ring each starts from. */
const FILE: readonly (readonly [Face, number])[] = [['+y', 0], ['-x', 1], ['+z', 2], ['-y', 3], ['+x', 1], ['-z', 2]];
const corner = (c: number): V3 => [LOW[0] + SIDE * ((c >> 2) & 1), LOW[1] + SIDE * ((c >> 1) & 1), LOW[2] + SIDE * (c & 1)];

/**
 * The cube as its file holds it: each face its own four vertices (no face shares a vertex with another, so the file
 * holds 24 where the cube has 8 corners), the faces in `FILE`'s order; each face two triangles, split along one
 * diagonal on every other face and along the other on the rest; the triangles listed last face first, so the order a
 * vertex first appears in among the indices is not its order among the vertices. `without` leaves one face out,
 * vertices and triangles both.
 */
export function cubeMesh(without?: Face): Mesh {
  const positions: V3[] = [];
  const faces: [number, number, number][][] = [];
  FILE.forEach(([face, start], i) => {
    if (face === without) return;
    const b = positions.length;
    for (let k = 0; k < 4; k++) positions.push(corner(FACES[face][(start + k) % 4]!));
    faces.push(i % 2 === 0 ? [[b, b + 1, b + 2], [b, b + 2, b + 3]] : [[b + 1, b + 2, b + 3], [b + 1, b + 3, b]]);
  });
  return { positions, triangles: faces.reverse().flat() };
}
/** The closed cube, and the same cube with the face the file holds first, its top, left out. */
export const CUBE = cubeMesh();
export const OPEN = cubeMesh('+y');

/**
 * A mesh's welded vertices (the design's and #524's rule: positions equal to 1e-6 m are one vertex, numbered from 0 in
 * the order the source's vertices first hold each), the welded vertex of each file vertex, and its triangles over the
 * welded vertices. Worked here from the fixture alone.
 */
export interface Welded { of: number[]; points: V3[]; triangles: [number, number, number][] }
export function welded(m: Mesh): Welded {
  const { of, welded: points } = weld(m.positions);
  return { of, points, triangles: m.triangles.map((t) => [of[t[0]]!, of[t[1]]!, of[t[2]]!]) };
}
const edgeKey = (a: number, b: number): string => `v${Math.min(a, b)}-v${Math.max(a, b)}`;
/** The open edges of triangles over welded vertices, each as `v{i}-v{j}` with i < j: an edge that isn't on exactly two triangles. */
export function openEdges(triangles: readonly (readonly [number, number, number])[]): string[] {
  const uses = new Map<string, number>();
  for (const t of triangles) for (let e = 0; e < 3; e++) { const k = edgeKey(t[e]!, t[(e + 1) % 3]!); uses.set(k, (uses.get(k) ?? 0) + 1); }
  return [...uses].filter(([, n]) => n !== 2).map(([k]) => k).sort();
}
/** A named edge `["v{i}", "v{j}"]` as `openEdges` writes it, or null when it isn't two different welded vertices of `count`. */
export function namedEdge(edge: JsonValue | undefined, count: number): string | null {
  if (!Array.isArray(edge) || edge.length !== 2) return null;
  const ends = edge.map((a) => (typeof a === 'string' ? /^v(0|[1-9]\d*)$/.exec(a) : null)).map((m) => (m ? Number(m[1]) : NaN));
  const [a, b] = [ends[0]!, ends[1]!];
  return Number.isInteger(a) && Number.isInteger(b) && a !== b && a < count && b < count ? edgeKey(a, b) : null;
}
/**
 * The volume a closed mesh encloses, m³, from its vertices' positions and its triangles (each wound outward): the sum
 * over its triangles of a · (b × c) ÷ 6. Measured here, from positions; no backend reports it.
 */
export function enclosed(points: readonly V3[], triangles: readonly (readonly [number, number, number])[]): number {
  return triangles.reduce((v, [a, b, c]) => v + dot(points[a]!, cross(points[b]!, points[c]!)) / 6, 0);
}
/** A point of the asset's own space where the scene draws it: the item has a position and no turn or scale. */
export const placed = (p: V3): V3 => [p[0] + AT[0], p[1] + AT[1], p[2] + AT[2]];

/**
 * `m` as a glTF 2.0 binary: a 12-byte header, a JSON chunk padded with spaces and a binary chunk; one scene, one node
 * (node 0) with no transform, its mesh one triangle primitive of f32 POSITION and u32 indices, nothing else.
 */
export function glb(m: Mesh): Buffer {
  const pos = Buffer.alloc(m.positions.length * 12);
  m.positions.forEach((p, i) => p.forEach((x, k) => pos.writeFloatLE(x, i * 12 + k * 4)));
  const idx = Buffer.alloc(m.triangles.length * 12);
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const bound = (pick: (...xs: number[]) => number): number[] => [0, 1, 2].map((k) => pick(...m.positions.map((p) => Math.fround(p[k]!))));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length, type: 'VEC3', min: bound(Math.min), max: bound(Math.max) },
      { bufferView: 1, componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length }],
  };
  const text = Buffer.from(JSON.stringify(doc), 'utf8');
  const json = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat([pos, idx]);
  const chunk = (body: Buffer, kind: number): Buffer => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  return Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}
/** Puts `bytes` into the evidence store at `root` by its layout, `<first 2 hex>/<other 62 hex>` of its SHA-256, which it returns. */
export function seed(root: string, bytes: Buffer): string {
  const h = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// Scenes and worlds (README: The surface under test, Fixtures). The world is #524's soft cube's, its ball left out:
// g = 9.81 m/s², 120 Hz, 4 substeps, the ground plane y = 0, a volume with inflate 1.2, 1 kg a particle, stretch 8 Hz.

/** A world a call names: world `id` of `scene`, whose mesh assets are in the evidence store `evidence`. */
export interface World { scene: JsonObject; id: string; evidence: string }
/** A `mesh.asset@1` item of the glTF stored as `sha`, its node 0, at `pos`. */
export const assetItem = (sha: string, pos: V3): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node: 0 }, at: { pos } });
/** A soft volume from item `from`: `inflate: 1.2`, and #524's cube's masses, stretch and contact material. */
export const volume = (from: string): JsonObject =>
  ({ shape: 'volume', from, inflate: 1.2, masses: { default: 1 }, stretch: { hz: 8, damping_ratio: 0.5 }, contact_material: 'jelly' });
const about = (title: string): JsonObject => ({ description: `${title}: a #2457 acceptance fixture.` });

/** The soft body, its world, its source item and its skin output, by ID. */
export const SOFT = 'jelly';
export const LAB = 'lab';
export const ITEM = 'cube';
/**
 * Criterion 1's scene: the closed cube asset, seeded into the evidence store `store`, placed as item `cube` at `AT`;
 * the world `lab` over the ground plane, whose soft volume `jelly` is built from `cube` and drawn back on it by the
 * skin output `skin` (`item: auto`, for a volume its source); 4 s at 50 fps.
 */
export function softCube(store: string): World {
  const sha = seed(store, glb(CUBE));
  const doc = softWorld({ bodies: { ground: GROUND }, soft: { [SOFT]: volume(ITEM) }, outputs: { skin: skin(SOFT, 'auto') } });
  return { scene: sceneDoc('Soft cube asset', '4s', FPS, { [ITEM]: assetItem(sha, AT) }, { [LAB]: doc }, about('Soft cube asset')), id: LAB, evidence: store };
}
/** The closed cube asset alone, as `softCube` places it, with no world: where each of its vertices is drawn at rest. */
export function cubeAlone(store: string): JsonObject {
  return sceneDoc('Cube asset alone', '4s', FPS, { [ITEM]: assetItem(seed(store, glb(CUBE)), AT) }, {}, about('Cube asset alone'));
}
/**
 * Criterion 2's scene: the closed cube asset as item `shut`, the open one as `open`, and a built cube with its top
 * left out as `lathe` (#524's: a `lathe@1` of 4 segments from 45°, 1 m square and 1 m tall, its outline through the
 * axis at the bottom only, `caps: none`); and a world for a soft volume from each, `closed`, `holed` and `built`.
 */
export function openAndClosed(store: string): { closed: World; holed: World; built: World } {
  const world = (from: string): JsonObject => softWorld({ bodies: { ground: GROUND }, soft: { [SOFT]: volume(from) } });
  const r = Math.SQRT1_2;
  const scene = sceneDoc('Open and closed cube assets', '4s', FPS, {
    shut: assetItem(seed(store, glb(CUBE)), [-2, 0.5, 0]),
    open: assetItem(seed(store, glb(OPEN)), [0, 0.5, 0]),
    lathe: { kind: 'lathe@1', params: { outline: [[0, 0, false], [r, 0, false], [r, 1, false]], segments: 4, from: 45, caps: 'none' }, at: { pos: [3, 0.5, 0] } },
  }, { closed: world('shut'), holed: world('open'), built: world('lathe') }, about('Open and closed cube assets'));
  const of = (id: string): World => ({ scene, id, evidence: store });
  return { closed: of('closed'), holed: of('holed'), built: of('built') };
}

/** `check` and `bake` on a scene's world (#1918's form), with the evidence store its mesh assets are read from. */
const on = (w: World): JsonObject => ({ scene: w.scene, world: w.id, evidence: w.evidence });
export const check = (w: World): JsonObject => ({ call: 'check', ...on(w) });
export const bake = (w: World, steps: number): JsonObject => ({ call: 'bake', ...on(w), steps });

// ---------------------------------------------------------------------------------------------------
// The programs: `deep-physics` (JSON lines in, one reply per line) and `deep-show run` (one scenario line, one answer).

/** What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what it did instead. */
export interface Asked { what: string; problem: string; replies: JsonObject[] }
const MINUTES = (ms: number): number => ms / 60_000;
const MAX = 1 << 30;

function started(what: string, run: ReturnType<typeof spawnSync>, limit: number): string {
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${MINUTES(limit)} minutes; this is not a pass`);
  if (run.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${run.error.message}`);
  const [out, err] = [String(run.stdout ?? ''), String(run.stderr ?? '')];
  return run.status === 0 ? '' : `${what} exits ${String(run.status)}, not 0; stdout: ${out.trim().slice(0, 600)}; stderr: ${err.trim().slice(-600)}`;
}
function parsed(line: string): JsonObject | null {
  try { const v = JSON.parse(line) as JsonValue; return isObject(v) ? v : null; } catch { return null; }
}

/** One cargo binary of this checkout; `error` is cargo's when its build failed. */
interface Bin { bin: string; error: string; line: string }
/**
 * Builds `name` once per file and copies it out of the target folder: before the file's tests when `first`, else the
 * first time a test asks, so a test whose earlier assertion fails builds nothing more. With no cargo on this machine
 * the build throws `BLOCKED:` (#2009's helper) in the test that asks.
 */
function useBinary(name: string, args: string[], first: boolean): () => Bin {
  let dir = '';
  let built: Bin | undefined;
  const build = (): Bin => {
    if (!built) {
      const error = cargoError(args);
      if (!dir) dir = mkdtempSync(join(tmpdir(), 'deep-2457-bin-'));
      if (error === '') copyFileSync(join(TARGET, 'debug', name), join(dir, name));
      built = { bin: join(dir, name), error, line: `cargo ${args.join(' ')}` };
    }
    return built;
  };
  if (first) beforeAll(() => { try { build(); } catch { /* each test reports it */ } }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; built = undefined; }, TIMEOUT);
  return build;
}

/**
 * `deep-physics` (#2009's build, `cargo build --locked --bin deep-physics`), built before the file's tests. The
 * function it returns runs `calls` through one process: one JSON reply per call, in order.
 */
export function usePhysics(): (calls: JsonObject[]) => Asked {
  const build = useBinary('deep-physics', ['build', '--locked', '--bin', 'deep-physics'], true);
  return (calls) => {
    const what = 'deep-physics';
    const b = build();
    if (b.error !== '') return { what, problem: `${what} doesn't build (${b.line}): ${b.error}`, replies: [] };
    const limit = TIMEOUT - 300_000;
    const run = spawnSync(b.bin, [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: MAX, timeout: limit, killSignal: 'SIGKILL' });
    const problem = started(what, run, limit);
    if (problem !== '') return { what, problem, replies: [] };
    const lines = run.stdout.split('\n').filter((l) => l !== '');
    if (lines.length !== calls.length) return { what, problem: `${what} wrote ${lines.length} replies to ${calls.length} calls; stdout: ${run.stdout.slice(0, 600)}`, replies: [] };
    const replies = lines.map(parsed);
    const bad = replies.findIndex((r) => r === null);
    if (bad >= 0) return { what, problem: `${what}: reply ${bad} isn't a JSON object: ${lines[bad]!.slice(0, 300)}`, replies: [] };
    return { what, problem: '', replies: replies as JsonObject[] };
  };
}

const SHOW_LIMIT = 1_800_000;
/**
 * `deep-show` (#524's build, `cargo build --locked -p deep-show --bin deep-show`), built the first time a test asks.
 * The function it returns plays one scenario through `deep-show run` (#393's convention): its one answer's replies,
 * one per call.
 */
export function useShow(): (sc: JsonObject) => Asked {
  const build = useBinary('deep-show', ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'], false);
  return (sc) => {
    const what = 'deep-show run';
    const b = build();
    if (b.error !== '') return { what, problem: `deep-show doesn't build (${b.line}): ${b.error}`, replies: [] };
    const run = spawnSync(b.bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: MAX, timeout: SHOW_LIMIT, killSignal: 'SIGKILL' });
    const problem = started(what, run, SHOW_LIMIT);
    if (problem !== '') return { what, problem, replies: [] };
    const lines = run.stdout.split('\n').filter((l) => l !== '');
    const answer = lines.length === 1 ? parsed(lines[0]!) : null;
    if (!answer || answer['ok'] !== true || !Array.isArray(answer['replies'])) return { what, problem: `${what} doesn't answer the scenario ok with its replies: ${run.stdout.slice(0, 800)}`, replies: [] };
    const calls = Array.isArray(sc['calls']) ? sc['calls'].length : 0;
    const replies = answer['replies'].filter(isObject);
    if (replies.length !== calls || replies.length !== answer['replies'].length) return { what, problem: `${what} wrote ${answer['replies'].length} replies to ${calls} calls: ${show(answer).slice(0, 600)}`, replies: [] };
    return { what, problem: '', replies };
  };
}

/** A fresh folder per call (an evidence store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2457-')); made.push(d); return d; };
}
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB2457D0${String(n).padStart(16, '0')}`;

// ---------------------------------------------------------------------------------------------------
// Reading replies (#524's surface: `check`'s issues, `soft` and `backend`; a bake's `particles`; `geometry`'s rows).

const issueText = (i: JsonObject): string => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`;
const issuesOf = (reply: JsonObject | undefined): JsonObject[] => (Array.isArray(reply?.['issues']) ? reply['issues'].filter(isObject) : []);
/** Why a reply isn't what was asked for, in its own words: its issues' codes, paths and sentences. */
const refusal = (reply: JsonObject | undefined): string => { const i = issuesOf(reply); return i.length ? i.map(issueText).join('; ') : show(reply); };

/** A `check`'s error issues; or, as text, that the check didn't run. */
export function errorsOf(reply: JsonObject | undefined): JsonObject[] | string {
  if (reply?.['ok'] !== true || !Array.isArray(reply['issues'])) return `the check didn't answer {ok: true, issues}: ${show(reply)}`;
  return issuesOf(reply).filter((i) => i['severity'] === 'error');
}
/** Everything that keeps a `check` from admitting its world: each error issue as text. Admitted: none. */
export function refusals(reply: JsonObject | undefined): string[] {
  const e = errorsOf(reply);
  return typeof e === 'string' ? [e] : e.map(issueText);
}
/** The error issue of a `check` that names an edge in `edge`, with its code; or, as text, why there is none. */
export function edgeIssue(reply: JsonObject | undefined): { code: string; edge: JsonValue; issue: JsonObject } | string {
  const e = errorsOf(reply);
  if (typeof e === 'string') return e;
  if (e.length === 0) return 'the check admits the world: no error issue';
  const named = e.find((i) => Array.isArray(i['edge']));
  return named ? { code: String(named['code']), edge: named['edge']!, issue: named } : `no error issue names an edge in \`edge\`: ${e.map(issueText).join('; ')}`;
}

/** What a `check` says the backend built: each soft body's shape and particle count, and the backend's own counts. */
export interface Built { soft: Record<string, { shape: JsonValue; particles: JsonValue }>; softBodies: JsonValue; particles: JsonValue }
export function builtOf(reply: JsonObject | undefined): Built | string {
  const [soft, backend] = [reply?.['soft'], reply?.['backend']];
  if (!isObject(soft) || !isObject(backend)) return `the check doesn't answer \`soft\` and \`backend\` (what the backend built): ${refusal(reply)}`;
  const each: Built['soft'] = {};
  for (const [id, s] of Object.entries(soft)) each[id] = { shape: isObject(s) ? s['shape'] ?? null : null, particles: isObject(s) ? s['particles'] ?? null : null };
  return { soft: each, softBodies: backend['soft_bodies'] ?? null, particles: backend['particles'] ?? null };
}

/** A soft body's particles in a bake: its addresses, and positions[k][i], particle addresses[i]'s position after k steps. */
export interface Particles { addresses: string[]; positions: V3[][] }
const v3 = (v: JsonValue | undefined): V3 | null =>
  (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[] as V3) : null);
/** Soft body `id`'s particles over a bake of `steps` steps (the built state, then one after each step); or, as text, why not. */
export function particlesOf(reply: JsonObject | undefined, id: string, steps: number): Particles | string {
  if (reply?.['ok'] !== true) return `the bake is refused: ${refusal(reply)}`;
  const p = isObject(reply['particles']) ? reply['particles'][id] : undefined;
  if (!isObject(p) || !Array.isArray(p['addresses']) || !Array.isArray(p['positions'])) return `the bake answers no particles.${id} {addresses, positions}: ${show(reply['particles']).slice(0, 400)}`;
  const addresses = p['addresses'].map(String);
  if (p['positions'].length !== steps + 1) return `particles.${id}.positions holds ${p['positions'].length} states, not the built one and one after each of ${steps} steps`;
  const positions: V3[][] = [];
  for (const [k, state] of p['positions'].entries()) {
    const row = Array.isArray(state) ? state.map(v3) : [];
    if (row.length !== addresses.length || row.some((x) => x === null)) return `particles.${id}.positions[${k}] isn't one [x, y, z] per address: ${show(state).slice(0, 300)}`;
    positions.push(row as V3[]);
  }
  return { addresses, positions };
}
/**
 * The particles `v0` … `v{count − 1}` in that order: positions[k][i] is particle `v{i}`'s after k steps. Or, as text,
 * which address is missing or held twice.
 */
export function byWelded(p: Particles, count: number): V3[][] | string {
  const at = Array.from({ length: count }, (_, i) => p.addresses.indexOf(`v${i}`));
  const missing = at.findIndex((j) => j < 0);
  if (missing >= 0 || new Set(p.addresses).size !== p.addresses.length) return `the particles aren't addressed v0 to v${count - 1}, each once: ${p.addresses.join(', ')}`;
  return p.positions.map((state) => at.map((j) => state[j]!));
}
/**
 * Where a frame at `t` flicks shows each particle (Physics output): k = ⌊t ÷ step⌋ and α = (t − t(k)) ÷ step, exact
 * from flicks, its position lerped between steps k and k + 1; with the two steps' own positions. Null past the bake.
 */
export function shownAt(states: readonly V3[][], t: number): { at: V3[]; before: V3[]; after: V3[]; alpha: number } | null {
  const { k, alpha } = stepAt(t);
  const before = states[k];
  const after = alpha === 0 ? before : states[k + 1];
  if (!before || !after) return null;
  return { at: before.map((a, i) => [0, 1, 2].map((c) => a[c]! + alpha * (after[i]![c]! - a[c]!)) as V3), before, after, alpha };
}

/** Whether a `deep_show` reply presented its document; else its issues, as text. */
export function presented(reply: JsonObject | undefined): string {
  return reply?.['outcome'] === 'presented' ? '' : `outcome ${show(reply?.['outcome'])}: ${refusal(reply)}`;
}
/**
 * Where a `geometry` reply draws each vertex of item `id`, in world metres: its `positions` through the row's `world`
 * matrix (3 × 4 rows; identity when absent), as #524's suite reads them. Or, as text, why it can't be read.
 */
export function drawn(reply: JsonObject | undefined, id: string): V3[] | string {
  if (reply?.['code'] !== undefined || !Array.isArray(reply?.['items'])) return `the geometry call is refused: ${show(reply).slice(0, 400)}`;
  const row = reply['items'].filter(isObject).find((r) => r['id'] === id);
  if (!row || !Array.isArray(row['positions'])) return `the geometry reply holds no positions of ${id}: ${show(reply).slice(0, 400)}`;
  const w = row['world'];
  const m = Array.isArray(w) ? w.map((r) => (Array.isArray(r) ? r.map(Number) : [])) : null;
  if (m && (m.length !== 3 || m.some((r) => r.length !== 4 || r.some((x) => !Number.isFinite(x))))) return `${id}'s world isn't a 3 × 4 matrix: ${show(w)}`;
  const out: V3[] = [];
  for (const [k, v] of row['positions'].entries()) {
    const p = v3(v);
    if (!p) return `${id}'s positions[${k}] isn't [x, y, z]: ${show(v)}`;
    out.push(m ? ([0, 1, 2].map((i) => m[i]![0]! * p[0] + m[i]![1]! * p[1] + m[i]![2]! * p[2] + m[i]![3]!) as V3) : p);
  }
  return out;
}
/** A position to the tenth of a micrometre, for messages. */
export const xyz = (p: readonly number[]): string => `(${p.map((x) => x.toFixed(7)).join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// The judges of criterion 1 (README: Criteria to tests). Each returns what is wrong, as sentences; none asserts.

/** The issue's numbers: `inflate: 1.2`, "within 2%", "within 1e-6 m"; a welded vertex and its particle agree to the weld's own 1e-6 m. */
export const INFLATE = 1.2;
export const WITHIN = 0.02;
export const BOUND = 1e-6;
/** "Once settled", as #524's suite reads it: every step from 2.5 s to 3 s, steps 300 to 360 at 120 Hz. */
export const SETTLED = Array.from({ length: 61 }, (_, i) => 300 + i);
/** Whether `v` m³ is `INFLATE` × `rest` m³ within 2%. */
export const holds = (v: number, rest: number): boolean => Math.abs(v - INFLATE * rest) <= WITHIN * INFLATE * rest;

/** Clause 1: as built, particle v{i} is the asset's welded vertex i (`points`, the asset's own space) where the item is drawn. */
export function builtFailures(asBuilt: readonly V3[], points: readonly V3[]): string[] {
  return points.map((q, i) => ({ i, want: placed(q), got: asBuilt[i]! }))
    .filter(({ want, got }) => !(Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) <= BOUND))
    .map(({ i, want, got }) => `particle v${i} is built at ${xyz(got)}, not within 1e-6 m of the asset's welded vertex ${i} as the item is drawn, ${xyz(want)}`);
}
/** Clause 2: at each settled step the particles enclose `INFLATE` × `rest` within 2%; each failure names the body and the step. */
export function settledFailures(states: readonly V3[][], triangles: Welded['triangles'], rest: number, id: string): string[] {
  const [lo, hi] = [INFLATE * rest * (1 - WITHIN), INFLATE * rest * (1 + WITHIN)];
  return SETTLED.map((k) => ({ k, state: states[k] })).flatMap(({ k, state }) => {
    if (!state) return [`${id}: the bake holds no step ${k}`];
    const v = enclosed(state, triangles);
    return holds(v, rest) ? [] : [`${id} holds ${v.toFixed(6)} m³ at step ${k}, ${(v / rest).toFixed(4)} × its rest ${rest} m³, not ${INFLATE} × it within 2% (${lo.toFixed(5)} to ${hi.toFixed(5)} m³)`];
  });
}

/** One sampled frame: where it shows each of the asset's file vertices (its particle's interpolated position), and that particle at the step before and after. */
export interface Frame { f: number; alpha: number; at: V3[]; before: V3[]; after: V3[] }
/** The 20 sampled frames for a mesh whose file vertex k welds to `of[k]`; or, as text, the frames the bake doesn't reach. */
export function framesOf(states: readonly V3[][], of: readonly number[], sampled: readonly number[], frame: number): Frame[] | string {
  const out: Frame[] = [];
  const past: number[] = [];
  for (const f of sampled) {
    const s = shownAt(states, f * frame);
    if (!s) { past.push(f); continue; }
    out.push({ f, alpha: s.alpha, at: of.map((i) => s.at[i]!), before: of.map((i) => s.before[i]!), after: of.map((i) => s.after[i]!) });
  }
  return past.length ? `the bake doesn't hold the two steps around frames ${past.join(', ')}` : out;
}
const apart = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The frames at which no vertex is more than 1e-6 m from `rest`: there a skin that draws the asset at rest would pass. */
export const stillFrames = (frames: readonly Frame[], rest: readonly V3[]): number[] =>
  frames.filter((x) => !x.at.some((q, k) => apart(q, rest[k]!) > BOUND)).map((x) => x.f);
/** The frames between two steps at which some vertex is more than 1e-6 m from both steps' positions: there a skin that holds a step fails. */
export const betweenFrames = (frames: readonly Frame[]): number[] =>
  frames.filter((x) => x.alpha !== 0 && x.at.some((q, k) => apart(q, x.before[k]!) > BOUND && apart(q, x.after[k]!) > BOUND)).map((x) => x.f);
/** Clause 3: reply s draws each vertex of item `id` within 1e-6 m of where frame s shows its particle. */
export function skinFailures(frames: readonly Frame[], replies: readonly (JsonObject | undefined)[], id: string, of: readonly number[]): string[] {
  const failures: string[] = [];
  frames.forEach((x, s) => {
    const d = drawn(replies[s], id);
    if (typeof d === 'string') { failures.push(`frame ${x.f}: ${d}`); return; }
    if (d.length !== x.at.length) { failures.push(`frame ${x.f}: ${id} is drawn with ${d.length} vertices, the asset has ${x.at.length}`); return; }
    d.forEach((q, k) => {
      const g = apart(q, x.at[k]!);
      if (!(g <= BOUND)) failures.push(`frame ${x.f}: vertex ${k} (v${of[k]}) is drawn at ${xyz(q)}, ${g.toExponential(2)} m from its particle's interpolated ${xyz(x.at[k]!)}`);
    });
  });
  return failures;
}
