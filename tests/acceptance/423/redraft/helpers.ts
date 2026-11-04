// Test-side tools the redrafted tests add beside ../helpers.ts (redraft/README: What changed). Nothing here stands in
// for the importer or the renderer: one reads the import out of a reply the design's cap refuses, one turns a node's
// world matrix into an item's `at`, and one is the reviewed CPU reference for NegativeScaleTest's single-sided planes.

import { expect } from 'vitest';
import {
  accessor, apply, decodePng, det, imageBytes, importOf, num, orthoProject,
  type Gltf, type Image, type Imported, type JsonObject, type M34, type V3,
} from '../helpers.ts';

/** The document's decoded-image cap, 64 MiB (Material: texture maps, Cost; Image `image@1`). */
export const CAP = 64 * 1024 * 1024;

/**
 * The `imports` entry for `item`, from a reply that was answered or that the design's cap refused: a document whose
 * maps count over 64 MiB decoded is refused `over_budget` (../README: Assumed surfaces 8), and the refusal still holds
 * the import (redraft/README: Assumed surface 12). Any other refusal fails as ../helpers' `importOf` fails it.
 */
export function importDrawnOrOverCap(reply: JsonObject, item: string, what: string): Imported {
  if (reply['code'] !== 'over_budget') return importOf(reply, item, what);
  const bytes = num(reply['decoded_bytes'], `${what}: the over_budget refusal's decoded_bytes`);
  expect(bytes, `${what} is refused over_budget only when its maps count over the ${CAP} B cap`).toBeGreaterThan(CAP);
  console.log(`${what}: refused over_budget at ${bytes} B decoded, as the cap requires; its import is read from the refusal`);
  const rest: JsonObject = Object.fromEntries(Object.entries(reply).filter(([k]) => k !== 'code'));
  return importOf(rest, item, `${what} (refused over_budget at ${bytes} B)`);
}

/** An item's `at` (pos, rot in degrees as Rz·Ry·Rx, scale) for a world matrix with a positive determinant. */
export function atOf(world: M34): JsonObject {
  expect(det(world), 'a node placed as its own item has a positive world determinant').toBeGreaterThan(0);
  const s = [0, 1, 2].map((j) => Math.hypot(world[0][j]!, world[1][j]!, world[2][j]!));
  const r = (i: number, j: number): number => world[i as 0 | 1 | 2][j]! / s[j]!;
  const deg = (a: number): number => (a * 180) / Math.PI;
  const rot = [deg(Math.atan2(r(2, 1), r(2, 2))), deg(Math.asin(Math.max(-1, Math.min(1, -r(2, 0))))), deg(Math.atan2(r(1, 0), r(0, 0)))];
  return { pos: [world[0][3], world[1][3], world[2][3]], rot, scale: s };
}

const list = (g: Gltf, key: string): JsonObject[] => ((g.json[key] as JsonObject[] | undefined) ?? []);

/** One triangle of a node in world metres, with its texture coordinates and the node it belongs to. */
interface Tri { node: number; p: [V3, V3, V3]; uv: [number[], number[], number[]]; image: Image }
/**
 * Node `i`'s triangles that face a camera on +Z: wound counter-clockwise seen from +Z when the node's world
 * determinant is positive, clockwise when it is negative (glTF 2.0, Instantiation). Each carries its base color map.
 */
function frontTriangles(g: Gltf, i: number, world: M34): Tri[] {
  const mesh = list(g, 'meshes')[list(g, 'nodes')[i]!['mesh'] as number]!;
  const sign = Math.sign(det(world));
  const out: Tri[] = [];
  for (const p of mesh['primitives'] as JsonObject[]) {
    const attrs = p['attributes'] as JsonObject;
    const mat = list(g, 'materials')[p['material'] as number]!;
    const tex = list(g, 'textures')[((mat['pbrMetallicRoughness'] as JsonObject)['baseColorTexture'] as JsonObject)['index'] as number]!;
    const image = decodePng(imageBytes(g, tex['source'] as number));
    const pos = accessor(g, attrs['POSITION'] as number).map((q) => apply(world, q));
    const uv = accessor(g, attrs['TEXCOORD_0'] as number);
    const idx = typeof p['indices'] === 'number' ? accessor(g, p['indices']).map((r) => r[0]!) : pos.map((_, k) => k);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      const [pa, pb, pc] = [pos[a]!, pos[b]!, pos[c]!];
      const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
      if (area * sign > 0) out.push({ node: i, p: [pa, pb, pc], uv: [uv[a]!, uv[b]!, uv[c]!], image });
    }
  }
  return out;
}

