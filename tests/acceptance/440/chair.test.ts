// AC1: "A chair built with a bevel (shape 0.5, limited by a 30° angle, hardened) and weighted normals shows flat
// large faces and rounded edges, and its vertex count equals the bound computed from its params before the
// build"
//
// The chair is six slab@1 boxes (a seat, a back, four legs), each with `mod.bevel@1 {width: 0.005, segments: 3,
// shape: 0.5, limit: angle, angle: 30, clamp: true, harden: true}` then `mod.normals@1 {mode: weighted, weight:
// area}`. Every box edge is 90°, sharper than 30°, so every edge bevels. Before the build, `geometry` with
// `estimate_only` builds nothing and declares each part's vertex count from its params; the build then makes
// exactly that many. Flat large faces: on each of a box's six planes, the triangles lying in it cover the face
// inset by the width on every side, (a − 2w)(b − 2w), and every corner normal there is the face's own within
// 1e-3 rad. Rounded edges: shape 0.5 is a circular profile tangent to both faces, so every vertex along an edge
// (outside the inset face, not in a corner patch) is at exactly the width from the box shrunk by the width, at
// least segments − 1 such vertices sit off both planes at each end of each edge, and their normals turn with the
// arc: within half a segment's turn (90° ÷ 2 × 3 = 15°) of the arc's own outward direction.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, buildsOf, declaredRow, geometryCall, meshRow, none, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type MeshRow } from './helpers.ts';
import { angle, fmt, fmtV, sub, triAt, triArea, unit, weldKey, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const WIDTH = 0.005;
const SEGMENTS = 3;
const FLAT_RAD = 1e-3;
const ON = 1e-9;
const BEVEL: JsonObject = { kind: 'mod.bevel@1', params: { width: WIDTH, segments: SEGMENTS, shape: 0.5, limit: 'angle', angle: 30, clamp: true, harden: true } };
const NORMALS: JsonObject = { kind: 'mod.normals@1', params: { mode: 'weighted', weight: 'area' } };

const PARTS: Record<string, { size: V3; pos: V3 }> = {
  seat: { size: [0.45, 0.04, 0.45], pos: [0, 0.45, 0] },
  back: { size: [0.45, 0.42, 0.04], pos: [0, 0.49, -0.205] },
  leg_fl: { size: [0.04, 0.45, 0.04], pos: [-0.205, 0, 0.205] },
  leg_fr: { size: [0.04, 0.45, 0.04], pos: [0.205, 0, 0.205] },
  leg_bl: { size: [0.04, 0.45, 0.04], pos: [-0.205, 0, -0.205] },
  leg_br: { size: [0.04, 0.45, 0.04], pos: [0.205, 0, -0.205] },
};
const IDS = Object.keys(PARTS);
const chair = (): JsonObject => sceneDoc('A bevelled chair', Object.fromEntries(IDS.map((id) => [id, {
  kind: 'slab@1', params: { size: PARTS[id]!.size }, at: { pos: PARTS[id]!.pos }, modifiers: [BEVEL, NORMALS],
}])));

/** Every check AC1 names on one bevelled box (slab@1 places a box centred on x and z, from y = 0 up). */
function boxProblems(id: string, g: MeshRow): string[] {
  const out: string[] = [];
  const s = PARTS[id]!.size;
  const lo: V3 = [-s[0] / 2, 0, -s[2] / 2];
  const hi: V3 = [s[0] / 2, s[1], s[2] / 2];
  const inLo = lo.map((x) => x + WIDTH) as V3;
  const inHi = hi.map((x) => x - WIDTH) as V3;
  const onPlane = (p: V3, axis: number, side: 0 | 1): boolean => Math.abs(p[axis]! - (side ? hi : lo)[axis]!) <= ON;
  // Flat large faces.
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1] as const) {
      const n: V3 = [0, 0, 0]; n[axis] = side ? 1 : -1;
      const [a, b] = [0, 1, 2].filter((k) => k !== axis).map((k) => s[k]! - 2 * WIDTH) as [number, number];
      let area = 0;
      let tilted = 0; let worst = 0;
      for (let t = 0; 3 * t < g.indices.length; t++) {
        const tri = triAt(g.indices, t);
        if (!tri.every((i) => onPlane(g.positions[i]!, axis, side))) continue;
        area += triArea(g.positions[tri[0]]!, g.positions[tri[1]]!, g.positions[tri[2]]!);
        for (const i of tri) {
          const off = angle(g.normals[i]!, n);
          if (off > FLAT_RAD) { tilted++; worst = Math.max(worst, off); }
        }
      }
      const plane = `${id}: the large face ${side ? '+' : '−'}${'xyz'[axis]}`;
      if (Math.abs(area - a * b) > 1e-9 * a * b) out.push(`${plane} covers ${fmt(area)} m² in its plane, not the inset face's ${fmt(a)} × ${fmt(b)} = ${fmt(a * b)} m²`);
      if (tilted) out.push(`${plane} isn't flat: ${tilted} corner normals are off its normal by up to ${fmt(worst)} rad (> ${FLAT_RAD})`);
    }
  }
  // Rounded edges.
  const arcPoints = new Map<string, Set<string>>();
  const maxTurn = Math.PI / 2 / (2 * SEGMENTS);
  g.positions.forEach((p, i) => {
    if (p.some((x, k) => x < lo[k]! - ON || x > hi[k]! + ON)) { out.push(`${id}: vertex ${i} ${fmtV(p)} lies outside the box`); return; }
    const outside = [0, 1, 2].filter((k) => p[k]! < inLo[k]! - ON || p[k]! > inHi[k]! + ON);
    const nearest = p.map((x, k) => Math.min(Math.max(x, inLo[k]!), inHi[k]!)) as V3;
    const d = Math.hypot(...sub(p, nearest));
    if (outside.length === 0) { out.push(`${id}: vertex ${i} ${fmtV(p)} lies inside the box shrunk by the width`); return; }
    if (outside.length === 3) {
      if (d > WIDTH + ON || d < 0.5 * WIDTH) out.push(`${id}: corner vertex ${i} ${fmtV(p)} is ${fmt(d)} m from the shrunk box, not within a corner's rounding of ${WIDTH} m`);
      return;
    }
    if (Math.abs(d - WIDTH) > ON) { out.push(`${id}: vertex ${i} ${fmtV(p)} is ${fmt(d)} m from the shrunk box, not on the rounded profile at ${WIDTH} m`); return; }
    if (outside.length !== 2) return;
    const onAny = [0, 1, 2].some((k) => onPlane(p, k, 0) || onPlane(p, k, 1));
    if (onAny) return;
    // Strictly inside the arc: its normal turns with it.
    const radial = unit(sub(p, nearest));
    const turn = angle(g.normals[i]!, radial);
    if (turn > maxTurn) out.push(`${id}: arc vertex ${i} ${fmtV(p)} has normal ${fmtV(g.normals[i]!)}, ${fmt(turn)} rad from the arc's outward ${fmtV(radial)} (> ${fmt(maxTurn)}): the edge isn't shaded round`);
    // Which edge (its two outside axes and sides) and which end of it (the third axis's side).
    const along = [0, 1, 2].find((k) => !outside.includes(k))!;
    const name = `${outside.map((k) => `${'xyz'[k]}${p[k]! > inHi[k]! ? '+' : '−'}`).join('')}@${p[along]! > (lo[along]! + hi[along]!) / 2 ? '+' : '−'}`;
    const seen = arcPoints.get(name) ?? new Set<string>();
    seen.add(weldKey(p));
    arcPoints.set(name, seen);
  });
  // Each of the 12 edges, at each of its two ends, has at least segments − 1 welded points strictly on its arc.
  for (const [ka, kb] of [[0, 1], [0, 2], [1, 2]] as [number, number][]) {
    const along = 3 - ka - kb;
    for (const sa of ['−', '+']) for (const sb of ['−', '+']) for (const end of ['−', '+']) {
      const name = `${'xyz'[ka]}${sa}${'xyz'[kb]}${sb}@${end}`;
      const n = arcPoints.get(name)?.size ?? 0;
      if (n < SEGMENTS - 1) out.push(`${id}: the edge along ${'xyz'[along]} at ${'xyz'[ka]}${sa} ${'xyz'[kb]}${sb} has ${n} points on its arc at its ${end} end, fewer than segments − 1 = ${SEGMENTS - 1}: it isn't rounded`);
    }
  }
  return out;
}

describe(`${AC[1]} a bevelled, weighted-normal chair`, () => {
  it(`${AC[1]} counts each part's vertices before the build, builds exactly that many, with flat large faces and rounded edges`, () => {
    const [shown, estimate, built] = runShow(bin(), scenario(dir(), [DOC.a], [
      show(DOC.a, chair()), geometryCall(DOC.a, IDS, { estimate_only: true }), geometryCall(DOC.a, IDS),
    ]));
    admitted(shown!, 'the chair');
    expect(buildsOf(estimate!, 'the estimate'), 'estimate_only builds nothing: the counts come from the params').toBe(0);
    const problems: string[] = [];
    for (const id of IDS) {
      const declared = declaredRow(estimate!, id, 'the estimate').vertices;
      const g = meshRow(built!, id, 'the chair\'s geometry');
      if (g.positions.length !== declared) problems.push(`${id}: builds ${g.positions.length} vertices, but its params declared ${declared} before the build`);
      if (g.declared.vertices !== declared) problems.push(`${id}: the build declares ${g.declared.vertices} vertices, the estimate ${declared}`);
      problems.push(...boxProblems(id, g));
    }
    none(problems, 'the chair');
  }, SLOW);
});
