// Test-side tools for the #269 acceptance tests (README: The surface under test). Builds, the assembler, evidence
// stores and `deep-show run` come from #538's suite by import (../538/helpers.ts, read only) and `deep-gpu`'s written
// files from #537's (../537/helpers.ts); ac6 takes the perf lane's judge from #1634's (../1634/helpers.ts). This file adds
// the criteria's IDs, the planted names, `deep-gpu run` with this suite's plants, the 2D calls' requests and replies, a
// role's coverage of a pixel, and the Catmull-Rom kernel the expected values come from. Nothing here rebuilds a share,
// picks a role or draws: every pixel, hash, count and issue read here is the implementation's own.

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { arr, decodePng, num, obj, REPO, show, TIMEOUT, type Image, type JsonObject, type JsonValue } from '../538/helpers.ts';
import { readNamed } from '../537/helpers.ts';

export {
  arr, at, binOf, blocked, determinismCall, evalCall, failsNaming, field, inconclusive, isObject, issuesOf, names, none, num, obj,
  pngBytes, pngOf, prebuild, presented, putEvidence, REPO, runShow, scenario, sha256, show, showCall, snapshotOf, str,
  TIMEOUT, useTemp, type Image, type JsonObject, type JsonValue, type Program,
} from '../538/helpers.ts';
export { putAsset, requireMetal } from '../537/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs's `criterionId`). */
export const AC = {
  1: 'AC1 #269.871a5dac',
  2: 'AC2 #269.5fc34243',
  3: 'AC3 #269.93b14936',
  4: 'AC4 #269.21d6944d',
  5: 'AC5 #269.2dd4ac2c',
  6: 'AC6 #269.6ad7e180',
  7: 'AC7 #269.40ff86cd',
} as const;

