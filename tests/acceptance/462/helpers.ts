// Test-side tools for the #462 acceptance tests (README: The surface under test). They reuse #449's suite helpers for
// building binaries, one `deep-gpu run` scenario, the GPU guard, failures as sentences and the animated PNG of the
// canvas's own frames, and #382's for the status report, PNG reading, the most common pixel and the clean look's status
// map; and add this suite's criterion IDs and planted names, its looks and fixture documents, the orbit camera and its
// projection worked out from the document, the readers of the fields this suite adds (each frame's strokes, a refusal
// naming a shot and a time, the film's document hashes), and the canvas core's revision hash through
// `deep-canvas canonical`. Nothing here stands in for the look module, the renderer or the check.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  FLICKS, REPO, arr, inconclusive, isObject, num, obj, runGpu, show, str,
  type BinName, type JsonObject, type JsonValue, type Startup, type V3,
} from '../449/helpers.ts';
import { look3, mode, type Image, type Rgb, type State } from '../382/helpers.ts';

export {
  FLICKS, REPO, SHA, TIMEOUT, apng, failsNaming, fmt, inconclusive, none, requireGpu, sha256, show, useBins, useDir, writeJson,
  type JsonObject, type JsonValue, type V3,
} from '../449/helpers.ts';
export { STATUS, fromHex, hex, mode, pixel, readPng, statusOf, type Image, type Rgb, type State } from '../382/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
const CRITERIA = { 1: '#462.c53608f8', 2: '#462.1b887b5d', 3: '#462.2e279aeb', 4: '#462.aac0f1f4', 5: '#462.28d871fe' } as const;
/** A test title's prefix: `AC<n> #462.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** The `deep-gpu --planted` names this suite adds (README: Planted programs). */
export type Planted = 'strokes_from_previous_frame' | 'region_sides_clip_independently' | 'status_in_look' | 'motifs_write_document';
/** One `deep-gpu run` scenario (#449's runGpu), under this suite's planted name when given. */
export function run(bin: string, out: string, calls: JsonObject[], s: { planted?: Planted } = {}): JsonObject[] {
  return runGpu(bin, out, calls, s as unknown as Startup);
}
/** #449's `useBins` builds any workspace binary by name (`cargo build --locked --bin <name>`); its type lists the two it needed. */
export const DEEP_CANVAS = 'deep-canvas' as unknown as BinName;

/** The canvas core's revision hash of a document: `deep-canvas canonical` (#389), its `sha256`. */
export function revisionHash(bin: string, doc: JsonObject): string {
  const ran = spawnSync(bin, ['canonical'], { cwd: REPO, input: `${JSON.stringify({ doc })}\n`, encoding: 'utf8' });
  if (ran.error) throw Error(`deep-canvas canonical: ${ran.error.message}`);
  expect(ran.status, `deep-canvas canonical exits 0; stderr: ${(ran.stderr ?? '').slice(-1500)}`).toBe(0);
  const answer = obj(JSON.parse((ran.stdout ?? '').split('\n')[0] ?? 'null') as JsonValue, 'deep-canvas canonical: the answer');
  return str(answer['sha256'], `deep-canvas canonical names the document's hash: ${show(answer)}`);
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Document fields). 3D documents are whole session documents, as #449's are: one writer layer.

const SIZE: [number, number] = [480, 270];
function doc3(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-462-${slug}`, profile: 'scene', title, description: `${title}: a #462 acceptance fixture.`, size: SIZE, seed: 462,
    camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
const box = (size: V3, pos: V3, role: string, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size, paint: { fill: { role } } }, at: { pos }, ...extra });
/** A sun shining straight along −Z (its `toward` is +Z), as #382's film has it: a +Z face it and the camera both face draws its role's color exactly. */
const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } };
const linear = (target: string, keys: readonly (readonly [number, number])[], interp: 'linear' | 'hold' = 'linear'): JsonObject => ({
  target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp }])),
});

// ---------------------------------------------------------------------------------------------------
// The camera, worked out from the document (Units and axes; camera@1: the eye at target + distance ·
// (cos el · sin az, sin el, cos el · cos az), the field of view across the wider side, screen right = forward × +Y)

