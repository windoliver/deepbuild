// AC9: "Moving the curve that a disabled `curve_deform` names leaves its item's content key and work counters
// unchanged, and enabling the modifier rebuilds the item once; a planted key that keeps a disabled modifier's
// references rebuilds it and fails, naming the modifier"
//
// A 4 m slab bar under `mod.curve_deform@1 {path: "rail", axis: "x"}` with `enabled: false`, beside the curve
// `rail` (curve@1). Revision 2 moves the rail (its points, 0.5 m up and bent); revision 3 enables the modifier;
// revision 4 moves the rail again. Each revision is followed by frames (#387's `eval`), and the bar's work is
// counted from its nodes: a node `ran`, or was `hit` or `kept`. The checks: after the move, every node of the bar
// keeps its key and none runs, and its geometry key is unchanged; after enabling, at least one node of the bar
// runs in the next frame and none in the three frames after it (it rebuilds once), its geometry key changes and
// its points follow the rail (they differ from the straight bar); after the second move, the enabled bar runs
// again and its key changes (the counter and the key see the curve once it is read). The planted
// `keeps_disabled_refs` keys the bar by the disabled modifier's references, so the first move changes its key and
// reruns it: the check fails, naming `mod.curve_deform@1` at `items/bar/modifiers/0`.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, admitted, canon, clone, evalCall, failsNaming, geometryCall, geometryOf, itemOf, nodeName, nodesOf, none, ofItem, runShow,
  scenario, sceneDoc, show, useBins, useDir, weldKey, type JsonObject, type Node, type ShowPlanted,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();
const MODIFIER = 'mod.curve_deform@1 at items/bar/modifiers/0';
const STRAIGHT = [[-2, 0, 0], [0, 0, 0], [2, 0, 0]];
const BENT = [[-2, 0.5, 0], [0, 1.5, 0], [2, 0.5, 0]];
const BENT_MORE = [[-2, 0.5, 0], [0, 2.5, 0], [2, 0.5, 0]];

function barDoc(points: number[][], enabled: boolean): JsonObject {
  return sceneDoc('A bar along a rail', {
    cam: CAMERA,
    rail: { kind: 'curve@1', params: { points: clone(points), mode: 'catmull_rom' } },
    bar: { kind: 'slab@1', params: { size: [4, 0.2, 0.2] }, modifiers: [{ kind: 'mod.curve_deform@1', enabled, params: { path: 'rail', axis: 'x' } }] },
  });
}

interface Step { label: string; frames: Node[][]; geometry: { key: string; points: string[] } }
/** Revisions 1 to 4, each shown, then `frames` frames and the bar's geometry. */
function steps(planted?: ShowPlanted): Step[] {
  const plan: { label: string; doc: JsonObject; frames: string[] }[] = [
    { label: 'disabled', doc: barDoc(STRAIGHT, false), frames: ['0s', '0.1s'] },
    { label: 'rail moved while disabled', doc: barDoc(BENT, false), frames: ['0.2s', '0.3s'] },
    { label: 'enabled', doc: barDoc(BENT, true), frames: ['0.4s', '0.5s', '0.6s', '0.7s'] },
    { label: 'rail moved while enabled', doc: barDoc(BENT_MORE, true), frames: ['0.8s'] },
  ];
  const calls: JsonObject[] = [];
  for (const p of plan) calls.push(show(DOC.a, p.doc), ...p.frames.map((t) => evalCall(DOC.a, t)), geometryCall(DOC.a, { items: ['bar'], stage: 'final' }));
  const replies = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], calls, planted ? { planted } : {}));
  let at = 0;
  return plan.map((p) => {
    admitted(replies[at++]!, `the revision "${p.label}"`);
    const frames = p.frames.map((t) => ofItem(nodesOf(replies[at++]!, `${p.label}: the frame at ${t}`), 'bar'));
    const g = itemOf(geometryOf(replies[at++]!, `${p.label}: the bar`), 'bar', p.label);
    return { label: p.label, frames, geometry: { key: g.key, points: [...new Set(g.positions.map(weldKey))].sort() } };
  });
}

const ran = (nodes: Node[]): Node[] => nodes.filter((n) => n.run === 'ran');
const keys = (nodes: Node[]): string => canon(Object.fromEntries(nodes.map((n) => [n.operator, n.key])));

/** What the criterion asks of the disabled modifier: nothing it names reaches the bar's key or work. Failures name the modifier. */
function disabledProblems(s: Step[]): string[] {
  const [before, moved] = s;
  const out: string[] = [];
  const last = before!.frames[before!.frames.length - 1]!;
  if (last.length === 0) return ['the bar has no node in its frames, so nothing can be counted'];
  for (const [i, frame] of moved!.frames.entries()) {
    for (const n of ran(frame)) out.push(`moving the rail ${MODIFIER} names, while it is disabled, ran ${nodeName(n)} in frame ${i} after the move`);
    if (keys(frame) !== keys(last)) out.push(`moving the rail ${MODIFIER} names, while it is disabled, changed the bar's node keys in frame ${i} after the move`);
  }
  if (moved!.geometry.key !== before!.geometry.key) out.push(`moving the rail ${MODIFIER} names, while it is disabled, changed the bar's content key`);
  return out;
}

describe(`${AC[9]} a disabled modifier reads nothing`, () => {
  it(`${AC[9]} moving the rail a disabled curve_deform names leaves the bar's keys and work unchanged; enabling it rebuilds the bar once, after which it follows the rail`, () => {
    const s = steps();
    none(disabledProblems(s), 'the disabled curve_deform');
    const [before, moved, enabled, again] = s as [Step, Step, Step, Step];
    expect(moved.geometry.points, 'while disabled, the bar is the straight slab whatever the rail does').toEqual(before.geometry.points);
    expect(ran(enabled.frames[0]!).length, 'enabling the modifier rebuilds the bar in the next frame').toBeGreaterThan(0);
    for (const [i, frame] of enabled.frames.slice(1).entries()) expect(ran(frame).map(nodeName), `and only once: nothing of the bar runs ${i + 1} frames later`).toEqual([]);
    expect(enabled.geometry.key, 'enabled, the bar has another content key').not.toBe(moved.geometry.key);
    expect(enabled.geometry.points, 'enabled, the bar bends along the rail').not.toEqual(moved.geometry.points);
    expect(ran(again.frames[0]!).length, 'once enabled, moving the rail rebuilds the bar (the counter sees the read)').toBeGreaterThan(0);
    expect(again.geometry.key, 'and changes its key').not.toBe(enabled.geometry.key);
  }, 900_000);

  it(`${AC[9]} the planted keeps_disabled_refs (a key that keeps a disabled modifier's references) rebuilds the bar when the rail moves and fails, naming the modifier`, () => {
    failsNaming(disabledProblems(steps('keeps_disabled_refs')), ['mod.curve_deform@1', 'items/bar/modifiers/0'], 'the planted keeps_disabled_refs');
  }, 900_000);
});
