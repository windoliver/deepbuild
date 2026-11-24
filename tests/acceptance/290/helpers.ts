// Test-side tools for the #290 acceptance tests (README: The surface under test). They reuse #424's suite for the
// documents `view3d` draws, #378's pinhole, the ray hits, the sRGB coding and the readers of a frame's targets, and
// #552's fixtures for the `sight` program; they add what #290's criteria read: the four fixtures (the sphere behind
// its wall, the torus behind its wall, the two characters of a 2-player match, the rows a `seen` column hides), the
// pixels each criterion is judged on, found by rays in f64 and never from a picture, `deep-gpu run` driven without an
// assertion of its own (so a test's failing line is in its own file), and the judges, each returning its failures as
// sentences that name the pixel, the copy or the row. Nothing here stands in for the renderer, the hidden view, the
// object-ID pass, a shadow map, a driver or a `seen` column: every pixel, hash, pick and count a test reads is the
// implementation's own, and every expected value comes from the issue, the design and the fixtures below.
//
// No import of `../549/`, `../550/` or `../552/helpers.ts` here (match.ts holds those), so a scratch script can load
// this file in plain Node.

import { spawnSync } from 'node:child_process';
import {
  DARK_SKY, PLAIN_LOOK, REPO, STATUS, ball, box, camera, dot, encode, framesOf as viewFrames, hitBox, hitSphere, inconclusive, isObject, linearChannel, material, rayAt, readIds, readLinear,
  readNamed, readPng, referenceComposite, sessionDoc, sub, unit, within,
  type Ids, type Image, type JsonObject, type JsonValue, type Linear, type Mesh, type Pinhole, type Rgb, type V3, type ViewFrame,
} from '../424/helpers.ts';
import { ENEMIES, ENEMY_COUNT, ENEMY_Z, SIGHT, SIGHT_WRITES, enemyX, seenAt, sha256, type Program } from '../552/fixtures.ts';

export type { Ids, Image, JsonObject, JsonValue, Linear, Program, Rgb, V3 };
export { ENEMIES, ENEMY_COUNT, PLAIN_LOOK, REPO, STATUS, inconclusive, isObject, seenAt, sha256 };

/** Each criterion's ID: `#290.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #290.052fe5e4',
  2: 'AC2 #290.8310b458',
  3: 'AC3 #290.a677630a',
  4: 'AC4 #290.fba001a7',
  5: 'AC5 #290.9e8b88d3',
  6: 'AC6 #290.69fa44f2',
  7: 'AC7 #290.f96ca349',
  8: 'AC8 #290.005a3986',
} as const;

/** Every `it` passes this: a first build takes many minutes on a loaded machine. No test reads a time. */
export const TIMEOUT = 5_400_000;
export type Size = [number, number];
/** The hidden view's opacity the criteria name. */
export const OPACITY = 0.4;

// ---------------------------------------------------------------------------------------------------
// Pictures

