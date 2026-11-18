// Test-side tools for the #1636 acceptance tests (README: Assumed surfaces). They drive the binaries as the sibling
// suites do: `deep-show run` (#393) with `deep_show`, #420's `geometry` (its `estimate_only` and `timings`) and #405's
// claims and `verdict`, built on this Mac and, for criterion 1, for Linux x86_64 in a linux/amd64 container; and
// `deep-gpu run` (#377) with `view3d` (#378, #2016's `sway`, `counts`, `capture`) and #425's `simplify`. Copied here,
// since suites never import each other: the runners and builds (#2017's), the Linux build (#225's redraft), the claim
// and verdict rows (#2013's), the look and the PNG and APNG coding (#2017's). The judges below measure the built mesh
// the binaries answer against the issue's closed forms; nothing here stands in for the builder, the audit, the simplify
// job, the sway or the renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1636 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#1636.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1636.d6af27c1', 2: '#1636.92e93acb', 3: '#1636.1bc36a69', 4: '#1636.da99f8e9', 5: '#1636.03118491',
  6: '#1636.0863f261', 7: '#1636.3164f1b8', 8: '#1636.2d5eb798', 9: '#1636.3cc39a14',
} as const;
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
export function int(v: JsonValue | undefined, what: string): number {
  const n = num(v, what);
  expect(Number.isInteger(n) && n >= 0, `${what} is a whole number ≥ 0, got ${n}`).toBe(true);
  return n;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${brief(v, 200)}`).toBe('string');
  return v as string;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A leg that needs what this machine lacks fails with this and one unblock ask, never passes. */
export function blocked(reason: string, ask: string): never {
  return expect.fail(`BLOCKED: ${reason}. Unblock: ${ask}. This is not a pass`);
}
/** What the GPU computes and draws is drawn on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file, debug info and incremental builds off, copied out of the target folder.

export type Bin = 'deep-show' | 'deep-gpu';
const FEATURES: Record<Bin, string[]> = { 'deep-show': ['--no-default-features', '--features', 'full'], 'deep-gpu': [] };
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const cargoArgs = (bin: Bin, release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', bin, ...FEATURES[bin]];
const quiet = (stderr: string): string => stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n');

/** Builds `bin` (debug, or release) and copies it into `dir`: its path, or cargo's error. */
export function buildInto(bin: Bin, release: boolean, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin, release);
  const env = { ...process.env, ...CARGO_ENV, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}` };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) return { path: '', error: `cargo ${args.join(' ')} failed:\n${quiet(r.stderr ?? '').slice(-4000)}` };
  const path = join(dir, `${bin}${release ? '-release' : ''}`);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', bin), path);
  return { path, error: '' };
}
/** Builds the debug `bins` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1636-bin-'));
    for (const b of bins) made.set(b, buildInto(b, false, dir));
  }, 3 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin, false).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** Fresh folders for a test (evidence stores, outputs, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1636-')); made.push(d); return d; };
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393).

/** The wrong programs this suite plants, each reachable only through deep-show's scenario `planted` (README). */
export type Planted = 'tree_child_keeps_parent_radius' | 'tree_curvature_frames';
export const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1636D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1636C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1636Q', n)}`;

/** A scenario: the agent's session, its process tree, one panel per document, and the scenario fields asked. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], more: { threads?: number; planted?: Planted; claims?: JsonObject } = {}): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: trees', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(more.threads === undefined ? {} : { threads: more.threads }),
    ...(more.planted === undefined ? {} : { planted: more.planted }),
    ...(more.claims === undefined ? {} : { claims: more.claims }),
    calls,
  };
}
interface Ran { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
const ran = (r: ReturnType<typeof spawnSync>): Ran => ({
  status: r.status, signal: r.signal, timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
  stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? r.error?.message ?? ''),
});
/** An answer line's replies: exit 0, one line, `ok`, one reply per call. */
function repliesOf(s: Ran, sc: JsonObject, name: string): JsonObject[] {
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  const lines = s.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const out = obj(answer, `${name}: the answer`);
  const planted = typeof sc['planted'] === 'string' ? ` (its planted program is ${sc['planted']})` : '';
  expect(out['ok'], `${name} accepted the scenario${planted}: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((v, i) => obj(v, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}
/** One `deep-show run` process on this machine: its replies, one per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  return repliesOf(ran(r), sc, 'deep-show run');
}
/** The working agent's deep_show of a whole revision (#393's agent form). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #420's `geometry` call on `items` at 0 s; `more` adds `estimate_only` or `timings`. */
export const geometry = (doc: string, items: readonly string[], more: JsonObject = {}): JsonObject => ({ call: 'geometry', doc, items: [...items], t: '0s', ...more });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject => ({ session: SESSION, deliverables: [doc], requirements: [{ id: req, check }] });
/** The show was presented: no error issue, and no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const bad = [
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${brief(reply['outcome'])}: ${brief(reply, 1500)}`]),
  ];
  expect(bad, `${what} is presented: ${bad.join('; ')}`).toEqual([]);
}
/** A `geometry` reply's row for `id`, answered and not refused. */
export function rowOf(reply: JsonObject, id: string, what: string): JsonObject {
  expect(reply['code'], `${what}: geometry answered, not refused: ${brief(reply)}`).toBeUndefined();
  const row = arr(reply['items'], `${what}: items`).filter(isObject).find((r) => r['id'] === id);
  expect(row, `${what}: the reply has a row for ${id}`).toBeDefined();
  return row!;
}
/** The vertex count an `estimate_only` row declares from the params, nothing built (README: Assumed surfaces 4). */
export function declaredOf(reply: JsonObject, id: string, what: string): number {
  expect(reply['builds'], `${what}: estimate_only builds nothing`).toBe(0);
  return int(obj(rowOf(reply, id, what)['declared'], `${what}: ${id}.declared`)['vertices'], `${what}: ${id}.declared.vertices`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const sc: JsonObject = { out, calls };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  return repliesOf(ran(r), sc, 'deep-gpu run');
}
/** A `view3d` reply's frames, in order from `from`; INCONCLUSIVE where the binary says the platform can't draw. */
export function framesOf(reply: JsonObject, count: number, what: string, from = 0): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.map((f) => f['frame']), `${what}: frames ${from} … ${from + count - 1}, in order`).toEqual(Array.from({ length: count }, (_, k) => from + k));
  return frames;
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures). Metres, degrees, +Y up.

