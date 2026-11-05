// AC4 #421.dc19b4bc: Spatial-index and culling queries return exactly what a brute-force scan returns, and a
// hierarchy's bounds are the union of its children's.
//
// A seeded scene of 240 boxes (120 roots, 120 children up to three levels deep; random sizes, positions, turns about
// all three axes and scales, a tenth of them mirrored) with three cameras is shown through `deep-show run` and asked
// this suite's `spatial` call: every item's world bounds, its hierarchy bounds (`subtree`) and children, and the answers
// to 3 view (culling) queries, 15 box queries, 10 nearest-n queries (n = 1, 5, 17) and 10 radius queries. The test
// checks each item's bounds against its own composition of the transform order (Units and axes: scale, R = Rz·Ry·Rx,
// position, then the parent) over the box's eight corners, to 1e-6 m; every `subtree` equals the union of the item's
// own bounds and its children's subtrees; and every answer equals the brute-force scan over every item's bounds, in
// the order the call names. Ported from Blender's BLI_kdtree_test.cc (oracle): nearest, nearest-n and radius queries
// on a random set against a brute-force sorted scan, here over boxes, by distance to a box (0 inside).
// `planted: cull_by_center` (a view keeps an item only when its bounds' centre is inside) fails, naming the view and
// an item the scan keeps; `planted: bounds_children_only` (a node's subtree unions only its direct children's own
// bounds) fails, naming a subtree.
// Wrong programs: the base (no `spatial` call: `bad_input`); a cull that drops an object a brute scan keeps or keeps
// one it drops; stale or local-space bounds; a mirrored box's bounds taken from a wrong corner; a hierarchy whose
// bounds miss a grandchild.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, admitted, boxBounds, distanceTo, failsNaming, frustum, localOf, mul, none, passesCull, payload, runShow, scenario, seeded, sessionDoc,
  show, spatialCall, spatialOf, union, useBins, useDir,
  type Aabb, type JsonObject, type M34, type Pinhole, type Query, type ShowPlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();
const SIZE: [number, number] = [640, 400];
const EPS = 1e-6;

interface Box { id: string; size: V3; pos: V3; rot: V3; scale: V3; parent: string | null }
interface Cam { id: string; pin: Pinhole; near: number; far: number }
function build(): { boxes: Box[]; cams: Cam[]; queries: Query[] } {
  const rnd = seeded(421);
  const between = (a: number, b: number): number => a + (b - a) * rnd();
  const boxes: Box[] = [];
  for (let i = 0; i < 240; i++) {
    const root = i < 120;
    const mirror = rnd() < 0.1 ? -1 : 1;
    boxes.push({
      id: `b-${String(i).padStart(3, '0')}`,
      size: [between(0.2, 3), between(0.2, 3), between(0.2, 3)],
      pos: root ? [between(-20, 20), between(0, 5), between(-20, 20)] : [between(-3, 3), between(-1, 3), between(-3, 3)],
      rot: [between(0, 360), between(0, 360), between(0, 360)],
      scale: [mirror * between(0.5, 1.5), between(0.5, 1.5), between(0.5, 1.5)],
      parent: root ? null : boxes[Math.floor(between(Math.max(0, i - 80), i))]!.id,
    });
  }
  const cams: Cam[] = [
    { id: 'cam0', pin: { position: [0, 12, 30], target: [0, 0, 0], fov: 40, size: SIZE }, near: 0.5, far: 60 },
    { id: 'cam1', pin: { position: [25, 6, 5], target: [-5, 1, -3], fov: 30, size: SIZE }, near: 1, far: 35 },
    { id: 'cam2', pin: { position: [-4, 2, -4], target: [10, 0, 12], fov: 70, size: SIZE }, near: 0.2, far: 25 },
  ];
  const point = (): V3 => [between(-22, 22), between(-1, 6), between(-22, 22)];
  const queries: Query[] = cams.map((c) => ({ view: c.id }));
  for (let k = 0; k < 15; k++) {
    const a = point(); const s: V3 = [between(1, 12), between(1, 6), between(1, 12)];
    queries.push({ box: { min: a, max: [a[0] + s[0], a[1] + s[1], a[2] + s[2]] } });
  }
  for (let k = 0; k < 10; k++) queries.push({ nearest: { point: point(), n: [1, 5, 17][k % 3]! } });
  for (let k = 0; k < 10; k++) queries.push({ radius: { point: point(), r: [2, 5, 9][k % 3]! } });
  return { boxes, cams, queries };
}

function document(boxes: Box[], cams: Cam[]): JsonObject {
  const items: Record<string, JsonObject> = {};
  for (const c of cams) items[c.id] = { kind: 'camera@1', params: { projection: 'perspective', position: c.pin.position, target: c.pin.target, fov: c.pin.fov, near: c.near, far: c.far } };
  for (const b of boxes) items[b.id] = { kind: 'mark.box@1', params: { size: b.size }, at: { pos: b.pos, rot: b.rot, scale: b.scale }, ...(b.parent ? { parent: b.parent } : {}) };
  const doc = payload(sessionDoc('spatial-421', SIZE, items));
  doc['camera'] = 'cam0';
  return doc;
}

const close = (a: Aabb, b: Aabb, eps: number): boolean =>
  [0, 1, 2].every((k) => Math.abs(a.min[k]! - b.min[k]!) <= eps * Math.max(1, Math.abs(b.min[k]!)) && Math.abs(a.max[k]! - b.max[k]!) <= eps * Math.max(1, Math.abs(b.max[k]!)));