/** A decoded picture: #424's and #467's readers both give one. */
export interface Pic { width: number; height: number; rgba: Uint8Array }
export const rgb = (p: Pic, x: number, y: number): Rgb => { const o = (y * p.width + x) * 4; return [p.rgba[o]!, p.rgba[o + 1]!, p.rgba[o + 2]!]; };
/** The largest difference of one channel between two colors, in codes. */
export const apart = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
export const count = (mask: Uint8Array): number => { let n = 0; for (const v of mask) n += v; return n; };
/** The pixels of `mask` whose every neighbour within `r` px (a square) is in it too. */
export function erode(mask: Uint8Array, [w, h]: Size, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    let all = 1;
    for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r; dx++) if (!mask[(y + dy) * w + x + dx]) { all = 0; break; }
    out[y * w + x] = all;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]` (#377): one JSON line in, one out. Unlike #424's `runGpu` this asserts nothing: a
// refused scenario (an unknown planted name among them) comes back as words, for the test's own assertion.

/** The wrong programs `deep-gpu run --planted` holds for this suite (README: Planted programs). */
export type GpuPlanted = 'hidden_view_draws_where_visible' | 'hidden_view_without_own_depth' | 'hidden_view_writes_ids' | 'hidden_view_after_status';
export interface GpuRun { refused: string | null; replies: JsonObject[] }
export function gpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): GpuRun {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error) return { refused: `${name} did not run to its end: ${run.error.message}`, replies: [] };
  const line = (run.stdout ?? '').split('\n').find((l) => l !== '') ?? '';
  let answer: JsonValue = null;
  try { answer = JSON.parse(line) as JsonValue; } catch { answer = null; }
  const replies = isObject(answer) && answer['ok'] === true && Array.isArray(answer['replies']) ? answer['replies'].filter(isObject) : null;
  if (run.status !== 0 || replies === null || replies.length !== calls.length) {
    return { refused: `${name} answered ${line.slice(0, 600) || 'nothing'} (exit ${run.status ?? run.signal}; stderr ${(run.stderr ?? '').slice(-600) || 'empty'})`, replies: [] };
  }
  return { refused: null, replies };
}
/** What kept a run from drawing: the scenario's refusal, or each call the binary refused. Off macOS, INCONCLUSIVE. */
export function refusals(run: GpuRun, labels: readonly string[]): string[] {
  if (run.refused !== null) return [run.refused];
  const out: string[] = [];
  run.replies.forEach((r, i) => {
    if (r['code'] === 'unsupported_platform') inconclusive(`${labels[i] ?? `call ${i}`} reports unsupported_platform`);
    if (r['code'] !== undefined) out.push(`${labels[i] ?? `call ${i}`} was refused: ${JSON.stringify(r).slice(0, 600)}`);
  });
  return out;
}

/** `view3d` (#378), with the fields this suite passes. `targets` takes this suite's `shadow` (README). */
export interface View {
  doc: string; size: Size; look?: JsonObject; frames?: number; fps?: number; from?: number; capture?: 'every' | number[];
  targets?: ('final' | 'linear' | 'ids' | 'shadow')[]; counts?: boolean; states?: Record<string, string>;
  clicks?: { frame: number; at: [number, number] }[]; class?: 'live' | 'render_back';
}
export const view3d = (v: View): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: 'every', ...(v as unknown as JsonObject) });
/** #424's plain look drawing one sample a frame in the live view and in an export alike (#419's `samples`), with no
 * settling at rest and no motion blur: a render-back then draws the samples the live frame drew. By default an export
 * draws 16 samples, which no live frame in motion holds. */
export const ONE_SAMPLE: JsonObject = { ...PLAIN_LOOK, samples: { live: 1, export: 1, at_rest: 'none' }, filter: 'box', filter_px: 1, motion_blur: 'none' };

/** One row of a frame's `draws` (#1636's, under `counts`): the pass that issued it and the item it draws for. */
export interface Draw { pass: string; of: string }
/** The passes this suite adds to `draws` (README): the hidden view's own depth pass and its blended draw. */
export const HIDDEN_DEPTH = 'hidden_depth';
export const HIDDEN_VIEW = 'hidden_view';
/** A frame of a `view3d` reply: #424's reading of it, with its pixel hash, this suite's `shadow` target and `draws`. */
export interface Shot { frame: number; view: ViewFrame; raw: JsonObject; hash: string | null; shadow: string | null; draws: Draw[] | null }
export function shotsOf(reply: JsonObject, what: string): Shot[] {
  const views = viewFrames(reply, what);
  const raws = Array.isArray(reply['frames']) ? reply['frames'] : [];
  return views.map((view, i): Shot => {
    const raw = isObject(raws[i]) ? raws[i] : {};
    const draws = Array.isArray(raw['draws']) ? raw['draws'].filter(isObject).map((d) => ({ pass: String(d['pass']), of: String(d['of']) })) : null;
    return { frame: view.frame, view, raw, hash: typeof raw['pixel_hash'] === 'string' ? raw['pixel_hash'] : null, shadow: typeof raw['shadow'] === 'string' ? raw['shadow'] : null, draws };
  });
}
export const finalOf = (out: string, s: Shot, what: string): Image => readPng(out, s.view.final, `${what}: the final target`);
export const linearOf = (out: string, s: Shot, size: Size, what: string): Linear => readLinear(out, s.view, size, `${what}: the linear target`);
export const idsOf = (out: string, s: Shot, what: string): Ids => readIds(out, s.view, `${what}: the object-ID target`);
/** The frame's `shadow` target (README): the file its SHA-256 names, and whether it holds more than one depth. */
export function shadowOf(out: string, s: Shot, what: string): { bytes: number; flat: boolean } {
  const file = readNamed(out, s.shadow, 'f32', `${what}: the shadow target`);
  let flat = true;
  for (let o = 4; o + 4 <= file.length && flat; o += 4) if (file.readUInt32LE(o) !== file.readUInt32LE(0)) flat = false;
  return { bytes: file.length, flat };
}
/** The `draws` rows of the hidden view's two passes, as `pass of` words, and the rest in order. */
export function drawsOf(s: Shot): { hidden: string[]; rest: string } {
  const rows = s.draws ?? [];
  const ours = (d: Draw): boolean => d.pass === HIDDEN_DEPTH || d.pass === HIDDEN_VIEW;
  return { hidden: rows.filter(ours).map((d) => `${d.pass} ${d.of}`).sort(), rest: JSON.stringify(rows.filter((d) => !ours(d))) };
}
/** The names of the reply's passes, in order (#378's `passes`). */
export const passNames = (reply: JsonObject): string[] => (Array.isArray(reply['passes']) ? reply['passes'].filter(isObject).map((p) => String(p['name'])) : []);

// ---------------------------------------------------------------------------------------------------
// The sphere behind a wall (criteria 1, 3, 6, 7, 8). A 480 × 360 frame through #378's pinhole at [0, 1.2, 8] looking
// at [0, 1, 0], 40° across: the sphere (radius 1 m at [0, 1, 0], a lit blue) fills a disc of about 83 px about the
// frame's centre. The wall (2.4 × 3 × 0.2 m, a lit warm grey) stands 2 m nearer and ends at x = 0, so it covers the
// sphere's left half and leaves its right half in plain sight. A grey ground; one sun from above the camera's right
// shoulder, π lx, and a black sky with no ambient. By default nothing casts, so the wall alone and the sphere alone
// are lit exactly as they are together, and each one's color at a pixel is the same renderer's frame with the other
// left out.

export const SIZE: Size = [480, 360];
export const SPHERE = {
  cam: { position: [0, 1.2, 8], target: [0, 1, 0], fov: 40, size: SIZE } as Pinhole,
  centre: [0, 1, 0] as V3, radius: 1, color: [0.1, 0.3, 0.85] as Rgb,
  wall: { size: [2.4, 3, 0.2] as V3, centre: [-1.2, 1.5, 2] as V3, color: [0.55, 0.5, 0.42] as Rgb },
  sun: [-35, 25, 0] as V3,
  /** Criterion 3's second light: a shadowed spot above the camera's left shoulder, aimed at the sphere. */
  lamp: [-3, 4, 6] as V3,
  /** Criterion 6's status-bound box, 0.2 m before the wall, over the sphere's hidden half: about 46 px square
   * around pixel (200, 180). */
  gauge: { size: [0.4, 0.4, 0.1] as V3, centre: [-0.35, 1.06, 2.3] as V3 },
  /** Criterion 7's channel: the hidden view's opacity from 0 at 0 s to 0.8 at 1 s, linear. */
  fade: { to: 0.8, span: 1 },
};
/** The record's verdict criterion 6's bindings read, and the look's exact fail color (#382's map: #bf232b). */
export const VERDICT = 'verdict:01JB2900000000000000000290';
export const FAIL: Rgb = [0xbf, 0x23, 0x2b];
/** `at.rot` (R = Rz·Ry·Rx, degrees) that turns a light's own −Z from `from` toward `to`. */
export function aim(from: V3, to: V3): V3 {
  const d = unit(sub(to, from));
  return [(Math.asin(d[1]) * 180) / Math.PI, (Math.atan2(-d[0], -d[2]) * 180) / Math.PI, 0];
}
export interface SphereOpts {
  /** Leave the wall or the sphere out (the reference frames). */
  wall?: boolean; sphere?: boolean;
  /** The sphere's `hidden_view`, as written; absent, the item carries no such field. */
  hidden?: JsonObject;
  /** Criterion 3: the sun casts (two cascades) and a shadowed spot is added. `casts: false`: the sphere's `cast_shadow` is false. */
  shadows?: boolean; casts?: boolean;
  /** Criterion 6: the status-bound gauge before the wall. */
  gauge?: boolean;
  /** Criterion 7: the channel on the hidden view's opacity. */
  fade?: boolean;
}
export function sphereDoc(name: string, o: SphereOpts = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera(SPHERE.cam.position, SPHERE.cam.target, SPHERE.cam.fov), sky: DARK_SKY,
    wall_mat: material({ base_color: [...SPHERE.wall.color, 1], roughness: 0.9 }),
    sphere_mat: material({ base_color: [...SPHERE.color, 1], roughness: 0.6 }),
    ground_mat: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.9 }),
    ground: box([20, 0.1, 20], [0, -0.05, 0], { material: 'ground_mat' }),
    sun: { kind: 'light.sun@1', params: { illuminance: Math.PI, color: [1, 1, 1], shadow: o.shadows === true, ...(o.shadows ? { cascades: 2 } : {}) }, at: { rot: SPHERE.sun } },
  };
  // At 1,000 lm the wall under both lights reads at most 0.77 in linear light where it covers the sphere (the base's
  // frame), so no judged pixel sits at white, where a blend couldn't show.
  if (o.shadows) items['lamp'] = { kind: 'light.spot@1', params: { power: 1000, color: [1, 1, 1], shadow: true, inner: 20, outer: 25, range: 14, radius: 0.02 }, at: { pos: SPHERE.lamp, rot: aim(SPHERE.lamp, SPHERE.centre) } };
  if (o.wall !== false) items['wall'] = box(SPHERE.wall.size, SPHERE.wall.centre, { material: 'wall_mat' });
  if (o.sphere !== false) {
    items['sphere'] = ball(SPHERE.radius, SPHERE.centre, 'sphere_mat', { ...(o.hidden ? { hidden_view: o.hidden } : {}), ...(o.casts === false ? { cast_shadow: false } : {}) });
  }
  if (o.gauge) items['gauge'] = { kind: 'mark.box@1', params: { size: SPHERE.gauge.size, paint: { fill: { role: 'stone' } } }, at: { pos: SPHERE.gauge.centre } };
  const extra: JsonObject = {};
  if (o.shadows) extra['light_policy'] = { shadowed: { spots: 1 } };
  if (o.fade) extra['channels'] = { fade: linearChannel('items/sphere/hidden_view/opacity', 0, SPHERE.fade.to, SPHERE.fade.span) };
  if (o.gauge) extra['status_bindings'] = { b_stroke: { target: 'items/gauge/params/paint/stroke', source: VERDICT }, b_badge: { target: 'items/gauge/params/paint/badge', source: VERDICT } };
  return sessionDoc(name, SIZE, items, extra);
}

/** The frame points a pixel is judged by: its centre and the eight points 1.5 px around it, the corners and edge
 * midpoints of the 3 × 3 pixels about it. A convex region that holds all nine holds the pixel and a whole pixel
 * around it. */
const NINE: [number, number][] = [-1.5, 0, 1.5].flatMap((dx) => [-1.5, 0, 1.5].map((dy): [number, number] => [dx, dy]));
export interface Regions {
  /** Pixels where the wall covers the item: every one of the nine rays meets the wall, then the item behind it. */
  hidden: Uint8Array;
  /** Pixels where the item shows directly: every one of the nine rays meets the item and none meets the wall. */
  shown: Uint8Array;
}
/** The sphere fixture's two regions, by rays in f64 through #378's pinhole. */
export function sphereRegions(): Regions {
  const [w, h] = SIZE; const cam = SPHERE.cam;
  const hidden = new Uint8Array(w * h); const shown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let under = 1; let open = 1;
    for (const [dx, dy] of NINE) {
      const d = rayAt(cam, x + 0.5 + dx, y + 0.5 + dy);
      const p = hitSphere(cam.position, d, SPHERE.centre, SPHERE.radius);
      if (!p) { under = 0; open = 0; break; }
      const t = dot(sub(p, cam.position), d);
      const wall = hitBox(cam.position, d, SPHERE.wall.centre, SPHERE.wall.size);
      if (!(wall && wall[0] > 0 && wall[1] < t)) under = 0;
      if (wall) open = 0;
    }
    hidden[y * w + x] = under; shown[y * w + x] = open;
  }
  return { hidden, shown };
}
/** Criterion 3's clicks: five pixel centres deep in the sphere's hidden half. */
export const HIDDEN_CLICKS: [number, number][] = [[200, 180], [180, 180], [220, 180], [205, 140], [205, 220]];

// ---------------------------------------------------------------------------------------------------
// The torus behind a wall (criteria 2, 8). The same frame from [0, 2.6, 7.5] looking at [0, 1, 0]: a `lathe@1` on a
// closed outline (a circle of radius 0.38 m, 32 points, 1 m from the axis, 96 segments about +Y), a lit orange, lying
// flat at [0, 1, 0], seen from about 12° above its plane, so its near tube stands before its far tube in a band
// across its middle: there a ray enters it twice. The wall (2.6 × 3 × 0.2 m, a lit blue grey) stands 2.2 m nearer and
// covers it from its left end to x = 0.4.

export const TORUS = {
  cam: { position: [0, 2.6, 7.5], target: [0, 1, 0], fov: 40, size: SIZE } as Pinhole,
  centre: [0, 1, 0] as V3, major: 1, minor: 0.38, outline: 32, segments: 96, color: [0.85, 0.45, 0.1] as Rgb,
  wall: { size: [2.6, 3, 0.2] as V3, centre: [-0.9, 1.5, 2.2] as V3, color: [0.3, 0.4, 0.6] as Rgb },
  sun: [-35, 25, 0] as V3,
};
/** The lathe's outline `[r, y, smooth]`, counter-clockwise in (r, y). */
const torusOutline = (): [number, number, boolean][] =>
  Array.from({ length: TORUS.outline }, (_, j): [number, number, boolean] => {
    const a = (2 * Math.PI * j) / TORUS.outline;
    return [TORUS.major + TORUS.minor * Math.cos(a), TORUS.minor * Math.sin(a), true];
  });
export function torusDoc(name: string, o: { wall?: boolean; torus?: boolean; hidden?: JsonObject } = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera(TORUS.cam.position, TORUS.cam.target, TORUS.cam.fov), sky: DARK_SKY,
    wall_mat: material({ base_color: [...TORUS.wall.color, 1], roughness: 0.9 }),
    torus_mat: material({ base_color: [...TORUS.color, 1], roughness: 0.6 }),
    ground_mat: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.9 }),
    ground: box([20, 0.1, 20], [0, -0.05, 0], { material: 'ground_mat' }),
    sun: { kind: 'light.sun@1', params: { illuminance: Math.PI, color: [1, 1, 1], shadow: false }, at: { rot: TORUS.sun } },
  };
  if (o.wall !== false) items['wall'] = box(TORUS.wall.size, TORUS.wall.centre, { material: 'wall_mat' });
  if (o.torus !== false) {
    items['torus'] = { kind: 'lathe@1', params: { outline: torusOutline(), closed: true, segments: TORUS.segments }, at: { pos: TORUS.centre }, material: 'torus_mat', ...(o.hidden ? { hidden_view: o.hidden } : {}) };
  }
  return sessionDoc(name, SIZE, items);
}
/** The triangles the lathe builds from that outline (Builder: lathe): ring k of outline point (r, y) at
 * [r cos a, y, r sin a], a = 2π k ÷ segments; each band between two outline points a strip of two triangles a
 * segment. Only where they are counts here, not which way they face. */
export function torusMesh(): Mesh {
  const outline = torusOutline(); const n = TORUS.segments;
  const ring = (r: number, y: number, k: number): V3 => { const a = (2 * Math.PI * k) / n; return [r * Math.cos(a), y, r * Math.sin(a)]; };
  const positions: V3[] = []; const triangles: [number, number, number][] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const base = positions.length;
    for (let k = 0; k <= n; k++) positions.push(ring(a[0], a[1], k), ring(b[0], b[1], k));
    for (let k = 0; k < n; k++) { const p0 = base + 2 * k; triangles.push([p0, p0 + 1, p0 + 3], [p0, p0 + 3, p0 + 2]); }
  });
  return { positions, triangles };
}
/**
 * The torus fixture's pixels where the wall covers the torus and its two layers overlap: the ray through the pixel's
 * centre crosses the torus's surface four times (into and out of its near tube, then its far tube), and so do the
 * rays ±0.5 px around it (#424's `referenceComposite`, in f64 over the same triangles), at every pixel within 2 px;
 * and every one of the nine rays meets the wall, which stands wholly before the torus.
 */
export function torusOverlap(): Uint8Array {
  const [w, h] = SIZE; const cam = TORUS.cam;
  // One layer of alpha 0.5 and color 1 over black reads 1 − 0.5^n after n crossings: 0.9375 after four.
  const { judged, color } = referenceComposite(cam, [{ id: 'torus', mesh: torusMesh(), at: TORUS.centre, color: [1, 1, 1], alpha: 0.5 }]);
  const four = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) four[i] = judged[i] && Math.abs(color[i * 3]! - 0.9375) < 1e-9 ? 1 : 0;
  const inside = erode(four, SIZE, 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside[y * w + x]) continue;
    for (const [dx, dy] of NINE) {
      const wall = hitBox(cam.position, rayAt(cam, x + 0.5 + dx, y + 0.5 + dy), TORUS.wall.centre, TORUS.wall.size);
      if (!(wall && wall[0] > 0)) { inside[y * w + x] = 0; break; }
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------------
// The judges of a frame. Each failure names its pixel as `pixel (x, y)`.

export interface Judged { judged: number; failing: number; failures: string[] }
const LISTED = 40;
/** Where the geometry and the renderer's own ID target part: pixels of `mask` not showing `id` there or 1 px around
 * (the fixture's guard: the pinhole and the rays are the frame's). */
export function strays(mask: Uint8Array, ids: Ids, id: string, what: string): string[] {
  const out: string[] = []; let n = 0;
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
    if (!mask[y * ids.width + x] || within(ids, x, y, id, 1)) continue;
    n++;
    if (out.length < 5) out.push(`${what}: pixel (${x}, ${y}) is in the region by its rays, but the object-ID target shows ${ids.at(x, y) ?? 'nothing'} there or beside it, not ${id}`);
  }
  return n > out.length ? [...out, `${what}: ${n} such pixels in all`] : out;
}
/**
 * Criteria 1 and 2: at each pixel of `mask`, `got`'s final code is the wall's color blended toward the item's at
 * `opacity`, within 1/255. The wall's color and the item's shaded color are the same renderer's linear targets of the
 * fixture with the other left out (`wall`, `item`); the blend is taken in linear light, as a see-through draw blends
 * in the frame's linear target, and judged on the final target, whose codes are the sRGB coding of that light:
 * |code − 255 · encode((1 − opacity) · wall + opacity · item)| ≤ 1 in each channel.
 */
export function blendFailures(got: Image, wall: Linear, item: Linear, mask: Uint8Array, opacity: number, name: string): Judged {
  const out: Judged = { judged: 0, failing: 0, failures: [] };
  for (let y = 0; y < got.height; y++) for (let x = 0; x < got.width; x++) {
    if (!mask[y * got.width + x]) continue;
    out.judged++;
    const g = rgb(got, x, y); const wv = wall.at(x, y); const iv = item.at(x, y);
    const want = [0, 1, 2].map((c) => 255 * encode((1 - opacity) * wv[c]! + opacity * iv[c]!));
    if (apart(g, want) <= 1) continue;
    out.failing++;
    if (out.failures.length < LISTED) {
      out.failures.push(`pixel (${x}, ${y}) reads ${g.join(', ')}, not the wall's color blended toward the ${name}'s shaded color at ${opacity}, ${want.map((v) => v.toFixed(1)).join(', ')} `
        + `(the wall alone ${wv.map((v) => (255 * encode(v)).toFixed(1)).join(', ')}, the ${name} alone ${iv.map((v) => (255 * encode(v)).toFixed(1)).join(', ')})`);
    }
  }
  return out;
}
/** The pixels of `mask` where the blend above stands more than `codes` from the wall's own color: where a frame with
 * no hidden view can't pass for one with it. */
export function standsApart(wall: Linear, item: Linear, mask: Uint8Array, opacity: number, codes = 2): number {
  let n = 0;
  for (let y = 0; y < wall.height; y++) for (let x = 0; x < wall.width; x++) {
    if (!mask[y * wall.width + x]) continue;
    const wv = wall.at(x, y); const iv = item.at(x, y);
    if ([0, 1, 2].some((c) => Math.abs(255 * encode((1 - opacity) * wv[c]! + opacity * iv[c]!) - 255 * encode(wv[c]!)) > codes)) n++;
  }
  return n;
}
/** Byte for byte: at each pixel of `mask`, `got`'s final bytes are `want`'s. */
export function sameFailures(got: Pic, want: Pic, mask: Uint8Array, as: string): Judged {
  const out: Judged = { judged: 0, failing: 0, failures: [] };
  for (let y = 0; y < got.height; y++) for (let x = 0; x < got.width; x++) {
    if (!mask[y * got.width + x]) continue;
    out.judged++;
    const g = rgb(got, x, y); const w = rgb(want, x, y);
    if (apart(g, w) === 0) continue;
    out.failing++;
    if (out.failures.length < LISTED) out.failures.push(`pixel (${x}, ${y}) reads ${g.join(', ')}, not ${w.join(', ')} ${as}`);
  }
  return out;
}
/** How many pixels of `mask` differ between two pictures by more than `codes` in a channel. */
export function changed(a: Pic, b: Pic, mask: Uint8Array, codes = 2): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (mask[y * a.width + x] && apart(rgb(a, x, y), rgb(b, x, y)) > codes) n++;
  return n;
}
/** The pixels of `mask` that hold exactly `color` in `pic`. */
export function exactly(pic: Pic, mask: Uint8Array, color: Rgb): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) if (mask[y * pic.width + x] && apart(rgb(pic, x, y), color) === 0) out[y * pic.width + x] = 1;
  return out;
}
/** The pixels of `mask` with none of `near`'s within `r` px (a square). */
export function awayFrom(mask: Uint8Array, near: Uint8Array, [w, h]: Size, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    let clear = 1;
    for (let dy = -r; dy <= r && clear; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy; const xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w && near[yy * w + xx]) { clear = 0; break; }
    }
    out[y * w + x] = clear;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The match pieces (criteria 4, 5, 8): 640 × 360 through an orthographic camera looking along −Z, 20 m across the
// frame (32 px a metre, +X right, +Y up), a black sky, everything unlit. Each is #552's kind of piece: a logic item at
// 20 Hz, a net item for 2 players (delay 4, window 0, a full-state hash every 60 match steps), played by both copies
// in one process through `match`.

export const PIECE_SIZE: Size = [640, 360];
const PX_PER_M = PIECE_SIZE[0] / 20;
export const RATE = 20;
export const HASH_EVERY = 60;
/** The relay each piece declares; `match` plays its copies in one process, so nothing reaches it. */
export const RELAY = 'https://relay.test/290';
const ulid = (k: number): string => `01JB290D${String(k).padStart(18, '0')}`;
export const DOC = { heroes: ulid(1), rows: ulid(2) } as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #290 acceptance tests.' };
/** The frame pixel of world point (x, y) under a piece's camera, whose target is [0, `eye`, 0]. */
const piecePx = (x: number, y: number, eye: number): [number, number] => [Math.round(PIECE_SIZE[0] / 2 + x * PX_PER_M), Math.round(PIECE_SIZE[1] / 2 - (y - eye) * PX_PER_M)];
function piece(id: string, title: string, eye: number, modules: JsonObject, items: Record<string, JsonObject>, program: Program, extra: JsonObject = {}): JsonObject {
  const all: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, eye, 20], target: [0, eye, 0], view_width: 20, near: 1, far: 100 } },
    sky: DARK_SKY,
    ...items,
    match: { kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: RATE, delay: 4, window: 0, hash_every: HASH_EVERY } },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(all)) withIds[itemId] = { id: itemId, name: itemId, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #290 acceptance tests play.`, size: PIECE_SIZE, camera: 'cam', seed: 290,
    transport: { span: '60s', frame_rate: [60, 1] }, requires: { modules }, ...extra, assets: { [`${program.name}_program`]: { sha256: program.sha, license: LICENSE } }, items: withIds,
  };
}
const unlit = (color: Rgb): JsonObject => material({ base_color: [...color, 1], unlit: true });

