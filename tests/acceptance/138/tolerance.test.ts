// #138.11bef137: every tolerance class "within N code values on P% of pixels" also names a ceiling and a bound
// on the pixels off in any small window, each with its size and reason, per fixture. The comparator
// (`compare_images`) is held to a fixture of one code value on 99.9% of a 1920 × 1080 frame with a ceiling of
// 16 and at most 64 pixels off in any 16 × 16 window; the planted output holds a 40 × 40 block 64 code values off
// at (1000, 500), which meets the percentage. The bounds are walked one below, at and one above, as Skia
// Gold's fuzzy and sample-area matcher tests walk theirs (the Oracle page's upstream tests, ported; their files
// aren't in this checkout). At the base there is no `compare_images` or `kit` call and no `test-kit-loose`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cloneImage, expectFailure, failuresIn, image, kit, moduleOf, nudge, num, obj, run, scenario, show, useBuilds, useEvidence, writePng,
  type Build, type Image, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const LOOSE: Build = { set: 'full', with: ['test-kit-loose'] };
const builds = useBuilds([FULL, LOOSE]);
const evidence = useEvidence();

const W = 1920;
const H = 1080;
const TOLERANCE: JsonObject = {
  within: 1, on: 99.9, ceiling: 16, window: { size: 16, off: 64 },
  reason: 'antialiased edges may move one code value; a status dot or a missing glyph must not hide in the share',
};
const ALLOWED = Math.floor(W * H * 0.001); // 2073 pixels may be off
const BASE = image(W, H, [128, 128, 128, 255]);

interface Compared { verdict: string; off: number; allowed: number; first: JsonObject | null; window: JsonObject | null; raw: JsonObject }
/** Writes both images and asks `compare_images` to judge them under `tolerance`. */
function compare(actual: Image, planted?: string, tolerance: JsonObject = TOLERANCE): Compared {
  const expected = join(evidence(), 'expected.png');
  const got = join(evidence(), 'actual.png');
  writePng(expected, BASE);
  writePng(got, actual);
  const [reply] = run(builds.bin(FULL), scenario(evidence(), [{ call: 'compare_images', expected, actual: got, tolerance }], planted ? { planted } : {}));
  const r = reply!;
  return {
    verdict: String(r['verdict']), off: num(r['off'], 'off'), allowed: num(r['allowed'], 'allowed'),
    first: r['first_past_ceiling'] === null || r['first_past_ceiling'] === undefined ? null : obj(r['first_past_ceiling'], 'first_past_ceiling'),
    window: r['window'] === null || r['window'] === undefined ? null : obj(r['window'], 'window'),
    raw: r,
  };
}
/** A 40 × 40 block at (1000, 500), 64 code values off in red. */
function block(): Image {
  const im = cloneImage(BASE);
  for (let y = 500; y < 540; y++) for (let x = 1000; x < 1040; x++) nudge(im, x, y, 64);
  return im;
}
/** How many pixels of `im` are off (any channel past `within`) in the window at (x, y) of `size`. */
function offIn(im: Image, x: number, y: number, size: number): number {
  let n = 0;
  for (let j = y; j < Math.min(y + size, im.h); j++) {
    for (let i = x; i < Math.min(x + size, im.w); i++) {
      const k = (j * im.w + i) * 4;
      if ([0, 1, 2, 3].some((c) => Math.abs(im.data[k + c]! - BASE.data[k + c]!) > 1)) n++;
    }
  }
  return n;
}

/** This test's check of the block: the failures it finds, empty when it fails naming the pixel and a window past the bound. */
function blockFailures(c: Compared, im: Image): string[] {
  const out: string[] = [];
  if (c.verdict !== 'FAIL') out.push(`the block reads ${c.verdict}, not FAIL`);
  if (c.off > c.allowed) out.push(`the block's ${c.off} pixels off should meet the share (${c.allowed} allowed)`);
  if (!c.first || c.first['x'] !== 1000 || c.first['y'] !== 500 || c.first['delta'] !== 64) out.push(`the first pixel past the ceiling is (1000, 500), 64 off: got ${show(c.first)}`);
  if (!c.window) out.push('no window named');
  else {
    const [x, y, size, off] = [Number(c.window['x']), Number(c.window['y']), Number(c.window['size']), Number(c.window['off'])];
    if (size !== 16) out.push(`the window's size is the fixture's 16, got ${size}`);
    if (off <= 64) out.push(`the named window holds ${off} pixels off, not past the bound of 64`);
    if (offIn(im, x, y, size) !== off) out.push(`the window at (${x}, ${y}) holds ${offIn(im, x, y, size)} pixels off, not the ${off} it says`);
  }
  return out;
}

