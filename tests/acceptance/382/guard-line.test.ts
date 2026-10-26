// #382.5bb38907: The guard moves a pixel along the OKLab line from the nearest status color through it to the look's
// distance, gamut-clipped and checked again against every status color: a pixel 0.05 from fail red lands 0.10 from
// it within 0.002, and one 0.12 away keeps its value; of 10,000 seeded pixels near each status color none ends
// within the distance; a planted guard that maps to grey passes the second test and fails the first, naming the pixel.
// The `guard` call runs the status guard's pass on this machine's GPU over an f32 image of display-referred,
// sRGB-encoded pixels, as the finished frame of a document where status can show, and writes the result as an f32
// target. The image is 300 × 301: pixel (0, 0) is fail red moved 0.05 along +L in OKLab, (1, 0) the same moved 0.12,
// then 10,000 pixels near each of the nine status colors from this suite's seeded sampler (LCG seed 382: a direction
// uniform over the sphere, a distance uniform in [0, 0.10), gamut-clipped before they are fed), then black. Expected
// values come from this suite's f64 OKLab math (helpers.ts `guardExpected`): the line from the nearest status color
// through the pixel to the distance, clamped to the gamut. Tolerances: the landing distance within 0.002 of 0.10 (the
// issue); the landing point within 0.002 OKLab of the predicted one where the line stays in gamut and keeps the
// distance from every other status color (README: Readings); an untouched pixel within 1e-4 per channel (f32); no
// moved pixel under 0.10 − 0.0005 from any status color (f32 round-off of a pixel at the distance). `pixels_moved`
// equals the count of inputs inside the distance. At the base there is no guard call; `--planted guard_to_grey`
// moves every clashing pixel to the achromatic OKLab (0.80, 0, 0).
import { describe, expect, it } from 'vitest';
import {
  DISTANCE, SEED, STATES, STATUS, Lcg, alongL, answered, deltaE, deltaEOk, encodedToOklab, fromHex, guardExpected, hex, look3, num, oklab8, oklabToEncoded, readF32, requireGpu,
  run1, seededNear, statusColors, to8, useBin, useOut, writeF32, type F32, type Lin, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

const COLORS = statusColors();
const LOOK = look3('guard-382', {});
const SIZE: [number, number] = [300, 301];
const PER_COLOR = 10_000;
const FAIL = fromHex(STATUS.fail);
const FAIL_LAB = oklab8(FAIL);

/** The input image: (0, 0) and (1, 0) the two named pixels (exact OKLab points along +L, not rounded to 8 bits), then the seeded ones, then black. */
function input(): { image: F32; pixels: Lin[]; nearName: (i: number) => string } {
  const pixels: Lin[] = [];
  const lighter = (d: number): Lin => oklabToEncoded([FAIL_LAB[0] + d, FAIL_LAB[1], FAIL_LAB[2]]);
  pixels.push(lighter(0.05), lighter(0.12));
  const rng = new Lcg(SEED);
  for (const s of STATES) pixels.push(...seededNear(rng, COLORS[s], PER_COLOR, DISTANCE));
  const rgba = new Float32Array(SIZE[0] * SIZE[1] * 4);
  for (let i = 0; i < SIZE[0] * SIZE[1]; i++) {
    const p = pixels[i] ?? [0, 0, 0];
    rgba[i * 4] = p[0]; rgba[i * 4 + 1] = p[1]; rgba[i * 4 + 2] = p[2]; rgba[i * 4 + 3] = 1;
  }
  const nearName = (i: number): string => (i < 2 ? `the pixel ${i === 0 ? '0.05' : '0.12'} from fail` : `seeded pixel ${i - 2} (near ${STATES[Math.floor((i - 2) / PER_COLOR)]})`);
  return { image: { width: SIZE[0], height: SIZE[1], rgba }, pixels, nearName };
}

interface Result { output: F32; moved: number }
function guard(startup: Startup, image: F32): Result {
  const bin = bins.bin();
  const path = writeF32(out(), `guard-input-${startup.planted ?? 'real'}`, image);
  const reply = answered(run1(bin, out(), { call: 'guard', look: LOOK, theme: 'light', size: SIZE, input: path }, startup), 'the guard call');
  const colors = reply['colors'];
  expect(colors && typeof colors === 'object', 'the guard reports the status map it used').toBeTruthy();
  for (const s of STATES) expect(hex(to8((colors as Record<string, Lin>)[s] ?? [0, 0, 0]).map((v) => v) as [number, number, number]), `the guard's ${s} color is the look's`).toBe(STATUS[s]);
  expect(num(reply['distance'], 'guard: distance'), 'the guard uses the look\'s distance').toBeCloseTo(DISTANCE, 9);
  const hash = reply['output'];
  return { output: readF32(out(), typeof hash === 'string' ? hash : null, SIZE, 'the guard\'s output'), moved: num(reply['pixels_moved'], 'guard: pixels_moved') };
}
const at = (f: F32, i: number): Lin => [f.rgba[i * 4]!, f.rgba[i * 4 + 1]!, f.rgba[i * 4 + 2]!];

/** The first test: the pixel 0.05 from fail lands 0.10 from it, along the line, and the one 0.12 away keeps its value. */
function lineCheck(r: Result, pixels: Lin[]): string[] {
  const failures: string[] = [];
  const p0 = at(r.output, 0); const d0 = deltaE(encodedToOklab(p0), FAIL_LAB);
  if (Math.abs(d0 - DISTANCE) > 0.002) failures.push(`pixel (0, 0), 0.05 from fail, lands ${d0.toFixed(4)} from it (${JSON.stringify(p0)}), not ${DISTANCE} within 0.002`);
  const want = guardExpected(pixels[0]!, COLORS, DISTANCE);
  const off = deltaE(encodedToOklab(p0), encodedToOklab(want.expected));
  if (off > 0.002) failures.push(`pixel (0, 0) lands ${off.toFixed(4)} OKLab from the point on the line from fail through it (${JSON.stringify(want.expected)}), not within 0.002`);
  const p1 = at(r.output, 1);
  const keep = Math.max(...p1.map((v, c) => Math.abs(v - pixels[1]![c]!)));
  if (keep > 1e-4) failures.push(`pixel (1, 0), 0.12 from fail, changed from ${JSON.stringify(pixels[1])} to ${JSON.stringify(p1)}`);
  return failures;
}
/** The second test: none of the 10,000 seeded pixels near each status color ends within the distance; the rest of the rule. */
function seededCheck(r: Result, pixels: Lin[], nearName: (i: number) => string): string[] {
  const failures: string[] = [];
  const labs = STATES.map((s) => [s, oklab8(COLORS[s])] as const);
  let moved = 0; let within = 0; let offLine = 0; let changed = 0; let predicted = 0;
  let firstWithin = ''; let firstOff = ''; let firstChanged = '';
  for (let i = 2; i < pixels.length; i++) {
    const want = guardExpected(pixels[i]!, COLORS, DISTANCE);
    const got = at(r.output, i); const lab = encodedToOklab(got);
    if (want.moved) moved++;
    for (const [s, l] of labs) { const d = deltaE(lab, l); if (d < DISTANCE - 0.0005) { within++; if (!firstWithin) firstWithin = `${nearName(i)} = ${JSON.stringify(got)} ends ${d.toFixed(4)} from ${s}`; break; } }
    if (!want.moved) {
      const k = Math.max(...got.map((v, c) => Math.abs(v - pixels[i]![c]!)));
      if (k > 1e-4) { changed++; if (!firstChanged) firstChanged = `${nearName(i)} (${want.before.toFixed(4)} from ${want.nearest}) changed from ${JSON.stringify(pixels[i])} to ${JSON.stringify(got)}`; }
    } else if (!want.clipped && want.clear) {
      predicted++;
      const off = deltaE(lab, encodedToOklab(want.expected));
      if (off > 0.002) { offLine++; if (!firstOff) firstOff = `${nearName(i)} lands ${off.toFixed(4)} from the line's point ${JSON.stringify(want.expected)} (got ${JSON.stringify(got)})`; }
    }
  }
  if (within > 0) failures.push(`${within} of ${pixels.length - 2} seeded pixels end within ${DISTANCE} of a status color; first: ${firstWithin}`);
  if (changed > 0) failures.push(`${changed} seeded pixels already at the distance changed; first: ${firstChanged}`);
  if (offLine > 0) failures.push(`${offLine} of ${predicted} seeded pixels whose line stays in gamut land off the line from their nearest status color; first: ${firstOff}`);
  if (r.moved !== moved + 1) failures.push(`pixels_moved is ${r.moved}; ${moved + 1} inputs lie inside the distance`);
  if (predicted < 20_000) failures.push(`only ${predicted} seeded pixels have an in-gamut, clear landing point; the sampler gives about 30,000 of 90,000 (the saturated status colors sit near the gamut's edge)`);
  return failures;
}

describe('#382.5bb38907 the guard moves a pixel along the OKLab line from the nearest status color to the distance', () => {
  it('#382.5bb38907 the sampler is deterministic from seed 382 and the named pixels sit 0.05 and 0.12 from fail', () => {
    const a = input(); const b = input();
    expect(a.image.rgba, 'two samplings from the seed are equal').toEqual(b.image.rgba);
    expect(deltaE(encodedToOklab(a.pixels[0]!), FAIL_LAB)).toBeCloseTo(0.05, 4);
    expect(deltaE(encodedToOklab(a.pixels[1]!), FAIL_LAB)).toBeCloseTo(0.12, 4);
    expect(guardExpected(a.pixels[0]!, COLORS, DISTANCE).clipped, 'the first pixel\'s line stays in gamut').toBe(false);
    const inside = a.pixels.slice(2).filter((p) => guardExpected(p, COLORS, DISTANCE).moved).length;
    expect(inside, 'most seeded pixels lie inside the distance after gamut clipping').toBeGreaterThan(60_000);
    // alongL agrees with the direct construction, so the other files' colors and this file's share one ruler.
    expect(Math.abs(deltaEOk(alongL(FAIL, 0.05), FAIL) - 0.05)).toBeLessThanOrEqual(0.0025);
  });

  it('#382.5bb38907 a pixel 0.05 from fail lands 0.10 from it within 0.002 along the line, one 0.12 away keeps its value', () => {
    requireGpu();
    const { image, pixels } = input();
    const failures = lineCheck(guard({}, image), pixels);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#382.5bb38907 of 10,000 seeded pixels near each status color none ends within the distance, and pixels_moved counts them', () => {
    requireGpu();
    const { image, pixels, nearName } = input();
    const failures = seededCheck(guard({}, image), pixels, nearName);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#382.5bb38907 a planted guard that maps to grey passes the seeded test and fails the first, naming the pixel', () => {
    requireGpu();
    const { image, pixels, nearName } = input();
    const r = guard({ planted: 'guard_to_grey' }, image);
    // Grey at OKLab L 0.80 is more than the distance from every status color (all lie under L 0.62), so no pixel ends within it.
    for (const s of STATES) expect(deltaE([0.8, 0, 0], oklab8(COLORS[s])), `the planted grey keeps the distance from ${s}`).toBeGreaterThan(DISTANCE);
    const seeded = seededCheck(r, pixels, nearName).filter((f) => /end within/.test(f));
    expect(seeded, 'the planted grey guard leaves no pixel within the distance').toEqual([]);
    const line = lineCheck(r, pixels);
    expect(line.some((f) => /^pixel \(0, 0\)/.test(f)), `the planted grey guard fails the first test, naming pixel (0, 0): ${line.join('\n')}`).toBe(true);
  }, 1_800_000);
});