// The characters' piece (criterion 4). Two characters stand behind one wall, each a 1.6 m box: `hero_1` (orange) at
// x = −4 and `hero_2` (cyan) at x = 4. The logic item `cast` writes `owner`, the player each character belongs to:
// [1, 2] before step 100 and [2, 1] from it (the players trade characters). A driver sets each character's hidden
// view's opacity to 0.4 where `cast.owner` names this copy's `match.me`, and to 0 where it names the other player.

export const CAST = 'cast';
export const HEROES = ['hero_1', 'hero_2'] as const;
/** The step from which the players have traded characters. */
export const TRADE = 100;
/** The player character `i` (0 or 1) belongs to after step `k`. */
export const ownerAt = (i: number, k: number): number => (k < TRADE ? [1, 2] : [2, 1])[i]!;
const HERO_X = [-4, 4] as const;
const HEROES_EYE = 1;
/** The centre of character `i` in the frame, and a spot of the wall alone 36 px above it. */
export const heroPx = (i: number): [number, number] => piecePx(HERO_X[i]!, HEROES_EYE, HEROES_EYE);
export const heroWallPx = (i: number): [number, number] => { const [x, y] = heroPx(i); return [x, y - 36]; };

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = n;
  for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
/**
 * `cast` as WebAssembly bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
 * `reads_at` 0 and `writes_at` 4096, `init(seed: i64)` and `step(k: i64)`, no imports, MVP only). Each step writes
 * `owner`, two i32 at 4096: 1 and 2 while k < 100, 2 and 1 from it. It reads nothing.
 */