interface Cam { eye: V3; right: V3; up: V3; forward: V3; scale: number; centre: [number, number] }
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
const rad = (d: number): number => (d * Math.PI) / 180;
function orbitCam(target: V3, azimuth: number, elevation: number, distance: number, fov: number, size: [number, number]): Cam {
  const dir: V3 = [Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))];
  const eye: V3 = [target[0] + distance * dir[0], target[1] + distance * dir[1], target[2] + distance * dir[2]];
  const forward = unit(sub(target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  return { eye, forward, right, up: cross(right, forward), scale: Math.max(...size) / 2 / Math.tan(rad(fov) / 2), centre: [size[0] / 2, size[1] / 2] };
}
/** Where a world point lands in frame px (origin at the frame's top left corner, x right, y down), or null behind the eye. */
export function project(c: Cam, p: V3): [number, number] | null {
  const d = sub(p, c.eye);
  const z = dot(d, c.forward);
  if (z <= 0) return null;
  return [c.centre[0] + (c.scale * dot(d, c.right)) / z, c.centre[1] - (c.scale * dot(d, c.up)) / z];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: strokes on three boxes through an orbit

/** The orbit: the camera's azimuth keyed linearly from 20° to 110° over the 3 s transport, played at 15 fps (frames 0 to 45). */
export const ORBIT = { from: 20, to: 110, elevation: 25, distance: 7, target: [0, 0.6, 0] as V3, fov: 40, span: 3, fps: 15, frames: 46 } as const;
export const BOXES: Readonly<Record<string, { size: V3; pos: V3 }>> = {
  plinth: { size: [3, 0.4, 3], pos: [0, 0.2, 0] },
  block: { size: [1.2, 1.2, 1.2], pos: [-0.3, 1.0, 0.2] },
  tower: { size: [0.5, 1.8, 0.5], pos: [0.9, 1.3, -0.7] },
};
export function orbitDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [...ORBIT.target], orbit: { azimuth: ORBIT.from, elevation: ORBIT.elevation, distance: ORBIT.distance }, fov: ORBIT.fov, near: 0.1 } },
    sun: { ...SUN, at: { rot: [-50, 30, 0] } },
  };
  for (const [id, b] of Object.entries(BOXES)) items[id] = box(b.size, b.pos, 'body');
  return doc3('Strokes through an orbit', items, {
    transport: { span: `${ORBIT.span}s` },
    channels: { orbit: linear('items/cam/params/orbit/azimuth', [[0, ORBIT.from], [ORBIT.span, ORBIT.to]]) },
  });
}
/** The camera frame `n` is drawn through, at fps `fps`: frame n is at ⌊n × flicks ÷ fps⌋ (#449's frameFlicks), the azimuth the channel's line there. */
export function orbitCamAt(n: number, fps: number, size: [number, number] = SIZE): Cam {
  const s = Math.floor((n * FLICKS) / fps) / FLICKS;
  return orbitCam([...ORBIT.target], ORBIT.from + ((ORBIT.to - ORBIT.from) * s) / ORBIT.span, ORBIT.elevation, ORBIT.distance, ORBIT.fov, size);
}

export type StrokeLook = 'brush' | 'dab' | 'dot';
/** The three stroke looks' `strokes` (README: Document fields): brush, dab and dot, by size, orientation, palette and layers. */
const STROKES: Record<StrokeLook, JsonObject> = {
  brush: { on: 'all', density: 0.006, size: [4, 12], orient: { surface: 'u' }, palette: { body: ['c-stroke-a', 'c-stroke-b'] }, layers: 2, seed: 'item' },
  dab: { on: 'all', density: 0.004, size: [7, 9], orient: { surface: 'v' }, palette: { body: ['c-stroke-b', 'c-stroke-c'] }, layers: 1, seed: 'item' },
  dot: { on: 'all', density: 0.01, size: [3, 3], orient: { surface: 'u' }, palette: { body: ['c-stroke-c'] }, layers: 3, seed: 'item' },
};
const STROKE_ROLES: Record<string, Rgb> = { body: [196, 182, 158], 'stroke-a': [214, 160, 96], 'stroke-b': [246, 226, 170], 'stroke-c': [120, 150, 210] };
/** A stroke look: #382's physical acceptance look (tone map none at unit exposure) with `strokes`; `null` the same look without them. */
export function strokeLook(name: StrokeLook, strokes = true): JsonObject {
  const look = look3(`strokes-${name}-462`, STROKE_ROLES) as JsonObject;
  return strokes ? { ...look, strokes: STROKES[name] } : look;
}

