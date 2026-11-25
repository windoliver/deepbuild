// Test-side tools for the #2034 acceptance tests: the criteria's IDs; the five planted wrong programs; the `view3d`
// report this suite reads (`shadows.maps`, each row a light's tiles: README: The surface under test); the fixtures
// the criteria name (the hall, the threshold walk, the 32 lamps, the trio with `local_map`) and the merge base's
// binary AC6 compares with. Everything else is reused by import: #1634's runner, documents, frames and timing judge
// (`../1634/helpers.ts`), #425's hold channel (`../425/helpers.ts`), and this suite's CPU rule (`./reference.ts`).
// Nothing here stands in for the renderer, the tile rule or the cache: every value a test compares comes from a binary,
// every expected value from `reference.ts`.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { expect } from 'vitest';
import {
  DARK_SKY, REPO, box, cameraOf, isObject, matte, objs, point, runGpu as runGpu1634, sessionDoc, shown, shuffled, spot, str,
  type Frame, type JsonObject, type JsonValue, type Planted as Planted1634, type Size,
} from '../1634/helpers.ts';
import { holdChannel } from '../425/helpers.ts';
import { add, basis, scale, unit } from '../1634/reference.ts';
import type { Box, Lamp, Pinhole, Row, V3 } from './reference.ts';

/** The criteria's IDs: `#2034.` and the first 8 hex digits of SHA-256 of each criterion's text (README). */
export const AC = {
  1: 'AC1 #2034.07726d12', 2: 'AC2 #2034.f29824eb', 3: 'AC3 #2034.97fa2de4', 4: 'AC4 #2034.051fac12',
  5: 'AC5 #2034.1a79031a', 6: 'AC6 #2034.7732697b', 7: 'AC7 #2034.250d73ea',
} as const;

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'tile_arrival_order' | 'tile_keeps_fixed_caps' | 'tile_hysteresis' | 'tile_filter_in_texels' | 'tile_key_without_size';
/** #1634's runner, with this suite's planted names: its own type lists #1634's, so a name passes through it as text. */
export function runGpu(bin: string, out: string, calls: JsonObject[], o: { lane?: 'metal' | 'noop'; planted?: Planted } = {}): JsonObject[] {
  return runGpu1634(bin, out, calls, { ...(o.lane ? { lane: o.lane } : {}), ...(o.planted ? { planted: o.planted as unknown as Planted1634 } : {}) });
}

// ---------------------------------------------------------------------------------------------------
// The report: `shadows: true` on `view3d` (README: The surface under test)

/** One row of a frame's `shadows.maps`: a light's map or tiles. `size`, `slots` and `pixel_hash` are the tile mode's,
 * null where the row has none. */
export interface MapRow { light: string; kind: string; key: string; drawn: boolean; size: number | null; slots: number[] | null; hash: string | null }
export function mapsOf(f: Frame, what: string): MapRow[] {
  const s = f.raw['shadows'];
  expect(isObject(s), `${what} reports its shadows (shadows: true): ${shown(s)}`).toBe(true);
  return objs((s as JsonObject)['maps'], `${what}: shadows.maps`).map((m, i) => {
    const slots = m['slots'];
    return {
      light: str(m['light'], `${what}: shadows.maps[${i}].light`), kind: String(m['kind']), key: String(m['key']), drawn: m['drawn'] === true,
      size: typeof m['size'] === 'number' ? m['size'] : null,
      slots: Array.isArray(slots) && slots.every((v) => typeof v === 'number') ? [...(slots as number[])].sort((a, b) => a - b) : null,
      hash: typeof m['pixel_hash'] === 'string' ? m['pixel_hash'] : null,
    };
  });
}
const listed = (slots: readonly number[] | null): string => (slots ? `[${slots.join(', ')}]` : 'none');
/** How a frame's tiles differ from the rule's table, row by row in the rule's fill order (largest first, then ID), then
 * any light the rule gives no tile; each failure starts with `where` and names its light. */
