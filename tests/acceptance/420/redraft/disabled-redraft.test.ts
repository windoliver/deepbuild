// AC9, blind redraft: "Moving the curve that a disabled `curve_deform` names leaves its item's content key and work
// counters unchanged, and enabling the modifier rebuilds the item once; a planted key that keeps a disabled
// modifier's references rebuilds it and fails, naming the modifier"
//
// A `curve@1` rail (three points in the xy plane, linear) and a bar, `slab@1 {size: [2, 0.1, 0.1]}`, whose one
// modifier is `mod.curve_deform@1 {path: "rail", axis: "x"}` with `enabled: false`. Each step is a whole revision
// that differs from the last at one path (README: Documents), followed by one `eval` frame (#387's nodes) and a
// `geometry` call for the bar, in one session, at rising times:
//
// 1. rev 1, the rail as drawn; 2. rev 2, the rail's middle point moved up (the bar's modifier still disabled);
// 3. rev 3, `items/bar/modifiers/0/enabled` set true, then three more frames; 4. rev 4, the rail's middle point
// moved again, the modifier enabled.
//
// "Content key" is the bar's geometry `key` and every bar node's `key`; "work counters" are the bar nodes' `run`
// (a node whose operator ran counts work; `hit` and `kept` don't). The check-phase nodes of a revision are listed as
// its check had them (#387 README: eval), so "once" is read as: the first frame after the enable runs a bar node,
// and in the three frames after it no frame-phase bar node runs and the check-phase ones are the same check.
//
// Wrong programs: a disabled modifier's references in the key or the read set (moving the rail reruns the bar);
// an enable that never rebuilds (no run, the same key, the straight bar); an enable that rebuilds every frame; a
// modifier that, once enabled, ignores the rail it names (rev 4 reruns nothing).

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, admitted, canon, evalCall, failsNaming, geometryCall, geometryOf, itemOf, length, nodeName, nodesOf, none, ofItem,
  runShow, scenario, sceneDoc, show, strs, sub, useBins, useDir, type Geometry, type JsonObject, type Node, type ShowPlanted, type V3,
} from '../helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();

const CHECK_PHASES = new Set(['load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check']);
const MODIFIER = 'mod.curve_deform@1';
const MODIFIER_PATH = 'items/bar/modifiers/0';

const RAIL_DRAWN: V3[] = [[-1, 0, 0], [0.3, 0.4, 0], [1.2, 0, 0]];
const RAIL_MOVED: V3[] = [[-1, 0, 0], [0.3, 0.9, 0], [1.2, 0, 0]];
const RAIL_AGAIN: V3[] = [[-1, 0, 0], [0.3, -0.7, 0], [1.2, 0, 0]];

function railDoc(rail: V3[], enabled: boolean): JsonObject {
  return sceneDoc('A bar on a rail', {
    cam: CAMERA,
    rail: { kind: 'curve@1', params: { points: rail, mode: 'linear', closed: false } },
    bar: { kind: 'slab@1', params: { size: [2, 0.1, 0.1] }, modifiers: [{ kind: MODIFIER, params: { path: 'rail', axis: 'x' }, enabled }] },
  });
}

const slot = (n: Node): string => `${n.phase}/${n.operator}`;
const keysOf = (nodes: Node[]): string => canon(Object.fromEntries(nodes.map((n) => [slot(n), n.key])));
/** The largest distance between a vertex and the same vertex in another build of the item. */
function moved(a: Geometry, b: Geometry): number {
  if (a.positions.length !== b.positions.length) return Infinity;
  return Math.max(0, ...a.positions.map((p, i) => length(sub(p, b.positions[i]!))));
}

/**
 * What moving the rail while the bar's modifier is disabled must leave alone: the bar's geometry key and every bar
 * node's key, result and work (no `ran`). Each sentence names the disabled modifier by its kind and path, as the
 * bar's stack reports it, and what moved.
 */
