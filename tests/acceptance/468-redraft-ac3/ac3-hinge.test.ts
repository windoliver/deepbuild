// AC3 #468.632af807: "With a lid that opens 110° while the camera orbits 90°, a label anchored to the right edge with a
// leader to lid#hinge keeps the leader's end within 0.5 px of that anchor's projection at 200 random times, has the same
// pixel hash seeked or played on one machine, and hides exactly at the times the anchor's projection leaves the safe
// frame; a 3D line with one point at lid#hinge passes through that anchor at every sampled time"
//
// The fixture (helpers.ts: lidDoc): a chest whose lid opens about its back edge from 0° to 110° over 4 s while the
// camera orbits 90°; the lid's anchor `hinge` sits 4 cm off the pivot's line. The label is `overlay.frame@1` `label`
// (a 120 × 40 px frame), anchored to the right edge (`anchor: "e"`) with `leader: {to: "lid#hinge"}` and
// `hide: "off_frame"`. The wire is a `mark.line@1` through [0.6, 0, −0.6], `lid#hinge`, [0.9, 0, −0.1]. The 200 times
// are distinct frames of the 240 fps grid over 4 s, drawn by a seeded generator (helpers.ts: SAMPLES).
//
// asserts, through `view3d` (README: The surface under test):
//   - the label's document played from frame 0 and sought through the 200 frames in drawing order, with `overlays`:
//     at every sampled frame of both, where the anchor's projection (worked out here from the lid's pivot, its opening
//     and the camera at that frame) lies inside the safe frame, the label's row has `at` and a leader whose end is
//     within 0.5 px of it; where it lies outside, `at` and `leader` are null; the played and the sought frame have one
//     pixel hash;
//   - at every sampled frame, the sought frame with the label against the same document without it, sought the same
//     way: where the projection lies outside the safe frame the two have one pixel hash (the label and its leader draw
//     nothing); where it lies inside, the leader's end draws there (a pixel of the 3 × 3 around the one holding the
//     projection differs by 48 code values or more);
//   - the document without the label, sought through the 200 frames with `counts`: at every sampled frame the wire's
//     segments are [fixed point, anchor] and [anchor, fixed point], each anchor within 1e-6 m of lid#hinge's world place.
// Guards on the fixture: every sampled projection in front of the camera and at least 0.5 px from the safe frame's
// edge; at least 20 frames inside and 20 outside; inside, the projection at least 30 px clear of the label's frame.
// Wrong programs: the base (an overlay must name an item to anchor to, so the label is refused; a line's `lid#hinge`
// is the lid's origin and its segments aren't reported); a leader or a line on the lid's rest pose, on its origin, or on
// the previous frame's camera; a label that hides on the frame's edge, or only behind the camera; a seek that differs
// from play.
import { describe, expect, it } from 'vitest';
import {
  AC3, GRID, LABEL_RECT, SAMPLES, TIMEOUT, WIRE, codeOff, dist3, finalOf, fmt, framesOf, hingeAt, hingeOpen, labelRow,
  lidDoc, lidOriginAt, none, played, projAt, px, requireGpu, runGpu, safeMargin, segmentsOf, sought, useBins, useDir,
  view3d, writeJson, type Frame,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();

/** Where the anchor projects at each sampled frame, and whether that is inside the safe frame. */
const want = new Map(SAMPLES.map((n) => {
  const p = projAt(n, hingeAt(n));
  return [n, { ...p, inside: safeMargin(p.x, p.y) > 0 }] as const;
}));

/** The fixture's guards: they hold of the numbers above, whatever the program does. */
function guards(): void {
  expect(new Set(SAMPLES).size === 200 && SAMPLES.every((n) => Number.isInteger(n) && n >= 0 && n < GRID), 'the fixture: 200 distinct frames of the 4 s grid').toBe(true);
  const inside = SAMPLES.filter((n) => want.get(n)!.inside);
  for (const n of SAMPLES) {
    const p = want.get(n)!;
    expect(p.depth, `the fixture: lid#hinge is in front of the camera at frame ${n}`).toBeGreaterThan(0.1);
    expect(Math.abs(safeMargin(p.x, p.y)), `the fixture: at frame ${n} lid#hinge projects at least 0.5 px from the safe frame's edge, (${fmt(p.x, 3)}, ${fmt(p.y, 3)})`).toBeGreaterThanOrEqual(0.5);
  }
  expect(inside.length, 'the fixture: at least 20 sampled frames put lid#hinge inside the safe frame').toBeGreaterThanOrEqual(20);
  expect(SAMPLES.length - inside.length, 'the fixture: at least 20 sampled frames put lid#hinge outside the safe frame').toBeGreaterThanOrEqual(20);
  const [lx, ly, lw, lh] = LABEL_RECT;
  for (const n of inside) {
    const p = want.get(n)!;
    const clear = Math.hypot(Math.max(lx - p.x, 0, p.x - lx - lw), Math.max(ly - p.y, 0, p.y - ly - lh));
    expect(clear, `the fixture: at frame ${n} lid#hinge projects 30 px or more clear of the label's frame`).toBeGreaterThanOrEqual(30);
  }
  // A leader drawn to the lid's rest pose, or to its origin, misses by far more than 0.5 px somewhere.
  const miss = (f: (n: number) => [number, number, number]): number => Math.max(...inside.map((n) => { const a = projAt(n, f(n)); const b = want.get(n)!; return Math.hypot(a.x - b.x, a.y - b.y); }));
  expect(miss(() => hingeOpen(0)), "the fixture: the lid's opening moves lid#hinge's projection by more than 10 px").toBeGreaterThan(10);
  expect(miss(lidOriginAt), "the fixture: the lid's origin projects more than 10 px from lid#hinge").toBeGreaterThan(10);
}

/** The label's rows in one run against the anchor's projections. */
function rowProblems(frames: readonly Frame[], what: string): string[] {
  const failures: string[] = [];
  for (const f of frames) {
    if (!want.has(f.frame)) continue;
    const p = want.get(f.frame)!;
    const at = `${what}, frame ${f.frame}`;
    const row = labelRow(f.raw, at);
    if (row.problem) { failures.push(row.problem); continue; }
    if (!p.inside) {
      if (row.at !== null || row.to !== null) failures.push(`${at}: lid#hinge projects outside the safe frame at (${fmt(p.x)}, ${fmt(p.y)}), but the label is shown (at ${JSON.stringify(row.at)}, leader to ${JSON.stringify(row.to)})`);
    } else if (row.at === null || row.to === null) {
      failures.push(`${at}: lid#hinge projects inside the safe frame at (${fmt(p.x)}, ${fmt(p.y)}), but the label ${row.at === null ? 'is hidden' : 'has no leader'}`);
    } else {
      const off = Math.hypot(row.to[0] - p.x, row.to[1] - p.y);
      if (off > 0.5) failures.push(`${at}: the leader ends at (${fmt(row.to[0], 3)}, ${fmt(row.to[1], 3)}), ${fmt(off, 3)} px from lid#hinge's projection (${fmt(p.x, 3)}, ${fmt(p.y, 3)})`);
    }
  }
  return failures;
}

describe(`${AC3} a leader and a wire on lid#hinge while the lid opens and the camera orbits`, () => {
  it(`${AC3} the label's leader ends within 0.5 px of lid#hinge's projection at 200 random times, seeked and played have one pixel hash, and it hides exactly where the projection leaves the safe frame`, () => {
    requireGpu();
    guards();
    const out = dir();
    const label = writeJson(out, 'label', lidDoc(true));
    const bare = writeJson(out, 'bare', lidDoc(false));
    const replies = runGpu(bin('deep-gpu'), out, [
      view3d(label, { ...played(), overlays: true }),
      view3d(label, { ...sought(), overlays: true, capture: 'every' }),
      view3d(bare, { ...sought(), capture: 'every' }),
    ]);
    const [play, seek, plain] = [framesOf(replies[0]!, 'the label played'), framesOf(replies[1]!, 'the label sought'), framesOf(replies[2]!, 'the lid without the label, sought')];
    expect(play.map((f) => f.frame), 'the played run draws frames 0 … through the last sampled one in turn').toEqual(Array.from({ length: Math.max(...SAMPLES) + 1 }, (_, n) => n));
    expect(seek.map((f) => f.frame), 'the sought run draws the 200 sampled frames in drawing order').toEqual(SAMPLES);
    expect(plain.map((f) => f.frame), 'the run without the label draws the 200 sampled frames in drawing order').toEqual(SAMPLES);
    const failures = [...rowProblems(play, 'played'), ...rowProblems(seek, 'sought')];
    const byFrame = (frames: readonly Frame[]): Map<number, Frame> => new Map(frames.map((f) => [f.frame, f]));
    const [playAt, plainAt] = [byFrame(play), byFrame(plain)];
    for (const s of seek) {
      const p = want.get(s.frame)!;
      const hash = s.raw['pixel_hash'];
      if (typeof hash !== 'string') { failures.push(`sought frame ${s.frame}: no pixel hash`); continue; }
      const ph = playAt.get(s.frame)!.raw['pixel_hash'];
      if (ph !== hash) failures.push(`frame ${s.frame}: sought it hashes ${hash}, played ${String(ph)}`);
      const bare0 = plainAt.get(s.frame)!;
      if (!p.inside) {
        if (bare0.raw['pixel_hash'] !== hash) failures.push(`frame ${s.frame}: lid#hinge projects outside the safe frame at (${fmt(p.x)}, ${fmt(p.y)}), but the frame with the label hashes ${hash} and without it ${String(bare0.raw['pixel_hash'])}: the label or its leader draws`);
        continue;
      }
      const [withLabel, without] = [finalOf(out, s, `sought frame ${s.frame}`), finalOf(out, bare0, `frame ${s.frame} without the label`)];
      const cx = Math.floor(p.x); const cy = Math.floor(p.y);
      let most = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) most = Math.max(most, codeOff(px(withLabel, cx + dx, cy + dy), px(without, cx + dx, cy + dy)));
      if (most < 48) failures.push(`frame ${s.frame}: around lid#hinge's projection (${fmt(p.x)}, ${fmt(p.y)}) the frame with the label differs from the frame without it by at most ${most} code values: the leader's end doesn't draw there`);
    }
    none(failures, "the label's leader on lid#hinge through the lid's opening and the orbit, seeked and played");
  }, TIMEOUT);

  it(`${AC3} a 3D line with one point at lid#hinge passes through that anchor at every sampled time`, () => {
    requireGpu();
    guards();
    const out = dir();
    const [reply] = runGpu(bin('deep-gpu'), out, [view3d(writeJson(out, 'bare', lidDoc(false)), { ...sought(), counts: true })]);
    const frames = framesOf(reply!, 'the lid and its wire, sought');
    expect(frames.map((f) => f.frame), 'the run draws the 200 sampled frames in drawing order').toEqual(SAMPLES);
    const failures: string[] = [];
    for (const f of frames) {
      const at = `frame ${f.frame}`;
      const { segments, problem } = segmentsOf(f.raw, 'wire', at);
      if (problem) { failures.push(problem); continue; }
      if (segments.length !== 2) { failures.push(`${at}: the wire draws ${segments.length} segments, not 2`); continue; }
      const h = hingeAt(f.frame);
      const ends: [string, [number, number, number], [number, number, number]][] = [
        ['its first point', segments[0]![0], WIRE[0]], ['lid#hinge (segment 1)', segments[0]![1], h],
        ['lid#hinge (segment 2)', segments[1]![0], h], ['its last point', segments[1]![1], WIRE[1]],
      ];
      for (const [name, got, place] of ends) {
        const off = dist3(got, place);
        if (off > 1e-6) failures.push(`${at}: the wire's ${name} is at (${got.map((v) => fmt(v, 6)).join(', ')}) m, ${off.toExponential(2)} m from (${place.map((v) => fmt(v, 6)).join(', ')})`);
      }
    }
    none(failures, 'the wire passes through lid#hinge at every sampled time');
  }, TIMEOUT);
});
