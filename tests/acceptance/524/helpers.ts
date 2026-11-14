// Test-side tools for the #524 acceptance tests (README: The surface under test). They extend #2009's, #2010's, #1918's,
// #1921's and #522's surface, imported read only through ../522/helpers.ts (and through it ../1918, ../2010 and ../2009),
// ../1921/helpers.ts (the scene as a session holds it, the look `view3d` draws with) and ../252/helpers.ts (an animated
// PNG of the canvas's own frames): the same `deep-physics` binary (#2009's build, once per file), asked this suite's
// fields (a world's `soft` bodies, skins, `check`'s `soft` and `backend`, a bake's and a seek's `particles`) and calls
// (`audit`; `seek`, `determinism`, `golden` and `golden_verify` on a scene's world), and run under this suite's
// `--planted` twin; `deep-physics` built with this suite's cargo feature (the swapped soft-body solver); `deep-show run`
// for documents, the document check and `geometry` (where each vertex of an item is drawn at a time); `deep-gpu run` for
// the canvas's own frames; and `scripts/benchmark.mjs` for the budget record and its judge. Nothing here stands in for
// the physics module, the skin or the renderer: every issue, state, particle, hash, row, vertex, verdict and frame read
// here is the program's own; every expected value comes from the issue's text, the design or the fixtures' own numbers,
// computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  REPO, TARGET, TIMEOUT, arr, cargoError, isObject, num, obj, physics, show, str, world,
  type JsonObject, type JsonValue, type PhysicsPlanted,
} from '../522/helpers.ts';
import { LOOK, forGpu } from '../1921/helpers.ts';
import { apng, sha256 } from '../252/helpers.ts';

export {
  OTHER, REPO, TIMEOUT, arr, caught, determinismOf, firstDiffering, goldenOf, hashesOf, inconclusive, isObject, issuesIn, load, none, num, obj,
  prebuild, presented, rowText, rowsOf, runShow, scenario, show, standing, str, useTemp, type JsonObject, type JsonValue, type Row,
} from '../522/helpers.ts';
export { LOOK, apng, forGpu, sha256 };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#524.98cf72b1',
  2: '#524.f05ac03c',
  3: '#524.4c32c52f',
  4: '#524.f18cb67c',
  5: '#524.78f2e1a8',
  6: '#524.49daa6e5',
  7: '#524.584c6e80',
  8: '#524.b97ba86d',
  9: '#524.d7f0282a',
} as const;

const MIB = 1024 * 1024;
export type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; a 120 Hz step and a 50 fps frame, whose frames fall between
// steps (frame f is 2.4 f steps), so a frame reads an interpolated state.

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 120;
export const FPS = 50;
export const FRAME = FLICKS / FPS;
/** The 20 sampled frames: 3, 7, … 79 at 50 fps (0.06 s to 1.58 s), 16 between steps (α 0.2, 0.4, 0.6, 0.8) and 4 on one. */
export const SAMPLED = Array.from({ length: 20 }, (_, i) => 3 + 4 * i);
/** A time in flicks as the state it draws: step k and α = (t − t(k)) ÷ step, exact from flicks (Physics output). */
export function stepAt(t: number): { k: number; alpha: number } {
  const k = Math.floor(t / STEP);
  return { k, alpha: (t - k * STEP) / STEP };
}

// ---------------------------------------------------------------------------------------------------
// Builds. deep-physics is #2009's (`prebuild()`, once per file); the rest are built when a test first needs them, once
// per file, each copied out of the target folder, so a file whose first assertion fails builds nothing more.