export type Texel = 'red' | 'green' | 'other';
/** A colour's class: red or green when that channel is over twice each other one (the X and the check), else other. */
export function hue(c: readonly number[], floor: number): Texel {
  const [r, g, b] = [c[0]!, c[1]!, c[2]!];
  if (r > floor && r > 2 * Math.max(g, b)) return 'red';
  if (g > floor && g > 2 * Math.max(r, b)) return 'green';
  return 'other';
}
/** What a correct render shows at one frame pixel: the nearest front-facing triangle's node, and its map's texel. */
export interface Shown { node: number; texel: Texel }
/** A cell of the planes' grid: a quad's box in frame px, named by the file's own labels. */
export interface Cell { name: string; x0: number; y0: number; x1: number; y1: number }
/**
 * The reviewed CPU reference for NegativeScaleTest's single-sided planes, orthographic from +Z (`ortho`): at each pixel
 * centre, among the front-facing triangles of `planes` (back faces culled), the nearest one (largest z) is shown,
 * and its base color map's texel at the interpolated texture coordinate (nearest texel; glTF's v runs down the
 * image). `cells` are the distinct boxes of the planes' quads, named by row (top first) and column (left first).
 */
export function planesReference(g: Gltf, worlds: Map<number, M34>, planes: number[], target: V3, viewWidth: number, size: [number, number], rows: string[], columns: string[]): { at: (x: number, y: number) => Shown | null; cells: Cell[] } {
  const tris = planes.flatMap((i) => frontTriangles(g, i, worlds.get(i)!));
  const k = size[0] / viewWidth;
  const at = (x: number, y: number): Shown | null => {
    const wx = target[0] + (x + 0.5 - size[0] / 2) / k;
    const wy = target[1] - (y + 0.5 - size[1] / 2) / k;
    let best: Shown | null = null; let bestZ = -Infinity;
    for (const t of tris) {
      const [a, b, c] = t.p;
      const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      const l1 = ((wx - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (wy - a[1])) / d;
      const l2 = ((b[0] - a[0]) * (wy - a[1]) - (wx - a[0]) * (b[1] - a[1])) / d;
      const l0 = 1 - l1 - l2;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const z = l0 * a[2] + l1 * b[2] + l2 * c[2];
      if (z <= bestZ) continue;
      const u = l0 * t.uv[0][0]! + l1 * t.uv[1][0]! + l2 * t.uv[2][0]!;
      const v = l0 * t.uv[0][1]! + l1 * t.uv[1][1]! + l2 * t.uv[2][1]!;
      const tx = Math.min(t.image.width - 1, Math.max(0, Math.floor(u * t.image.width)));
      const ty = Math.min(t.image.height - 1, Math.max(0, Math.floor(v * t.image.height)));
      const o = (ty * t.image.width + tx) * 4;
      best = { node: t.node, texel: hue([t.image.rgba[o]!, t.image.rgba[o + 1]!, t.image.rgba[o + 2]!], 32) };
      bestZ = z;
    }
    return best;
  };
  // Each node's triangles, both faces, grouped into the boxes of their quads; boxes that coincide are one cell.
  const boxes = new Map<string, [number, number, number, number]>();
  for (const i of planes) {
    const mesh = list(g, 'meshes')[list(g, 'nodes')[i]!['mesh'] as number]!;
    for (const p of mesh['primitives'] as JsonObject[]) {
      const pos = accessor(g, (p['attributes'] as JsonObject)['POSITION'] as number).map((q) => apply(worlds.get(i)!, q));
      const idx = typeof p['indices'] === 'number' ? accessor(g, p['indices']).map((r) => r[0]!) : pos.map((_, n) => n);
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const px = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((n) => orthoProject(target, viewWidth, size, pos[n]!));
        const box: [number, number, number, number] = [Math.min(...px.map((q) => q[0])), Math.min(...px.map((q) => q[1])), Math.max(...px.map((q) => q[0])), Math.max(...px.map((q) => q[1]))];
        // Two triangles of one quad share its box's corners; a triangle's own box is its quad's.
        boxes.set(box.map((n) => Math.round(n)).join(','), box);
      }
    }
  }
  const all = [...boxes.values()];
  const rowsAt = [...new Set(all.map((b) => Math.round(b[1])))].sort((a, b) => a - b);
  const colsAt = [...new Set(all.map((b) => Math.round(b[0])))].sort((a, b) => a - b);
  expect([rowsAt.length, colsAt.length], `NegativeScaleTest's single-sided planes form the ${rows.length} × ${columns.length} grid its labels name`).toEqual([rows.length, columns.length]);
  const cells: Cell[] = all.map((b) => ({ name: `${rows[rowsAt.indexOf(Math.round(b[1]))]} row, ${columns[colsAt.indexOf(Math.round(b[0]))]} column`, x0: b[0], y0: b[1], x1: b[2], y1: b[3] }));
  return { at, cells };
}
