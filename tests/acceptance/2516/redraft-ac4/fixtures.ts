// Test-side tools for #2516 AC4 on the GPU (README: The surface under test; Fixtures; The reading). The documents are
// literal and generated here; `deep-gpu run` (#377's binary with #378's `view3d`) draws them; the reading is taken from
// the linear target, located by the object-ID target of a locator frame. Nothing here stands in for ambient occlusion:
// every pixel read is the renderer's own. Reused unchanged from the base: #418's helpers (the binary's build, the look,
// `solid`, frames, the linear and ID targets) and #379's `machineModel` and `inconclusive`; the reference-Mac gate is this
// issue's own (APPROVED.md, C).
import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import {
  REPO, answered, arr, frameAt, look, luma, obj, readIds, readTarget, shown, solid, texel, writeJson,
  type F32, type Ids, type JsonObject, type JsonValue, type Rgb,
} from '../../418/helpers.ts';

import { inconclusive, machineModel } from '../../379/helpers.ts';

export { useGpuBin, useOut } from '../../418/helpers.ts';

/**
 * The design's three reference Macs (technical-design.md: The reference Macs), by `hw.model`. Owner-approved
 * (APPROVED.md, C): this issue's own gate; #379's frozen helper, which lists only the first two, is not edited.
 */
export const REFERENCE_MODELS: readonly string[] = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
/** The reference Mac this is, read from the machine's real `sysctl -n hw.model` (#379's `machineModel`), or INCONCLUSIVE. */
export function requireReferenceMac(): string {
  const model = machineModel();
  if (model === null || !REFERENCE_MODELS.includes(model)) inconclusive(`not a reference Mac (${REFERENCE_MODELS.join(', ')}): hw.model is ${model} on ${process.platform}`);
  return model;
}

/** A machine with no GPU: the test fails with this word, never passes (AGENTS.md, invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

/** The planted loop AC4 names (README: The planted loop): main's loop with every one of its points at the full radius. */
export const PLANTED = 'ao_points_at_radius';

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out.

/** Runs one scenario; BLOCKED on `no_device` (no GPU) or a startup that refuses the planted name; replies answered. */
export function gpuRun(bin: string, out: string, calls: JsonObject[], planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${name}: ${r.error.message}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  const first = lines[0];
  const code = first && typeof first === 'object' && !Array.isArray(first) ? (first as JsonObject)['code'] : undefined;
  if (code === 'no_device') blocked(`${name} found no GPU (no_device: ${shown((first as JsonObject)['reason'])})`);
  if (planted && r.status === 2 && code === 'bad_input') blocked(`${name} has no planted program ${planted}, the wrong program AC4 names (README: Proposed surfaces)`);
  expect(r.status, `${name} exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(lines.length, `${name}: one output line`).toBe(1);
  const answer = obj(first, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((v, i) => obj(v, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). y up, metres; the floor's top at y = 0.

type V3 = [number, number, number];
const ROLES: Record<string, Rgb> = { floor: [150, 150, 150], block: [176, 176, 176], marker: [200, 60, 60] };
const AMBIENT = 0.6;

/** The look: #418's physical look (tone map none at exposure scale 1, finish at identity) with `ao` as given. */
export const lookWith = (ao: JsonObject | 'none'): JsonObject => look('ao-2516-ac4', ROLES, { ao });
/** The issue's settings: radius 0.5 m, strength 1, multi_bounce and specular off. */
export const aoOn = (samples: 8 | 16, resolution: 'half' | 'full'): JsonObject =>
  ({ radius: 0.5, strength: 1, samples, resolution, multi_bounce: false, specular: false });
export interface Setting { samples: 8 | 16; resolution: 'half' | 'full' }
export const SETTINGS: Setting[] = [{ samples: 8, resolution: 'half' }, { samples: 8, resolution: 'full' }, { samples: 16, resolution: 'half' }, { samples: 16, resolution: 'full' }];
export const settingName = (s: Setting): string => `${s.samples} samples, ${s.resolution} resolution`;

/** A perspective orbit camera (#378's `camera@1`). */
export interface Camera { name: string; target: V3; azimuth: number; elevation: number; distance: number }
const camera = (c: Camera): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: c.target, orbit: { azimuth: c.azimuth, elevation: c.elevation, distance: c.distance }, fov: 40, near: 0.1 } });
/** Uniform ambient from a `sky@1`, the same from above and below, and no light. */
const sky: JsonObject = { id: 'sky', kind: 'sky@1', name: 'Sky', order: 'z1', layer: 'main', params: { ambient_top: [AMBIENT, AMBIENT, AMBIENT], ambient_low: [AMBIENT, AMBIENT, AMBIENT] } };
/** The floor's material: no specular share (metallic 0, specular_level 0). */
const floorMaterial: JsonObject = { id: 'm-floor', kind: 'material@1', name: 'Floor material', order: 'a9', layer: 'main', params: { base_color: { role: 'floor' }, metallic: 0, specular_level: 0 } };
const floor = (side: number): JsonObject => solid('floor', 'a1', 'mark.box@1', [side, 0.1, side], [0, -0.05, 0], 'floor', { material: 'm-floor' });

/** A flat marker on the floor (1 mm thick) or on the wall, drawn only in the locator frame. */
export interface Marker { id: string; size: V3; pos: V3 }
const markerItem = (m: Marker, i: number): JsonObject => solid(m.id, `b${String(i).padStart(2, '0')}`, 'mark.box@1', m.size, m.pos, 'marker');
const floorMarker = (id: string, size: [number, number], at: [number, number]): Marker => ({ id, size: [size[0], 0.001, size[1]], pos: [at[0], 0.0005, at[1]] });

function document(id: string, size: [number, number], items: JsonObject[]): JsonObject {
  return {
    format: 1, id, profile: 'scene', title: `#2516 AC4 ${id}`, description: 'A literal ambient-occlusion fixture under uniform ambient with no lights.', size, camera: 'cam',
    transport: { span: '2s' }, requires: { modules: { scene3d: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])),
  };
}