function disabledMoveProblems(before: Node[], after: Node[], gBefore: Geometry, gAfter: Geometry): string[] {
  const disabled = gBefore.stack.map((r, k) => ({ ...r, path: `items/${gBefore.id}/modifiers/${k}` })).filter((r) => !r.enabled);
  if (disabled.length === 0) return [`${gBefore.id}: its stack reports no disabled modifier: ${JSON.stringify(gBefore.stack)}`];
  const named = disabled.map((r) => `the disabled ${r.kind} at ${r.path}`).join(', ');
  const out: string[] = [];
  const b = ofItem(before, gBefore.id);
  const a = ofItem(after, gBefore.id);
  if (b.length === 0) out.push(`${gBefore.id}: has no node, so its work can't be read (${named})`);
  if (canon(a.map(slot).sort()) !== canon(b.map(slot).sort())) out.push(`${gBefore.id}: moving what ${named} names changed its nodes from ${JSON.stringify(b.map(slot).sort())} to ${JSON.stringify(a.map(slot).sort())}`);
  const byBefore = new Map(b.map((n) => [slot(n), n]));
  for (const n of a) {
    if (n.run === 'ran') out.push(`${gBefore.id}: moving what ${named} names reran ${nodeName(n)} (${n.phase})`);
    const was = byBefore.get(slot(n));
    if (was && was.key !== n.key) out.push(`${gBefore.id}: moving what ${named} names changed the key of ${nodeName(n)} (${n.phase})`);
    if (was && was.result !== n.result) out.push(`${gBefore.id}: moving what ${named} names changed the result of ${nodeName(n)} (${n.phase})`);
  }
  if (gAfter.key !== gBefore.key) out.push(`${gBefore.id}: moving what ${named} names changed its geometry key`);
  if (canon(gAfter.positions) !== canon(gBefore.positions)) out.push(`${gBefore.id}: moving what ${named} names changed its positions`);
  return out;
}

/** Rev 1 and rev 2 (the rail moved, the modifier disabled), each followed by a frame and the bar's geometry. */
const moveWhileDisabled = (): JsonObject[] => [
  show(DOC.a, railDoc(RAIL_DRAWN, false)), evalCall(DOC.a, '0s'), geometryCall(DOC.a, { items: ['bar'], t: '0s' }),
  show(DOC.a, railDoc(RAIL_MOVED, false)), evalCall(DOC.a, '0.05s'), geometryCall(DOC.a, { items: ['bar'], t: '0.05s' }),
];
function runMove(replies: JsonObject[]): { n1: Node[]; n2: Node[]; g1: Geometry; g2: Geometry } {
  admitted(replies[0]!, 'rev 1, the modifier disabled');
  admitted(replies[3]!, 'rev 2, the rail moved');
  // The revision record sees the move: the rail changed, the bar didn't.
  expect(strs(replies[3]!['changed'] ?? [], 'rev 2: changed'), 'rev 2 lists the rail as changed').toContain('rail');
  expect(strs(replies[3]!['unchanged'] ?? [], 'rev 2: unchanged'), 'rev 2 lists the bar as unchanged').toContain('bar');
  return {
    n1: nodesOf(replies[1]!, 'the frame after rev 1'), n2: nodesOf(replies[4]!, 'the frame after rev 2'),
    g1: itemOf(geometryOf(replies[2]!, 'the bar after rev 1'), 'bar', 'the bar after rev 1'),
    g2: itemOf(geometryOf(replies[5]!, 'the bar after rev 2'), 'bar', 'the bar after rev 2'),
  };
}

function scenarioFor(calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  return scenario(dir(), [DOC.a], calls, planted ? { planted } : {});
}

