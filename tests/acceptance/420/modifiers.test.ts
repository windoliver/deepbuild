// AC2: "Modifiers apply in their declared order, each pure in its params and time; one that doesn't read time
// never rebuilds while playing, and a reorder is a recorded change"
//
// A 1 m slab box under two generate modifiers, `mod.array@1 {count: 2, offset: [3, 0, 0]}` and
// `mod.mirror@1 {axes: ["x"]}`, in both orders. The test reads the built box (stage `built`) and computes each
// order's result itself: array makes copies k = 0 … count − 1 moved by k × offset, mirror keeps the mesh and adds
// its reflection across the item's plane x = 0; the two orders give different point sets, and each item's final
// geometry must be its own order's (so no stack is sorted or reordered behind the document's back). Purity: the
// same document in two processes gives the same geometry and key, and an array whose offset a channel moves
// (it reads time, computed from its bound params) gives at t = 1 s, sought in a fresh session, what it gives after
// playing frames to 1 s, and equals the closed result for its offset at that time. While playing 1 s (26 frames
// 0.04 s apart), no node of the item whose modifiers read nothing of time runs after the first frame, while the
// time-reading item's nodes run every frame (the counter can see a rebuild). A revision that changes only the
// order is recorded: the deep_show reply lists the item as changed, a new revision becomes current with another
// hash, and the item's geometry follows. The stack rows say each modifier's class and whether it reads time.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, add, admitted, arr, canon, clone, evalCall, geometryCall, geometryOf, itemOf, nodeName, nodesOf, none, obj, ofItem, revisionsOf,
  runShow, scenario, sceneDoc, show, str, useBins, useDir, weldKey, type Geometry, type JsonObject, type JsonValue, type V3,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();

const ARRAY: JsonObject = { kind: 'mod.array@1', params: { count: 2, offset: [3, 0, 0] } };
const MIRROR: JsonObject = { kind: 'mod.mirror@1', params: { axes: ['x'] } };
/** 26 frames over 1 s, 0.04 s apart, as time literals (decimal seconds, each a whole number of flicks). */
const PLAY = Array.from({ length: 26 }, (_, k) => `${Math.floor((4 * k) / 100)}.${String((4 * k) % 100).padStart(2, '0')}s`);
const slab = (modifiers: JsonObject[], x: number): JsonObject => ({ kind: 'slab@1', params: { size: [1, 1, 1] }, modifiers, at: { pos: [x, 0, 0] } });