export function castProgram(): Program {
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const vec = (list: number[][]): number[] => [...uleb(list.length), ...list.flat()];
  const fn = (body: number[]): number[] => { const b = [0x00, ...body, 0x0b]; return [...uleb(b.length), ...b]; };
  // i32.const at; i32.const before; i32.const after; local.get 0; i64.const TRADE; i64.lt_s; select; i32.store
  const write = (at: number, before: number, after: number): number[] =>
    [0x41, ...sleb(at), 0x41, ...sleb(before), 0x41, ...sleb(after), 0x20, 0x00, 0x42, ...sleb(TRADE), 0x53, 0x1b, 0x36, 0x02, 0x00];
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(4096), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([fn([]), fn([...write(4096, 1, 2), ...write(4100, 2, 1)])])),
  ]);
  return { name: CAST, bytes, sha: sha256(bytes) };
}
/** The driver that sets character `i`'s hidden view's opacity from `match.me` and the logic array. */
export const heroDriver = (i: number): JsonObject =>
  ({ target: `items/${HEROES[i]!}/hidden_view/opacity`, expr: `${OPACITY} * max(0, 1 - abs(who - me))`, vars: { who: `${CAST}.owner[${i}]`, me: 'match.me' } });
export function heroesDoc(program: Program): JsonObject {
  const hero = (i: number): JsonObject => ({ kind: 'mark.box@1', params: { size: [1.6, 1.6, 1.6] }, material: `paint_${i + 1}`, at: { pos: [HERO_X[i]!, HEROES_EYE, 0] }, hidden_view: { opacity: 0 } });
  return piece(DOC.heroes, 'Two characters behind a wall', HEROES_EYE, { scene3d: '^1', logic: '^1', net: '^1' }, {
    paint_1: unlit([0.9, 0.35, 0.1]), paint_2: unlit([0.1, 0.7, 0.9]), stone: unlit([0.3, 0.3, 0.32]),
    wall: { kind: 'mark.box@1', params: { size: [16, 3, 0.2] }, material: 'stone', at: { pos: [0, HEROES_EYE, 2] } },
    [HEROES[0]]: hero(0), [HEROES[1]]: hero(1),
    [CAST]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [], writes: { owner: { type: 'i32', count: 2 } } } },
  }, program, { drivers: { hero_1_view: heroDriver(0), hero_2_view: heroDriver(1) } });
}