/** `tree@1`'s params (README: Assumed surfaces 1). */
export interface TreeParams {
  seed: number; levels: number; length: number; radius: number; exponent?: number; split: number; angle: number; roll: number; gravity: number;
  leaves: { per_twig: number; size: number }; segments: number; rings: number;
}
/** The fixture tree: 4 levels, 3 children a fork, so 40 branches, 13 forks, 36 twigs and 216 leaf cards. */
export const FIXTURE: TreeParams = {
  seed: 1636, levels: 4, length: 4, radius: 0.15, split: 3, angle: 40, roll: 30, gravity: 0.3, leaves: { per_twig: 6, size: 0.12 }, segments: 8, rings: 8,
};
/** Criterion 8's tree: 4 levels, 4 children a fork, 12 sides and 10 rings, about 20,000 triangles. */
export const BUDGET_TREE: TreeParams = { ...FIXTURE, seed: 2026, split: 4, segments: 12, rings: 10 };
/** What the topology gives (README: Assumed surfaces 2): branches, forks, twigs (level 3 and up) and tips. */
export function topology(p: TreeParams): { branches: number; forks: number; twigs: number; tips: number } {
  const at = (level: number): number => p.split ** (level - 1);
  let branches = 0; let forks = 0; let twigs = 0;
  for (let l = 1; l <= p.levels; l++) { branches += at(l); if (l < p.levels) forks += at(l); if (l >= 3) twigs += at(l); }
  return { branches, forks, twigs, tips: at(p.levels) };
}
/** A `tree@1` item: its tubes in `bark`, its cards in `leaf` (Object: `materials` by named part). */
export function treeItem(p: TreeParams, more: JsonObject = {}): JsonObject {
  const params: JsonObject = {
    seed: p.seed, levels: p.levels, length: p.length, radius: p.radius, split: p.split, angle: p.angle, roll: p.roll, gravity: p.gravity,
    leaves: { per_twig: p.leaves.per_twig, size: p.leaves.size }, segments: p.segments, rings: p.rings,
  };
  if (p.exponent !== undefined) params['exponent'] = p.exponent;
  return { kind: 'tree@1', params, material: 'bark', materials: { leaves: 'leaf' }, ...more };
}
export const material = (base: V3, roughness = 0.8): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
export const camera = (position: V3, target: V3, fov: number, near = 0.1, far = 2000): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near, far } });
/** A sun: it shines along its local −Z, so `at.rot` [−e, y, 0] puts it e degrees above the horizon. */
export const sun = (rot: V3, shadow = false): JsonObject => ({ kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow }, at: { rot } });
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
/** A flat `plate@1` of one cell, `size` m, centred on `pos`, facing +Y. */
export const ground = (size: [number, number], pos: V3): JsonObject => ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos }, material: 'soil' });
const MATERIALS = (): Record<string, JsonObject> => ({ bark: material([0.36, 0.25, 0.16], 0.9), leaf: material([0.25, 0.5, 0.18], 0.7), soil: material([0.35, 0.28, 0.2], 1) });

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const all: Record<string, JsonObject> = { cam: camera([7, 5, 14], [0, 4, 0], 50), sun: sun([-40, 30, 0]), sky: DAY_SKY, ...MATERIALS(), ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(all)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(5, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1636 acceptance fixture.`, size: [...size], camera: 'cam', seed: 1636,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The same document in the agent's form for deep_show (#393): no `id`, no `layers`, no item's `layer`. */
export function agentDoc(session: JsonObject): JsonObject {
  const { id: _id, layers: _layers, items, ...rest } = session;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(obj(items, 'items'))) {
    const { layer: _layer, ...it } = obj(item, `items.${key}`);
    out[key] = it;
  }
  return { ...rest, items: out };
}
/** One or more trees in a scene, as deep_show takes it. */
export const treesDoc = (trees: Record<string, JsonObject>): JsonObject => agentDoc(sessionDoc('trees-1636', [640, 480], trees));

// ---------------------------------------------------------------------------------------------------
// A `tree@1` row of `geometry` (README: Assumed surfaces 4)

export interface Branch { id: string; level: number; rings: number[][] }
export interface Fork { id: string; parent: string; children: string[] }
export interface Card { twig: string; vertices: number[] }
export interface TreeRow {
  id: string; positions: V3[]; normals: V3[]; indices: number[]; parts: Map<string, number[]>; branches: Branch[]; forks: Fork[]; cards: Card[]; raw: JsonObject;
}
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} is [x, y, z]`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
const indexList = (v: JsonValue | undefined, count: number, what: string): number[] => {
  const list = arr(v, what).map((x, k) => int(x, `${what}[${k}]`));
  const out = list.filter((i) => i >= count);
  expect(out, `${what} index the row's ${count} positions`).toEqual([]);
  return list;
};
/** The row of tree `id` in a `geometry` reply, checked to hold what Assumed surfaces 4 says. */
export function treeRow(reply: JsonObject, id: string, what: string): TreeRow {
  const raw = rowOf(reply, id, what);
  expect(raw['kind'], `${what}: ${id} is a tree@1 row`).toBe('tree@1');
  const positions = arr(raw['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
  const normals = arr(raw['normals'], `${what}: ${id}.normals`).map((p, k) => v3(p, `${what}: ${id}.normals[${k}]`));
  expect(positions.length, `${what}: ${id} builds vertices`).toBeGreaterThan(0);
  const n = positions.length;
  const indices = indexList(raw['indices'], n, `${what}: ${id}.indices`);
  const parts = new Map(Object.entries(obj(raw['parts'], `${what}: ${id}.parts`)).map(([k, v]) => [k, arr(v, `${what}: ${id}.parts.${k}`).map((x, j) => int(x, `${what}: ${id}.parts.${k}[${j}]`))]));
  const branches = arr(raw['branches'], `${what}: ${id}.branches (README: Assumed surfaces 4)`).map((b, k): Branch => {
    const o = obj(b, `${what}: ${id}.branches[${k}]`);
    const bid = str(o['id'], `${what}: ${id}.branches[${k}].id`);
    const rings = arr(o['rings'], `${what}: branch ${bid}: rings`).map((r, j) => indexList(obj(r, `${what}: branch ${bid}: rings[${j}]`)['vertices'], n, `${what}: branch ${bid}: rings[${j}].vertices`));
    expect(rings.length, `${what}: branch ${bid} has at least two rings`).toBeGreaterThanOrEqual(2);
    for (const [j, r] of rings.entries()) expect(r.length, `${what}: branch ${bid} ring ${j} has its sides' vertices`).toBeGreaterThanOrEqual(3);
    return { id: bid, level: int(o['level'], `${what}: branch ${bid}: level`), rings };
  });
  const ids = new Set(branches.map((b) => b.id));
  expect(ids.size, `${what}: ${id}: no branch ID twice`).toBe(branches.length);
  const forks = arr(raw['forks'], `${what}: ${id}.forks (README: Assumed surfaces 4)`).map((f, k): Fork => {
    const o = obj(f, `${what}: ${id}.forks[${k}]`);
    const fork = { id: str(o['id'], `${what}: ${id}.forks[${k}].id`), parent: str(o['parent'], `${what}: ${id}.forks[${k}].parent`), children: arr(o['children'], `${what}: ${id}.forks[${k}].children`).map((c, j) => str(c, `${what}: ${id}.forks[${k}].children[${j}]`)) };
    expect([fork.parent, ...fork.children].filter((b) => !ids.has(b)), `${what}: fork ${fork.id} names branches of the row`).toEqual([]);
    return fork;
  });
  const cards = arr(raw['cards'], `${what}: ${id}.cards (README: Assumed surfaces 4)`).map((c, k): Card => {
    const o = obj(c, `${what}: ${id}.cards[${k}]`);
    return { twig: str(o['twig'], `${what}: ${id}.cards[${k}].twig`), vertices: indexList(o['vertices'], n, `${what}: ${id}.cards[${k}].vertices`) };
  });
  return { id, positions, normals, indices, parts, branches, forks, cards, raw };
}
/** The row's `wind` point attribute (README: Assumed surfaces 4): one value per vertex. */
export function windOf(row: TreeRow, what: string): number[] {
  const w = obj(obj(row.raw['attributes'], `${what}: ${row.id}.attributes`)['wind'], `${what}: ${row.id}.attributes.wind`);
  expect(w['domain'], `${what}: wind is a point attribute`).toBe('point');
  const values = arr(w['values'], `${what}: wind values`).map((x, k) => num(x, `${what}: wind[${k}]`));
  expect(values.length, `${what}: one wind value per vertex`).toBe(row.positions.length);
  return values;
}
/** The tree's shape holds the topology Assumed surfaces 2 gives for `p`. */
export function topologyFailures(row: TreeRow, p: TreeParams): string[] {
  const t = topology(p);
  const out: string[] = [];
  if (row.branches.length !== t.branches) out.push(`${row.id} has ${row.branches.length} branches, not the ${t.branches} of ${p.levels} levels with ${p.split} children a fork`);
  if (row.forks.length !== t.forks) out.push(`${row.id} has ${row.forks.length} forks, not ${t.forks}`);
  for (const f of row.forks) if (f.children.length !== p.split) out.push(`fork ${f.id} has ${f.children.length} children, not split ${p.split}`);
  const trunk = row.branches.filter((b) => b.level === 1);
  if (trunk.length !== 1) out.push(`${row.id} has ${trunk.length} branches at level 1, not one trunk`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Vectors and rings, measured on the built mesh

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = len(a); return l > 0 ? mul(a, 1 / l) : a; };
const DEG = 180 / Math.PI;

/** A ring's centre: the mean of its vertices. */
export const centreOf = (row: TreeRow, ring: number[]): V3 => mul(ring.reduce<V3>((s, i) => add(s, row.positions[i]!), [0, 0, 0]), 1 / ring.length);
/** A ring's radius: the mean distance of its vertices from its centre. */
export function radiusOf(row: TreeRow, ring: number[]): number {
  const c = centreOf(row, ring);
  return ring.reduce((s, i) => s + len(sub(row.positions[i]!, c)), 0) / ring.length;
}
/** A ring's plane normal by Newell's method over its vertices in order, turned to point along `along`. */
function normalOf(row: TreeRow, ring: number[], along: V3): V3 {
  let n: V3 = [0, 0, 0];
  for (let k = 0; k < ring.length; k++) {
    const a = row.positions[ring[k]!]!; const b = row.positions[ring[(k + 1) % ring.length]!]!;
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  n = unit(n);
  return dot(n, along) < 0 ? mul(n, -1) : n;
}
const branchById = (row: TreeRow): Map<string, Branch> => new Map(row.branches.map((b) => [b.id, b]));
/** Each branch's fork (where it starts), by branch ID; the trunk has none. */
const forkOfChild = (row: TreeRow): Map<string, Fork> => new Map(row.forks.flatMap((f) => f.children.map((c) => [c, f] as [string, Fork])));

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the vertex hash

/** SHA-256 of every vertex's position and normal (x, y, z as little-endian f64, in order), then the indices (u32). */
export function vertexHash(row: TreeRow): string {
  const b = Buffer.alloc(row.positions.length * 48 + row.indices.length * 4);
  let at = 0;
  for (let k = 0; k < row.positions.length; k++) for (const c of [...row.positions[k]!, ...row.normals[k]!]) { b.writeDoubleLE(c, at); at += 8; }
  for (const i of row.indices) { b.writeUInt32LE(i, at); at += 4; }
  return sha256(b);
}
/** Where two builds' vertices first differ, or ''. */
export function firstDifference(a: TreeRow, b: TreeRow): string {
  if (a.positions.length !== b.positions.length) return `${a.positions.length} vertices against ${b.positions.length}`;
  for (let k = 0; k < a.positions.length; k++) {
    for (const [name, x, y] of [['position', a.positions[k]!, b.positions[k]!], ['normal', a.normals[k]!, b.normals[k]!]] as const) {
      const j = [0, 1, 2].find((c) => !Object.is(x[c], y[c]));
      if (j !== undefined) return `vertex ${k}'s ${name} ${'xyz'[j]}: ${x[j]} against ${y[j]}`;
    }
  }
  const i = a.indices.findIndex((x, k) => x !== b.indices[k]);
  return i >= 0 || a.indices.length !== b.indices.length ? `the indices differ at ${i}` : '';
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the pipe model at every fork

/** Each fork whose parent ring's radius^e differs from the sum of its children's first rings' radius^e by over 1%. */
export function pipeFailures(row: TreeRow, e: number, share = 0.01): string[] {
  const by = branchById(row);
  return row.forks.flatMap((f) => {
    const parent = by.get(f.parent)!;
    const R = radiusOf(row, parent.rings[parent.rings.length - 1]!);
    const rs = f.children.map((c) => radiusOf(row, by.get(c)!.rings[0]!));
    const lhs = R ** e; const rhs = rs.reduce((s, r) => s + r ** e, 0);
    const off = Math.abs(lhs - rhs) / lhs;
    return off <= share ? [] : [`fork ${f.id} (parent ${f.parent}, children ${f.children.join(', ')}): the parent's ring radius ${R.toFixed(5)} m ^ ${e} = ${lhs.toExponential(5)}, the children's ${rs.map((r) => r.toFixed(5)).join(', ')} m give ${rhs.toExponential(5)}, ${(off * 100).toFixed(2)}% apart, over ${share * 100}%`];
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the frame's turn between consecutive rings, and the inflections

export interface Turn { branch: string; ring: number; deg: number }
/** For each two consecutive rings of each branch: the angle about the axis between ring k's first vertex, carried to
 * ring k + 1's plane by the least rotation between the two rings' normals, and ring k + 1's first vertex. */
export function frameTurns(row: TreeRow): Turn[] {
  const out: Turn[] = [];
  for (const b of row.branches) {
    const cs = b.rings.map((r) => centreOf(row, r));
    const along = (k: number): V3 => (k + 1 < cs.length ? sub(cs[k + 1]!, cs[k]!) : sub(cs[k]!, cs[k - 1]!));
    const ns = b.rings.map((r, k) => normalOf(row, r, along(k)));
    const first = b.rings.map((r, k) => { const d = sub(row.positions[r[0]!]!, cs[k]!); return unit(sub(d, mul(ns[k]!, dot(d, ns[k]!)))); });
    for (let k = 0; k + 1 < b.rings.length; k++) {
      const [n0, n1, d0, d1] = [ns[k]!, ns[k + 1]!, first[k]!, first[k + 1]!];
      const axis = cross(n0, n1); const s = len(axis); const c = dot(n0, n1);
      // Rodrigues: d0 turned about axis by the angle between the normals.
      const u = s > 1e-12 ? mul(axis, 1 / s) : ([0, 0, 0] as V3);
      const carried = add(add(mul(d0, c), mul(cross(u, d0), s)), mul(u, dot(u, d0) * (1 - c)));
      out.push({ branch: b.id, ring: k + 1, deg: Math.atan2(dot(n1, cross(carried, d1)), dot(carried, d1)) * DEG });
    }
  }
  return out;
}
export const turnFailure = (t: Turn, bound: number): string => `branch ${t.branch} ring ${t.ring}: the frame turns ${t.deg.toFixed(2)}° from ring ${t.ring - 1}, over the declared roll plus 0.5°, ${bound}°`;
/** Where a branch inflects: its curvature, from its ring centres, reverses between rings `ring` − 1 and `ring`. */
export function inflections(row: TreeRow): { branch: string; ring: number }[] {
  const out: { branch: string; ring: number }[] = [];
  for (const b of row.branches) {
    const cs = b.rings.map((r) => centreOf(row, r));
    const t = cs.slice(1).map((c, k) => unit(sub(c, cs[k]!)));
    const kappa = t.slice(1).map((x, k) => sub(x, t[k]!)); // at ring k + 1
    for (let k = 1; k < kappa.length; k++) {
      const [a, z] = [kappa[k - 1]!, kappa[k]!];
      if (len(a) > 1e-4 && len(z) > 1e-4 && dot(a, z) < 0) out.push({ branch: b.id, ring: k + 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the capsule chain per branch, and overlaps outside 1.5 parent radii of a shared fork

interface Capsule { solid: string; branch: string; a: V3; b: V3; r: number }
interface Zone { point: V3; radius: number }
/** The capsule chain of each branch of `item` (README: Assumed surfaces 6), with each fork's excused zone. */
function chainOf(item: string, row: TreeRow): { capsules: Capsule[]; shared: (x: string, y: string) => Zone | null } {
  const by = branchById(row);
  const capsules = row.branches.flatMap((b) => {
    const cs = b.rings.map((r) => centreOf(row, r)); const rs = b.rings.map((r) => radiusOf(row, r));
    return cs.slice(1).map((c, k): Capsule => ({ solid: `${item}#${b.id}`, branch: b.id, a: cs[k]!, b: c, r: Math.max(rs[k]!, rs[k + 1]!) }));
  });
  const forkOf = forkOfChild(row);
  const zone = (f: Fork): Zone => { const p = by.get(f.parent)!; const last = p.rings[p.rings.length - 1]!; return { point: centreOf(row, last), radius: 1.5 * radiusOf(row, last) }; };
  const shared = (x: string, y: string): Zone | null => {
    const [fx, fy] = [forkOf.get(x), forkOf.get(y)];
    if (fx && fx === fy) return zone(fx);
    if (fx && fx.parent === y) return zone(fx);
    if (fy && fy.parent === x) return zone(fy);
    return null;
  };
  return { capsules, shared };
}
/** The closest points of segments p1q1 and p2q2 (clamped to both). */
function closest(p1: V3, q1: V3, p2: V3, q2: V3): [V3, V3] {
  const d1 = sub(q1, p1); const d2 = sub(q2, p2); const r = sub(p1, p2);
  const a = dot(d1, d1); const e = dot(d2, d2); const f = dot(d2, r);
  let s = 0; let t = 0;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = dot(d1, r);
    if (e <= 1e-18) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = dot(d1, d2); const den = a * e - b * b;
      s = den > 1e-18 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return [add(p1, mul(d1, s)), add(p2, mul(d2, t))];
}
/** Every pair of capsules of two branches (of one tree, or of trees placed alike) that pass into each other by more
 * than `sunk` where no shared fork excuses it, each naming both solids. */
export function overlapFailures(trees: { item: string; row: TreeRow }[], sunk = 0.002): string[] {
  const chains = trees.map((t) => ({ item: t.item, ...chainOf(t.item, t.row) }));
  const all = chains.flatMap((c) => c.capsules.map((cap) => ({ cap, chain: c })));
  const worst = new Map<string, string>();
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [x, y] = [all[i]!, all[j]!];
    if (x.cap.solid === y.cap.solid) continue;
    const [p, q] = closest(x.cap.a, x.cap.b, y.cap.a, y.cap.b);
    const depth = x.cap.r + y.cap.r - len(sub(p, q));
    if (depth <= sunk) continue;
    const z = x.chain === y.chain ? x.chain.shared(x.cap.branch, y.cap.branch) : null;
    if (z && len(sub(mul(add(p, q), 0.5), z.point)) <= z.radius) continue;
    const key = [x.cap.solid, y.cap.solid].sort().join(' and ');
    if (!worst.has(key)) worst.set(key, `${key} pass into each other by ${(depth * 1000).toFixed(1)} mm at (${mul(add(p, q), 0.5).map((v) => v.toFixed(3)).join(', ')}) m, outside 1.5 parent radii of any fork they share`);
  }
  return [...worst.values()];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: path lengths along the branches

/** Each branch's rings' path lengths from the root (the trunk's first ring centre), along the ring centres. */
export function pathLengths(row: TreeRow): Map<string, number[]> {
  const by = branchById(row); const forkOf = forkOfChild(row);
  const out = new Map<string, number[]>();
  const of = (id: string): number[] => {
    const known = out.get(id);
    if (known) return known;
    const b = by.get(id)!; const cs = b.rings.map((r) => centreOf(row, r));
    const f = forkOf.get(id);
    let s = 0;
    if (f) { const p = by.get(f.parent)!; const pl = of(f.parent); s = pl[pl.length - 1]! + len(sub(cs[0]!, centreOf(row, p.rings[p.rings.length - 1]!))); }
    const list = cs.map((c, k) => (k === 0 ? s : (s += len(sub(c, cs[k - 1]!)))));
    out.set(id, list);
    return list;
  };
  for (const b of row.branches) of(b.id);
  return out;
}
/** The branches that end in a tip: no fork's parent. */
export const tipsOf = (row: TreeRow): Branch[] => { const parents = new Set(row.forks.map((f) => f.parent)); return row.branches.filter((b) => !parents.has(b.id)); };
export const trunkOf = (row: TreeRow): Branch => { const t = row.branches.filter((b) => b.level === 1); expect(t.length, `${row.id} has one trunk (level 1)`).toBe(1); return t[0]!; };
/** "The farthest tip": among the tips whose path length (by ring centres) is within 0.5% of the longest, the one whose
 * last ring reads the highest mean wind (README: Readings, criterion 5). */
export function farthestTip(row: TreeRow, wind: number[]): Branch {
  const paths = pathLengths(row); const tips = tipsOf(row);
  const end = (b: Branch): number => paths.get(b.id)![b.rings.length - 1]!;
  const longest = Math.max(...tips.map(end));
  const mean = (b: Branch): number => { const r = b.rings[b.rings.length - 1]!; return r.reduce((s, i) => s + wind[i]!, 0) / r.length; };
  return tips.filter((b) => end(b) >= 0.995 * longest).sort((a, b) => mean(b) - mean(a))[0]!;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6: the leaf cards

/** Each twig (level 3 and up) holds `perTwig` cards, no other branch holds one, and each card's centre lies within
 * `size` of its twig's centreline at 80% to 100% of its length (0.5% of the length allowed for the ring polyline). */
export function cardFailures(row: TreeRow, perTwig: number, size: number): string[] {
  const out: string[] = [];
  const by = branchById(row);
  for (const b of row.branches) {
    const n = row.cards.filter((c) => c.twig === b.id).length;
    if (b.level >= 3 && n !== perTwig) out.push(`twig ${b.id} (level ${b.level}) holds ${n} cards, not ${perTwig}`);
    if (b.level < 3 && n > 0) out.push(`branch ${b.id} (level ${b.level}) is no twig but holds ${n} cards`);
  }
  const seen = new Set<number>();
  for (const [k, c] of row.cards.entries()) {
    const twig = by.get(c.twig);
    if (!twig) { out.push(`card ${k} names ${c.twig}, no branch of the row`); continue; }
    if (c.vertices.some((i) => seen.has(i))) out.push(`card ${k} shares a vertex with another card`);
    for (const i of c.vertices) seen.add(i);
    const centre = mul(c.vertices.reduce<V3>((s, i) => add(s, row.positions[i]!), [0, 0, 0]), 1 / c.vertices.length);
    const cs = twig.rings.map((r) => centreOf(row, r));
    let total = 0; let best = { d: Infinity, s: 0 };
    for (let j = 0; j + 1 < cs.length; j++) {
      const seg = sub(cs[j + 1]!, cs[j]!); const l = len(seg);
      const u = l > 0 ? Math.min(1, Math.max(0, dot(sub(centre, cs[j]!), seg) / (l * l))) : 0;
      const d = len(sub(centre, add(cs[j]!, mul(seg, u))));
      if (d < best.d) best = { d, s: total + u * l };
      total += l;
    }
    const at = best.s / total;
    if (at < 0.8 - 0.005 || at > 1 + 0.005) out.push(`card ${k} on twig ${c.twig} is centred at ${(at * 100).toFixed(1)}% of its length, not in its last 20%`);
    if (best.d > size) out.push(`card ${k} on twig ${c.twig} is centred ${best.d.toFixed(4)} m from its twig, more than the card size ${size} m`);
  }
  for (const k of row.branches.flatMap((b) => b.rings.flat())) if (seen.has(k)) { out.push(`a card shares vertex ${k} with a tube`); break; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: a branch's radius on any mesh, by a plane cut

/** Where `indices`' triangles cross the plane through `p` normal to `n`: the farthest crossing within `within` of `p`,
 * or null when none is that close. Measured alike on the full build and on a proxy, so their tessellations cancel. */
export function cutRadius(positions: readonly V3[], indices: readonly number[], p: V3, n: V3, within: number): number | null {
  let best: number | null = null;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const vs = [positions[indices[t]!]!, positions[indices[t + 1]!]!, positions[indices[t + 2]!]!];
    const ds = vs.map((v) => dot(sub(v, p), n));
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      if (ds[i]! < 0 === ds[j]! < 0) continue;
      const q = add(vs[i]!, mul(sub(vs[j]!, vs[i]!), ds[i]! / (ds[i]! - ds[j]!)));
      const d = len(sub(q, p));
      if (d <= within && (best === null || d > best)) best = d;
    }
  }
  return best;
}
/** The plane a branch is cut at: between the two rings around `share` of its rings, normal along it, and the wider
 * of the two rings' radii. */
export function cutOf(row: TreeRow, b: Branch, share: number): { p: V3; n: V3; r: number } {
  const k = Math.min(b.rings.length - 2, Math.floor(share * (b.rings.length - 1)));
  const [c0, c1] = [centreOf(row, b.rings[k]!), centreOf(row, b.rings[k + 1]!)];
  return { p: mul(add(c0, c1), 0.5), n: unit(sub(c1, c0)), r: Math.max(radiusOf(row, b.rings[k]!), radiusOf(row, b.rings[k + 1]!)) };
}
/** Bytes per component: float, unsigned int, unsigned short, unsigned byte. */
const COMPONENT_BYTES: Record<number, number> = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
/** A JSON glTF's first mesh's first primitive (README: Assumed surfaces 7), its buffers inline. */
export function readGltf(file: Buffer, what: string): { positions: V3[]; indices: number[] } {
  const g = obj(JSON.parse(file.toString('utf8')) as JsonValue, `${what}: the glTF`);
  const buffers = arr(g['buffers'], `${what}: buffers`).map((b, k) => {
    const uri = str(obj(b, `${what}: buffers[${k}]`)['uri'], `${what}: buffers[${k}].uri`);
    expect(uri.startsWith('data:'), `${what}: buffers[${k}] is inline`).toBe(true);
    return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  });
  const views = arr(g['bufferViews'], `${what}: bufferViews`).map((v, k) => obj(v, `${what}: bufferViews[${k}]`));
  const accessors = arr(g['accessors'], `${what}: accessors`).map((a, k) => obj(a, `${what}: accessors[${k}]`));
  const prim = obj(arr(obj(arr(g['meshes'], `${what}: meshes`)[0], `${what}: meshes[0]`)['primitives'], `${what}: primitives`)[0], `${what}: primitives[0]`);
  const read = (k: number, comps: number): number[] => {
    const a = accessors[k]!; const v = views[int(a['bufferView'], `${what}: accessor ${k}.bufferView`)]!;
    const buf = buffers[int(v['buffer'], `${what}: view.buffer`)]!; const type = int(a['componentType'], `${what}: componentType`);
    const size = COMPONENT_BYTES[type];
    expect(size, `${what}: accessor ${k}'s component type ${type} is float or unsigned`).toBeDefined();
    const start = (typeof v['byteOffset'] === 'number' ? v['byteOffset'] : 0) + (typeof a['byteOffset'] === 'number' ? a['byteOffset'] : 0);
    const stride = typeof v['byteStride'] === 'number' ? v['byteStride'] : size! * comps;
    const out: number[] = [];
    for (let e = 0; e < int(a['count'], `${what}: count`); e++) for (let c = 0; c < comps; c++) {
      const at = start + e * stride + c * size!;
      out.push(type === 5126 ? buf.readFloatLE(at) : type === 5125 ? buf.readUInt32LE(at) : type === 5123 ? buf.readUInt16LE(at) : buf.readUInt8(at));
    }
    return out;
  };
  const flat = read(int(obj(prim['attributes'], `${what}: attributes`)['POSITION'], `${what}: POSITION`), 3);
  const positions = Array.from({ length: flat.length / 3 }, (_, k): V3 => [flat[3 * k]!, flat[3 * k + 1]!, flat[3 * k + 2]!]);
  return { positions, indices: read(int(prim['indices'], `${what}: indices`), 1) };
}

// ---------------------------------------------------------------------------------------------------
// The audit's verdict row (#405's, as #2013's suite reads it)

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export function requirementRow(v: JsonObject, req: string, what: string): { result: string; issues: Issue[]; raw: JsonObject } {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).map((x, i) => {
    const o = obj(x, `${what}: issues[${i}]`);
    const ids = Array.isArray(o['ids']) ? o['ids'].filter((s): s is string => typeof s === 'string') : [];
    return { code: String(o['code']), severity: String(o['severity']), ids: [...ids].sort(), raw: o };
  });
  return { result: String(raw!['result']), issues, raw: raw! };
}

// ---------------------------------------------------------------------------------------------------
// The machine and the perf lane (scripts/benchmark.mjs)

export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** The perf lane's own rule: five runs after warm-up, a reference Mac at rest, the load within the cores. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  (await bench()).validateBudgets(current, base);
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: a linux/amd64 container on this Mac (canvas primitives: Golden: it counts as the other architecture for
// CPU checks), from scripts/lane-x86.json's pinned toolchain image with libclang added, which `full` deep-show's
// bindgen build scripts need (#225's redraft found so). Its caches live under target/acceptance-1636-linux/. Nothing
// is pulled or built as an image here.

const CHANNEL = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? '';
const PIN = JSON.parse(readFileSync(join(REPO, 'scripts', 'lane-x86.json'), 'utf8')) as { image: string; digest: string };
const PINNED = `${PIN.image}@${PIN.digest}`;
const LINUX_IMAGE = `deepbuild-acceptance-1636-linux:${CHANNEL}`;
const RECIPE = `FROM ${PINNED}\nRUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*\n`;
const MAKE_IMAGE = `printf '${RECIPE.replace(/\n/g, '\\n')}' | docker build --platform linux/amd64 -t ${LINUX_IMAGE} -`;
const CACHE = join(TARGET, 'acceptance-1636-linux');
const SHOW_ARGS = cargoArgs('deep-show', false);

const docker = (args: string[], timeout: number, input?: string): Ran =>
  ran(spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout, killSignal: 'SIGKILL', ...(input === undefined ? {} : { input }) }));
const lastLine = (s: string): string => s.trim().split('\n').slice(-1)[0] ?? '';
const layers = (image: string): string[] | null => {
  const r = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}} {{json .RootFS.Layers}}', image], 60_000);
  const m = /^amd64 (\[.*\])$/.exec(r.stdout.trim());
  return r.status === 0 && m ? (JSON.parse(m[1]!) as string[]) : null;
};
/** Why Linux x86_64 can't run here, with its one unblock ask; null when it can. */
export function linuxBlocked(): { reason: string; ask: string } | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 60_000);
  if (info.status !== 0) return { reason: `the container runtime is unreachable (${lastLine(info.stderr) || `exit ${info.status}`})`, ask: 'start Docker on this Mac, then run this file again' };
  if (PIN.image !== `rust:${CHANNEL}-bookworm`) return { reason: `scripts/lane-x86.json pins ${PIN.image}, not rust-toolchain.toml's channel ${CHANNEL}`, ask: `pin rust:${CHANNEL}-bookworm by digest in scripts/lane-x86.json` };
  const base = layers(PINNED);
  if (!base) return { reason: `Docker has no linux/amd64 image ${PINNED}, and this suite pulls nothing`, ask: `docker pull --platform linux/amd64 ${PINNED}` };
  const ours = layers(LINUX_IMAGE);
  if (!ours || base.some((l, i) => ours[i] !== l)) return { reason: `Docker has no linux/amd64 image ${LINUX_IMAGE} built from ${PINNED} with libclang`, ask: `build it once: ${MAKE_IMAGE}` };
  return null;
}
const crashed = (s: Ran): boolean => s.status === 139 || /SIGSEGV|SIGBUS|SIGILL|signal: 1[01],|Segmentation fault|qemu: uncaught target signal/i.test(s.stderr);
/** Builds `full` deep-show for linux/amd64, resuming up to twice after an emulation crash: '' or why it failed. */
export function buildLinux(): { error: string; crashes: number } {
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(CACHE, d), { recursive: true });
  let crashes = 0;
  for (;;) {
    const r = docker([
      'run', '--rm', '--pull', 'never', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(CACHE, 'target')}:/target`,
      '-v', `${join(CACHE, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(CACHE, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${CHANNEL}`, '-e', 'CARGO_BUILD_JOBS=2',
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
      LINUX_IMAGE, 'cargo', ...SHOW_ARGS,
    ], 4 * TIMEOUT);
    if (r.status === 0) return { error: '', crashes };
    if (!r.timedOut && crashed(r) && crashes < 2) { crashes++; continue; }
    return { error: `cargo ${SHOW_ARGS.join(' ')} in ${LINUX_IMAGE} (linux/amd64) ${r.timedOut ? 'timed out' : 'failed'}:\n${quiet(r.stderr).slice(-4000)}`, crashes };
  }
}
/** One `deep-show run` in a linux/amd64 container with no network: the machine it reports (`uname -m`) and the replies. */
export function runLinux(sc: JsonObject, evidence: string): { arch: string; replies: JsonObject[] } {
  const inside = { ...sc, evidence: '/evidence' };
  const r = docker([
    'run', '--rm', '-i', '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none',
    '-v', `${REPO}:/src:ro`, '-v', `${join(CACHE, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`, '-w', '/src',
    LINUX_IMAGE, 'sh', '-c', 'echo "machine: $(uname -m)" >&2; exec /target/debug/deep-show run',
  ], TIMEOUT, `${JSON.stringify(inside)}\n`);
  return { arch: /machine: (\S+)/.exec(r.stderr)?.[1] ?? 'unknown', replies: repliesOf(r, inside, 'deep-show run on linux/amd64') };
}

// ---------------------------------------------------------------------------------------------------
// The look (#166's shape) and PNG and APNG coding (#425's): written with no filter at zlib level 9, so the same pixels
// give the same SHA-256.

/** A physical-basis `look@1` with `change` applied: tone map, exposure, no finish, deband, bloom, ao or 3D ground. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #1636 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' }, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
export const PLAIN = look3d('plain-1636');
export const FILMIC = look3d('filmic-1636', { tone_map: 'filmic', exposure: 0 });

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const size = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + size;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
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
  return { width, height, rgba };
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
function ihdr(width: number, height: number): Buffer {
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 2;
  return h;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function encodePng(image: Image): Buffer {
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(image.width, image.height)), chunk('IDAT', rows(image)), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr(width, height)), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22); fctl[24] = 0; fctl[25] = 0;
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}