describe('#138.11bef137 a tolerance class with a share also names a ceiling and a window bound; a comparator that checks only the share fails this test', () => {
  it('#138.11bef137 on a fixture held to one code value on 99.9% of 1920 × 1080, a 40 × 40 block 64 code values off meets the share but fails, naming the first pixel past the ceiling and the window', () => {
    const im = block();
    const c = compare(im);
    expect(c.allowed, '0.1% of 1920 × 1080 pixels may be off').toBe(ALLOWED);
    expect(c.off, 'the block\'s 1,600 pixels are off').toBe(1_600);
    expect(blockFailures(c, im)).toEqual([]);
  }, 600_000);

  it('#138.11bef137 a comparator that checks only the percentage (checks_share_only) passes the block, and this test\'s check rejects it', () => {
    const im = block();
    expect(blockFailures(compare(im, 'checks_share_only'), im).length, 'the check catches the planted comparator').toBeGreaterThan(0);
  }, 600_000);

  it('#138.11bef137 the ceiling, walked one below, at and one above: one pixel 15, 16 or 17 code values off', () => {
    for (const [delta, verdict] of [[15, 'PASS'], [16, 'PASS'], [17, 'FAIL']] as const) {
      const im = cloneImage(BASE);
      nudge(im, 300, 200, delta);
      const c = compare(im);
      expect(c.verdict, `one pixel ${delta} off against a ceiling of 16`).toBe(verdict);
      if (verdict === 'FAIL') expect(c.first, 'naming the pixel').toEqual({ x: 300, y: 200, delta: 17 });
      else expect(c.first, 'no pixel past the ceiling').toBeNull();
    }
  }, 600_000);

  it('#138.11bef137 the share, walked one below, at and one above: 2,072, 2,073 and 2,074 sparse pixels 2 code values off; and a whole frame one value off is within', () => {
    for (const [n, verdict] of [[ALLOWED - 1, 'PASS'], [ALLOWED, 'PASS'], [ALLOWED + 1, 'FAIL']] as const) {
      const im = cloneImage(BASE);
      let placed = 0;
      for (let y = 5; y < H && placed < n; y += 30) for (let x = 5; x < W && placed < n; x += 30) { nudge(im, x, y, 2); placed++; }
      expect(placed, 'the sparse pixels fit on a 30 px grid').toBe(n);
      const c = compare(im);
      expect([c.off, c.verdict, c.window], `${n} sparse pixels off`).toEqual([n, verdict, null]);
    }
    const one = cloneImage(BASE);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) nudge(one, x, y, 1);
    const c = compare(one);
    expect([c.off, c.verdict], 'one code value off everywhere is within').toEqual([0, 'PASS']);
  }, 600_000);

  it('#138.11bef137 the window bound, walked one below, at and one above: 63, 64 and 65 dense pixels 2 code values off', () => {
    for (const [n, verdict] of [[63, 'PASS'], [64, 'PASS'], [65, 'FAIL']] as const) {
      const im = cloneImage(BASE);
      const square = Array.from({ length: 64 }, (_, k) => [100 + (k % 8), 100 + Math.floor(k / 8)] as const);
      const points = n === 65 ? [...square, [108, 100] as const] : square.slice(0, n);
      for (const [x, y] of points) nudge(im, x, y, 2);
      const c = compare(im);
      expect(c.verdict, `${n} pixels off in one small area against a window bound of 64`).toBe(verdict);
      if (verdict === 'FAIL') {
        expect(c.window, 'naming the window').not.toBeNull();
        expect(Number(c.window!['off']), 'the window holds 65').toBe(65);
        expect(offIn(im, Number(c.window!['x']), Number(c.window!['y']), 16), 'the window it names holds them').toBe(65);
      } else expect(c.window).toBeNull();
    }
  }, 600_000);

  it('#138.11bef137 a tolerance class missing its ceiling, its window or its reason fails the kit, naming the fixture and what it lacks', () => {
    const r = kit(builds.bin(LOOSE), evidence(), { modules: ['test.kit.loose'], parts: ['fixtures'] });
    const m = moduleOf(r, 'test.kit.loose');
    expect(m.verdict).toBe('FAIL');
    const failures = failuresIn(m, 'fixtures');
    for (const [name, missing] of [['no-ceiling', 'ceiling'], ['no-window', 'window'], ['no-reason', 'reason']] as const) {
      const f = expectFailure(failures, 'tolerance', { fixture: `parity/kernel/loose-${name}.board` }, `the fixture without its ${missing}`);
      expect(f['missing'], `it names the ${missing}`).toEqual([missing]);
    }
  }, 1_800_000);
});
