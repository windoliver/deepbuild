// Test-side tools for the #2215 acceptance tests: the issue’s fixture (a brushed pane over a glowing disk), drawn by
// the base’s `deep-gpu` (#378’s `view3d`, #428’s transmission and anisotropy) in raster or as a path-traced final
// (#178, not built at the base: README: Assumed surfaces); the reading (the glow’s spread along u and v, its long axis);
// the corpus AC5 holds still; and the planted programs. #428’s helpers build the binary, run it and read its targets.
// Nothing here stands in for the renderer, the tracer or the receipt.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  DARK_SKY, PLAIN_LOOK, REPO, SPHERE_SIZE, answered, blocked, box, camera, frameAt, framesOf, isObject, material, readLinear, runGpu, sessionDoc,
  shown, sphereDoc, sun, unlit, writeJson, type GpuPlanted, type JsonObject, type Linear,
} from '../428/helpers.ts';

export { REPO, blocked, failsNaming, frameAt, framesOf, inconclusive, isObject, none, requireMetal, shown, str, useDir, useGpu, type JsonObject } from '../428/helpers.ts';
export const HERE = join(REPO, 'tests', 'acceptance', '2215');

/** The criteria’s IDs: `#2215.` and the first 8 hex characters of SHA-256 of each criterion’s text (README: Criteria). */
export const AC = {
  1: 'AC1 #2215.021cca23',
  2: 'AC2 #2215.2c2aa19d',
  3: 'AC3 #2215.74b10a80',
  4: 'AC4 #2215.87722da6',
  5: 'AC5 #2215.64bff3ff',
} as const;

/** The wrong programs the criteria name, each reachable only through `deep-gpu run --planted <name>` (README). */
export type Planted =
  | 'final_refracts_round' | 'final_ignores_rotation' | 'final_stretches_reflection_only' | 'final_stretches_refraction_only'
  | 'raster_lists_nothing';
/** One `deep-gpu run` of `calls` (#428’s runner; its planted type lists #428’s names, so this suite’s are cast). */
export const run = (bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] =>
  runGpu(bin, out, calls, planted as GpuPlanted | undefined);

// ---------------------------------------------------------------------------------------------------
// The fixture (the issue’s Scope): a flat pane 1 m across with transmission 1, roughness 0.3 and ior 1.5; a glowing
// disk 0.05 m in radius 2 m behind its centre; an orthographic camera 2 m in front; a black environment; no light.

export const SIZE: [number, number] = [512, 512];
/** The final’s samples a pixel (AC1: "at 512² and 4,096 samples"). */
export const SAMPLES = 4096;
/** The pane: a `slab@1` 1 × 1 m and 2 mm thick, centred on the origin and facing +z. Its uv0 is planar along z, so on
 * both faces u runs along world +x (the frame’s x, left to right) and v along world +y (README: The fixture). */
const PANE: JsonObject = { kind: 'slab@1', params: { size: [1, 1, 0.002], uv0: { planar: { axis: 'z' } } }, at: { pos: [0, -0.5, 0] }, material: 'pane_glass' };
/** A disk 0.05 m in radius and 2 mm thick, its axis along z, its face toward the pane at z = `face` m. */
const disk = (face: number): JsonObject =>
  ({ kind: 'mark.cylinder@1', params: { size: [0.1, 0.002, 0.1] }, at: { pos: [0, 0, face + Math.sign(face) * 0.001], rot: [90, 0, 0] }, material: 'glow' });
/** Radiance 1 from an emitter with no reflection of its own. */
const GLOW = material({ base_color: [0, 0, 0, 1], metallic: 0, specular_level: 0, emission: [1, 1, 1], emission_strength: 1 });
/** Orthographic, 2 m in front of the pane, the pane filling the frame (512 px a metre). Its near plane at 0.5 m keeps
 * the mirrored disk (AC3), at the camera’s own plane, out of every camera ray: it is seen only in the pane. */
const CAM: JsonObject = { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 2], target: [0, 0, 0], view_width: 1, near: 0.5, far: 10 } };

export interface Fixture { strength: number; rotation?: number; mirrored?: boolean }
/** The fixture with the pane’s anisotropy, and with AC3’s second disk mirrored in the pane on the camera’s side. */
export function fixture(f: Fixture): JsonObject {
  const glass = material({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.3, transmission: 1, ior: 1.5, anisotropy: { strength: f.strength, rotation: f.rotation ?? 0 } });
  return sessionDoc(`pane-2215-s${f.strength}-r${f.rotation ?? 0}${f.mirrored ? '-mirrored' : ''}`, SIZE, {
    cam: CAM, sky: DARK_SKY, pane_glass: glass, glow: GLOW, pane: PANE, disk: disk(-2), ...(f.mirrored ? { mirrored: disk(2) } : {}),
  });
}

/** A `view3d` call: tone map none at scale 1, one frame, its receipt; with `samples`, an export-class view drawing a
 * path-traced final with the Export’s own fields (README: Assumed surfaces 1). */