interface Built { bin: string; error: string }
const builds = new Map<string, Built>();
const buildDirs: string[] = [];
/** Deletes this file's copied builds after its tests; call once at a file's top when it uses a lazy build. */
export function cleanBuilds(): void {
  afterAll(() => { for (const d of buildDirs.splice(0)) rmSync(d, { recursive: true, force: true }); builds.clear(); });
}
function built(key: string, args: string[], bin: string): string {
  let b = builds.get(key);
  if (!b) {
    const dir = mkdtempSync(join(tmpdir(), 'deep-524-bin-'));
    buildDirs.push(dir);
    b = { bin: join(dir, bin), error: cargoError(args) };
    if (b.error === '') copyFileSync(join(TARGET, 'debug', bin), b.bin);
    builds.set(key, b);
  }
  expect(b.error, `${bin} builds (cargo ${args.join(' ')})`).toBe('');
  return b.bin;
}
/** `deep-show` with no features: the full build set. */
export const showBin = (): string => built('deep-show', ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'], 'deep-show');
/** `deep-gpu`, for the canvas's own frames. */
export const gpuBin = (): string => built('deep-gpu', ['build', '--locked', '--bin', 'deep-gpu'], 'deep-gpu');
/** The cargo feature that swaps the soft-body solver (README: The swapped solver). */
export const SWAP_FEATURE = 'test-swap-soft-solver';
/** `deep-physics` with its soft-body solver swapped for another. */
export const swappedBin = (): string =>
  built(SWAP_FEATURE, ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics', '--features', SWAP_FEATURE], 'deep-physics');

// ---------------------------------------------------------------------------------------------------
// deep-physics, under this suite's planted twin (README: Planted twin), or another build of it.

export type Planted = 'volume_without_constraint';
export interface Ask { planted?: Planted; bin?: string; where?: string }
/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function ask(calls: JsonObject[], o: Ask = {}): JsonObject[] {
  return physics(calls, {
    ...(o.planted ? { planted: o.planted as unknown as PhysicsPlanted } : {}),
    ...(o.bin ? { bin: o.bin } : {}),
    ...(o.where ? { where: o.where } : {}),
  });
}

/** A call on a scene's world (#1918's form), or on a world document alone. */
export const on = (w: World): JsonObject => (w.scene ? { scene: w.scene, world: w.id } : { world: w.doc });
export interface World { doc: JsonObject; scene?: JsonObject; id: string }
export const check = (w: World): JsonObject => ({ call: 'check', ...on(w) });
export const bake = (w: World, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', ...on(w), steps, ...extra });

// ---------------------------------------------------------------------------------------------------
// Reading replies.

/** A check's error issues. */
export function errorsOf(reply: JsonObject | undefined, what: string): JsonObject[] {
  expect(reply?.['ok'], `${what}: the check ran: ${show(reply)}`).toBe(true);
  return arr(reply!['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['severity'] === 'error');
}
/** A world the check admits: no error issue. */
export function admitted(reply: JsonObject | undefined, what: string): void {
  expect(errorsOf(reply, what).map((i) => show(i)), `${what} is admitted: no error issue`).toEqual([]);
}

/** One built soft body, read back from the backend's built body (README: `check`'s `soft`). */
export interface SoftBuilt { shape: string; particles: number; targetVolumeRatio: number | null }
/** What the backend built (README: `check`'s `backend`), and the bodies it built for the document (#1921's `built`). */
export interface BuiltWorld { soft: Record<string, SoftBuilt>; rigidBodies: number; joints: number; softBodies: number; particles: number; built: string[] }
export function builtOf(reply: JsonObject | undefined, what: string): BuiltWorld {
  admitted(reply, what);
  const r = reply!;
  const soft: Record<string, SoftBuilt> = {};
  for (const [id, v] of Object.entries(obj(r['soft'], `${what}: soft (each soft body as built)`))) {
    const s = obj(v, `${what}: soft.${id}`);
    const ratio = s['target_volume_ratio'];
    expect(ratio === null || typeof ratio === 'number', `${what}: soft.${id}.target_volume_ratio is a number or null, got ${show(ratio)}`).toBe(true);
    soft[id] = { shape: str(s['shape'], `${what}: soft.${id}.shape`), particles: num(s['particles'], `${what}: soft.${id}.particles`), targetVolumeRatio: ratio as number | null };
  }
  const b = obj(r['backend'], `${what}: backend (what the backend built)`);
  return {
    soft,
    rigidBodies: num(b['rigid_bodies'], `${what}: backend.rigid_bodies`),
    joints: num(b['joints'], `${what}: backend.joints`),
    softBodies: num(b['soft_bodies'], `${what}: backend.soft_bodies`),
    particles: num(b['particles'], `${what}: backend.particles`),
    built: arr(r['built'], `${what}: built`).map((x, i) => str(x, `${what}: built[${i}]`)),
  };
}

/** A soft body's particles in a bake or a seek (README: `particles`): its addresses, and positions[j][i] after j steps. */
export interface Particles { addresses: string[]; positions: V3[][] }
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
export function particlesOf(reply: JsonObject | undefined, id: string, count: number, what: string): Particles {
  expect(reply?.['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  const p = obj(obj(reply!['particles'], `${what}: particles`)[id], `${what}: particles.${id}`);
  const addresses = arr(p['addresses'], `${what}: particles.${id}.addresses`).map((a, i) => str(a, `${what}: particles.${id}.addresses[${i}]`));
  const states = arr(p['positions'], `${what}: particles.${id}.positions`);
  expect(states.length, `${what}: particles.${id}.positions holds ${count} states`).toBe(count);
  const positions = states.map((s, j) => {
    const list = arr(s, `${what}: particles.${id}.positions[${j}]`);
    expect(list.length, `${what}: particles.${id}.positions[${j}] holds one position per address`).toBe(addresses.length);
    return list.map((x, i) => v3(x, `${what}: particles.${id}.positions[${j}][${i}]`));
  });
  return { addresses, positions };
}
/** The index of each address in a soft body's particle list. */
export function indexOf(p: Particles, what: string): (address: string) => number {
  const at = new Map(p.addresses.map((a, i) => [a, i]));
  expect(at.size, `${what}: each particle has its own address`).toBe(p.addresses.length);
  return (a) => {
    const i = at.get(a);
    expect(i, `${what}: a particle is addressed ${a}; the addresses are ${p.addresses.slice(0, 8).join(', ')}…`).toBeDefined();
    return i!;
  };
}
/** A particle's position at time t (flicks), lerped between the two steps that hold t (Physics output). */
export function interpolated(p: Particles, i: number, t: number): V3 {
  const { k, alpha } = stepAt(t);
  const a = p.positions[k]?.[i];
  const b = p.positions[k + 1]?.[i] ?? a;
  expect(a, `the bake holds step ${k}`).toBeDefined();
  return [0, 1, 2].map((c) => a![c]! + alpha * (b![c]! - a![c]!)) as V3;
}

export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(...sub(a, b));
export const mean = (ps: readonly (readonly number[])[]): V3 => [0, 1, 2].map((c) => ps.reduce((s, p) => s + p[c]!, 0) / ps.length) as V3;

// ---------------------------------------------------------------------------------------------------
// deep-show `geometry` (#420's call): where each vertex of an item is drawn at t, in world metres (its positions through
// the row's `world` matrix, identity when absent), its normals, and a tube's rings.

export interface Drawn { id: string; kind: string; positions: V3[]; normals: V3[]; indices: number[]; rings: number[][]; raw: JsonObject }
export const geometryCall = (doc: string, items: string[], t: number): JsonObject => ({ call: 'geometry', doc, items, t });
export function drawnOf(reply: JsonObject | undefined, id: string, what: string): Drawn {
  expect(reply?.['code'], `${what}: the geometry call answers, not refused: ${show(reply)}`).toBeUndefined();
  const row = arr(reply!['items'], `${what}: items`).map((v, i) => obj(v, `${what}: items[${i}]`)).find((r) => r['id'] === id);
  expect(row, `${what}: the reply holds ${id}: ${show(reply).slice(0, 400)}`).toBeDefined();
  const r = row!;
  const w = r['world'];
  const m = Array.isArray(w) ? w.map((rowv, i) => arr(rowv, `${what}: ${id}.world[${i}]`).map((x, j) => num(x, `${what}: ${id}.world[${i}][${j}]`))) : null;
  const place = (p: V3): V3 => (m ? ([0, 1, 2].map((i) => m[i]![0]! * p[0] + m[i]![1]! * p[1] + m[i]![2]! * p[2] + m[i]![3]!) as V3) : p);
  const turn = (n: V3): V3 => {
    if (!m) return n;
    const q = [0, 1, 2].map((i) => m[i]![0]! * n[0] + m[i]![1]! * n[1] + m[i]![2]! * n[2]) as V3;
    const l = Math.hypot(...q);
    return [q[0] / l, q[1] / l, q[2] / l];
  };
  return {
    id, kind: str(r['kind'], `${what}: ${id}.kind`),
    positions: arr(r['positions'], `${what}: ${id}.positions`).map((p, k) => place(v3(p, `${what}: ${id}.positions[${k}]`))),
    normals: arr(r['normals'] ?? [], `${what}: ${id}.normals`).map((p, k) => turn(v3(p, `${what}: ${id}.normals[${k}]`))),
    indices: arr(r['indices'] ?? [], `${what}: ${id}.indices`).map((x, k) => num(x, `${what}: ${id}.indices[${k}]`)),
    rings: Array.isArray(r['rings']) ? r['rings'].map((ring, k) => arr(obj(ring, `${what}: ${id}.rings[${k}]`)['vertices'], `${what}: ${id}.rings[${k}].vertices`).map((x, j) => num(x, `${what}: ${id}.rings[${k}].vertices[${j}]`))) : [],
    raw: r,
  };
}
/** Positions equal to 1e-6 m are one welded vertex, numbered from 0 in order of first appearance (the design's rule). */
export function weld(positions: readonly V3[]): { of: number[]; welded: V3[] } {
  const key = (p: V3): string => p.map((x) => Math.round(x / 1e-6)).join(',');
  const seen = new Map<string, number>();
  const welded: V3[] = [];
  const of = positions.map((p) => {
    const k = key(p);
    let i = seen.get(k);
    if (i === undefined) { i = welded.length; seen.set(k, i); welded.push(p); }
    return i;
  });
  return { of, welded };
}

// ---------------------------------------------------------------------------------------------------
// Worlds and scenes (README: The world document, Fixtures). Fields are #2009's and #1918's, `soft` and skins this
// suite's. g = 9.81 m/s², 120 Hz, 4 substeps, seed 524.

export const MATERIALS: JsonObject = {
  ground: { friction: 0.8, restitution: 0 },
  cloth: { friction: 0.5, restitution: 0, density: 100 },
  jelly: { friction: 0.8, restitution: 0, density: 1000 },
  rubber: { friction: 0.5, restitution: 0, density: 1000 },
};
export const SHAPES: JsonObject = { plane: { kind: 'plane', normal: [0, 1, 0] }, floor: { kind: 'box', half: [10, 0.1, 10] }, ball: { kind: 'sphere', radius: 0.1 } };
/** The static plane y = 0, normal +Y. */
export const GROUND: JsonObject = { kind: 'static', shapes: [{ shape: 'plane', contact_material: 'ground' }] };
/** A world document with this suite's seed, materials, shapes and capacity, a checkpoint every 60 steps. */
export function softWorld(parts: JsonObject): JsonObject {
  return world({
    seed: 524, capacity: { bodies: 8, shapes: 8, joints: 64, contacts: 1024, particles: 1024 },
    contact_materials: MATERIALS, shapes: SHAPES, bodies: {}, checkpoint: { every: 60 }, ...parts,
  });
}
/** A rope of `particles` particles from `from` to `to` (soft@1 rope; ropes use the index as the address). */
export const rope = (from: V3, to: V3, particles: number, extra: JsonObject = {}): JsonObject => ({
  shape: 'rope', from, to, particles, edges: 'chain', masses: { default: 0.05 }, stretch: { hz: 30, damping_ratio: 0.5 },
  bend: { hz: 1, damping_ratio: 0.5 }, damping: 0.5, contact_material: 'cloth', ...extra,
});
/** A cloth of nu columns and nv rows, particle r{row}c{col} resting at origin + col × du + row × dv (soft@1 cloth). */
export const cloth = (origin: V3, du: V3, dv: V3, nu: number, nv: number, extra: JsonObject = {}): JsonObject => ({
  shape: 'cloth', origin, du, dv, nu, nv, edges: 'grid', address: 'r{row}c{col}', masses: { default: 0.01 },
  stretch: { hz: 30, damping_ratio: 0.5 }, shear: { hz: 10, damping_ratio: 0.5 }, bend: { hz: 1, damping_ratio: 0.5 }, damping: 0.5,
  contact_material: 'cloth', ...extra,
});
/** The addresses of a cloth's row `r`, or of its column `c`. */
export const row = (r: number, nu: number): string[] => Array.from({ length: nu }, (_, c) => `r${r}c${c}`);
export const column = (c: number, nv: number): string[] => Array.from({ length: nv }, (_, r) => `r${r}c${c}`);
/** The 28 × 10 banner, flat in the xz plane 3 m up, its row 0 pinned, so it swings down: 28 columns 0.1 m apart along x, 10 rows along z. */
export const BANNER_NU = 28;
export const BANNER_NV = 10;
export const banner = (extra: JsonObject = {}): JsonObject =>
  cloth([-1.35, 3, -0.45], [0.1, 0, 0], [0, 0, 0.1], BANNER_NU, BANNER_NV, { pins: row(0, BANNER_NU), ...extra });

/** A skin output (Physics output): `from`'s particle positions written as the vertices of `item` (an ID, or `auto`). */
export const skin = (from: string, item: string): JsonObject => ({ from, read: 'particle_positions', to: { skin: { item } } });

export const CAM: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 1.2, 0], fov: 50, near: 0.1, far: 100 } };
/** A scene in the agent's form (#421's payload: no `id`, no `layers`), its camera `cam`, listing `worlds`. */
export function sceneDoc(title: string, span: string, fps: number, items: Record<string, JsonObject>, worlds: JsonObject, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries({ cam: CAM, ...items })) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #524 acceptance fixture.`, size: [640, 360], camera: 'cam',
    transport: { span, frame_rate: [fps, 1] }, requires: { modules: { scene3d: '^1' } }, ...(Object.keys(worlds).length ? { worlds } : {}), ...extra,
    items: withIds,
  };
}
/** A plate whose grid has (cols) × (rows) vertices (plate@1 builds (nx + 1) × (ny + 1)), one-sided. */
export const plate = (cols: number, rows: number): JsonObject => ({ kind: 'plate@1', params: { grid: [cols - 1, rows - 1], size: [0.1 * (cols - 1), 0.1 * (rows - 1)] } });

/** Criterion 5's world: a 40-particle rope 2 m long, 4 m up, pinned at both ends, and the 28 × 10 banner, over a static floor. */
export function ropeAndBanner(): World {
  return {
    doc: softWorld({
      bodies: { floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'ground' }], pose: { pos: [0, -0.1, 0] } } },
      soft: { rope: rope([-1, 4, 0], [1, 4, 0], 40, { pins: ['0', '39'] }), banner: banner() },
    }),
    id: 'rope-and-banner',
  };
}
/** Criterion 2's world: balloons `b12` (inflate 1.2, `extra` over its fields) and `b15` (inflate 1.5), radius 0.5 m, subdivisions 2. */
export function twoBalloons(extra: JsonObject = {}): World {
  const balloon = (center: V3, inflate: number, more: JsonObject = {}): JsonObject => ({
    shape: 'balloon', center, radius: 0.5, subdivisions: 2, inflate, masses: { default: 0.01 }, stretch: { hz: 20, damping_ratio: 0.5 },
    contact_material: 'cloth', ...more,
  });
  return { doc: softWorld({ soft: { b12: balloon([0, 2, 0], 1.2, extra), b15: balloon([2, 2, 0], 1.5) } }), id: 'balloons' };
}
/**
 * Criterion 4's skinned cloth: the 28 × 10 banner as `flag`, swinging down from its pinned row 0, skinned onto the
 * plate `sheet` whose grid has `cols` × 10 vertices (output `onto_sheet`) and onto a plate the core builds itself
 * (output `onto_own`, the item `lab.onto_own`); 2 s at 50 fps.
 */
