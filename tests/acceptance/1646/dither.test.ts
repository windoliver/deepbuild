// AC1 #1646.23206300: "A dither fill between two roles over a gradient covers, in each 4 × 4 block, exactly the pixels
// whose matrix entry is below the gradient's step, the same on two GPUs and at every t, and a fill naming a status role
// is refused at check"
//
// One rect@1, `plate`, box [64, 32, 64, 32] in a 192 × 96 figure on white, filled with `dither {stops: [lo, hi],
// matrix: 4, by: gradient, anchor: world}` (README: The surface under test). The gradient is the item box's default,
// 0 at its west edge and 1 at its east; its step at a pixel is ⌊16 × v⌋, v taken at the pixel's centre, so the 4 × 4
// block k columns from the west (x = 64 + 4k … 67 + 4k) has step k everywhere in it, k = 0 … 15. The matrix is read at
// the pixel's world (here frame) coordinate, BAYER4[y mod 4][x mod 4]. Each pixel of the plate must be exactly `hi`
// where that entry is below k and exactly `lo` elsewhere, so block k holds hi in exactly k of its 16 pixels.
// At every t: played at 24 fps, frames 0, 23 and 59 (0, 0.96 s, 2.46 s), and frame 41 opened cold (1.71 s).
// Two GPUs: the coverage mask's SHA-256, recorded, BLOCKED with one unblock ask where only one GPU exists.
// Status: the document check (`deep-canvas-render check`, as #149's noise fill's status ramp is checked) refuses the same
// fill with stops [status.fail, hi], `status_color_unbound` naming item `plate`, and checks it clean with [lo, hi].
import { describe, expect, it } from 'vitest';
import {
  AC, BAYER4, type Image, type JsonObject, doc2d, film2d, frameAt, hex, item, lines, look2d, none, obj, pixel, readFinal, requireGpu, runGpu,
  sameOnTwoGpus, sha256, shown, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu', 'deep-canvas-render']);
const out = useOut();
const COLORS = { lo: '#1f3a5f', hi: '#f2c14e' };
const BOX = { x: 64, y: 32, w: 64, h: 32 };
const dither = (stops: string[]): JsonObject => ({ dither: { stops, matrix: 4, by: 'gradient', anchor: 'world' } });
const docWith = (id: string, stops: string[]): JsonObject =>
  doc2d(id, [192, 96], [item('plate', 'rect@1', 'a0', { box: [BOX.x, BOX.y, BOX.w, BOX.h], paint: { fill: dither(stops) } })]);
const DOC = docWith('dither-1646', ['lo', 'hi']);
const LOOK = look2d('dither-1646', COLORS);

/** The gradient's step at column x: ⌊16 × v⌋ with v at the pixel's centre, 0 at the box's west edge, 1 at its east. */
const stepAt = (x: number): number => Math.min(16, Math.floor((16 * (x - BOX.x + 0.5)) / BOX.w));

/** Every plate pixel against the matrix and the step, block by block; and the mask's hash (h, l or ? per pixel). */
function coverage(img: Image, what: string): { problems: string[]; mask: string } {
  const problems: string[] = [];
  let mask = '';
  for (let y = BOX.y; y < BOX.y + BOX.h; y++) for (let x = BOX.x; x < BOX.x + BOX.w; x++) {
    const c = hex(pixel(img, x, y));
    mask += c === COLORS.hi ? 'h' : c === COLORS.lo ? 'l' : '?';
  }
  for (let by = BOX.y; by < BOX.y + BOX.h; by += 4) for (let bx = BOX.x; bx < BOX.x + BOX.w; bx += 4) {
    const k = stepAt(bx);
    let his = 0; const wrong: string[] = [];
    for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) {
      const m = BAYER4[y % 4]![x % 4]!;
      const want = m < k ? COLORS.hi : COLORS.lo;
      const got = hex(pixel(img, x, y));
      if (got === COLORS.hi) his++;
      if (got !== want) wrong.push(`(${x}, ${y}) draws ${got}, not ${want === COLORS.hi ? 'hi' : 'lo'} ${want} (matrix entry ${m}, step ${k})`);
    }
    if (wrong.length) problems.push(`${what}: the 4 × 4 block at (${bx}, ${by}), the gradient's step ${k}, covers ${his} of 16 pixels with hi, not the ${k} whose matrix entry is below ${k}: ${wrong.slice(0, 3).join('; ')}`);
  }
  return { problems, mask: sha256(mask) };
}

function played(): { problems: string[]; masks: string[] } {
  requireGpu();
  const [play, seek] = runGpu(bins.bin('deep-gpu'), out(), [
    film2d(DOC, LOOK, { fps: 24, frames: 60, capture: [0, 23, 59] }),
    film2d(DOC, LOOK, { fps: 24, from: 41, frames: 1, capture: [41] }),
  ]);
  const runs = [[play!, 0, 'played, frame 0'], [play!, 23, 'played, frame 23 (0.96 s)'], [play!, 59, 'played, frame 59 (2.46 s)'], [seek!, 41, 'opened at frame 41 (1.71 s)']] as const;
  const problems: string[] = []; const masks: string[] = [];
  for (const [reply, n, what] of runs) {
    const c = coverage(readFinal(out(), frameAt(reply, n, what), what), what);
    problems.push(...c.problems); masks.push(c.mask);
  }
  return { problems, masks };
}

const check = (doc: JsonObject): JsonObject => lines(bins.bin('deep-canvas-render'), ['check'], [{ doc, look: LOOK }])[0]!;
const errorsOf = (answer: JsonObject): JsonObject[] =>
  (Array.isArray(answer['issues']) ? answer['issues'] : []).map((v) => obj(v, 'an issue')).filter((i) => i['severity'] === 'error');

describe(`${AC[1]} a dither fill: an ordered threshold on the gradient's step, integer, still, and never a status role`, () => {
  it(`${AC[1]} between two roles over a gradient, each 4 × 4 block covers exactly the pixels whose matrix entry is below the gradient's step, at every t`, () => {
    const { problems, masks } = played();
    none(problems, `${AC[1]} the dither fill's coverage`);
    expect(new Set(masks).size, `the plate covers the same pixels at 0, 0.96 s, 2.46 s and opened at 1.71 s: ${masks.join(', ')}`).toBe(1);
  });

  it(`${AC[1]} a dither fill naming a status role is refused at check, naming the item; the same fill between two data roles checks`, () => {
    const bad = check(docWith('dither-status-1646', ['status.fail', 'hi']));
    const errors = errorsOf(bad);
    expect(errors.map((e) => e['code']), `the status-color rule refuses the fill: ${shown(bad)}`).toContain('status_color_unbound');
    const refusal = errors.find((e) => e['code'] === 'status_color_unbound')!;
    expect(shown(refusal['ids']), `the refusal names the item plate: ${shown(refusal)}`).toContain('"plate"');
    const good = check(DOC);
    expect(errorsOf(good), `the fill between lo and hi checks: ${shown(good)}`).toEqual([]);
    expect(good['ok'], `the fill between lo and hi is accepted: ${shown(good)}`).toBe(true);
  });

  it(`${AC[1]} the dither fill covers the same pixels on two GPUs`, () => {
    const { problems, masks } = played();
    none(problems, `${AC[1]} the dither fill's coverage on this GPU`);
    sameOnTwoGpus('dither', { dither: masks[0]! }, `${AC[1]} the dither fill`);
  });
});