export function tableProblems(where: string, maps: readonly MapRow[], rule: readonly Row[]): string[] {
  const failures: string[] = [];
  const got = new Map(maps.map((m) => [m.light, m]));
  for (const r of rule) {
    const m = got.get(r.light);
    if (!m) failures.push(`${where}: ${r.light} has no tile, where the rule gives it ${r.size} px at slots ${listed(r.slots)}`);
    else if (m.size === null || m.slots === null) failures.push(`${where}: ${r.light}'s map reports no tile (size ${shown(m.size)}, slots ${listed(m.slots)}), where the rule gives it ${r.size} px at slots ${listed(r.slots)}`);
    else if (m.size !== r.size || listed(m.slots) !== listed(r.slots)) failures.push(`${where}: ${r.light} holds ${m.size} px at slots ${listed(m.slots)}, where the rule gives ${r.size} px at slots ${listed(r.slots)}`);
  }
  const ruled = new Set(rule.map((r) => r.light));
  for (const m of maps) if (!ruled.has(m.light)) failures.push(`${where}: ${m.light} holds a tile the rule doesn't give it (${shown(m.size)} px at slots ${listed(m.slots)})`);
  return failures;
}
/** The sizes a frame reports, by light (null where a row has none). */
export const sizesOf = (maps: readonly MapRow[]): Map<string, number | null> => new Map(maps.map((m) => [m.light, m.size]));
/** The IDs a frame's `lights_over_budget` notices name in `shadows`: the lights whose shadow was dropped. */
export function droppedShadows(f: Frame, what: string): string[] {
  return f.notices.filter((n) => n['code'] === 'lights_over_budget').flatMap((n, i) => (n['shadows'] === undefined ? [] : ids(n['shadows'], `${what}: lights_over_budget[${i}].shadows`)));
}
function ids(v: JsonValue | undefined, what: string): string[] {
  expect(Array.isArray(v), `${what} is a list of light IDs, got ${shown(v)}`).toBe(true);
  return (v as JsonValue[]).map((x, i) => str(x, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Documents

const DOWN: V3 = [0, -1, 0];
/** A light of the rule's shape as a document item: `shadow: true`, its range and radius; a spot aimed straight down
 * (`at.rot` [−90, 0, 0] turns its −Z to −Y) with its cone. */
export function lampItem(l: Lamp): JsonObject {
  const params: JsonObject = { shadow: true, range: l.range, radius: l.radius ?? 0.05 };
  return l.kind === 'spot' ? spot(l.power, l.pos, [-90, 0, 0], { ...params, inner: l.inner!, outer: l.outer! }) : point(l.power, l.pos, params);
}
const described = (what: string): JsonObject => ({ description: `${what}: a #2034 acceptance fixture.` });
const boxItem = (b: Box): JsonObject => box(b.size, b.centre, 'grey');

/**
 * The hall (AC1, AC2, AC6, AC7): a grey floor (albedo 0.5) 50 × 24 m with a wall 44 m long, 2 m tall and 0.2 m thick
 * down its middle along x; 16 spots `spot_01` … `spot_16` 2.4 m up and 0.5 m off the wall's line (01 to 08 on its −z
 * side, 09 to 16 on its +z side) every 5 m from x = −17.5 to 17.5, aimed straight down, cones 50° and 60°, 120 lm,
 * ranges 4.5, 7.5, 6.5, 5.5 m by turns; two point lights `point_1` at (−10, 1.6, −0.6) and `point_2` at (10, 1.6,
 * 0.6), 60 lm, range 6 m; every light radius 0.05 m and `shadow: true`, created in a seeded shuffled order (so the
 * document's order is neither the IDs' nor the sizes'). No sun and a black sky. The light policy names no counts:
 * `soft: {method: pcss}` unless a test gives another. A work product at 1920 × 1080.
 */
export const HALL = { size: [1920, 1080] as Size, rho: 0.5, fov: 60, near: 0.1 };
const HALL_RANGES = [4.5, 5.5, 6.5, 7.5];
export const HALL_LAMPS: Lamp[] = [
  { id: 'point_1', kind: 'point', pos: [-10, 1.6, -0.6], range: 6, power: 60, radius: 0.05 },
  { id: 'point_2', kind: 'point', pos: [10, 1.6, 0.6], range: 6, power: 60, radius: 0.05 },
  ...Array.from({ length: 16 }, (_, k): Lamp => ({
    id: `spot_${String(k + 1).padStart(2, '0')}`, kind: 'spot', pos: [-17.5 + 5 * (k % 8), 2.4, k < 8 ? -0.5 : 0.5],
    range: HALL_RANGES[(3 * k) % 4]!, power: 120, radius: 0.05, aim: DOWN, inner: 50, outer: 60,
  })),
];
export const HALL_BOXES: Box[] = [
  { id: 'floor', centre: [0, -0.1, 0], size: [50, 0.2, 24] },
  { id: 'wall', centre: [0, 1, 0], size: [44, 2, 0.2] },
];
const hallCam = (position: V3, target: V3 = [0, 0, 0]): Pinhole => ({ position, target, fov: HALL.fov, size: HALL.size, near: HALL.near });
/** The hall's 8 poses (AC1), numbered from 1. At each the policy shades all 18 lights and every diameter sits at
 * least 2% from 128, 256 and 512 px (README: The hall's poses). `above` is AC2's and AC7's, `inside` AC6's. */
export const HALL_POSES: { name: string; cam: Pinhole }[] = [
  { name: 'far', cam: hallCam([0, 87.2, -98.1]) },
  { name: 'overview', cam: hallCam([0, 23.4, -27]) },
  { name: 'inside', cam: hallCam([-21, 2, -2]) },
  { name: 'east end', cam: hallCam([24.6, 6.8, 5.1], [-6, 0, 0]) },
  { name: 'north', cam: hallCam([5.5, 44, 49.5]) },
  { name: 'oblique', cam: hallCam([-46.75, 23.8, -38.25]) },
  { name: 'east far', cam: hallCam([44, 15, 6]) },
  { name: 'above', cam: hallCam([0, 40, -12]) },
];
export const ABOVE = HALL_POSES[7]!.cam;
export const HALL_POLICY: JsonObject = { soft: { method: 'pcss' } };
export function hallDoc(name: string, cam: Pinhole, policy: JsonObject = HALL_POLICY): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(cam), sky: DARK_SKY, grey: matte(HALL.rho) };
  for (const b of HALL_BOXES) items[b.id] = boxItem(b);
  for (const l of shuffled(HALL_LAMPS, 2034)) items[l.id] = lampItem(l);
  return sessionDoc(name, HALL.size, 'work_product', items, { ...described('The hall'), light_policy: policy });
}

/**
 * The threshold walk (AC3, AC4, AC5): a grey floor 16 × 16 m; `edge_lamp`, a spot 3 m over the origin aimed down
 * (cones 50° and 60°, 400 lm, radius 0.5 m, range 6 m); `board`, a board 0.1 m thick, 1.5 m tall and 4 m long
 * standing across x = 1.15 to 1.25 m, so the lamp throws a soft straight edge along z near x = 2.5 m on the floor
 * (from the board's top far edge); `side_lamp_1` 3 m over (−6, 0) and `side_lamp_2` 3 m over (6, 4), spots aimed down
 * (cones 30° and 40°, 200 lm, radius 0.05 m, ranges 4 and 3.5 m), so the document has three shadowed spots and uses
 * tiles; `crate`, a 0.5 m cube on the floor at (−7, 1), inside `side_lamp_1`'s range and 7.2 m or more from
 * `edge_lamp`, outside its range. The light policy names no counts: `soft: {method: pcss, max_penumbra: 64}`. A work
 * product at 1280 × 720, 25 frames a second (so each hold key sits at a whole number of flicks), fov 50°.
 *
 * The camera aims at (2.5, 0, 0) from the edge lamp's position plus d times the unit vector of (0.3, 1, −0.6), so it
 * looks down on the edge from the side the shadow falls, held frame by frame (#425's hold channels on
 * `items/cam/params/position/0..2`, f32), with d per frame from `WALK_FRAMES`: D* ± offsets, where D* is the distance
 * at which the lamp's 6 m range sphere spans 256 px exactly, so the lamp asks 512 px nearer than D* and 256 px
 * beyond it. Frame 11 also moves the crate away to x = −7.5 (`items/crate/at/pos/0`).
 */
export const WALK = { size: [1280, 720] as Size, fov: 50, near: 0.1, fps: 25, rho: 0.5, target: [2.5, 0, 0] as V3, out: unit([0.3, 1, -0.6]) };
export const EDGE: Lamp = { id: 'edge_lamp', kind: 'spot', pos: [0, 3, 0], range: 6, power: 400, radius: 0.5, aim: DOWN, inner: 50, outer: 60 };
export const WALK_LAMPS: Lamp[] = [
  EDGE,
  { id: 'side_lamp_1', kind: 'spot', pos: [-6, 3, 0], range: 4, power: 200, radius: 0.05, aim: DOWN, inner: 30, outer: 40 },
  { id: 'side_lamp_2', kind: 'spot', pos: [6, 3, 4], range: 3.5, power: 200, radius: 0.05, aim: DOWN, inner: 30, outer: 40 },
];
export const BOARD: Box = { id: 'board', centre: [1.2, 0.75, 0], size: [0.1, 1.5, 4] };
export const CRATE = { size: [0.5, 0.5, 0.5] as V3, at: [-7, 0.25, 1] as V3, movedX: -7.5 };
/** The distance from the edge lamp at which its range sphere's diameter on screen is 256 px. */
export const D_STAR = Math.sqrt(EDGE.range ** 2 + ((2 * basis({ position: [0, 0, 0], target: [0, 0, 1], fov: WALK.fov, size: WALK.size, near: WALK.near }).focal * EDGE.range) / 256) ** 2);
/** Each frame's offset of the eye from D*, m, and whether the crate has moved: out across the threshold (frames 0–3,
 * A at 2 and B at 3), on out and back in (frames 4–8, B at 7 and A at 8), on in, then the crate moves (frame 11). */
const OFFSETS = [-0.51, -0.11, -0.01, 0.01, 0.11, 0.51, 0.11, 0.01, -0.01, -0.11, -0.51, -0.51];
export const WALK_FRAMES = OFFSETS.map((o, n) => ({ d: D_STAR + o, crateMoved: n >= 11 }));
/** The two poses 1 cm either side of the threshold, and the frames that reach them moving out, moving in and (AC3's
 * second call, opened at frame 10 and sought to 3, then 8) by seeking. */
export const POSE_A = { name: 'A (1 cm nearer than the threshold)', out: 2, in: 8, sought: 8 };
export const POSE_B = { name: 'B (1 cm beyond the threshold)', out: 3, in: 7, sought: 3 };
/** The eye at frame n, each coordinate rounded to f32 as the hold channel holds it. */
export const walkEye = (n: number): V3 => add(EDGE.pos, scale(WALK.out, WALK_FRAMES[n]!.d)).map((v) => Math.fround(v)) as V3;
export const walkCam = (n: number): Pinhole => ({ position: walkEye(n), target: WALK.target, fov: WALK.fov, size: WALK.size, near: WALK.near });
export function walkDoc(name: string, o: { board?: boolean; cache?: 'none' } = {}): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(walkCam(0)), sky: DARK_SKY, grey: matte(WALK.rho), floor: box([16, 0.2, 16], [0, -0.1, 0], 'grey') };
  if (o.board !== false) items['board'] = boxItem(BOARD);
  items['crate'] = box(CRATE.size, CRATE.at, 'grey');
  for (const l of WALK_LAMPS) items[l.id] = lampItem(l);
  const eyes = WALK_FRAMES.map((_, n) => walkEye(n));
  const channels: JsonObject = {
    cam_x: holdChannel('items/cam/params/position/0', eyes.map((e) => e[0]), WALK.fps),
    cam_y: holdChannel('items/cam/params/position/1', eyes.map((e) => e[1]), WALK.fps),
    cam_z: holdChannel('items/cam/params/position/2', eyes.map((e) => e[2]), WALK.fps),
    crate_x: holdChannel('items/crate/at/pos/0', WALK_FRAMES.map((f) => (f.crateMoved ? CRATE.movedX : CRATE.at[0])), WALK.fps),
  };
  const policy: JsonObject = { soft: { method: 'pcss', max_penumbra: 64 }, ...(o.cache ? { cache: o.cache } : {}) };
  return sessionDoc(name, WALK.size, 'work_product', items, { ...described('The threshold walk'), light_policy: policy, channels });
}