interface Stroke { id: string; item: string; anchor: V3; at: [number, number] }
export interface StrokeFrame { frame: number; pixelHash: string; final: string | null; strokes: Stroke[] }
const vec = (v: JsonValue | undefined, n: number, what: string): number[] => {
  const a = arr(v, what);
  expect(a.length, `${what} has ${n} numbers`).toBe(n);
  return a.map((x, i) => num(x, `${what}[${i}]`));
};
/** A `view3d` reply's frames with this suite's `strokes` field (README: view3d, `strokes`). */
export function strokeFrames(reply: JsonObject, what: string): StrokeFrame[] {
  drawn(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${String(f['frame'])}`;
    const strokes = arr(f['strokes'], `${at}: strokes (README: view3d's strokes field)`).map((s, k): Stroke => {
      const o = obj(s, `${at}: strokes[${k}]`);
      return {
        id: str(o['id'], `${at}: strokes[${k}].id`), item: str(o['item'], `${at}: strokes[${k}].item`),
        anchor: vec(o['anchor'], 3, `${at}: strokes[${k}].anchor`) as V3, at: vec(o['at'], 2, `${at}: strokes[${k}].at`) as [number, number],
      };
    });
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixelHash: str(f['pixel_hash'], `${at}: pixel_hash`), final: typeof f['final'] === 'string' ? f['final'] : null, strokes };
  });
}
/** How far a point lies from a box's surface (m): the largest of |p − centre| − half size over the axes, by absolute value. */
export function offSurface(p: V3, b: { size: V3; pos: V3 }): number {
  return Math.abs(Math.max(...[0, 1, 2].map((k) => Math.abs(p[k]! - b.pos[k]!) - b.size[k]! / 2)));
}

// ---------------------------------------------------------------------------------------------------
// Criteria 2 and 3: a slab split by a region's edge, seen straight on

/**
 * The edge films' scene: a camera on the +Z axis at 7 m, aimed at (0, 0.5, 0); a sun shining along −Z; a slab 4 m wide,
 * 0.8 m tall and 0.2 m deep centred at (0, 0.5, 0), whose front face faces both and draws its role's color exactly in a
 * look with tone map none at unit exposure (#382's film); and the region's mask `zone`, an unseen box covering x ≥ 0,
 * so the slab's right half is inside the region and the edge crosses it at x = 0, the frame's middle column.
 */
const EDGE = { target: [0, 0.5, 0] as V3, distance: 7, fov: 40, slab: { size: [4, 0.8, 0.2] as V3, pos: [0, 0.5, 0] as V3 } } as const;
const edgeCam = (size: [number, number] = SIZE): Cam => orbitCam([...EDGE.target], 0, 0, EDGE.distance, EDGE.fov, size);
/** The slab's front face on screen, [x0, y0, x1, y1] px. */
function slabFace(size: [number, number] = SIZE): [number, number, number, number] {
  const { size: s, pos: p } = EDGE.slab;
  const c = edgeCam(size);
  const z = p[2] + s[2] / 2;
  const lo = project(c, [p[0] - s[0] / 2, p[1] + s[1] / 2, z])!;
  const hi = project(c, [p[0] + s[0] / 2, p[1] - s[1] / 2, z])!;
  return [lo[0], lo[1], hi[0], hi[1]];
}
/** The slab front face's pixels whose centres lie at least `margin` px inside it (clear of its antialiased silhouette). */
export function slabPixels(margin = 3, size: [number, number] = SIZE): [number, number][] {
  const [x0, y0, x1, y1] = slabFace(size);
  const out: [number, number][] = [];
  for (let y = Math.ceil(y0 + margin - 0.5); y + 0.5 <= y1 - margin; y++) for (let x = Math.ceil(x0 + margin - 0.5); x + 0.5 <= x1 - margin; x++) out.push([x, y]);
  return out;
}
/** The edge's column on screen (x = 0 on the slab's front face). */
export const edgeColumn = (size: [number, number] = SIZE): number => project(edgeCam(size), [0, EDGE.slab.pos[1], EDGE.slab.pos[2] + EDGE.slab.size[2] / 2])![0];