export function view3d(doc: string, size: [number, number], samples: number | null, extra: JsonObject = {}): JsonObject {
  return {
    call: 'view3d', doc, look: PLAIN_LOOK, size, frames: 1, capture: [0], targets: ['linear'], receipt: true,
    ...(samples === null ? {} : { class: 'export', export: { frames: 'path_traced', path: { samples } } }), ...extra,
  };
}

const UNBLOCK = 'Path-traced finals (#178): export: {frames: path_traced, path: {samples}} on an export-class view3d, on a GPU with hardware ray queries, with the Paths table answering material@1 in a final';
/** A final’s reply: BLOCKED naming #178 when the final is refused or missing (no `receipt.final`), never a pass. */
export function finalReply(reply: JsonObject, samples: number, what: string): JsonObject {
  if (reply['code'] !== undefined && reply['code'] !== 'unsupported_platform') {
    blocked(`${what}: view3d refused the path-traced final (#178) with ${String(reply['code'])}: ${shown(reply)}`, UNBLOCK);
  }
  const receipt = answered(reply, what)['receipt'];
  const fin = isObject(receipt) ? receipt['final'] : undefined;
  if (!isObject(fin)) blocked(`${what}: view3d drew no path-traced final (#178): its receipt has no final block, so the frame is raster (receipt ${shown(receipt)})`, UNBLOCK);
  expect(fin['samples'], `${what}: the final traced ${samples} samples a pixel (receipt.final.samples)`).toBe(samples);
  return reply;
}

/** Each document drawn once at SIZE, in raster (`samples` null) or as a final; its linear target and its reply. */
export function draw(bin: string, out: string, docs: { name: string; doc: JsonObject }[], samples: number | null, planted?: Planted): Map<string, { linear: Linear; reply: JsonObject }> {
  const replies = run(bin, out, docs.map((d) => view3d(writeJson(out, d.name, d.doc), SIZE, samples)), planted);
  const drawn = new Map<string, { linear: Linear; reply: JsonObject }>();
  docs.forEach((d, i) => {
    const what = `${d.name}${planted ? ` (--planted ${planted})` : ''}`;
    const reply = samples === null ? replies[i]! : finalReply(replies[i]!, samples, what);
    drawn.set(d.name, { linear: readLinear(out, frameAt(framesOf(reply, what), 0, what).linear, SIZE, `${what}: linear`), reply });
  });
  return drawn;
}

// ---------------------------------------------------------------------------------------------------
// The reading: the glow’s spread along u and along v, the square root of its second moment about its centroid in
// linear light (luminance, Rec. 709), over every pixel of the frame, in pixels; and its long axis.

export interface Glow { total: number; cx: number; cy: number; xx: number; yy: number; xy: number; su: number; sv: number }
const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
/** The glow in `lin`, less `minus` pixel by pixel where given (AC3: the frame with the mirrored disk less the one without). */
export function glowOf(lin: Linear, minus?: Linear): Glow {
  let t = 0; let sx = 0; let sy = 0;
  const w = new Float64Array(lin.width * lin.height);
  for (let y = 0; y < lin.height; y++) for (let x = 0; x < lin.width; x++) {
    const v = lum(lin.at(x, y)) - (minus ? lum(minus.at(x, y)) : 0);
    w[y * lin.width + x] = v; t += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
  }
  const cx = sx / t; const cy = sy / t;
  let xx = 0; let yy = 0; let xy = 0;
  for (let y = 0; y < lin.height; y++) for (let x = 0; x < lin.width; x++) {
    const v = w[y * lin.width + x]!; const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
    xx += v * dx * dx; yy += v * dy * dy; xy += v * dx * dy;
  }
  xx /= t; yy /= t; xy /= t;
  return { total: t, cx, cy, xx, yy, xy, su: Math.sqrt(xx), sv: Math.sqrt(yy) };
}
/** The long axis’s angle from u in degrees, in [0, 180) (y down the frame), and the spreads along the long and short axes. */
export function axisOf(g: Glow): { angle: number; long: number; short: number } {
  const angle = ((((0.5 * Math.atan2(2 * g.xy, g.xx - g.yy) * 180) / Math.PI) % 180) + 180) % 180;
  const mid = (g.xx + g.yy) / 2; const half = Math.sqrt(((g.xx - g.yy) / 2) ** 2 + g.xy ** 2);
  return { angle, long: Math.sqrt(mid + half), short: Math.sqrt(Math.max(mid - half, 0)) };
}
export const f2 = (v: number): string => v.toFixed(2);
/** A reading that saw no glow is a failure of its own, naming the part. */
export function glowProblems(g: Glow, what: string): string[] {
  return g.total > 0 && Number.isFinite(g.su) && Number.isFinite(g.sv) ? [] : [`pane: ${what} shows no glow (luminance summed over the frame ${g.total})`];
}

/** AC1’s reading on the final, shared with AC3’s planted twin: strength 0.5 at least twice as wide along u as along v,
 * strength 0 within 5%; each failure names the part and both spreads. */