// The rows' piece (criterion 5). #552's `sight` (its fixtures, imported) writes four enemies, 1.6 × 1 × 1.6 m boxes
// at x = −6 + 4i, y = 0.5, z = −3, and `seen`, bit p − 1 set where player p sees the row: row 0 both, row 1 player 2
// alone (before step 200), row 2 player 1 alone, row 3 neither. The instancer `enemies` is fed by it, its `seen`
// column reading `sight.seen`, and carries the hidden view at 0.4; a wall stands between the rows and the camera.

const ROWS_EYE = 0.5;
/** The centre of row `i` in the frame, and a spot of the wall alone 34 px above it. */
export const rowPx = (i: number): [number, number] => piecePx(enemyX(i), ROWS_EYE, ROWS_EYE);
export const rowWallPx = (i: number): [number, number] => { const [x, y] = rowPx(i); return [x, y - 34]; };
/** Row `i` as a failure names it: its place and its element ID (#537's address, generation 1). */
export const rowName = (i: number): string => `row ${i} (${ENEMIES}#${i}.1)`;
export function rowsDoc(program: Program, o: { hidden?: boolean } = {}): JsonObject {
  const column = (array: string, as: string): JsonObject => ({ array: `${SIGHT}.${array}`, as });
  return piece(DOC.rows, 'Four rows behind a wall', ROWS_EYE, { scene3d: '^1', logic: '^1', net: '^1' }, {
    paint: unlit([0.9, 0.35, 0.1]), stone: unlit([0.3, 0.3, 0.32]),
    wall: { kind: 'mark.box@1', params: { size: [18, 3, 0.2] }, material: 'stone', at: { pos: [0, ROWS_EYE, 0] } },
    unit: { kind: 'mark.box@1', params: { size: [1.6, 1, 1.6] }, material: 'paint', visible: false },
    [SIGHT]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [], writes: SIGHT_WRITES } },
    [ENEMIES]: {
      kind: 'instance@1', params: { of: ['unit'], live: column('live', 'bool'), gen: column('gen', 'u32'), pos: column('pos', 'f32'), seen: column('seen', 'i32') },
      ...(o.hidden === false ? {} : { hidden_view: { opacity: OPACITY } }),
    },
  }, program);
}
export { ENEMY_Z };

