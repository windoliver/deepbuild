// Test-side pieces the #1871 acceptance tests share: #149's gray PNG tooth and its drawn look (from
// tests/acceptance/149/pressure.test.ts), a second gray PNG, the one-box 3D scene, and the `view3d` and `film2d` calls
// that draw them through `deep-gpu run`, the way #149's suite drives it (README: The surface under test). Everything
// else (the build, the JSON-lines run, PNG reading) is #149's own helpers, imported, not copied.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeGrayPng, figure, film2dCall, look, mark, sha256, view3dCall, writeJson, type JsonObject } from '../149/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, as the lanes know them. */
export const AC = {
  1: 'AC1 #1871.9a827581',
  2: 'AC2 #1871.7550b5c1',
  3: 'AC3 #1871.fbe6ad2a',
  4: 'AC4 #1871.f656387e',
} as const;

// #149's tooth image, as its pressure test writes it: 256 × 128 px of 8 × 8 px patches, 256 gray levels in bit-reversed
// order so neighbours differ.
export const TOOTH_SIZE = [256, 128] as const;
const PATCH = 8;
const reverse8 = (v: number): number => { let r = 0; for (let i = 0; i < 8; i++) if (v & (1 << i)) r |= 1 << (7 - i); return r; };
const toothCode = (i: number, j: number): number => reverse8((j * 32 + i) & 255);
/** #149's gray PNG tooth. */
export const toothPng = (): Buffer => encodeGrayPng(TOOTH_SIZE[0], TOOTH_SIZE[1], (x, y) => toothCode(Math.floor(x / PATCH), Math.floor(y / PATCH)));
/** A different gray PNG of the same size: #149's tooth inverted, so every patch's level changes (no patch is 127.5). */
export const otherToothPng = (): Buffer => encodeGrayPng(TOOTH_SIZE[0], TOOTH_SIZE[1], (x, y) => 255 - toothCode(Math.floor(x / PATCH), Math.floor(y / PATCH)));

/** A PNG written into the run's folder, named in a call's `assets` by its SHA-256. */
export interface Asset { hash: string; file: string }
export function putPng(out: string, name: string, png: Buffer): Asset {
  const file = join(out, name);
  writeFileSync(file, png);
  return { hash: sha256(png), file };
}
export const assetsOf = (...list: Asset[]): JsonObject => Object.fromEntries(list.map((a) => [a.hash, a.file]));

/** #149's drawn look for its gray PNG tooth (pressure.test.ts), its paper's `tooth.from` naming `hash`. */
export const toothLook = (hash: string): JsonObject => look({
  id: 'pressure-149',
  ground: { kind: 'paper', params: { role: 'paper', seed: 'document', tooth: { kind: 'cold_press', from: hash, scale: 1, depth: 1, seed: 1 }, anchor: 'world', zoom: 'crossfade_octaves' } },
  lines: { line: { kind: 'exact', width: 2 }, light: { kind: 'exact', width: 96, pressure: 0.3 } },
});

/** #149's 2D page under that look: the pressure test's figure, one wide light stroke across the tooth. */
export const PAGE_2D: JsonObject = figure('pressure-149', TOOTH_SIZE, { swipe: mark('swipe', 'path@1', 'a0', { d: 'M -8 64 L 264 64', paint: { stroke: { role: 'ink', line: 'light' } } }) });

/** The one-box 3D scene: a camera and one box, 480 × 270, so most of the frame is the paper around the box. */
export const SIZE_3D = [480, 270] as const;
export const SCENE_3D: JsonObject = {
  format: 1, id: 'tooth-box-1871', profile: 'scene', title: 'A box on a toothed paper', description: 'A box on a toothed paper: a #1871 acceptance scene in a drawn look.',
  size: [...SIZE_3D], camera: 'cam', transport: { span: '1s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'figure' },
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
  items: {
    cam: { id: 'cam', kind: 'camera@1', layer: 'main', name: 'cam', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], position: [2.2, 1.6, 4.4], fov: 40, near: 0.1, far: 40 } },
    box: { id: 'box', kind: 'mark.box@1', layer: 'main', name: 'box', order: 'a1', params: { size: [1, 1, 1], paint: { fill: { fill: 'fill', role: 'indigo' } } }, at: { pos: [0, 0, 0] } },
  },
};

/** One `view3d` call drawing frame 0 of the scene under `lk`, its final frame captured, with `assets` as given. */
export function view3dOf(out: string, lk: JsonObject, assets: JsonObject): JsonObject {
  const doc = writeJson(out, 'tooth-box.json', SCENE_3D);
  return { ...view3dCall(doc, lk, SIZE_3D, { fps: 30, from: 0, frames: 1, capture: [0], targets: ['final'] }), assets };
}
/** One `film2d` call drawing frame 0 of #149's 2D page under `lk`, captured, with `assets` as given. */
export const film2dOf = (lk: JsonObject, assets: JsonObject): JsonObject => film2dCall(PAGE_2D, lk, { fps: 30, from: 0, frames: 1, capture: [0], assets });