/** The slab's color in each of the coverage tests' four looks: red 240 in every one, so a pixel mixed from any of them keeps red 240 exactly when their coverage sums to one. */
export const BODY: Record<'a' | 'b' | 'c' | 'd', Rgb> = { a: [240, 210, 130], b: [240, 150, 230], c: [240, 110, 60], d: [240, 250, 180] };
/** A coverage look: #382's physical acceptance look, so the slab's front face draws `body` exactly. */
const coverageLook = (name: keyof typeof BODY): JsonObject => look3(`edge-${name}-462`, { body: BODY[name], post: [250, 250, 250] }) as JsonObject;
export const COVERAGE_LOOKS = (): Record<string, JsonObject> => ({ a: coverageLook('a'), b: coverageLook('b'), c: coverageLook('c'), d: coverageLook('d') });

/** The status test's looks: each tone maps or exposes differently, and the region looks and the second shot's look carry status maps of their own. */
const OWN_STATUS: Partial<Record<State, string>> = { fail: '#b93c85', running: '#1f7a8c' };
const toneLook = (id: string, body: Rgb, tone: string, exposure: number, own: boolean): JsonObject =>
  ({ ...(look3(`${id}-462`, { body, post: [250, 250, 250] }, own ? { status: OWN_STATUS } : {}) as JsonObject), tone_map: tone, exposure });
export const STATUS_LOOKS = (): Record<string, JsonObject> => ({
  a: toneLook('status-a', [250, 230, 190], 'filmic', 0, false),
  b: toneLook('status-b', [225, 238, 252], 'agx', 0.5, true),
  c: toneLook('status-c', [242, 222, 242], 'neutral', -0.5, true),
  d: toneLook('status-d', [222, 250, 222], 'filmic', 1, true),
});
/** The document's own look in the status test: the clean status map, tone map none; no shot or region names it. */
export const documentLook = (): JsonObject => look3('status-document-462', { body: [236, 236, 230], post: [250, 250, 250] }) as JsonObject;

type EdgeKind = 'straight' | 'torn' | 'pixel' | 'brush';
const region = (mask: string, look: string, edge: EdgeKind, seed: number): JsonObject => ({ mask, look, edge, width: 16, seed });
const pose = { move: 'hold', target: [...EDGE.target], orbit: { azimuth: 0, elevation: 0, distance: EDGE.distance } };
/** The verdict handles the status test binds (README: Fixtures). */
export const VERDICTS = { left: 'verdict:01JB4620000000000000000462', right: 'verdict:01JB4620000000000000000463' } as const;

/**
 * An edge film (README: Fixtures). `split`: one 4 s shot in look a whose region (the zone) is in look b. `fade`: shot
 * `one` (0–2 s, look a, region b) and shot `two` (2–4 s, look c, region d) joined by a 1 s cross-fade centred on 2 s;
 * with `status`, two posts above the slab, `post-l` outside the zone and `post-r` inside it, their badges bound to
 * two verdicts. `crowded`: one 4 s shot `crowded` in look a with the zone in look b and, when `third`, a second region
 * in look c whose mask `zone2` waits far off screen until 2 s and then covers the slab's left end.
 */
