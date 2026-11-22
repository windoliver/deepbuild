// #1619.a63cb7a9: "At `convergence: 2, convergence_angle: 0`, a 1 px white vertical line over black has its red peak
// 2 px left and its blue peak 2 px right of green, within 0.5 px, byte-equal to the merge base's frame; at
// `convergence_angle: 90`, a 1 px white horizontal line has its red and blue peaks 2 px from green on opposite sides,
// within 0.5 px, and a planted pass that ignores the angle fails, naming it"
//
// The line fixture: a 320 × 180 black frame with one white line, 1 px wide and 120 px long, drawn by `film2d` under a
// CRT screen that sets `convergence` and `convergence_angle` and nothing else. A channel's peak is a point: the
// centroid of the pixels at or above half the channel's brightest value (helpers.ts: peak).
// At 0° (the vertical line, column 160): red's peak lies 2 px left of green's and blue's 2 px right, each within 0.5 px,
// and neither moves along y. That frame, and the frame of the same look with the angle left out, hold the bytes of
// the merge base's frame (fixtures/base-frame.png: the base's `convergence: 2`, recorded before any implementation;
// README: The merge base's frame); on a GPU of another family than the one that drew it the comparison reads
// INCONCLUSIVE.
// At 90° (the horizontal line, row 90): red's and blue's peaks lie 2 px from green's along y, each within 0.5 px, on
// opposite sides, and neither moves along x, since an offset along 90° has no x part. Which of the two lies above
// green is not asserted: the criterion says opposite sides.
// Planted: `convergence_angle_ignored`, the offsets drawn along x whatever the angle says; on the horizontal line red
// and blue stay in green's row and slide 2 px along it, and every failure names `convergence_angle: 90`.
import { describe, expect, it } from 'vitest';
import {
  AC, HORIZONTAL, type Image, type JsonObject, type Planted, VERTICAL, baseFrame, chipName, failsNaming, firstDifference, frameAt, inconclusive, lineCall, none, peak,
  readFinal, requireGpu, runGpu, thisFamily, useGpu, useOut,
} from './helpers.ts';

const gpu = useGpu();
const out = useOut();
/** The criterion's offset and its tolerance, px. */
const OFFSET = 2; const WITHIN = 0.5;

/** One frame of a line under a CRT screen with these fields. */
function draw(doc: JsonObject, screen: JsonObject, what: string, planted?: Planted): Image {
  requireGpu();
  const [r] = runGpu(gpu(), out(), [lineCall(doc, screen)], { planted });
  return readFinal(out(), frameAt(r!, 0, what), what);
}

/**
 * Red's and blue's peaks against green's: along the axis the offsets lie on (x at 0°, y at 90°) and across it. At 0°
 * red is 2 px before green (left) and blue 2 px after; at 90° each is 2 px from green and they lie on opposite sides.
 * Each failure names the angle.
 */
function peakFailures(img: Image, angle: 0 | 90): string[] {
  const at = `at convergence: ${OFFSET}, convergence_angle: ${angle}`;
  const [along, across] = angle === 0 ? (['x', 'y'] as const) : (['y', 'x'] as const);
  const peaks = { red: peak(img, 0), green: peak(img, 1), blue: peak(img, 2) };
  const dark = Object.entries(peaks).filter(([, p]) => !(p.max > 127));
  if (dark.length) return dark.map(([name, p]) => `${at}, the ${name} channel has no peak: its brightest value is ${p.max} of 255`);
  const d = { red: peaks.red[along] - peaks.green[along], blue: peaks.blue[along] - peaks.green[along] };
  const problems: string[] = [];
  for (const name of ['red', 'blue'] as const) {
    const want = angle === 0 ? (name === 'red' ? -OFFSET : OFFSET) : OFFSET;
    const got = angle === 0 ? d[name] : Math.abs(d[name]);
    if (!(Math.abs(got - want) <= WITHIN)) problems.push(`${at}, the ${name} peak is ${d[name].toFixed(2)} px from green's along ${along}, not ${angle === 0 ? want : `${OFFSET} either way`} within ${WITHIN} px`);
    const off = peaks[name][across] - peaks.green[across];
    if (!(Math.abs(off) <= WITHIN)) problems.push(`${at}, the ${name} peak is ${off.toFixed(2)} px from green's along ${across}, where an offset along ${angle}° moves nothing`);
  }
  if (angle === 90 && !(d.red * d.blue < 0)) problems.push(`${at}, the red and blue peaks (${d.red.toFixed(2)} and ${d.blue.toFixed(2)} px from green's along y) are not on opposite sides of green`);
  return problems;
}

describe(`${AC[1]} the screen's convergence along its angle: the line fixture`, () => {
  it(`${AC[1]} at convergence 2, convergence_angle 0, a 1 px white vertical line over black has its red peak 2 px left and its blue peak 2 px right of green, within 0.5 px`, () => {
    none(peakFailures(draw(VERTICAL, { convergence: OFFSET, convergence_angle: 0 }, 'the vertical line at 0°'), 0), `${AC[1]} the vertical line`);
  });

  it(`${AC[1]} at convergence 2, convergence_angle 0, the vertical line's frame is byte-equal to the merge base's frame`, () => {
    requireGpu();
    const base = baseFrame();
    expect(lineCall(VERTICAL, { convergence: OFFSET }), 'the merge base drew this suite\'s own call with the angle left out').toEqual(base.call);
    const family = thisFamily();
    if (family !== base.gpu.family) {
      inconclusive(`the merge base's frame was drawn on a GPU of the ${base.gpu.family} family (${base.gpu.chip}) and this Mac's is ${family} (${chipName()}); a frame the GPU drew on one machine doesn't count on another (canvas primitives: Determinism class), so run this test on a Mac of the ${base.gpu.family} family`);
    }
    const names = ['convergence_angle: 0', 'convergence_angle left out, its default 0'];
    const replies = runGpu(gpu(), out(), [lineCall(VERTICAL, { convergence: OFFSET, convergence_angle: 0 }), lineCall(VERTICAL, { convergence: OFFSET })]);
    const differences = names.map((name, i) => firstDifference(readFinal(out(), frameAt(replies[i]!, 0, name), name), base.image, `the frame at ${name}`, `the merge base's frame (${base.base.slice(0, 8)})`));
    none(differences.filter((d) => d !== ''), `${AC[1]} byte-equal to the merge base's frame`);
  });

  it(`${AC[1]} at convergence_angle 90, a 1 px white horizontal line has its red and blue peaks 2 px from green on opposite sides, within 0.5 px`, () => {
    none(peakFailures(draw(HORIZONTAL, { convergence: OFFSET, convergence_angle: 90 }, 'the horizontal line at 90°'), 90), `${AC[1]} the horizontal line`);
  });

  it(`${AC[1]} a planted pass that ignores the angle (planted convergence_angle_ignored) fails, naming it`, () => {
    const failures = peakFailures(draw(HORIZONTAL, { convergence: OFFSET, convergence_angle: 90 }, 'the horizontal line at 90°, planted', 'convergence_angle_ignored'), 90);
    failsNaming(failures, ['convergence_angle: 90', /the red peak is -?0\.\d\d px from green's along y/], `${AC[1]} the planted convergence_angle_ignored`);
  });
});
