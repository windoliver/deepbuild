// AC3: "zigzag with 5 ridges on a 4-segment path builds the 24 segments computed before the build, as Lottie's zig
// zag with 5 ridges per segment does, and a repeater whose computed segments pass 50,000 is refused before anything
// builds, naming the op"
//
// Through `path` (`segments`, `declared`, `subpaths`), `check` and `raster`. Lottie's zig zag splits each segment
// into ridges + 1 pieces (Path: ops: "(ridges + 1) × segments, since its ridges split each segment, as Lottie's zig
// zag draws them"), so 5 ridges on 4 segments is 6 × 4 = 24. The repeater's count is ⌈copies⌉ × segments: 64 copies
// of a 1,000-segment path is 64,000, past the 50,000 a path may build; 50 copies is exactly 50,000 and builds. The
// refusal is the check's, which runs before anything is built; its code is this suite's `segment_budget` (the design
// names none; README: Readings), its error names the item at the op's path and carries the computed count.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, check, errorsOf, expectRefused, figure, numbersIn, pathAt, pathItem, pathRaw, rasterInput, scratch,
  segmentCount, useRenderBinary, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('segments');

const zigzag = figure('segments-zigzag', [400, 400], [
  pathItem('zz', 'a0', 'M 40 40 L 140 40 L 140 140 L 240 140 L 240 240', { ops: [{ zigzag: { size: 8, ridges: 5, points: 'corner' } }] }),
]);

/** A polyline of 1,000 segments, a zig zag of steps 0.3 u wide, and a repeater of `copies` copies after it. */
function thousand(copies: number): JsonObject {
  const pts = Array.from({ length: 1001 }, (_, i) => `${(20 + i * 0.3).toFixed(1)} ${i % 2 ? 30 : 20}`);
  return figure('segments-repeater', [400, 400], [
    pathItem('big', 'a0', `M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(' ')}`, { ops: [{ repeater: { copies, at: { pos: [0, 5] } } }], paint: { stroke: { role: 'ink', width: 1 } } }),
  ]);
}

describe('AC3 segment counts computed from params before anything builds', () => {
  it('AC3 zigzag with 5 ridges on a 4-segment path builds the 24 segments computed before the build, as Lottie\'s zig zag does', () => {
    const f = pathAt(zigzag, 'zz', 'the zig zag');
    expect(f.declared, 'the count computed from params: (5 + 1) × 4').toBe(24);
    expect(f.segments, 'the segments built').toBe(24);
    expect(segmentCount(f.subpaths), 'the output\'s own segments (every L, Q and C)').toBe(24);
    expect(f.subpaths.length, 'one sub-path').toBe(1);
  }, TIMEOUT);

  it('AC3 a repeater whose computed segments pass 50,000 is refused before anything builds, naming the op', () => {
    const over = thousand(64);
    const result = check(over);
    const errors = errorsOf(result);
    expect(errors.map((e) => e.code), 'the only error is the segment budget').toEqual(['segment_budget']);
    const e = errors[0]!;
    expect(e.ids, 'it names the item').toContain('big');
    expect(e.path.startsWith('items/big/params/ops/0'), `it names the op, items/big/params/ops/0, got ${e.path}`).toBe(true);
    expect(numbersIn(e.raw), `it carries the computed count, 64 × 1,000 = 64,000: ${JSON.stringify(e.raw).slice(0, 600)}`).toContain(64_000);
    const refused = pathRaw({ doc: over, item: 'big' });
    expect([refused['ok'], refused['code']], 'path refuses it with the check\'s code and builds no frame').toEqual([false, 'segment_budget']);
    expect(refused['frames'], 'no frame was built').toBeUndefined();
    expectRefused('raster', rasterInput(dir, over), 'segment_budget', 'the repeater would build 64,000 segments');

    // Exactly 50,000 is within the budget, and builds what it declared.
    const at = thousand(50);
    expect(errorsOf(check(at)).map((x) => x.code), '50 copies of 1,000 segments, exactly 50,000, passes').toEqual([]);
    const f = pathAt(at, 'big', 'the 50-copy repeater');
    expect([f.declared, f.segments], 'it declares and builds 50,000 segments').toEqual([50_000, 50_000]);
  }, TIMEOUT);
});
