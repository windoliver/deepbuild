// AC2, blind redraft of one part: "Modifiers apply in their declared order, each pure in its params and time; one
// that doesn't read time never rebuilds while playing, and a reorder is a recorded change"
//
// This file covers "one that doesn't read time never rebuilds while playing" only. Two 1 m slab boxes carry the
// same stack, `mod.array@1 {count: 2, offset: [1.5, 0, 0]}` then `mod.mirror@1 {axes: ["x"]}`. On `still` nothing
// is bound; on `moving` a channel drives the array's offset x from 1.5 m at 0 s to 3 m at 1.5 s, so its array reads
// time (README: Documents). The play is 31 `eval` frames at 0, 0.05, …, 1.5 s in one session (#387's nodes).
//
// - The `geometry` call's stack rows say `still`'s two modifiers don't read time and `moving`'s array does.
// - In every frame after the first, no frame-phase node of `still` runs (`run` is `hit` or `kept`, under the key it
//   had in the first frame), and its check-phase nodes are the revision's check as the first frame listed them
//   (same key, result and `run`): no check reruns while playing either.
// - The same check on `moving`, the twin whose stack does read time, fails in every frame after the first, naming
//   `moving`: a frame-phase node of it runs each frame. So the check sees a rebuild when there is one.
// - At 1.5 s, `still`'s geometry key and positions are those at 0 s; `moving`'s key and positions are not.
//
// Wrong programs: a static stack rebuilt each frame (a `still` node `ran`); a stack keyed by a clock or a frame
// counter (a `still` key that moves while playing); a check rerun per frame; a time-bound stack that never reruns
// (the twin finds no run); reads_time declared rather than computed from the bound params.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, admitted, canon, evalCall, failsNaming, geometryCall, geometryOf, itemOf, nodeName, nodesOf, none, ofItem,
  runShow, scenario, sceneDoc, show, useBins, useDir, type JsonObject, type Node,
} from '../helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();

/** #387's closed phase lists (Phase: Check and Frame). */
const CHECK_PHASES = new Set(['load', 'expand', 'resolve', 'validate', 'plan', 'build', 'estimate', 'check']);
const FRAME_PHASES = new Set(['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback']);

const STEP = 0.05;
const FRAMES = 31; // 0 s … 1.5 s
const END = '1.5s';
const timeAt = (k: number): string => `${Number((k * STEP).toFixed(2))}s`;

const stack = (): JsonObject[] => [
  { kind: 'mod.array@1', params: { count: 2, offset: [1.5, 0, 0] } },
  { kind: 'mod.mirror@1', params: { axes: ['x'] } },
];
function playDoc(): JsonObject {
  return sceneDoc('A still stack and a moving one', {
    cam: CAMERA,
    still: { kind: 'slab@1', params: { size: [1, 1, 1] }, modifiers: stack(), at: { pos: [0, 0, -3] } },
    moving: { kind: 'slab@1', params: { size: [1, 1, 1] }, modifiers: stack(), at: { pos: [0, 0, 3] } },
  }, {
    transport: { span: END },
    channels: {
      slide: {
        target: 'items/moving/modifiers/0/params/offset/0', type: 'f32',
        keys: { k0: { t: '0s', value: 1.5, interp: 'linear' }, k1: { t: END, value: 3, interp: 'linear' } },
      },
    },
  });
}

const slot = (n: Node): string => `${n.phase}/${n.operator}`;

/**
 * What "never rebuilds while playing" forbids, for one item over a play: a frame-phase node that runs after the
 * first frame or whose key moves, a check-phase node that isn't the revision's check as the first frame listed it,
 * and a node set that changes. Each sentence names the item, the node and the time.
 */
function rebuildsWhilePlaying(frames: Node[][], item: string): string[] {
  const out: string[] = [];
  const first = ofItem(frames[0]!, item);
  if (first.length === 0) return [`${item}: has no node in the first frame, so nothing about its rebuilds can be read`];
  const firstBy = new Map(first.map((n) => [slot(n), n]));
  for (let k = 1; k < frames.length; k++) {
    const at = timeAt(k);
    const nodes = ofItem(frames[k]!, item);
    const ids = nodes.map(slot).sort();
    if (canon(ids) !== canon([...firstBy.keys()].sort())) out.push(`${item}: its nodes at ${at} are ${JSON.stringify(ids)}, not the first frame's ${JSON.stringify([...firstBy.keys()].sort())}`);
    for (const n of nodes) {
      const f = firstBy.get(slot(n));
      if (CHECK_PHASES.has(n.phase)) {
        if (!f || f.key !== n.key || f.result !== n.result || f.run !== n.run) out.push(`${item}: check-phase node ${nodeName(n)} (${n.phase}) at ${at} is not the revision's check as the first frame listed it: a check reran while playing`);
      } else {
        if (n.run === 'ran') out.push(`${item}: ${nodeName(n)} (${n.phase}) ran at ${at}`);
        if (f && f.key !== n.key) out.push(`${item}: ${nodeName(n)} (${n.phase}) changed its key at ${at}`);
      }
    }
  }
  return out;
}