/** The 32 lamps (AC2): point lights `lamp_01` … `lamp_32` on an 8 × 4 grid 2.5 m apart, 1.5 m over a grey floor
 * 24 × 14 m, 40 lm, range 3 m, radius 0.05 m, `shadow: true`; the policy names no counts; 960 × 540, the eye at
 * (0, 12, −14) on the origin, fov 60°, where the policy shades all 32. */
export const LAMPS32 = { size: [960, 540] as Size, cam: { position: [0, 12, -14], target: [0, 0, 0], fov: 60, size: [960, 540], near: 0.1 } as Pinhole };
export const LAMPS32_LIGHTS: Lamp[] = Array.from({ length: 32 }, (_, k) => ({
  id: `lamp_${String(k + 1).padStart(2, '0')}`, kind: 'point', pos: [-8.75 + 2.5 * (k % 8), 1.5, -3.75 + 2.5 * Math.floor(k / 8)], range: 3, power: 40, radius: 0.05,
}));
export function lamps32Doc(): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(LAMPS32.cam), sky: DARK_SKY, grey: matte(0.5), floor: box([24, 0.2, 14], [0, -0.1, 0], 'grey') };
  for (const l of LAMPS32_LIGHTS) items[l.id] = lampItem(l);
  return sessionDoc('lamps-32', LAMPS32.size, 'work_product', items, { ...described('32 shadowed point lights'), light_policy: HALL_POLICY });
}