describe(`${AC[9]} a disabled curve_deform reads nothing until it is enabled (blind redraft)`, () => {
  it(`${AC[9]} moving the rail a disabled ${MODIFIER} names leaves the bar's keys and work alone; enabling it reruns the bar in the next frame and in none of the three after; once enabled, moving the rail reruns it`, () => {
    const calls: JsonObject[] = [
      ...moveWhileDisabled(),
      show(DOC.a, railDoc(RAIL_MOVED, true)), evalCall(DOC.a, '0.1s'), evalCall(DOC.a, '0.15s'), evalCall(DOC.a, '0.2s'), evalCall(DOC.a, '0.25s'),
      geometryCall(DOC.a, { items: ['bar'], t: '0.25s' }),
      show(DOC.a, railDoc(RAIL_AGAIN, true)), evalCall(DOC.a, '0.3s'), geometryCall(DOC.a, { items: ['bar'], t: '0.3s' }),
    ];
    const replies = runShow(bins.bin('deep-show'), scenarioFor(calls));
    const { n1, n2, g1, g2 } = runMove(replies);

    expect(g1.stack.map((r) => [r.kind, r.class, r.enabled]), 'the bar\'s stack: one disabled deform').toEqual([[MODIFIER, 'deform', false]]);
    expect(g1.built, 'the bar is built').toBe(true);
    none(disabledMoveProblems(n1, n2, g1, g2), 'moving the rail while the modifier is disabled');

    // Enabling the modifier: the next frame reruns the bar, under new keys, and bends it.
    admitted(replies[6]!, 'rev 3, the modifier enabled');
    const after = [7, 8, 9, 10].map((i, k) => nodesOf(replies[i]!, `frame ${k + 1} after the enable`));
    const g3 = itemOf(geometryOf(replies[11]!, 'the bar after the enable'), 'bar', 'the bar after the enable');
    const bar3 = ofItem(after[0]!, 'bar');
    expect(bar3.filter((n) => n.run === 'ran').map(nodeName), 'the first frame after the enable reruns the bar').not.toEqual([]);
    expect(keysOf(bar3), 'the enable is in the bar\'s node keys').not.toBe(keysOf(ofItem(n2, 'bar')));
    expect(g3.key, 'the enable changes the bar\'s geometry key').not.toBe(g2.key);
    expect(g3.stack.map((r) => [r.kind, r.enabled]), 'the bar\'s stack: the modifier enabled').toEqual([[MODIFIER, true]]);
    expect(moved(g3, g2), 'the enabled modifier bends the bar: a vertex moves by more than 5 cm').toBeGreaterThan(0.05);

    // Once: in the three frames after, no frame-phase node of the bar runs and its check-phase nodes are one check.
    const once: string[] = [];
    const firstBy = new Map(bar3.map((n) => [slot(n), n]));
    for (const [k, nodes] of after.slice(1).entries()) {
      const bar = ofItem(nodes, 'bar');
      if (canon(bar.map(slot).sort()) !== canon(bar3.map(slot).sort())) once.push(`frame ${k + 2} after the enable: the bar's nodes changed`);
      for (const n of bar) {
        const f = firstBy.get(slot(n));
        if (CHECK_PHASES.has(n.phase)) {
          if (!f || f.key !== n.key || f.result !== n.result || f.run !== n.run) once.push(`frame ${k + 2} after the enable: check-phase ${nodeName(n)} is another check than the first frame's`);
        } else if (n.run === 'ran') once.push(`frame ${k + 2} after the enable: ${nodeName(n)} (${n.phase}) ran again`);
      }
    }
    none(once, 'the enable rebuilds the bar once');

    // Once enabled, the modifier reads the rail: moving it reruns the bar and moves its vertices.
    admitted(replies[12]!, 'rev 4, the rail moved with the modifier enabled');
    const n4 = nodesOf(replies[13]!, 'the frame after rev 4');
    const g4 = itemOf(geometryOf(replies[14]!, 'the bar after rev 4'), 'bar', 'the bar after rev 4');
    expect(ofItem(n4, 'bar').filter((n) => n.run === 'ran').map(nodeName), 'with the modifier enabled, moving the rail reruns the bar').not.toEqual([]);
    expect(g4.key, 'with the modifier enabled, moving the rail changes the bar\'s geometry key').not.toBe(g3.key);
    expect(moved(g4, g3), 'with the modifier enabled, moving the rail moves the bar\'s vertices').toBeGreaterThan(0.05);
  }, 900_000);

  it(`${AC[9]} planted keeps_disabled_refs reruns the bar when the rail moves, and the check fails naming ${MODIFIER} and ${MODIFIER_PATH}`, () => {
    const replies = runShow(bins.bin('deep-show'), scenarioFor(moveWhileDisabled(), 'keeps_disabled_refs'));
    const { n1, n2, g1, g2 } = runMove(replies);
    const problems = disabledMoveProblems(n1, n2, g1, g2);
    failsNaming(problems, [MODIFIER, MODIFIER_PATH], 'planted keeps_disabled_refs');
    expect(problems.some((p) => / reran | changed the key of | changed its geometry key/.test(p)), `planted keeps_disabled_refs: the bar reruns or its key moves; the failures were:\n  ${problems.join('\n  ')}`).toBe(true);
  }, 900_000);
});