export const OWN_PLATE = 'lab.onto_own';
export function skinnedCloth(cols: number): World {
  const doc = softWorld({ soft: { flag: banner() }, outputs: { onto_sheet: skin('flag', 'sheet'), onto_own: skin('flag', 'auto') } });
  return { doc, scene: sceneDoc('Skinned cloth', '2s', FPS, { sheet: plate(cols, BANNER_NV) }, { lab: doc }), id: 'lab' };
}

// The soft cube (criterion 6): a built 1 m cube, `slab@1 {size: [1, 1, 1]}` (it stands on its plan, y 0 to 1 in its own
// space), placed 2 cm above the ground plane, the source of the soft volume `jelly` with inflate 1.2; a 1 kg ball of
// radius 0.1 m that gravity doesn't pull (gravity_scale 0), at rest 1.5 m to its −x side at mid height until the launch
// input `kick` throws it at the cube at 5 m/s.

export const CUBE_AT: V3 = [0, 0.02, 0];
export const BALL_AT: V3 = [-1.5, 0.55, 0];
export const LAUNCH_STEP = 360;
export const LAUNCH: JsonObject = { step: LAUNCH_STEP, kind: 'launch', target: 'ball', data: { linear: [5, 0, 0] } };
export function cubeScene(fps = FPS, span = '7s'): World {
  const doc = softWorld({
    bodies: {
      ground: GROUND,
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos: BALL_AT }, mass: 1, gravity_scale: 0, sleep: false },
    },
    soft: { jelly: { shape: 'volume', from: 'cube', inflate: 1.2, masses: { default: 1 }, stretch: { hz: 8, damping_ratio: 0.5 }, contact_material: 'jelly' } },
    inputs: { kick: { kind: 'launch', targets: ['ball'] } },
    outputs: { skin: skin('jelly', 'auto') },
  });
  const scene = sceneDoc('Soft cube', span, fps, {
    cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: CUBE_AT } },
    ball: { kind: 'mark.sphere@1', params: { size: [0.2, 0.2, 0.2] } },
  }, { lab: { ...doc, outputs: { ...(doc['outputs'] as JsonObject), ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } } } });
  return { doc: obj(obj(scene['worlds'], 'worlds')['lab'], 'lab'), scene, id: 'lab' };
}
/** The cube's 1.2 m³ and the criterion's 2% (1.176 to 1.224 m³). */
export const TARGET_VOLUME = 1.2;
export const inBand = (v: number): boolean => Math.abs(v - TARGET_VOLUME) <= 0.02 * TARGET_VOLUME;