describe(`${AC[2]} a modifier that doesn't read time never rebuilds while playing (blind redraft)`, () => {
  it(`${AC[2]} over ${FRAMES} frames in 1.5 s no node of a stack that reads no time runs after the first frame, while its time-bound twin's run every frame`, () => {
    const calls: JsonObject[] = [show(DOC.a, playDoc()), geometryCall(DOC.a, { items: ['still', 'moving'], t: '0s' })];
    for (let k = 0; k < FRAMES; k++) calls.push(evalCall(DOC.a, timeAt(k)));
    calls.push(geometryCall(DOC.a, { items: ['still', 'moving'], t: END }));
    const replies = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], calls));
    admitted(replies[0]!, 'the two stacks');

    // Whether a modifier reads time is computed from its kind and its bound params.
    const g0 = geometryOf(replies[1]!, 'geometry at 0 s');
    const still0 = itemOf(g0, 'still', 'geometry at 0 s');
    const moving0 = itemOf(g0, 'moving', 'geometry at 0 s');
    expect(still0.stack.map((r) => [r.kind, r.reads_time, r.enabled]), 'still: array then mirror, neither reading time').toEqual([['mod.array@1', false, true], ['mod.mirror@1', false, true]]);
    expect(moving0.stack.map((r) => r.kind), 'moving: array then mirror').toEqual(['mod.array@1', 'mod.mirror@1']);
    expect(moving0.stack[0]!.reads_time, 'moving: the array whose offset a channel drives reads time').toBe(true);

    const frames = replies.slice(2, 2 + FRAMES).map((r, k) => nodesOf(r, `the frame at ${timeAt(k)}`));
    for (const [k, nodes] of frames.entries()) {
      for (const n of [...ofItem(nodes, 'still'), ...ofItem(nodes, 'moving')]) {
        expect(CHECK_PHASES.has(n.phase) || FRAME_PHASES.has(n.phase), `the frame at ${timeAt(k)}: ${nodeName(n)}'s phase ${n.phase} is in the closed lists`).toBe(true);
      }
    }

    none(rebuildsWhilePlaying(frames, 'still'), 'the stack that reads no time, while playing');

    // The twin: the same check on the stack that does read time finds a run in every frame after the first.
    failsNaming(rebuildsWhilePlaying(frames, 'moving'), ['moving'], 'the time-bound twin');
    const rebuiltAt = frames.slice(1).map((nodes, i) => (ofItem(nodes, 'moving').some((n) => FRAME_PHASES.has(n.phase) && n.run === 'ran') ? i + 1 : -1)).filter((k) => k >= 0);
    expect(rebuiltAt.map(timeAt), 'the time-bound twin reruns a frame-phase node in every frame after the first').toEqual(frames.slice(1).map((_, i) => timeAt(i + 1)));

    // Pure in its params and time: the still stack's geometry at 1.5 s is its geometry at 0 s; the twin's moved.
    const g1 = geometryOf(replies[2 + FRAMES]!, `geometry at ${END}`);
    const still1 = itemOf(g1, 'still', `geometry at ${END}`);
    const moving1 = itemOf(g1, 'moving', `geometry at ${END}`);
    expect(still0.built && still1.built, 'still is built at both times').toBe(true);
    expect(still1.key, 'still: the same geometry key at 1.5 s as at 0 s').toBe(still0.key);
    expect(canon(still1.positions), 'still: the same positions at 1.5 s as at 0 s').toBe(canon(still0.positions));
    expect(moving1.key, 'moving: another geometry key at 1.5 s').not.toBe(moving0.key);
    expect(canon(moving1.positions), 'moving: other positions at 1.5 s').not.toBe(canon(moving0.positions));
  }, 900_000);
});
