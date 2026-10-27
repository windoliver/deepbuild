// #387.f71bf834: flipping the view's locale, and separately its reduced motion, changes the content keys
// of every operator that formats numbers, shapes text or plays motion; both reduced-motion renditions
// rendered in one process give different text-animator frames; and a planted key without the locale or
// reduced motion reuses the other's result and fails, naming the operator. Which operators those are is
// read from clean evaluations in fresh processes: an operator with a node whose result moves with the
// flip, every node of which must then change key, its plain label's included (README: Readings). The
// wrong programs: the two planted keys. At the base there is no `eval`.
import { describe, expect, it } from 'vitest';
import {
  DOC, board, byId, evalCall, evaluated, label, presented, rect, run, sameNodes, scenario, show, snapshotOf, sorted, useBuilds, useEvidence,
  type Build, type Evaluated, type JsonObject, type View,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

const READING = 'reading:01JB8700000000000000000001';
const RECORD: JsonObject = { [READING]: { session: null, value: 1234567.5, as_of: 1_000 } };
const T = '0.5s';

/** A counter of a reading, a plain label, a title with a text animator, and a sliding rect, under reduced motion `hold`. */
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
/** Both renditions in one process, through the content-key cache, the second after the first; with their snapshots. */
function oneProcess(first: View, second: View, planted?: string): { a: Evaluated; b: Evaluated; snapA: string; snapB: string } {
  const replies = run(builds.bin(FULL), scenario(evidence(), [show(VIEWED), evalCall(DOC.a, { t: T, view: first, pixels: true }), evalCall(DOC.a, { t: T, view: second, pixels: true })], { record: RECORD, ...(planted ? { planted } : {}) }));
  presented(replies[0]!, 'the view-input board');
  return { a: evaluated(replies[1]!, `the rendition under ${JSON.stringify(first)}`), b: evaluated(replies[2]!, `the rendition under ${JSON.stringify(second)}`), snapA: snapshotOf(replies[1]!, 'the first rendition'), snapB: snapshotOf(replies[2]!, 'the second rendition') };
}

/** The operators with a node whose clean result moves with the flip; then every node of theirs whose key didn't move. */
function flipFailures(x: Evaluated, y: Evaluated, flip: string): { moved: string[]; failures: string[] } {
  const right = byId(y);
  const moved = sorted([...new Set(x.nodes.filter((n) => right.get(`${n.operator}@${n.item ?? '(document)'}`)?.result !== n.result).map((n) => n.operator))]);
  const failures = x.nodes.filter((n) => moved.includes(n.operator) && right.get(`${n.operator}@${n.item ?? '(document)'}`)?.key === n.key)
    .map((n) => `${n.operator} on ${n.item ?? 'the document'} keeps its key across the ${flip} flip`);
  return { moved, failures };
}

describe('#387.f71bf834 flipping the view\'s locale, and separately its reduced motion, changes the keys of every operator that formats numbers, shapes text or plays motion; both renditions in one process differ; a planted key without either reuses the other\'s result and fails, naming the operator', () => {
  it('#387.f71bf834 en → de: the operators whose result moves (formatting and shaping the number) change the key of every node they have, the plain label\'s included', () => {
    const en = fresh({ locale: 'en' });
    const de = fresh({ locale: 'de' });
    const { moved, failures } = flipFailures(en, de, 'locale');
    expect(moved.length, 'formatting 1,234,567.5 moves with the locale: some operator\'s result differs between en and de').toBeGreaterThan(0);
    expect(en.nodes.some((n) => n.item === 'n' && moved.includes(n.operator)), 'among them an operator on the counter').toBe(true);
    expect(en.nodes.some((n) => n.item === 'lbl' && moved.includes(n.operator)), 'and the shaping operator has a node on the plain label too').toBe(true);
    expect(failures, 'every node of an operator that formats numbers or shapes text changes key with the locale').toEqual([]);
  }, 600_000);

  it('#387.f71bf834 in one process both locale renditions and both reduced-motion renditions draw different frames, each equal to its fresh clean rendition', () => {
    for (const [first, second] of [[{ locale: 'en' }, { locale: 'de' }], [{ reduced_motion: false }, { reduced_motion: true }]] as [View, View][]) {
      const p = oneProcess(first, second);
      expect(p.snapB, `the rendition under ${JSON.stringify(second)} differs from the one under ${JSON.stringify(first)}`).not.toBe(p.snapA);
      expect(sameNodes(fresh(second), p.b, `${JSON.stringify(second)} after ${JSON.stringify(first)}`, { key: true, result: true }), 'no result of the first rendition is reused for the second').toEqual([]);
    }
  }, 900_000);

  it('#387.f71bf834 a planted key without the locale (key_without_locale) reuses the en result for de and fails, naming the operator', () => {
    const p = oneProcess({ locale: 'en' }, { locale: 'de' }, 'key_without_locale');
    const failures = sameNodes(fresh({ locale: 'de' }), p.b, 'de after en', { key: false, result: true });
    expect(failures.length, 'the planted key reuses the other rendition\'s result, so the check fails').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the operator on the counter').toMatch(/node [a-z0-9._]+@n has result/);
  }, 600_000);

  it('#387.f71bf834 a planted key without reduced motion (key_without_reduced_motion) reuses one rendition\'s text-animator result for the other and fails, naming the operator', () => {
    const p = oneProcess({ reduced_motion: false }, { reduced_motion: true }, 'key_without_reduced_motion');
    const failures = sameNodes(fresh({ reduced_motion: true }), p.b, 'reduced motion after full motion', { key: false, result: true });
    expect(failures.length, 'the planted key reuses the other rendition\'s result, so the check fails').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the operator on the animated title').toMatch(/node [a-z0-9._]+@title has result/);
  }, 600_000);
});