/** The wrong programs (README: Plants): `deep-show run`'s scenario `planted` values and `deep-gpu run --planted` names. */
export const SHOW_PLANTS = ['grid_bspline_rebuild', 'grid_bilinear_rebuild', 'grid_share_passes_half'] as const;
export const GPU_PLANTS = ['grid_keeps_previous_step', 'grid_role_before_rebuild'] as const;
export type ShowPlant = (typeof SHOW_PLANTS)[number];
export type GpuPlant = (typeof GPU_PLANTS)[number];

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB269D${String(n).padStart(18, '0')}`;

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one `{out, calls}` line in, one `{ok, replies}` line out (#377).

const MIB = 1024 * 1024;
export function runGpu(bin: string, out: string, calls: JsonObject[], what: string, planted?: GpuPlant): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const tag = `${what}: deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag} did not finish within its timeout`);
  if (r.error) throw r.error;
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag} exits 0 (${r.signal ?? 'no signal'})${planted ? `, taking the planted ${planted}` : ''}; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${tag}: the answer`);
  expect(answer['ok'], `${tag} answers the scenario ok: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(replies.length, `${tag}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that answers rather than refuses (a refusal carries `code`). */
export function answered(reply: JsonObject, what: string): JsonObject {
  expect(reply['code'], `${what} is answered, not refused: ${show(reply, 2500)}`).toBeUndefined();
  return reply;
}

/** `layers` (#385): each writer layer of `doc` at `t` flicks drawn alone by each renderer `by` names, in the clean look,
 * the logic programs read from `assets` ({sha256: path}, as `view3d`'s, #537). */
export const layersCall = (doc: JsonObject, t: number, by: ('vello_cpu' | 'gpu_layer')[], assets: Record<string, string>): JsonObject =>
  ({ call: 'layers', doc, look: 'clean', t, by, assets });
/** One renderer's picture of the one layer `main` of a `layers` reply. */
export function layerPicture(out: string, reply: JsonObject, by: 'vello_cpu' | 'gpu_layer', what: string): Image {
  answered(reply, what);
  const layers = arr(reply['layers'], `${what}: layers`).map((l, i) => obj(l, `${what}: layers[${i}]`));
  const main = layers.find((l) => l['layer'] === 'main');
  expect(main, `${what}: the layer main is in the reply (${layers.map((l) => String(l['layer'])).join(', ')})`).toBeDefined();
  const side = obj(obj(main!['drawn'], `${what}: drawn`)[by], `${what}: drawn.${by}`);
  expect(side['ok'], `${what}: ${by} draws the layer, not refuses it: ${show(side)}`).not.toBe(false);
  return decodePng(readNamed(out, typeof side['png'] === 'string' ? side['png'] : null, 'png', `${what}: the layer by ${by}`));
}

/** `film2d` (#417, #430): `frames` frames of `doc` from frame `from` (nothing drawn before it) at 60 fps in the clean
 * look, each with its `pixel_hash`; with `counts`, each frame's `row_uploads`; with `timings`, each frame's `draw_ms`. */
export interface Film2d { from: number; frames: number; counts?: boolean; timings?: boolean; hash?: boolean }
export const film2dCall = (doc: JsonObject, assets: Record<string, string>, f: Film2d): JsonObject =>
  ({ call: 'film2d', doc, look: 'clean', fps: 60, from: f.from, frames: f.frames, hash: f.hash ?? true, ...(f.counts ? { counts: true } : {}), ...(f.timings ? { timings: true } : {}), assets });
/** A `film2d` reply's frames by frame number. */
export function filmFrames(reply: JsonObject, what: string): Map<number, JsonObject> {
  answered(reply, what);
  const out = new Map<number, JsonObject>();
  for (const [i, v] of arr(reply['frames'], `${what}: frames`).entries()) {
    const f = obj(v, `${what}: frames[${i}]`);
    out.set(num(f['frame'], `${what}: frames[${i}].frame`), f);
  }
  return out;
}
/** A frame's `row_uploads.<item>` (README: The surface under test): the grid rows it wrote to the GPU, as listed. */
export function rowUploads(frame: JsonObject, item: string, what: string): number[] {
  const all = obj(frame['row_uploads'], `${what}: row_uploads (README: The surface under test)`);
  return arr(all[item], `${what}: row_uploads.${item}`).map((r, i) => num(r, `${what}: row_uploads.${item}[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export type Rgb = [number, number, number];
export const rgbAt = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
export const rgbaAt = (im: Image, x: number, y: number): [number, number, number, number] => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!]; };
/** The largest difference of one channel between two colors. */
export const apart = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
/** How far `p` lies from `ground` towards `role`, 0 to 1 (its projection on the line between them, in sRGB). */
export function coverage(p: Rgb, role: Rgb, ground: Rgb): number {
  const d = role.map((v, i) => v - ground[i]!);
  return d.reduce((s, v, i) => s + v * (p[i]! - ground[i]!), 0) / d.reduce((s, v) => s + v * v, 0);
}
const decode = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const encode = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** Coverage of `role` over `ground` in a picture whose edges blend in sRGB or in linear light, whichever the
 * part-covered `pixels` lie nearer: the projection in that space. */
export function coverageIn(pixels: Rgb[], role: Rgb, ground: Rgb): (p: Rgb) => number {
  const [R, G] = [role.map(decode), ground.map(decode)];
  const d = R.map((v, i) => v - G[i]!);
  const linear = (p: Rgb): number => d.reduce((s, v, i) => s + v * (decode(p[i]!) - G[i]!), 0) / d.reduce((s, v) => s + v * v, 0);
  const srgb = (p: Rgb): number => coverage(p, role, ground);
  const clamp = (c: number): number => Math.min(1, Math.max(0, c));
  let [offS, offL] = [0, 0];
  for (const p of pixels) {
    const c = srgb(p);
    if (c <= 0.05 || c >= 0.95) continue;
    offS += apart(p, role.map((v, i) => ground[i]! + clamp(c) * (v - ground[i]!)));
    offL += apart(p, R.map((v, i) => encode(G[i]! + clamp(linear(p)) * (v - G[i]!))));
  }
  return offL < offS ? linear : srgb;
}
/** The colors the canvas drew for each team role (its key's centre pixels) and for the ground (the picture's top-left
 * pixel, on the backdrop), with a failure when they aren't four distinct colors. */
export interface Key { teams: Rgb[]; ground: Rgb }
export function keyOf(im: Image, top: number, keyCenter: (top: number, i: number) => [number, number], what: string): Key {
  const teams = [0, 1, 2].map((i) => { const [x, y] = keyCenter(top, i); return rgbAt(im, x, y); });
  const ground = rgbAt(im, 0, 0);
  const all = [...teams, ground].map((c) => c.join(','));
  expect(new Set(all).size, `${what}: the key draws the three team roles and the ground as four colors (${all.join(' | ')})`).toBe(4);
  return { teams, ground };
}

// ---------------------------------------------------------------------------------------------------
// The interpolating Catmull-Rom cubic (a = −1/2): k(0) = 1, k(±1) = k(±2) = 0, and the shifted kernels sum to 1. A lone
// held cell's share at (x, y) cells from its centre is k(x) × k(y); its role draws where that passes 1/2.

export function catmullRom(x: number): number {
  const a = Math.abs(x);
  if (a <= 1) return 1.5 * a ** 3 - 2.5 * a ** 2 + 1;
  if (a < 2) return -0.5 * a ** 3 + 2.5 * a ** 2 - 4 * a + 2;
  return 0;
}
/** A lone cell's share at (x, y) cells from its centre. */
export const loneShare = (x: number, y: number): number => catmullRom(x) * catmullRom(y);
/** How far from the centre, in cells, the share passes 1/2 along the unit direction (dx, dy) on the line offset `off`
 * cells across it: the root of k·k = 1/2 between 0 and 1, by bisection. */
export function halfLevel(dx: number, dy: number, off = 0): number {
  const [nx, ny] = [-dy, dx];
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (loneShare(m * dx + off * nx, m * dy + off * ny) > 0.5) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
/** The boundary k(x)·k(y) = 1/2 as 1,440 points (in cells from the centre), for a pixel's distance to it. */
export const HALF_LEVEL: [number, number][] = Array.from({ length: 1440 }, (_, i) => {
  const a = (i / 1440) * 2 * Math.PI;
  const r = halfLevel(Math.cos(a), Math.sin(a));
  return [r * Math.cos(a), r * Math.sin(a)];
});
export const distanceToHalfLevel = (x: number, y: number): number => Math.min(...HALF_LEVEL.map(([bx, by]) => Math.hypot(x - bx, y - by)));
