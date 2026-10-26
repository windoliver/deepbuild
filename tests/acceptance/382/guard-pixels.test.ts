// #382.1b194e8e: Wherever status can show, no operator pixel ends within the look's status distance of a status
// color, checked on a fixture that tries.
// The fixture: the film with the lamp's badge bound to a verdict (status can show), bloom on (a pass operator writes
// the whole frame), and three roles each 0.11 OKLab lighter than a status color (fail, pass, running), so the look's
// check passes while the sun's shading (0.25 + 0.75 × facing) darkens every face that doesn't face it straight on
// into the status color's neighborhood. Drawn with the binding in state fail: the guard ran and moved pixels, and
// every pixel outside the status marks' and the legend's own boxes (grown by 2 px) keeps at least 0.10 − 0.005 OKLab
// from every status color (0.005: the largest move an 8-bit quantization gives a guarded pixel at these lightnesses).
// The mark's own pixels draw the fail color exactly. That the fixture tries: the same film with no binding, played on
// its own, has at least 200 pixels within the distance. At the base there is no guard and no status report;
// `--planted guard_half_distance` guards to half the look's distance and leaves pixels between 0.05 and 0.10.
import { describe, expect, it } from 'vitest';
import {
  DISTANCE, STATUS, VERDICT, alongL, answered, clashes, deltaEOk, film, frameAt, framesOf, fromHex, hex, look3, mode, readPng, requireGpu, run1,
  statusColors, statusMask, statusOf, useBin, useOut, writeJson, type JsonObject, type Rgb, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

/** The 8-bit quantization of a pixel guarded to the distance can move it this much (README: Readings). */
const QUANT = 0.005;
const COLORS = statusColors();
const ROLES: Record<string, Rgb> = {
  lamp: alongL(fromHex(STATUS.fail), 0.11), block: alongL(fromHex(STATUS.pass), 0.11), crate: alongL(fromHex(STATUS.running), 0.11), floor: [172, 172, 172],
};
const LOOK: JsonObject = look3('tries-382', ROLES, { bloom: { intensity: 0.3, radius: 0.85 } });

function guarded(startup: Startup): string[] {
  const bin = bins.bin();
  const path = writeJson(out(), 'tries.json', film('tries-382', { binding: true }));
  const reply = answered(run1(bin, out(), { call: 'view3d', doc: path, look: LOOK, size: [480, 360], states: { [VERDICT]: 'fail' }, targets: ['final'], capture: [0] }, startup), 'the fixture that tries');
  const status = statusOf(reply, 'the fixture that tries');
  const failures: string[] = [];
  if (!status.shows) failures.push('status.shows is false for a document with a status binding');
  if (status.guard === null || !status.guard.ran) failures.push('no status guard ran where status can show');
  else if (status.guard.pixels_moved < 1) failures.push('the guard moved no pixel on a fixture whose shaded faces cross into the status colors');
  if (status.marks.length !== 1) failures.push(`${status.marks.length} status marks, not the one binding`);
  const image = readPng(out(), frameAt(framesOf(reply, 'view3d'), 0, 'the fixture').final, 'frame 0\'s final frame');
  const mask = statusMask(status, image.width, image.height);
  const near = clashes(image, COLORS, DISTANCE - QUANT, mask);
  if (near.count > 0) failures.push(`${near.count} operator pixels end within ${DISTANCE} OKLab of a status color: ${near.listed.join('; ')}`);
  for (const m of status.marks) {
    // The binding's own pixels are the status color, exact, and never recolored by the guard.
    const inside = mode(image, (x, y) => x >= m.bounds[0] + 1 && x < m.bounds[0] + m.bounds[2] - 1 && y >= m.bounds[1] + 1 && y < m.bounds[1] + m.bounds[3] - 1);
    if (hex(inside.color) !== STATUS.fail) failures.push(`the mark's most common pixel is ${hex(inside.color)}, not the fail color ${STATUS.fail}`);
    if (hex(m.color) !== STATUS.fail) failures.push(`the mark reports color ${hex(m.color)}, not ${STATUS.fail}`);
  }
  return failures;
}

describe('#382.1b194e8e wherever status can show, no operator pixel ends within the status distance of a status color', () => {
  it('#382.1b194e8e the roles sit 0.11 from fail, pass and running, so the look passes its check and the shading crosses the distance', () => {
    expect(Math.abs(deltaEOk(ROLES['lamp']!, COLORS.fail) - 0.11)).toBeLessThanOrEqual(0.0025);
    expect(Math.abs(deltaEOk(ROLES['block']!, COLORS.pass) - 0.11)).toBeLessThanOrEqual(0.0025);
    expect(Math.abs(deltaEOk(ROLES['crate']!, COLORS.running) - 0.11)).toBeLessThanOrEqual(0.0025);
    for (const [role, c] of Object.entries(ROLES)) for (const s of Object.keys(COLORS) as (keyof typeof COLORS)[]) expect(deltaEOk(c, COLORS[s]), `${role} keeps the distance from ${s}`).toBeGreaterThanOrEqual(DISTANCE);
  });

  it('#382.1b194e8e the fixture tries: the same film with no binding, played alone, has pixels within the distance', () => {
    requireGpu();
    const bin = bins.bin();
    const path = writeJson(out(), 'tries-alone.json', film('tries-382'));
    const reply = answered(run1(bin, out(), { call: 'view3d', doc: path, look: LOOK, size: [480, 360], targets: ['final'], capture: [0] }), 'the film alone');
    const image = readPng(out(), frameAt(framesOf(reply, 'view3d'), 0, 'the film alone').final, 'frame 0\'s final frame');
    const near = clashes(image, COLORS, DISTANCE, null);
    expect(near.count, `pixels within ${DISTANCE} of a status color with no guard: ${near.listed.join('; ')}`).toBeGreaterThanOrEqual(200);
  }, 1_800_000);

  it('#382.1b194e8e with a status binding, the guard moves every operator pixel off the status colors and the mark draws exact', () => {
    requireGpu();
    const failures = guarded({});
    expect(failures, failures.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#382.1b194e8e a planted guard that keeps only half the distance fails, naming pixels', () => {
    requireGpu();
    const failures = guarded({ planted: 'guard_half_distance' });
    expect(failures.some((f) => /operator pixels end within/.test(f)), `the mutant leaves pixels between 0.05 and 0.10: ${failures.join('\n')}`).toBe(true);
  }, 1_800_000);
});