export function edgeDoc(variant: 'split' | 'fade' | 'crowded', opts: { edge?: EdgeKind; status?: boolean; third?: boolean } = {}): JsonObject {
  const edge = opts.edge ?? 'torn';
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [...EDGE.target], orbit: { azimuth: 0, elevation: 0, distance: EDGE.distance }, fov: EDGE.fov, near: 0.1 } },
    sun: SUN,
    slab: box([...EDGE.slab.size], [...EDGE.slab.pos], 'body'),
    zone: box([4, 3, 3], [2, 0.5, 0], 'body', { visible: false }),
  };
  const extra: JsonObject = { transport: { span: '4s' } };
  if (variant === 'split') {
    extra['shots'] = { one: { start: '0s', end: '4s', camera: 'cam', ...pose, look: 'a', regions: [region('zone', 'b', edge, 3)] } };
  } else if (variant === 'fade') {
    extra['shots'] = {
      one: { start: '0s', end: '2s', camera: 'cam', ...pose, look: 'a', regions: [region('zone', 'b', 'torn', 3)] },
      two: { start: '2s', end: '4s', camera: 'cam', ...pose, look: 'c', regions: [region('zone', 'd', 'brush', 5)] },
    };
    extra['transitions'] = { fade: { from: 'one', to: 'two', kind: 'cross_fade', span: '1s', align: 'center' } };
    if (opts.status) {
      items['post-l'] = box([0.4, 0.4, 0.4], [-1.4, 1.5, 0], 'post');
      items['post-r'] = box([0.4, 0.4, 0.4], [1.4, 1.5, 0], 'post');
      extra['status_bindings'] = {
        'b-left': { target: 'items/post-l/params/paint/badge', source: VERDICTS.left },
        'b-right': { target: 'items/post-r/params/paint/badge', source: VERDICTS.right },
      };
    }
  } else {
    items['zone2'] = box([1, 3, 3], [30, 0.5, 0], 'body', { visible: false });
    extra['channels'] = { arrive: linear('items/zone2/at/pos/0', [[0, 30], [2, -1.5]], 'hold') };
    extra['shots'] = { crowded: { start: '0s', end: '4s', camera: 'cam', ...pose, look: 'a', regions: [region('zone', 'b', edge, 3), ...(opts.third ? [region('zone2', 'c', edge, 4)] : [])] } };
  }
  return doc3(`Edge ${variant}${opts.status ? ' with status' : ''}${opts.third ? ' with a third look' : ''}`, items, extra);
}

/** A `view3d` call with this suite's fields (README: The surface under test). */
interface View3 {
  doc: string; look: JsonObject; looks?: Record<string, JsonObject>; size?: [number, number]; fps?: number; from?: number; frames?: number;
  strokes?: boolean; capture?: 'every' | number[]; targets?: string[]; states?: Record<string, string>;
}
export const view3d = (c: View3): JsonObject => ({ call: 'view3d', size: SIZE, ...(c as unknown as JsonObject) });