/** `plain` (no stack), `am` (array then mirror), `ma` (mirror then array), and `moving` (an array whose offset x a channel takes from 0 to 2 over 2 s). */
function orderDoc(amOrder: JsonObject[] = [clone(ARRAY), clone(MIRROR)]): JsonObject {
  return sceneDoc('Two orders of one stack', {
    cam: CAMERA,
    plain: slab([], -10),
    am: slab(amOrder, 0),
    ma: slab([clone(MIRROR), clone(ARRAY)], 10),
    moving: slab([{ kind: 'mod.array@1', params: { count: 2, offset: [0, 0, 0] } }], 20),
  }, {
    transport: { span: '2s' },
    channels: { slide: { target: 'items/moving/modifiers/0/params/offset/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 2 } } } },
  });
}

/** The set of welded points, as sorted keys. */
const pointSet = (points: V3[]): string[] => [...new Set(points.map(weldKey))].sort();
const reflectX = (p: V3): V3 => [-p[0], p[1], p[2]];
const arrayOf = (points: V3[], count: number, offset: V3): V3[] => Array.from({ length: count }, (_, k) => points.map((p) => add(p, [offset[0] * k, offset[1] * k, offset[2] * k]))).flat();
const mirrorOf = (points: V3[]): V3[] => [...points, ...points.map(reflectX)];

/** Each order's geometry against the order the document declares, computed here from the built box. */
function orderProblems(box: V3[], am: Geometry, ma: Geometry): string[] {
  const out: string[] = [];
  const wantAm = pointSet(mirrorOf(arrayOf(box, 2, [3, 0, 0])));
  const wantMa = pointSet(arrayOf(mirrorOf(box), 2, [3, 0, 0]));
  if (canon(wantAm) === canon(wantMa)) out.push('the two orders give one point set for this box, so the fixture can\'t tell them apart');
  if (canon(pointSet(am.positions)) !== canon(wantAm)) out.push(`am (array, then mirror): its points are not the array's copies mirrored (${pointSet(am.positions).length} points, want ${wantAm.length})`);
  if (canon(pointSet(ma.positions)) !== canon(wantMa)) out.push(`ma (mirror, then array): its points are not the mirrored box arrayed (${pointSet(ma.positions).length} points, want ${wantMa.length})`);
  if (am.declared !== am.positions.length) out.push(`am: declares ${am.declared} vertices and builds ${am.positions.length}`);
  if (ma.declared !== ma.positions.length) out.push(`ma: declares ${ma.declared} vertices and builds ${ma.positions.length}`);
  return out;
}

describe(`${AC[2]} modifiers in their declared order, pure in params and time`, () => {
  it(`${AC[2]} array-then-mirror and mirror-then-array each build their own order's result, and the stack rows name each modifier's class (generate) and that neither reads time`, () => {
    const [shown, built, final] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
      show(DOC.a, orderDoc()),
      geometryCall(DOC.a, { items: ['plain'], stage: 'built' }),
      geometryCall(DOC.a, { items: ['am', 'ma'], stage: 'final' }),
    ]));
    admitted(shown!, 'the two orders');
    const box = itemOf(geometryOf(built!, 'the built box'), 'plain', 'the built box').positions;
    expect(box.length, 'the slab box builds vertices').toBeGreaterThan(0);
    const g = geometryOf(final!, 'the two orders');
    const am = itemOf(g, 'am', 'the two orders');
    const ma = itemOf(g, 'ma', 'the two orders');
    none(orderProblems(box, am, ma), 'each stack in its declared order');
    expect(am.stack.map((s) => [s.kind, s.class, s.reads_time]), 'am\'s stack, top to bottom').toEqual([['mod.array@1', 'generate', false], ['mod.mirror@1', 'generate', false]]);
    expect(ma.stack.map((s) => [s.kind, s.class, s.reads_time]), 'ma\'s stack, top to bottom').toEqual([['mod.mirror@1', 'generate', false], ['mod.array@1', 'generate', false]]);
  }, 900_000);

  it(`${AC[2]} each modifier is pure in its params and time: two processes build the same; an array whose offset a channel moves reads time, and at 1 s sought equals played and equals its offset's closed result`, () => {
    const run = (times: string[]): { moving: Geometry; am: Geometry; box: V3[] } => {
      const calls: JsonObject[] = [show(DOC.a, orderDoc())];
      for (const t of times) calls.push(evalCall(DOC.a, t));
      calls.push(geometryCall(DOC.a, { items: ['plain'], stage: 'built' }), geometryCall(DOC.a, { items: ['moving', 'am'], t: '1s', stage: 'final' }));
      const replies = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], calls));
      admitted(replies[0]!, 'the document');
      const g = geometryOf(replies[replies.length - 1]!, 'at 1 s');
      return { moving: itemOf(g, 'moving', 'at 1 s'), am: itemOf(g, 'am', 'at 1 s'), box: itemOf(geometryOf(replies[replies.length - 2]!, 'the box'), 'plain', 'the box').positions };
    };
    const sought = run([]);
    const played = run(PLAY);
    const again = run([]);
    expect(sought.moving.stack.map((s) => [s.kind, s.reads_time]), 'the moving array reads time: a channel binds its offset').toEqual([['mod.array@1', true]]);
    expect(canon(pointSet(played.moving.positions)), 'at 1 s, played equals sought').toBe(canon(pointSet(sought.moving.positions)));
    expect(played.moving.key, 'at 1 s, played and sought have one content key').toBe(sought.moving.key);
    expect(canon(pointSet(sought.moving.positions)), 'at 1 s the offset is 1 m: the box and its copy 1 m along x').toBe(canon(pointSet(arrayOf(sought.box, 2, [1, 0, 0]))));
    expect(canon(pointSet(again.am.positions)), 'a static stack builds the same in two processes').toBe(canon(pointSet(sought.am.positions)));
    expect(again.am.key, 'and keys the same').toBe(sought.am.key);
  }, 900_000);

  it(`${AC[2]} while playing 26 frames over 1 s, the item whose modifiers don't read time never rebuilds after the first frame, while the time-reading one rebuilds every frame`, () => {
    const times = PLAY;
    const replies = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [show(DOC.a, orderDoc()), ...times.map((t) => evalCall(DOC.a, t))]));
    admitted(replies[0]!, 'the document');
    const frames = replies.slice(1).map((r, i) => nodesOf(r, `frame at ${times[i]}`));
    const first = ofItem(frames[0]!, 'am');
    expect(first.length, 'frame 0 has nodes for am').toBeGreaterThan(0);
    const problems: string[] = [];
    frames.forEach((nodes, i) => {
      if (i === 0) return;
      for (const n of ofItem(nodes, 'am')) if (n.run === 'ran') problems.push(`at ${times[i]}: ${nodeName(n)} ran, though am's modifiers read nothing of time`);
      if (!ofItem(nodes, 'moving').some((n) => n.run === 'ran')) problems.push(`at ${times[i]}: no node of moving ran, though its array's offset moves with time`);
    });
    none(problems, 'rebuilds while playing');
  }, 900_000);

  it(`${AC[2]} a revision that only reorders am's modifiers is a recorded change: am is listed as changed, a new current revision with another hash, and am's geometry becomes the other order's`, () => {
    const replies = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
      show(DOC.a, orderDoc()),
      revisionsOf(DOC.a),
      show(DOC.a, orderDoc([clone(MIRROR), clone(ARRAY)])),
      revisionsOf(DOC.a),
      geometryCall(DOC.a, { items: ['am', 'ma'], stage: 'final' }),
    ]));
    const [first, before, reordered, after, geo] = replies;
    admitted(first!, 'the first revision');
    admitted(reordered!, 'the reordered revision');
    expect(arr(reordered!['changed'], 'changed').map((v: JsonValue) => str(v, 'a changed item')), 'the reorder changes am and nothing else').toEqual(['am']);
    const current = (r: JsonObject) => arr(r['revisions'], 'revisions').map((v) => obj(v, 'a revision')).filter((v) => v['state'] === 'current');
    const was = current(before!);
    const now = current(after!);
    expect(was.length, 'one current revision before').toBe(1);
    expect(now.length, 'one current revision after').toBe(1);
    expect(now[0]!['rev'], 'the reorder is a new revision').not.toBe(was[0]!['rev']);
    expect(now[0]!['hash'], 'with another hash').not.toBe(was[0]!['hash']);
    const g = geometryOf(geo!, 'after the reorder');
    expect(canon(pointSet(itemOf(g, 'am', 'after').positions)), 'am now builds mirror, then array').toBe(canon(pointSet(itemOf(g, 'ma', 'after').positions)));
    expect(itemOf(g, 'am', 'after').stack.map((s) => s.kind), 'am\'s stack in its new order').toEqual(['mod.mirror@1', 'mod.array@1']);
  }, 900_000);
});