/**
 * The volume a cube's eight particles enclose, measured from their positions (the kit's rule: never reported by a
 * backend): each face a quad of four corners, split into four triangles about its centroid, each closed into a
 * tetrahedron with the body's centroid; `corner[c]` is the particle at corner c = 4 × (x high) + 2 × (y high) + (z high).
 */
export function cubeVolume(ps: readonly V3[], corner: readonly number[]): number {
  const c = mean(corner.map((i) => ps[i]!));
  const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  let v = 0;
  for (const f of faces) {
    const q = f.map((k) => ps[corner[k]!]!);
    const fc = mean(q);
    for (let e = 0; e < 4; e++) v += Math.abs(dot(sub(fc, c), cross(sub(q[e]!, c), sub(q[(e + 1) % 4]!, c)))) / 6;
  }
  return v;
}
/** The corners of a cube's eight particles from their resting places: corner code → particle index. */
export function cornersOf(rest: readonly V3[], what: string): number[] {
  expect(rest.length, `${what}: the cube's soft body holds its 8 welded vertices`).toBe(8);
  const m = mean(rest);
  const corner: number[] = [];
  rest.forEach((p, i) => { corner[4 * Number(p[0] > m[0]) + 2 * Number(p[1] > m[1]) + Number(p[2] > m[2])] = i; });
  expect(corner.filter((x) => x !== undefined).length, `${what}: the 8 particles sit at the cube's 8 corners`).toBe(8);
  return corner;
}

