// The AC1 and AC2 fixture (fixtures/parity/geometry/crease-edges.scene) drawn on the noop lane, and the checks its
// cases are held to, each returning its failures as sentences that name the item and what it drew. Shared by
// crease.test.ts and border.test.ts, which read the same fixture.

import {
  arr, fixture, isObject, look, num, obj, runGpu, segKey, segmentsOf, sessionDoc, startName, str, view3d, view3Reply, writeFile,
  type Frame3, type JsonObject, type Startup,
} from './helpers.ts';
import { length, sub, weldKey, type V3 } from './reference.ts';

export const SCENE = ['parity', 'geometry', 'crease-edges.scene'] as const;
const SIZE: [number, number] = [640, 480];

export interface Case { name: string; line: string; of: string; at: V3; segments: number; guard: { line: string; segments: number } | null; raw: JsonObject }
export function cases(): Map<string, Case> {
  const scene = fixture(...SCENE);
  const out = new Map<string, Case>();
  for (const [name, v] of Object.entries(obj(scene['cases'], 'the fixture\'s cases'))) {
    const c = obj(v, `case ${name}`);
    const at = arr(c['at'], `case ${name}.at`).map((x, k) => num(x, `case ${name}.at[${k}]`)) as V3;
    const g = isObject(c['guard']) ? { line: str(c['guard']['line'], `case ${name}.guard.line`), segments: num(c['guard']['segments'], `case ${name}.guard.segments`) } : null;
    out.set(name, { name, line: str(c['line'], `case ${name}.line`), of: str(c['of'], `case ${name}.of`), at, segments: num(c['segments'], `case ${name}.segments`), guard: g, raw: c });
  }
  return out;
}
export function twinNames(planted: string): string[] {
  const twins = arr(fixture(...SCENE)['twins'], 'the fixture\'s twins').map((t, i) => obj(t, `twins[${i}]`));
  const twin = twins.find((t) => t['planted'] === planted);
  if (!twin) throw Error(`the fixture has no twin ${planted}`);
  return arr(twin['names'], `twin ${planted}.names`).map((n, i) => str(n, `twin ${planted}.names[${i}]`));
}

/** The fixture's items drawn for one frame on the noop backend with `counts`, as `startup` says. */
export function drawScene(bin: string, dir: string, startup: Startup): Frame3 {
  const items = obj(fixture(...SCENE)['items'], 'the fixture\'s items') as Record<string, JsonObject>;
  const doc = writeFile(dir, 'crease-edges.json', sessionDoc('Crease edges', items));
  const [reply] = runGpu(bin, dir, [view3d({ doc, look: look(), size: SIZE, frames: 1, counts: true })], { backend: 'noop', ...startup });
  return view3Reply(reply!, `the fixture on ${startName({ backend: 'noop', ...startup })}`, 1)[0]!;
}

const rel = (p: V3, at: V3): V3 => sub(p, at);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
/** The count every case is held to, and segments drawn twice on welded positions. */
function counted(c: Case, segs: [V3, V3][]): string[] {
  const out: string[] = [];
  if (segs.length !== c.segments) out.push(`crease edges of ${c.of} draw ${segs.length} segments, not ${c.segments}`);
  const keys = new Set(segs.map(([a, b]) => segKey(a, b)));
  if (keys.size !== segs.length) out.push(`crease edges of ${c.of} draw ${segs.length - keys.size} segments twice on welded positions`);
  return out;
}

/** AC1's cube: exactly its 12 edges, each 1 m long between its 8 corners, each once. */
export function cubeProblems(c: Case, segs: [V3, V3][]): string[] {
  const out = counted(c, segs);
  const corners = new Map<string, V3>();
  for (const [a, b] of segs) { corners.set(weldKey(a), a); corners.set(weldKey(b), b); }
  const long = segs.filter(([a, b]) => Math.abs(length(sub(a, b)) - 1) > 1e-6);
  if (long.length) out.push(`crease edges of ${c.of} draw ${long.length} segments that aren't 1 m box edges (e.g. ${JSON.stringify(long[0])})`);
  if (segs.length && corners.size !== 8) out.push(`crease edges of ${c.of} meet at ${corners.size} points, not the box's 8 corners`);
  return out;
}

