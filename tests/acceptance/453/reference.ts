// A reviewed CPU reference over this suite's own fixtures (fixtures.test.ts), so a fixture is known to hold
// exactly the defect it is named for, read straight from the design's definitions (Check input: loop kinds:
// shading defects, quad ratio). It reads the meshes gltf.ts builds, never the product's output, and no test
// compares the product to it: the product is held to the numbers each criterion and fixture state.

import { cross, dot, edgeId, faceId, len, sub, unit, vertexId, type Prim, type V3 } from './gltf.ts';

export interface Report {
  welded: number; triangles: number; signedVolume: number | null;
  ids: { non_manifold_edges: string[]; non_manifold_vertices: string[]; inconsistent_edges: string[]; flipped_faces: string[]; degenerate_faces: string[]; boundary_edges: string[] };
  quadRatio: number; unpaired: number;
}

interface Tri { id: string; v: [number, number, number]; corners: [V3, V3, V3]; normals: [V3, V3, V3] | null; order: number }

/** Every primitive of `prims` in triangle mode, welded within `weld` m (a vertex joins the first earlier vertex that close). */
export function analyse(prims: Prim[], weld = 0.00001, degenerateArea = 1e-12, pair = { normal: 30, corner: 30 }): Report {
  const pos: V3[] = []; const names: [number, number][] = []; const rep: number[] = [];
  const tris: Tri[] = [];
  prims.forEach((p, pi) => {
    const base = pos.length;
    p.positions.forEach((q, vi) => {
      let r = pos.length;
      for (let k = 0; k < pos.length; k++) if (rep[k] === k && len(sub(pos[k]!, q)) <= weld) { r = k; break; }
      pos.push(q); names.push([pi, vi]); rep.push(r);
    });
    const ind = p.indices ?? p.positions.map((_, i) => i);
    for (let t = 0; 3 * t + 2 < ind.length; t++) {
      const local = [ind[3 * t]!, ind[3 * t + 1]!, ind[3 * t + 2]!];
      tris.push({
        id: faceId(pi, t), order: tris.length, v: local.map((i) => rep[base + i]!) as [number, number, number],
        corners: local.map((i) => p.positions[i]!) as [V3, V3, V3], normals: p.normals ? local.map((i) => p.normals![i]!) as [V3, V3, V3] : null,
      });
    }
  });
  const vname = (k: number) => names[k]!;
  const areaVec = (t: Tri): V3 => { const [a, b, c] = t.v.map((k) => pos[k]!) as [V3, V3, V3]; return cross(sub(b, a), sub(c, a)); };

  // Edges on welded vertices, with the faces using each and the direction each walks it.
  const edges = new Map<string, { a: number; b: number; uses: { t: number; forward: boolean }[] }>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = t.v[k]!, b = t.v[(k + 1) % 3]!;
      if (a === b) continue;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = `${lo}-${hi}`;
      const e = edges.get(key) ?? { a: lo, b: hi, uses: [] };
      e.uses.push({ t: ti, forward: a === lo }); edges.set(key, e);
    }
  });
  const ids: Report['ids'] = { non_manifold_edges: [], non_manifold_vertices: [], inconsistent_edges: [], flipped_faces: [], degenerate_faces: [], boundary_edges: [] };
  for (const e of edges.values()) {
    const id = edgeId(vname(e.a), vname(e.b));
    if (e.uses.length === 1) ids.boundary_edges.push(id);
    if (e.uses.length > 2) ids.non_manifold_edges.push(id);
    if (e.uses.length === 2 && e.uses[0]!.forward === e.uses[1]!.forward) ids.inconsistent_edges.push(id);
  }
  // A vertex whose faces don't form one fan: its faces split into more than one set joined across its edges.
  const around = new Map<number, number[]>();
  tris.forEach((t, ti) => new Set(t.v).forEach((k) => around.set(k, [...(around.get(k) ?? []), ti])));
  for (const [k, faces] of around) {
    const group = new Map(faces.map((f) => [f, f]));
    const find = (f: number): number => { while (group.get(f) !== f) f = group.get(f)!; return f; };
    for (const e of edges.values()) {
      if (e.a !== k && e.b !== k) continue;
      const fs = e.uses.map((u) => u.t);
      for (const f of fs.slice(1)) group.set(find(f), find(fs[0]!));
    }
    if (new Set(faces.map(find)).size > 1) ids.non_manifold_vertices.push(vertexId(...vname(k)));
  }
  // Flipped: the face's corner normals against its own vector area; degenerate: area under the ratio of its bounds diagonal squared.
  const all = pos.filter((_, k) => rep[k] === k);
  const lo: V3 = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i]!))) as V3;
  const hi: V3 = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i]!))) as V3;
  const diag2 = dot(sub(hi, lo), sub(hi, lo));
  for (const t of tris) {
    const av = areaVec(t);
    if (t.normals && t.normals.some((n) => dot(n, av) < 0)) ids.flipped_faces.push(t.id);
    if (len(av) / 2 < degenerateArea * diag2) ids.degenerate_faces.push(t.id);
  }
  const closed = [...edges.values()].every((e) => e.uses.length === 2);
  const signedVolume = closed ? tris.reduce((s, t) => { const [a, b, c] = t.v.map((k) => pos[k]!) as [V3, V3, V3]; return s + dot(a, cross(b, c)) / 6; }, 0) : null;

  // Quad pairing: across each edge two faces share, normals within pair.normal and a convex quad with every
  // corner within pair.corner of a right angle; best first by the worst corner, ties to the lower triangles.
  const deg = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
  const candidates: { t1: number; t2: number; worst: number }[] = [];
  for (const e of edges.values()) {
    if (e.uses.length !== 2) continue;
    const [t1, t2] = [e.uses[0]!.t, e.uses[1]!.t].sort((x, y) => x - y) as [number, number];
    const n1 = areaVec(tris[t1]!), n2 = areaVec(tris[t2]!);
    if (deg(n1, n2) > pair.normal) continue;
    const opp = (t: Tri) => t.v.find((k) => k !== e.a && k !== e.b)!;
    const quad = [opp(tris[t1]!), e.a, opp(tris[t2]!), e.b].map((k) => pos[k]!);
    const nq = unit([n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]]);
    let worst = 0; let convex = true; const signs: number[] = [];
    for (let k = 0; k < 4; k++) {
      const p = quad[k]!, prev = quad[(k + 3) % 4]!, next = quad[(k + 1) % 4]!;
      worst = Math.max(worst, Math.abs(deg(sub(prev, p), sub(next, p)) - 90));
      signs.push(Math.sign(dot(cross(sub(next, p), sub(prev, p)), nq)));
    }
    if (!(signs.every((s) => s > 0) || signs.every((s) => s < 0))) convex = false;
    if (convex && worst <= pair.corner) candidates.push({ t1, t2, worst });
  }
  candidates.sort((x, y) => x.worst - y.worst || x.t1 - y.t1 || x.t2 - y.t2);
  const used = new Set<number>(); let pairs = 0;
  for (const c of candidates) if (!used.has(c.t1) && !used.has(c.t2)) { used.add(c.t1); used.add(c.t2); pairs++; }
  return { welded: all.length, triangles: tris.length, signedVolume, ids, quadRatio: (2 * pairs) / tris.length, unpaired: tris.length - 2 * pairs };
}