export interface Fixture {
  name: string;
  size: [number, number];
  cameras: Camera[];
  /** The fixture's solids beside the floor. */
  solids: JsonObject[];
  floorSide: number;
  /** Per read distance in cm, its band marker. */
  bands: Map<number, Marker>;
  /** Markers at the corners of every surface within the radius of a read point: each must be in the frame. */
  corners: Marker[];
}
/** The fixture's document from one camera: plain, or with its markers (the locator). */
export function documentOf(f: Fixture, cam: Camera, withMarkers: boolean): JsonObject {
  const markers = withMarkers ? [...f.bands.values(), ...f.corners].map(markerItem) : [];
  return document(`${f.name}-${cam.name.replace(/[^a-z0-9]+/gi, '-')}${withMarkers ? '-locator' : ''}`, f.size,
    [camera(cam), floor(f.floorSide), ...f.solids, floorMaterial, sky, ...markers]);
}

/**
 * The cube (README: Fixtures): 0.2 m on a side on the floor, centred on x = z = 0, the face read at z = +0.1. Each
 * band is the middle 10 cm of the face along x and 1 cm deep about d. Every surface within 0.5 m of a band point lies
 * in x ∈ [−0.55, 0.55], z ∈ [−0.355, 0.705] (the floor) or is the cube; the corner markers stand just outside that.
 */
export const CUBE_FIXTURE: Fixture = {
  name: 'cube',
  size: [960, 720],
  cameras: [
    { name: 'facing the face', target: [0, 0.05, 0.15], azimuth: 0, elevation: 40, distance: 2.4 },
    { name: '90° around it', target: [0, 0.05, 0.15], azimuth: 90, elevation: 40, distance: 2.4 },
  ],
  solids: [solid('block', 'a2', 'mark.box@1', [0.2, 0.2, 0.2], [0, 0.1, 0], 'block')],
  floorSide: 8,
  bands: new Map([5, 10].map((cm): [number, Marker] => [cm, floorMarker(`at-${cm}`, [0.1, 0.01], [0, 0.1 + cm / 100])])),
  corners: [[-0.56, -0.36], [0.56, -0.36], [-0.56, 0.71], [0.56, 0.71]].map(([x, z], i) => floorMarker(`corner-${i + 1}`, [0.02, 0.02], [x!, z!])),
};

// The redraft's own wall fixture is withdrawn (owner-approved, APPROVED.md, D): the planted loop's wall witness is the
// original suite's wall fixture (../helpers.ts), read in cube.test.ts. It stays in history at 3cd75b8aa.

// ---------------------------------------------------------------------------------------------------
// Drawing and reading (README: The reading)

const view = (doc: string, ao: JsonObject | 'none', size: [number, number]): JsonObject =>
  ({ call: 'view3d', doc, look: lookWith(ao), size, targets: ['linear', 'ids'], capture: [0] });