/** AC1's cylinder: 64 segments, 32 on each rim (y = 0 and 1 m, radius 0.5 m about its axis), none on its side or caps. */
export function cylinderProblems(c: Case, segs: [V3, V3][]): string[] {
  const out = counted(c, segs);
  const rims = arr(c.raw['rims'], 'cylinder rims').map((y, k) => num(y, `cylinder rims[${k}]`));
  const radius = num(c.raw['radius'], 'cylinder radius');
  const perRim = num(c.raw['per_rim'], 'cylinder per_rim');
  const onRim = rims.map(() => 0);
  let side = 0; let inside = 0;
  for (const [a0, b0] of segs) {
    const [a, b] = [rel(a0, c.at), rel(b0, c.at)];
    if (!near(a[1], b[1])) { side++; continue; }
    const r = (p: V3): number => Math.hypot(p[0], p[2]);
    const rim = rims.findIndex((y) => near(a[1], y));
    if (rim < 0 || !near(r(a), radius) || !near(r(b), radius)) { inside++; continue; }
    onRim[rim]!++;
  }
  if (side) out.push(`crease edges of ${c.of} draw ${side} segments on its side`);
  if (inside) out.push(`crease edges of ${c.of} draw ${inside} segments off its two rims (inside a cap)`);
  rims.forEach((y, k) => { if (onRim[k] !== perRim) out.push(`crease edges of ${c.of} draw ${onRim[k]} segments on its rim at y = ${y} m, not ${perRim}`); });
  return out;
}

/** AC1's ball and AC2's plane without border: nothing. */
export const emptyProblems = (c: Case, segs: [V3, V3][]): string[] => counted(c, segs);

/** AC2's plane with border: its 4 border edges (both ends on one side of the 1 × 1 m square in y = 0), never its diagonal. */
export function borderProblems(c: Case, segs: [V3, V3][]): string[] {
  const out = counted(c, segs);
  const half = 0.5;
  let diagonal = 0; let off = 0;
  const sides = new Set<string>();
  for (const [a0, b0] of segs) {
    const [a, b] = [rel(a0, c.at), rel(b0, c.at)];
    if (!near(a[1], 0) || !near(b[1], 0)) { off++; continue; }
    const corner = (p: V3): boolean => near(Math.abs(p[0]), half) && near(Math.abs(p[2]), half);
    if (corner(a) && corner(b) && !near(a[0], b[0]) && !near(a[2], b[2])) { diagonal++; continue; }
    if (near(a[0], b[0]) && near(Math.abs(a[0]), half)) sides.add(`x=${Math.sign(a[0])}`);
    else if (near(a[2], b[2]) && near(Math.abs(a[2]), half)) sides.add(`z=${Math.sign(a[2])}`);
    else off++;
  }
  if (diagonal) out.push(`crease edges of ${c.of} draw its diagonal (${diagonal} segment${diagonal > 1 ? 's' : ''} between opposite corners)`);
  if (off) out.push(`crease edges of ${c.of} draw ${off} segments off its border`);
  if (segs.length && sides.size !== 4 && c.segments === 4) out.push(`crease edges of ${c.of} draw ${sides.size} of its 4 sides`);
  return out;
}

/** A fixture guard from #420's `all`: the line draws exactly `segments`. */
export function guardProblems(c: Case, f: Frame3, what: string): string[] {
  if (!c.guard) return [];
  const n = segmentsOf(f, c.guard.line, what).length;
  return n === c.guard.segments ? [] : [`fixture guard: ${c.guard.line} (all edges of ${c.of}) draws ${n} segments, not ${c.guard.segments}`];
}