const showBox = (b: Aabb | null): string => (b ? `[${b.min.map((x) => x.toFixed(4)).join(', ')}]–[${b.max.map((x) => x.toFixed(4)).join(', ')}]` : 'none');
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The criterion's check: failures as sentences naming the query or item. */
function spatialProblems(bin: string, evidence: string, planted?: ShowPlanted): string[] {
  const { boxes, cams, queries } = build();
  const store = join(evidence, planted ?? 'shipped');
  mkdirSync(store, { recursive: true });
  const [shown, reply] = runShow(bin, scenario(store, [show(document(boxes, cams)), spatialCall(queries)], planted));
  admitted(shown!, 'the seeded scene');
  const s = spatialOf(reply!);
  const problems: string[] = [];

  // Bounds against this suite's own composition of the transforms.
  const world = new Map<string, M34>();
  const mine = new Map<string, Aabb>();
  for (const b of boxes) {
    const local = localOf(b.pos, b.rot, b.scale);
    const m = b.parent ? mul(world.get(b.parent)!, local) : local;
    world.set(b.id, m);
    mine.set(b.id, boxBounds(m, b.size));
  }
  const bounds = new Map<string, Aabb>();
  for (const b of boxes) {
    const got = s.items.get(b.id)?.bounds ?? null;
    if (!got) { problems.push(`${b.id}: no bounds in the reply`); continue; }
    if (!close(got, mine.get(b.id)!, EPS)) problems.push(`${b.id}: bounds ${showBox(got)}, not the box's world bounds ${showBox(mine.get(b.id)!)}`);
    bounds.set(b.id, got);
  }
  if (problems.length) return problems;

  // A hierarchy's bounds: the union of its own and its children's, on the reply's own numbers.
  const children = new Map<string, string[]>(boxes.map((b) => [b.id, []]));
  for (const b of boxes) if (b.parent) children.get(b.parent)!.push(b.id);
  for (const b of [...boxes].reverse()) {
    const item = s.items.get(b.id)!;
    const kids = children.get(b.id)!.sort(byId);
    if ([...item.children].sort(byId).join(',') !== kids.join(',')) problems.push(`${b.id}: children ${item.children.join(', ') || 'none'}, not ${kids.join(', ') || 'none'}`);
    let want: Aabb | null = item.bounds;
    for (const k of kids) want = union(want, s.items.get(k)?.subtree ?? null);
    if (!item.subtree || !want || !close(item.subtree, want, 1e-12)) problems.push(`${b.id}: subtree ${showBox(item.subtree)} is not the union of its own bounds and its children's subtrees, ${showBox(want)}`);
  }

  // Every query against the brute-force scan over every item's bounds.
  const ids = boxes.map((b) => b.id);
  for (const [i, q] of queries.entries()) {
    const got = s.results[i] ?? [];
    let want: string[]; let what: string; let ordered = false;
    if ('view' in q) {
      const c = cams.find((x) => x.id === q.view)!;
      const planes = frustum(c.pin, c.near, c.far);
      want = ids.filter((id) => passesCull(planes, bounds.get(id)!));
      what = `view ${q.view}`;
    } else if ('box' in q) {
      want = ids.filter((id) => { const b = bounds.get(id)!; return [0, 1, 2].every((k) => b.min[k]! <= q.box.max[k]! && q.box.min[k]! <= b.max[k]!); });
      what = `box query ${i}`;
    } else {
      const p = 'nearest' in q ? q.nearest.point : q.radius.point;
      const scan = ids.map((id) => ({ id, d: distanceTo(bounds.get(id)!, p) })).sort((a, b) => a.d - b.d || byId(a.id, b.id));
      want = ('nearest' in q ? scan.slice(0, q.nearest.n) : scan.filter((x) => x.d <= q.radius.r)).map((x) => x.id);
      what = 'nearest' in q ? `nearest-${q.nearest.n} query ${i}` : `radius ${q.radius.r} query ${i}`;
      ordered = true;
    }
    const [g, w] = ordered ? [got, want] : [[...got].sort(byId), [...want].sort(byId)];
    if (g.join(',') === w.join(',')) continue;
    const missing = w.filter((id) => !g.includes(id)); const extra = g.filter((id) => !w.includes(id));
    if (missing.length) problems.push(`${what}: drops ${missing.slice(0, 5).join(', ')} that the brute-force scan keeps (${missing.length} in all)`);
    if (extra.length) problems.push(`${what}: keeps ${extra.slice(0, 5).join(', ')} that the brute-force scan drops (${extra.length} in all)`);
    if (!missing.length && !extra.length) problems.push(`${what}: answers ${g.slice(0, 8).join(', ')} in another order than the scan's ${w.slice(0, 8).join(', ')}`);
  }
  const sizes = queries.map((q, i) => ('view' in q ? `${q.view} ${s.results[i]?.length ?? 0}` : '')).filter(Boolean);
  console.log(`${AC[4]}: views keep ${sizes.join(', ')} of ${ids.length}`);
  return problems;
}

describe(`${AC[4]} spatial-index and culling queries against a brute-force scan; hierarchy bounds`, () => {
  it(`${AC[4]} 240 seeded boxes: bounds by the transform order, subtrees the union of their children's, and view, box, nearest-n and radius answers equal to the brute-force scan`, () => {
    none(spatialProblems(bins.bin('deep-show'), dir()), 'the spatial index');
  }, 1_800_000);

  it(`${AC[4]} the planted cull_by_center fails, naming a view; the planted bounds_children_only fails, naming a subtree`, () => {
    const bin = bins.bin('deep-show');
    failsNaming(spatialProblems(bin, dir(), 'cull_by_center'), ['view', 'drops'], 'the planted cull_by_center');
    failsNaming(spatialProblems(bin, dir(), 'bounds_children_only'), ['subtree'], 'the planted bounds_children_only');
  }, 1_800_000);
});