/** A copy's view as these judges read it (#552's `views` rows give one): its player, its step, the `match.me` it read
 * and its frame. */
export interface Seen { player: number; step: number; me: JsonValue | undefined; image: Pic | null }
/** The five pixels a box of at least 32 px a side is read at: its centre and 10 px to each side. */
const FIVE: [number, number][] = [[0, 0], [-10, 0], [10, 0], [0, -10], [0, 10]];
/** A wall pixel reads as the wall alone within this many codes; a hidden view at 0.4 moves it by far more. */
const SAME = 2;
const SHOWS = 12;
/** What a frame shows at a box behind the wall: `through` where every pixel of it stands apart from the wall alone
 * just above it, `wall` where every one reads as that wall, else `mixed`. */
function through(im: Pic, at: [number, number], wallAt: [number, number]): { is: 'through' | 'wall' | 'mixed'; read: Rgb; wall: Rgb } {
  const wall = rgb(im, wallAt[0], wallAt[1]);
  const reads = FIVE.map(([dx, dy]) => rgb(im, at[0] + dx!, at[1] + dy!));
  const is = reads.every((c) => apart(c, wall) > SHOWS) ? 'through' : reads.every((c) => apart(c, wall) <= SAME) ? 'wall' : 'mixed';
  return { is, read: reads[0]!, wall };
}
function frameOf(views: readonly Seen[], a: { player: number; step: number }, f: string[]): Pic | null {
  const v = views.find((x) => x.player === a.player && x.step === a.step);
  const tag = `copy ${a.player} at step ${a.step}`;
  if (!v) { f.push(`${tag}: no view in the reply`); return null; }
  if (v.me !== a.player) f.push(`${tag}: its view reads match.me as ${JSON.stringify(v.me)}, not ${a.player}`);
  if (!v.image) { f.push(`${tag}: its view has no frame (a PNG in the evidence store)`); return null; }
  if (v.image.width !== PIECE_SIZE[0] || v.image.height !== PIECE_SIZE[1]) { f.push(`${tag}: its frame is ${v.image.width} × ${v.image.height}, not ${PIECE_SIZE.join(' × ')}`); return null; }
  // The wall is drawn: it stands apart from the black sky above it.
  if (apart(rgb(v.image, 320, 150), rgb(v.image, 320, 20)) <= SHOWS) { f.push(`${tag}: its frame draws no wall (${rgb(v.image, 320, 150).join(',')} against the sky's ${rgb(v.image, 320, 20).join(',')})`); return null; }
  return v.image;
}
/**
 * Criterion 4's judge of each asked view: copy p after step k shows through the wall the character `cast.owner`
 * gives player p, and only the wall where the other player's character stands. Each failure names the copy.
 */