// ---------------------------------------------------------------------------------------------------
// physics.audit (README: `audit`) and its defaults (canvas primitives: Extended kinds).

/** physics.audit's settings at its defaults: the Extended-kinds line's defaults; settle, max_speed and joints have none. */
export const AUDIT_DEFAULTS = { energy: { max_gain: 0.01 }, penetration: { max: 0.01 }, faults: ['nan', 'capacity', 'speed_cap', 'penetration'], soft: { max_stretch: 1.1 } };
export interface AuditFailure { rule: string; id: string | null; raw: JsonObject }
export interface Audit { verdict: string; settings: JsonObject; failures: AuditFailure[] }
export function auditOf(reply: JsonObject | undefined, what: string): Audit {
  expect(reply?.['ok'], `${what}: the audit ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply!['kind'], `${what}: the check kind`).toBe('physics.audit');
  const verdict = str(reply!['verdict'], `${what}: verdict`);
  expect(['PASS', 'FAIL'], `${what}: verdict is PASS or FAIL`).toContain(verdict);
  return {
    verdict, settings: obj(reply!['settings'], `${what}: settings (what it ran with)`),
    failures: arr(reply!['failures'], `${what}: failures`).map((f, i) => {
      const o = obj(f, `${what}: failures[${i}]`);
      return { rule: str(o['rule'], `${what}: failures[${i}].rule`), id: typeof o['id'] === 'string' ? o['id'] : null, raw: o };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// The labs as documents (README: The labs). Each is a scene in the agent's form whose world `lab` the lab runs.

export const LABS = {
  bridge: 'packs/examples/labs/rope-bridge.json',
  banner: 'packs/examples/labs/banner.json',
  goal: 'packs/examples/labs/ball-and-goal.json',
} as const;
export type Lab = keyof typeof LABS;
export const LAB_WORLD = 'lab';
/** A lab's document as the repo holds it, and its world. */
export function labOf(name: Lab): World {
  const path = join(REPO, LABS[name]);
  expect(existsSync(path), `the ${name} lab is a document at ${LABS[name]}`).toBe(true);
  let parsed: JsonValue;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${LABS[name]} is JSON: ${String(e)}`); }
  const scene = obj(parsed, LABS[name]);
  const doc = obj(obj(scene['worlds'], `${LABS[name]}: worlds`)[LAB_WORLD], `${LABS[name]}: worlds.${LAB_WORLD}`);
  return { doc, scene, id: LAB_WORLD };
}