export function stretchOnFinal(bin: string, out: string, planted?: Planted): { failures: string[]; half: Glow; zero: Glow } {
  const d = draw(bin, out, [{ name: 'half', doc: fixture({ strength: 0.5 }) }, { name: 'zero', doc: fixture({ strength: 0 }) }], SAMPLES, planted);
  const half = glowOf(d.get('half')!.linear); const zero = glowOf(d.get('zero')!.linear);
  const tag = planted ? ` (--planted ${planted})` : '';
  console.log(`${AC[1]}${tag}: strength 0.5 spreads ${f2(half.su)} px along u, ${f2(half.sv)} px along v (ratio ${f2(half.su / half.sv)}); strength 0: ${f2(zero.su)}, ${f2(zero.sv)} (ratio ${f2(zero.su / zero.sv)})`);
  const failures = [...glowProblems(half, 'the final at strength 0.5'), ...glowProblems(zero, 'the final at strength 0')];
  if (!(half.su >= 2 * half.sv)) failures.push(`pane: at strength 0.5 the final’s glow spreads ${f2(half.su)} px along u and ${f2(half.sv)} px along v, a ratio of ${f2(half.su / half.sv)}, under 2`);
  if (!(Math.abs(zero.su / zero.sv - 1) <= 0.05)) failures.push(`pane: at strength 0 the final’s glow spreads ${f2(zero.su)} px along u and ${f2(zero.sv)} px along v, not within 5% of each other`);
  return { failures, half, zero };
}

// ---------------------------------------------------------------------------------------------------
// AC5’s corpus (README: The corpus): documents already in the repository that draw scene3d materials, none with both
// features on one material.

const repoJson = (path: string): JsonObject => JSON.parse(readFileSync(join(REPO, path), 'utf8')) as JsonObject;
export interface Member { name: string; size: [number, number]; call: (out: string) => JsonObject }
const own = (name: string, size: [number, number], doc: () => JsonObject): Member =>
  ({ name, size, call: (out) => ({ doc: writeJson(out, `corpus-${name}`, doc()), look: PLAIN_LOOK }) });
/** #428 AC3’s frosted panes over a black-to-white edge (transmission, no anisotropy), as its transmission.test.ts builds them. */
function frost(): JsonObject {
  const glass = (r: number): JsonObject => ({ kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: r, transmission: 1, ior: 1.5, absorption: { thickness: 0 } } });
  const items: Record<string, JsonObject> = {
    cam: camera([0, 0, 1.5], [0, 0, 0], 40), sky: DARK_SKY, black: unlit([0, 0, 0]), white: unlit([1, 1, 1]),
    left: box([2, 4, 0.01], [-1, 0, -0.505], 'black'), right: box([2, 4, 0.01], [1, 0, -0.505], 'white'),
  };
  for (const p of [{ id: 'frost_000', r: 0, y: 0.15 }, { id: 'frost_030', r: 0.3, y: 0 }, { id: 'frost_060', r: 0.6, y: -0.15 }]) {
    items[p.id] = glass(p.r); items[`pane_${p.id}`] = box([0.6, 0.12, 0.002], [0, p.y, 0], p.id);
  }
  return sessionDoc('panes-428', [512, 512], items);
}
export const CORPUS: Member[] = [
  // #422’s castle as committed, with its look and the pack its recipes come from, at half its size.
  { name: 'castle', size: [640, 400], call: () => ({ doc: join(REPO, 'packs/examples/castle.json'), look: repoJson('packs/examples/castle.look.json'), packs: [join(REPO, 'packs', 'composites-1.0.0')] }) },
  // The surfaces example: five formula surfaces under one material and a sun, under the castle’s look, which holds the
  // roles its color ramp names (muted, accent, ink).
  { name: 'surfaces', size: [640, 360], call: () => ({ doc: join(REPO, 'packs/examples/surfaces.json'), look: repoJson('packs/examples/castle.look.json') }) },
  // #428 AC1’s brushed white metal ball at roughness 0.2 and strength 1 under a sun (anisotropy, no transmission).
  own('brushed', SPHERE_SIZE, () => sphereDoc('brushed', { base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.2, anisotropy: { strength: 1 } }, DARK_SKY, sun(Math.PI, [0, 0, 0]))),
  own('frost', [512, 512], frost),
];
/** The corpus’s calls: raster, or finals at `samples`; each with the final and linear targets. */
export const corpusCalls = (out: string, samples: number | null): JsonObject[] =>
  CORPUS.map((m) => ({ ...view3d('', m.size, samples, { targets: ['final', 'linear'] }), ...m.call(out) }));

/** This machine as the recorded hashes name one: its model and its macOS version. */
export function machine(): { model: string; os: string } {
  const read = (cmd: string, args: string[]): string => {
    try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; }
  };
  return { model: read('sysctl', ['-n', 'hw.model']), os: read('sw_vers', ['-productVersion']) };
}
export interface Hashes {
  recorded: { base: string; model: string; os: string; how: string };
  raster: Record<string, { final: string; linear: string }>;
  final: { base: string; model: string; os: string; samples: number; hashes: Record<string, { final: string; linear: string }> } | null;
}
export const readHashes = (): Hashes => JSON.parse(readFileSync(join(HERE, 'hashes.json'), 'utf8')) as Hashes;
