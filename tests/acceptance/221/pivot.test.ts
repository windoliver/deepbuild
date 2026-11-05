// AC4: "`pivot: sw` with scale 2 keeps the lower left corner within 0.5 px"
//
// Oracle lane (README): ManimGX cfd33af5aa tests/unit/test_mobject.py:266-356 (the Transforms state machine scales
// about each of eight box points and checks every point against plain arithmetic about that pivot) is ported onto a
// curved path scaled 2 about its sw box point: every point of its outline is 2 (p − sw) + sw, sw read from the tight
// box of its curves (TestBox, :359-402), never from its control points.
import { describe, expect, it } from 'vitest';
import {
  EXACT, FLICKS, PX, TIMEOUT, boxFailures, evenTimes, expectClean, fmt, fmtBox, geometryAt, geometryOf, loadDoc, none, pointOf, scratch,
  tightBox, trackAt, trackOf, useRenderBinary, type Box, type Pt, type Subpath,
} from './helpers.ts';

useRenderBinary();
const store = scratch('store');

/** The arch's own outline as its `d` writes it (fixtures/pivot-sw.json), unscaled. */
const ARCH: Subpath = { closed: true, verbs: ['M', 'C', 'Z'], points: [[300, 400], [280, 300], [420, 300], [400, 400]] };

describe('AC4 pivot: sw', () => {
  it('AC4 pivot: sw with scale 2 keeps the lower left corner within 0.5 px (a rect and a curved path)', () => {
    const doc = loadDoc('pivot-sw.json');
    expectClean([doc], store);
    const [card] = geometryOf([doc], 'card', store);
    const [arch] = geometryOf([doc], 'arch', store);
    const failures: string[] = [];
    // The card's box [100, 200, 80, 40]: its lower left corner (100, 240) stays; it grows up and right.
    const cardSw: Pt = [100, 240];
    if (Math.abs(card!.points.sw[0] - cardSw[0]) > PX || Math.abs(card!.points.sw[1] - cardSw[1]) > PX) failures.push(`the card's sw is (${card!.points.sw.map(fmt).join(', ')}), not (100, 240)`);
    failures.push(...boxFailures(card!, [100, 160, 160, 80], PX, 'the card scaled 2 about sw'));
    // The arch's lower left corner is that of the tight box of its curve: its cubic bulges left of its ends.
    const before = tightBox([ARCH]);
    const sw = pointOf(before, 'sw');
    expect(before[0], 'the arch\'s curve reaches left of its first point (and inside its control point 280)').toBeLessThan(300);
    expect(before[0]).toBeGreaterThan(280);
    const after = tightBox(arch!.subpaths);
    const afterSw = pointOf(after, 'sw');
    if (Math.abs(afterSw[0] - sw[0]) > PX || Math.abs(afterSw[1] - sw[1]) > PX) failures.push(`the arch's drawn lower left corner moved from (${sw.map(fmt).join(', ')}) to (${afterSw.map(fmt).join(', ')})`);
    if (Math.abs(arch!.points.sw[0] - sw[0]) > PX || Math.abs(arch!.points.sw[1] - sw[1]) > PX) failures.push(`the arch's #sw reads (${arch!.points.sw.map(fmt).join(', ')}), not (${sw.map(fmt).join(', ')})`);
    if (Math.abs(after[2] - 2 * before[2]) > PX || Math.abs(after[3] - 2 * before[3]) > PX) failures.push(`the arch's box ${fmtBox(after)} is not twice ${fmtBox(before)}`);
    none(failures, 'the lower left corner stays');
  }, TIMEOUT);

  it('AC4 oracle port (Transforms, test_mobject.py:266-356): every point of the arch scaled 2 about its sw box point is plain arithmetic about that pivot, and its box is the tight box of what it draws', () => {
    const doc = loadDoc('pivot-sw.json');
    const [arch] = geometryOf([doc], 'arch', store);
    const sw = pointOf(tightBox([ARCH]), 'sw');
    const want: Pt[] = ARCH.points.map(([x, y]) => [2 * (x - sw[0]) + sw[0], 2 * (y - sw[1]) + sw[1]]);
    expect(arch!.subpaths.length, `geometry lists the arch's outline: ${JSON.stringify(arch!.raw).slice(0, 400)}`).toBe(1);
    const got = arch!.subpaths[0]!;
    expect(got.verbs, 'the arch is still one cubic').toEqual(['M', 'C', 'Z']);
    const failures: string[] = [];
    got.points.forEach((p, i) => {
      if (Math.abs(p[0] - want[i]![0]) > EXACT || Math.abs(p[1] - want[i]![1]) > EXACT) failures.push(`point ${i} is (${p.map(fmt).join(', ')}), want (${want[i]!.map(fmt).join(', ')})`);
    });
    failures.push(...boxFailures(arch!, tightBox(arch!.subpaths), EXACT, 'the arch\'s box against its curve'));
    none(failures, 'its points are the arithmetic');
  }, TIMEOUT);

  it('AC4 a keyed scale from 1 to 2 about sw keeps the lower left corner within 0.5 px at 21 sampled times', () => {
    const doc = loadDoc('pivot-sw.json');
    const times = evenTimes(2 * FLICKS, 21);
    const sx = trackOf(doc, 'grow-sx');
    const grow = geometryAt(doc, 'grow', store, times);
    const failures: string[] = [];
    grow.forEach((g, k) => {
      const s = trackAt(sx, times[k]!);
      const want: Box = [500, 330 - 30 * s, 60 * s, 30 * s];
      failures.push(...boxFailures(g, want, PX, `the growing card at scale ${fmt(s)}`));
    });
    none(failures, 'the corner stays while the scale is keyed');
  }, TIMEOUT);
});