// ---------------------------------------------------------------------------------------------------
// deep-show and deep-gpu runs.

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB0524D0${String(n).padStart(16, '0')}`;
const SESSION = 'sess-1918';
/** The agent's `deep_show` of a whole document, with its issues (#393), in #1918's session. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });

/** One `deep-gpu run` process: exit 0, one answer line, ok, one reply per call (#377). */
export function gpu(out: string, calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(gpuBin(), ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-gpu run: ${r.error.message}`);
  expect(timedOut, 'deep-gpu run finished within its timeout').toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one answer line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run answers the scenario ok: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu run: replies').map((x, i) => obj(x, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The budget record (docs/parallel-proof.md §12a): a task of benchmarks/budgets.json names each budget criterion, and the
// budget window measures it against the merge base. scripts/benchmark.mjs is read for its validator and judge.

export interface Task { id: string; command: string[]; targets: Record<string, number> }
export const MODULE_TASK: Task = {
  id: 'physics-module', command: ['node', 'benchmarks/physics.mjs', 'module'],
  targets: { bridge_step_ms: 2, stress_step_ms: 2, bake_10s_ms: 1000, world_mb: 50, startup_ms: 5 },
};
export const LABS_TASK: Task = {
  id: 'physics-soft-labs', command: ['node', 'benchmarks/physics.mjs', 'soft-labs'],
  targets: { bridge_step_ms: 2, banner_step_ms: 2 },
};
interface Bench {
  validateBudgets: (current: unknown, base: unknown) => void;
  judgeTargets: (budget: unknown, cwd: string) => JsonObject;
}
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/**
 * The record a budget criterion needs: benchmarks/budgets.json holds `task` with the issue's numbers, the lane's margin,
 * a reason naming #524 and the criterion's ID, and the lane's validator accepts the file against the merge base's.
 */