/** A reply that drew frames: INCONCLUSIVE where the platform can't draw, a failure naming the refusal otherwise. */
export function drawn(reply: JsonObject, what: string): void {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  arr(reply['frames'], `${what}: frames`);
}
export interface Shot { frame: number; pixelHash: string; final: string | null }
export function framesOf(reply: JsonObject, what: string): Shot[] {
  drawn(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixelHash: str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`), final: typeof f['final'] === 'string' ? f['final'] : null };
  });
}
export function frameAt(frames: readonly Shot[], n: number, what: string): Shot {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}

/** Every object at any depth of a refusal that names `shot` with a whole-flick `t` (README: the three-look refusal). */
export function shotTimes(v: JsonValue | undefined, shot: string): number[] {
  if (Array.isArray(v)) return v.flatMap((x) => shotTimes(x, shot));
  if (!isObject(v)) return [];
  const here = v['shot'] === shot && typeof v['t'] === 'number' && Number.isInteger(v['t']) ? [v['t']] : [];
  return [...here, ...Object.values(v).flatMap((x) => shotTimes(x, shot))];
}

/** The most common color of the slab pixels `keep` holds, in `image`. */
export const slabMode = (image: Image, keep: (x: number) => boolean, margin = 3): { color: Rgb; count: number; total: number } => {
  const inside = new Set(slabPixels(margin, [image.width, image.height]).map(([x, y]) => y * image.width + x));
  return mode(image, (x, y) => inside.has(y * image.width + x) && keep(x));
};
export const near = (a: Rgb, b: Rgb, codes: number): boolean => a.every((v, k) => Math.abs(v - b[k]!) <= codes);
export const rgbText = (c: Rgb): string => `(${c.join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// Criterion 4: a 2D film whose look adds motifs (film2d)

/** The motif film's frame rate, its length and the reading hold's span (README: Fixtures). */
export const MOTIF = { fps: 30, frames: 120, hold: { from: 1.5, to: 3 } } as const;
/** The clean look (crates/deep-canvas-marks/looks/clean.json at the base), with the motifs the film's slots take, or none. */
export function motifLook(motifs: boolean): JsonObject {
  const clean = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
  const look: JsonObject = { ...clean, id: motifs ? 'motifs-462' : 'still-462', description: 'The clean look with the #462 acceptance motifs.' };
  if (motifs) {
    look['motifs'] = {
      sway: { motion: 'sway', amount: 12, hz: 0.5, phase: 'alternate', desync: true, seed: 'item' },
      drift: { motion: 'drift', amount: 8, hz: 0.4, desync: true, seed: 'item' },
    };
  }
  return look;
}
/**
 * The motif film (2D, 480 × 270, 4 s): three reeds (`reed-1` to `reed-3`, collection `reeds`), a title (`title`,
 * collection `words`) and a sill nothing binds; a reading hold (marker kind `hold`) from 1.5 s to 3 s. `bound: all`
 * binds the reeds to the slot `sway` and the title to `drift`; `bound: text` binds only the title.
 */
export function motifFilm(bound: 'all' | 'text'): JsonObject {
  const item = (id: string, order: number, kind: string, params: JsonObject, pos: [number, number]): JsonObject =>
    ({ id, kind, layer: 'main', name: id, order: `a${order}`, params, at: { pos: [pos[0], pos[1], 0] } });
  const reed = (k: number): JsonObject => item(`reed-${k}`, k, 'rect@1', { box: [-5, -60, 10, 60], paint: { fill: { role: 'accent' } } }, [150 + 90 * k, 230]);
  return {
    format: 1, id: `film-462-motifs-${bound}`, profile: 'film', title: `Reeds and a title, ${bound === 'all' ? 'reeds and title' : 'the title alone'} moving`,
    description: 'Three reeds sway and a title drifts under the look\'s motifs; a reading hold from 1.5 s to 3 s.', size: [480, 270],
    transport: { span: '4s' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      sill: item('sill', 0, 'rect@1', { box: [0, 0, 400, 8], paint: { fill: { role: 'muted' } } }, [40, 232]),
      'reed-1': reed(1), 'reed-2': reed(2), 'reed-3': reed(3),
      title: item('title', 4, 'text@1', { text: 'Reeds in the wind', font: 'body', size: 24, box: { w: 300, h: 36 } }, [90, 50]),
    },
    collections: { reeds: { members: ['reed-1', 'reed-2', 'reed-3'] }, words: { members: ['title'] } },
    motif_slots: bound === 'all' ? { sway: 'reeds', drift: 'words' } : { drift: 'words' },
    markers: { read: { kind: 'hold', name: 'read', t: `${MOTIF.hold.from}s`, span: `${MOTIF.hold.to - MOTIF.hold.from}s` } },
  };
}
interface Film2 { doc: JsonObject; look: JsonObject; fps: number; frames: number; from?: number; reduced_motion?: boolean; capture?: number[] }
export const film2d = (c: Film2): JsonObject => ({ call: 'film2d', hash: true, ...(c as unknown as JsonObject) });
/** A `film2d` reply's frames, each with its `pixel_hash` (`hash: true`) and its `final` PNG where captured. */
export const filmFrames = framesOf;
/** The film reply's `document` (README: film2d, `document`): the revision hash it opened and the one it holds after its last frame. */
export function documentHashes(reply: JsonObject, what: string): { opened: string; played: string } {
  drawn(reply, what);
  const d = obj(reply['document'], `${what}: document (README: film2d's document field)`);
  return { opened: str(d['opened'], `${what}: document.opened`), played: str(d['played'], `${what}: document.played`) };
}
