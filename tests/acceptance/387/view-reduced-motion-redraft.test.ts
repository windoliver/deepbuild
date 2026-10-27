// #387.f71bf834 (redraft of view.test.ts's reduced-motion key test): flipping the view's reduced motion
// changes the content keys of every operator that plays motion. Which operators those are is read from
// two clean evaluations in fresh processes, one with reduced motion off and one with it on: an operator
// plays motion when one of its nodes gives another result while nothing it reads gave another result,
// so the change can only come from the view's reduced motion itself. Every node of such an operator must
// change key (an operator's read set, the view inputs in it among them, is the same for all its nodes:
// Operator and read set; Content key). An operator whose result moves only because an operator it reads
// moved (the world transform under a motion operator that holds still under reduced motion) reads no view
// input through that change, so its nodes on items whose reads didn't change keep their keys and this
// test doesn't ask them to change (RM-REDRAFT.md). The wrong programs: a key without the view's reduced
// motion (`planted: "key_without_reduced_motion"`, caught here and by view.test.ts's planted test).
import { describe, expect, it } from 'vitest';
import {
  DOC, board, byId, evalCall, evaluated, label, nodeId, presented, rect, run, scenario, sealed, show, sorted, useBuilds, useEvidence,
  type Build, type Evaluated, type JsonObject, type Registry, type View,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

const READING = 'reading:01JB8700000000000000000001';
const RECORD: JsonObject = { [READING]: { session: null, value: 1234567.5, as_of: 1_000 } };
const T = '0.5s';

/** view.test.ts's board, unchanged: a counter of a reading, a plain label, a title with a text animator, and a sliding rect, under reduced motion `hold`. */
const VIEWED = board('View inputs', [
  rect('back', [0, 0, 320, 200], 'a0', 'ground'),
  { id: 'n', kind: 'text@1', name: 'Total', order: 'a1', params: { text: { counter: { source: 'bv' } }, size: 13, box: { w: 160, h: 20 }, widest: '8,888,888.8' }, at: { pos: [16, 16, 0] } },
  label('lbl', 'Checks passed', [16, 44], 'a2'),
  { id: 'title', kind: 'text@1', name: 'Title', order: 'a3', params: { text: 'Launch', size: 24, box: { w: 200, h: 32 }, animators: [{ units: 'grapheme', range: { from: 0, to: 1, falloff: 0.5, offset: 0 }, shape: 'smooth', mode: 'add', props: { y: 16, opacity: 0 } }] }, at: { pos: [16, 72, 0] } },
  rect('mover', [0, 0, 24, 24], 'a4', 'ink', { at: { pos: [16, 150, 0] } }),
], {
  transport: { span: '2s', reduced_motion: 'hold' },
  bound_values: { bv: { target: 'items/n/params/text', source: READING, format: { precision: 1 } } },
  clips: {
    slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 16, interp: 'linear' }, k1: { t: '2s', value: 280, interp: 'linear' } } } } },
    rise: { slots: { target: { type: 'text@1', required: true } }, span: 'auto', channels: { o: { target: 'slot:target/params/animators/0/range/offset', type: 'f32', keys: { k0: { t: '0s', value: -1, interp: 'linear' }, k1: { t: '2s', value: 1, interp: 'linear' } } } } },
  },
  placements: { p: { clip: 'slide', slots: { target: 'mover' }, start: '0s' }, p2: { clip: 'rise', slots: { target: 'title' }, start: '0s' } },
});

/** One rendition evaluated clean in a fresh process: no other rendition's result can reach it. */
function fresh(view: View): Evaluated {
  const replies = run(builds.bin(FULL), scenario(evidence(), [show(VIEWED), evalCall(DOC.a, { t: T, view, clean: true })], { record: RECORD }));
  presented(replies[0]!, 'the view-input board');
  return evaluated(replies[1]!, `a fresh clean rendition under ${JSON.stringify(view)}`);
}