/** The trio (AC6, the issue's Scope on `local_map`): three shadowed spots `trio_1` … `trio_3` 3 m over (−3, −1),
 * (0, 0) and (3.5, 1), aimed down (cones 30° and 40°, 300, 340 and 380 lm, range 6 m), each over a post 1.2 m tall,
 * on a grey floor; `light_policy: {local_map: 1024}` and no counts. 640 × 360, the eye at (0, 7, −7) on the origin. */
export function trioDoc(): JsonObject {
  const cam: Pinhole = { position: [0, 7, -7], target: [0, 0, 0], fov: 50, size: [640, 360], near: 0.1 };
  const items: Record<string, JsonObject> = { cam: cameraOf(cam), sky: DARK_SKY, grey: matte(0.5), floor: box([12, 0.2, 8], [0, -0.1, 0], 'grey') };
  const spots: [V3, number][] = [[[-3, 3, -1], 300], [[0, 3, 0], 340], [[3.5, 3, 1], 380]];
  spots.forEach(([pos, power], k) => {
    items[`trio_${k + 1}`] = lampItem({ id: `trio_${k + 1}`, kind: 'spot', pos, range: 6, power, radius: 0.05, aim: DOWN, inner: 30, outer: 40 });
    items[`post_${k + 1}`] = box([0.3, 1.2, 0.3], [pos[0] + 0.5, 0.6, pos[2] + 0.5], 'grey');
  });
  return sessionDoc('trio-local-map', [640, 360], 'work_product', items, { ...described('Three shadowed spots naming local_map'), light_policy: { local_map: 1024 } });
}