/** One reading: the floor's radiance with ao on ÷ the same pixels' with `ao: none`, over a band's pixels. */
export interface Reading { camera: string; setting: string; cm: number; value: number; pixels: number }

/**
 * Draws the fixture from each camera: its locator (markers, ao none), the plain frame with ao none, and the plain
 * frame with ao on at each setting, all in one `deep-gpu run`. Checks every corner marker is in the frame and each
 * band is floor in the plain frame, then returns each band's reading.
 */
export function readFixture(bin: string, out: string, f: Fixture, planted?: string): Reading[] {
  const calls: JsonObject[] = []; const what: string[] = [];
  for (const cam of f.cameras) {
    const locator = writeJson(out, `${f.name}-${f.cameras.indexOf(cam)}-locator.json`, documentOf(f, cam, true));
    const plain = writeJson(out, `${f.name}-${f.cameras.indexOf(cam)}.json`, documentOf(f, cam, false));
    calls.push(view(locator, 'none', f.size)); what.push(`${f.name} from the camera ${cam.name}: the locator`);
    calls.push(view(plain, 'none', f.size)); what.push(`${f.name} from the camera ${cam.name}: ao none`);
    for (const s of SETTINGS) { calls.push(view(plain, aoOn(s.samples, s.resolution), f.size)); what.push(`${f.name} from the camera ${cam.name}: ao at ${settingName(s)}`); }
  }
  const replies = gpuRun(bin, out, calls, planted).map((r, i) => answered(r, what[i]!));
  const per = 2 + SETTINGS.length;
  const readings: Reading[] = [];
  f.cameras.forEach((cam, c) => {
    const at = (k: number): { ids: () => Ids; lin: () => F32 } => {
      const frame = frameAt(replies[c * per + k]!, 0, what[c * per + k]!);
      return { ids: () => readIds(out, frame, what[c * per + k]!), lin: () => readTarget(out, frame, 'linear', f.size, what[c * per + k]!) };
    };
    const locIds = at(0).ids();
    const missing = f.corners.filter((m) => !anyPixel(locIds, m.id)).map((m) => `${m.id} at [${m.pos.join(', ')}]`);
    expect(missing, `${f.name}, camera ${cam.name}: every surface within the radius of a read point is in the frame (corner markers seen in the ID target)`).toEqual([]);
    const offIds = at(1).ids(); const off = at(1).lin();
    const ons = SETTINGS.map((_, k) => at(2 + k).lin());
    for (const [cm, marker] of f.bands) {
      const px: number[] = [];
      for (let y = 0; y < f.size[1]; y++) for (let x = 0; x < f.size[0]; x++) if (locIds.at(x, y) === marker.id) px.push(y * f.size[0] + x);
      expect(px.length, `${f.name}, camera ${cam.name}: the band at ${cm} cm covers at least 20 pixels`).toBeGreaterThanOrEqual(20);
      const notFloor = px.filter((i) => offIds.at(i % f.size[0], Math.floor(i / f.size[0])) !== 'floor').length;
      expect(notFloor, `${f.name}, camera ${cam.name}: the band at ${cm} cm is floor in the frame without markers`).toBe(0);
      const sum = (img: F32): number => px.reduce((s, i) => s + luma(texel(img, i % f.size[0], Math.floor(i / f.size[0]))), 0);
      const base = sum(off);
      expect(base / px.length, `${f.name}, camera ${cam.name}: the ambient light reaches the floor at ${cm} cm with ao none`).toBeGreaterThan(0.01);
      SETTINGS.forEach((s, k) => readings.push({ camera: cam.name, setting: settingName(s), cm, value: sum(ons[k]!) / base, pixels: px.length }));
    }
  });
  for (const r of readings) console.log(`${planted ?? 'the build'}  ${f.name}, camera ${r.camera}, ${r.setting}, ${r.cm} cm: ${r.value.toFixed(4)} over ${r.pixels} px`);
  return readings;
}
function anyPixel(ids: Ids, id: string): boolean {
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) if (ids.at(x, y) === id) return true;
  return false;
}

/** The readings off their expected value by more than `tol`, each naming its camera, setting and distance. */
export function offBy(readings: Reading[], expected: (cm: number) => number, tol: number, what: string): string[] {
  return readings.filter((r) => !(Math.abs(r.value - expected(r.cm)) <= tol))
    .map((r) => `camera ${r.camera} (${r.setting}) at ${r.cm} cm: reads ${r.value.toFixed(4)} where ${what} is ${expected(r.cm).toFixed(4)}, off by more than ${tol}`);
}