export async function recordFailures(task: Task, criterion: string): Promise<string[]> {
  const f: string[] = [];
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === task.id);
  if (!entry) return [`benchmarks/budgets.json has no task ${task.id}`];
  if (JSON.stringify(entry['command']) !== JSON.stringify(task.command)) f.push(`${task.id} runs ${show(entry['command'])}, not ${show(task.command)}`);
  if (JSON.stringify(entry['targets']) !== JSON.stringify(task.targets)) f.push(`${task.id} holds ${show(entry['targets'])}, not the issue's numbers ${show(task.targets)}`);
  if (entry['margin'] !== 0.5) f.push(`${task.id} compares with the merge base at margin ${show(entry['margin'])}, not the lane's 0.5`);
  if (!Array.isArray(entry['criteria']) || !entry['criteria'].includes(criterion)) f.push(`${task.id} doesn't name ${criterion} among its criteria, so the budget window never measures it`);
  if (!/#524\b/.test(String(entry['initialReason'] ?? ''))) f.push(`${task.id}'s initialReason doesn't name #524`);
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mergeBase.status !== 0) return [...f, `git merge-base HEAD origin/main: ${mergeBase.stderr}`];
  const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB });
  if (base.status !== 0) return [...f, `the merge base's benchmarks/budgets.json: ${base.stderr}`];
  try { (await bench()).validateBudgets(current, JSON.parse(base.stdout)); } catch (e) { f.push(`the lane's validator refuses budgets.json against the merge base's: ${String(e)}`); }
  return f;
}
/** The task's own judge on this checkout (the budget window's `judgeTargets`): its verdict and each target's. */
export async function judgeTask(task: Task): Promise<JsonObject> {
  return (await bench()).judgeTargets(task, REPO);
}

// ---------------------------------------------------------------------------------------------------
// The swapped solver's footprint (criterion 3): every file under crates/ that names the feature.

export function namingFiles(word: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'target' || name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if ((name.endsWith('.rs') || name === 'Cargo.toml') && readFileSync(p, 'utf8').includes(word)) out.push(relative(REPO, p));
    }
  };
  walk(join(REPO, 'crates'));
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------
// The taste call (criterion 8): files kept for the PR and the session, and the call you record.

export const evidenceDir = (): string => process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-524-taste');
export const readPng = (dir: string, hash: JsonValue | undefined, what: string): Buffer => {
  expect(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), `${what}: the canvas's final PNG, named by its SHA-256, got ${show(hash)}`).toBe(true);
  const b = readFileSync(join(dir, `${hash as string}.png`));
  expect(sha256(b), `${what}: the PNG's SHA-256 is its name`).toBe(hash);
  return b;
};