// ---------------------------------------------------------------------------------------------------
// AC6: the merge base's tree and binary. Git runs with every GIT_* variable taken out of its environment, so a hook's
// or a worktree's settings can't point it at another repository; the tree is exported with `git archive` (no .git is
// copied) and built in a target folder of its own.

const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
export function git(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: gitEnv(), maxBuffer: 1 << 28 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: `${r.error?.message ?? ''}${r.stderr ?? ''}` };
}
/** `git merge-base HEAD origin/main`, else `main`; '' when neither answers. */
export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) { const r = git(['merge-base', 'HEAD', ref]); if (r.ok && r.out.trim()) return r.out.trim(); }
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
export interface Base { rev: string; src: string; bin: string }
/** The merge base's tree, exported once into `<target>/acceptance-2034-base/src-<rev>`, and its `deep-gpu` built there
 * into `<target>/acceptance-2034-base/target`, copied into `scratch`; or the step that failed. */
export function mergeBaseGpu(scratch: string): Base | string {
  const rev = mergeBase();
  if (!rev) return 'git merge-base HEAD origin/main (or main) gave no commit';
  const own = join(targetDir(), 'acceptance-2034-base');
  const src = join(own, `src-${rev.slice(0, 12)}`);
  if (!existsSync(join(src, '.exported'))) {
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    const tar = `${src}.tar`;
    const a = git(['archive', '--format=tar', '-o', tar, rev]);
    if (!a.ok) return `git archive ${rev} failed: ${a.err}`;
    const x = spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' });
    rmSync(tar, { force: true });
    if (x.status !== 0) return `unpacking the merge base ${rev} failed: ${x.stderr}`;
    writeFileSync(join(src, '.exported'), rev);
  }
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const env = {
    ...gitEnv(), PATH: existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : (process.env['PATH'] ?? ''),
    CARGO_TARGET_DIR: join(own, 'target'), CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const args = ['build', '--locked', '--bin', 'deep-gpu'];
  const b = spawnSync('cargo', args, { cwd: src, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (b.status !== 0) return `cargo ${args.join(' ')} at the merge base ${rev} failed: ${b.error?.message ?? ''}${(b.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  const bin = join(scratch, 'deep-gpu-merge-base');
  copyFileSync(join(own, 'target', 'debug', 'deep-gpu'), bin);
  return { rev, src, bin };
}

/** A scene document found in a fixture file: where, and whether the criterion holds it (README: AC6's fixtures). */
export interface Fixture { name: string; doc: JsonObject; held: boolean; why: string }
/** Whether AC6 holds a document: it names `spots` or `points` under `light_policy.shadowed`, or declares at most 2
 * spots and no point or area light with `shadow: true`. */
export function heldByAc6(doc: JsonObject): { held: boolean; why: string } {
  const policy = doc['light_policy'];
  const shadowed = isObject(policy) ? policy['shadowed'] : undefined;
  if (isObject(shadowed) && ('spots' in shadowed || 'points' in shadowed)) return { held: true, why: 'names counts' };
  const items = isObject(doc['items']) ? Object.values(doc['items']) : [];
  const lit = (kind: RegExp): number => items.filter((i) => isObject(i) && typeof i['kind'] === 'string' && kind.test(i['kind']) && isObject(i['params']) && i['params']['shadow'] === true).length;
  const [spots, others] = [lit(/^light\.spot@/), lit(/^light\.(point|area)@/)];
  return spots <= 2 && others === 0 ? { held: true, why: `${spots} shadowed spots, no shadowed point` } : { held: false, why: `${spots} shadowed spots and ${others} shadowed point or area lights, no counts named` };
}
/** Every scene document (`profile: scene` with items) in the merge base's JSON files, outside `docs/evidence/` (run
 * outputs), read from its exported tree, nested up to four levels deep in a file. */
export function sceneFixtures(base: Base): Fixture[] {
  const listedFiles = git(['ls-tree', '-r', '--name-only', base.rev]);
  expect(listedFiles.ok, `git ls-tree ${base.rev}: ${listedFiles.err}`).toBe(true);
  const out: Fixture[] = [];
  for (const path of listedFiles.out.split('\n').filter((p) => p.endsWith('.json') && !p.startsWith('docs/evidence/'))) {
    let text: string;
    try { text = readFileSync(join(base.src, path), 'utf8'); } catch { continue; }
    if (!/"profile"\s*:\s*"scene"/.test(text)) continue;
    let parsed: JsonValue;
    try { parsed = JSON.parse(text) as JsonValue; } catch { continue; }
    const found: { at: string; doc: JsonObject }[] = [];
    const walk = (v: JsonValue | undefined, at: string, depth: number): void => {
      if (!isObject(v) && !Array.isArray(v)) return;
      if (isObject(v) && v['profile'] === 'scene' && isObject(v['items'])) { found.push({ at, doc: v }); return; }
      if (depth >= 4) return;
      for (const [k, x] of Object.entries(v)) walk(x, `${at}/${k}`, depth + 1);
    };
    walk(parsed, '', 0);
    for (const f of found) out.push({ name: `${path}${f.at ? `#${f.at}` : ''}`, doc: f.doc, ...heldByAc6(f.doc) });
  }
  return out;
}