/**
 * The operators a node's result depends on besides its own reads of view, time and tables: those that write
 * an array in its operator's declared reads, or an array the registry says contributes to one of them or to
 * an array it writes (a contribution, such as motion's offset toward the transform, is composed into the
 * array, so it can reach the writer's own result). The registry's read sets, as its modules registered them.
 */
function readsFrom(reg: Registry, operator: string): string[] {
  const contributors = new Map<string, string[]>();
  for (const [name, a] of Object.entries(reg.arrays)) {
    const to = a['contributes_to'];
    if (typeof to === 'string') contributors.set(to, [...(contributors.get(to) ?? []), name]);
  }
  const arrays = new Set<string>();
  for (const r of reg.operators[operator]?.reads ?? []) { arrays.add(r); for (const c of contributors.get(r) ?? []) arrays.add(c); }
  for (const w of reg.operators[operator]?.writes ?? []) for (const c of contributors.get(w) ?? []) arrays.add(c);
  return sorted(Object.entries(reg.operators).filter(([name, op]) => name !== operator && op.writes.some((w) => arrays.has(w))).map(([name]) => name));
}

/**
 * The operators that play motion: an operator with a node whose result differs between the renditions while
 * every node of every operator it reads, on any item, has the same result in both (any item, so a read through
 * `parent`, `children`, `refs` or a set counts as a moved input), so its own read of the view's reduced motion
 * moved it; and an operator whose registered reads name `view(reduced_motion)` (the text animator, whose own
 * read a moved input upstream can hide). Then every node of theirs whose key didn't move.
 */
function motionFailures(reg: Registry, x: Evaluated, y: Evaluated): { direct: string[]; movers: string[]; moved: string[]; failures: string[] } {
  const right = byId(y);
  const differs = (id: string, result: string): boolean => right.get(id)?.result !== result;
  const movedOps = new Set(x.nodes.filter((n) => differs(nodeId(n), n.result)).map((n) => n.operator));
  for (const n of y.nodes) if (!x.nodes.some((m) => nodeId(m) === nodeId(n))) movedOps.add(n.operator);
  const direct = sorted([...movedOps].filter((op) => readsFrom(reg, op).every((u) => !movedOps.has(u))));
  const declared = Object.entries(reg.operators).filter(([, op]) => op.reads.includes('view(reduced_motion)')).map(([name]) => name);
  const movers = sorted([...new Set([...direct, ...declared])]);
  const moved = sorted(x.nodes.filter((n) => movers.includes(n.operator) && differs(nodeId(n), n.result)).map(nodeId));
  const failures = x.nodes.filter((n) => movers.includes(n.operator) && right.get(nodeId(n))?.key === n.key)
    .map((n) => `${n.operator} on ${n.item ?? 'the document'} keeps its key across the reduced-motion flip, though ${n.operator} reads the view's reduced motion`);
  return { direct, movers, moved, failures };
}

describe('#387.f71bf834 flipping the view\'s reduced motion changes the keys of every operator that plays motion (redraft)', () => {
  it('#387.f71bf834 reduced motion off → on: the operators whose result moves with the view\'s reduced motion itself, not through an operator they read, change the key of every node they have', () => {
    const reg = sealed(builds.bin(FULL), evidence());
    const off = fresh({ reduced_motion: false });
    const on = fresh({ reduced_motion: true });
    const onById = byId(on);
    expect(off.nodes.some((n) => n.item === 'title' && onById.get(nodeId(n))?.result !== n.result), 'the title\'s text-animator frame moves with reduced motion (it keeps only opacity)').toBe(true);
    const { direct, movers, moved, failures } = motionFailures(reg, off, on);
    expect(direct.length, 'some operator\'s result moves with reduced motion while nothing it reads moved').toBeGreaterThan(0);
    expect(failures, `every node of an operator that plays motion (${movers.join(', ')}; moved: ${moved.join(', ')}) changes key with reduced motion`).toEqual([]);
  }, 600_000);
});