export function heroFailures(views: readonly Seen[], asks: readonly { player: number; step: number }[]): string[] {
  const f: string[] = [];
  for (const a of asks) {
    const im = frameOf(views, a, f);
    if (!im) continue;
    for (const i of [0, 1]) {
      const own = ownerAt(i, a.step) === a.player;
      const s = through(im, heroPx(i), heroWallPx(i));
      const where = `${s.read.join(',')} at its centre (${heroPx(i).join(', ')}), the wall alone ${s.wall.join(',')}`;
      if (own && s.is !== 'through') f.push(`copy ${a.player} at step ${a.step} hides ${HEROES[i]!}, its own player's character, behind the wall (${where})`);
      if (!own && s.is !== 'wall') f.push(`copy ${a.player} at step ${a.step} shows ${HEROES[i]!}, player ${ownerAt(i, a.step)}'s character, through the wall (${where})`);
    }
  }
  return f;
}
/**
 * Criterion 5's judge of each asked view: copy p after step k draws a hidden view of each row its player's bit of
 * `seen` sets, and none of a row the column hides on that copy. Each failure names the copy and the row.
 */
export function rowFailures(views: readonly Seen[], asks: readonly { player: number; step: number }[]): string[] {
  const f: string[] = [];
  for (const a of asks) {
    const im = frameOf(views, a, f);
    if (!im) continue;
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const sees = ((seenAt(i, a.step) >> (a.player - 1)) & 1) === 1;
      const s = through(im, rowPx(i), rowWallPx(i));
      const where = `${s.read.join(',')} at its centre (${rowPx(i).join(', ')}), the wall alone ${s.wall.join(',')}`;
      if (sees && s.is !== 'through') f.push(`copy ${a.player} at step ${a.step} draws no hidden view of ${rowName(i)}, which player ${a.player} sees (${where})`);
      if (!sees && s.is !== 'wall') f.push(`copy ${a.player} at step ${a.step} draws a hidden view of ${rowName(i)}, which its seen column hides on this copy (${where})`);
    }
  }
  return f;
}
