// AC3 #431.bedb0727: A pass that adds the core's emission target to color brightens only emissive pixels that show:
// with a sign of emission [4, 0, 0] (linear) half behind an opaque wall, beside a chrome sphere whose glint reaches a
// linear 4, each pixel the sign's visible half covers at every sample gains [4, 0, 0] within 1% before tone mapping,
// read back on one machine, while the glint, the wall and every other pixel keep their values within 1%; a planted
// target made by thresholding the color target at 1 brightens the glint and fails, naming the pixel.
//
// The fixture (helpers: `signDoc`, `SIGN`): a 480 × 270 orthographic view at 100 px/m; the sign over [60, 220) ×
// [95, 175) px, black with emission [1, 0, 0] at strength 4; a grey opaque wall over [140, 230) × [65, 205) px in front
// of it, so its visible half is [60, 140) × [95, 175); a chrome ball (metallic 1, roughness 0.2) of radius 60 px at
// (360, 135) under a sun. The same frame is drawn without and with the pass `glow` (helpers: `glowPass`: color + the
// emission target, each loaded at its own pixel, alpha kept), on one machine, and `pre_tone` (#418: the linear image
// the tone map reads, after the effects chain) is read back for both. "Covers at every sample" is read as at least 2 px
// inside the visible half's edges; "every other pixel" as every pixel more than 2 px outside it, the wall over the
// hidden half included. 1% of [4, 0, 0] is 0.04 a channel; "keeps its value within 1%" is |with − without| ≤ 1% of the
// value without, plus 1e-4 for a half float's last place. The fixture's glint is held to reach a linear 4 first.
// Wrong program (planted `emission_thresholds_color`): the emission target is max(color − 1, 0) of the color target,
// so the glint gains and the check fails naming a pixel on the ball.
import { describe, expect, it } from 'vitest';
import { AC, SIGN, frameAt, inRect, readF32Image, requireGpu, run, signDoc, useBin, useOut, view3dCall, writeJson, type F32Image, type Planted } from './helpers.ts';

const bin = useBin();
const out = useOut();

const onBall = (x: number, y: number): boolean => Math.hypot(x + 0.5 - SIGN.ball.cx, y + 0.5 - SIGN.ball.cy) < SIGN.ball.r - 2;
const nearVisible = (x: number, y: number): boolean => inRect(SIGN.visible, x, y, -2);
function where(x: number, y: number): string {
  if (onBall(x, y)) return 'the ball';
  if (inRect(SIGN.wall, x, y)) return 'the wall';
  return 'the background';
}

interface Run { problems: string[]; without: F32Image; withPass: F32Image; glintPixels: [number, number][] }
function emissionProblems(planted?: Planted): Run {
  const dir = out();
  const [a, b] = run(bin(), dir, [
    view3dCall({ doc: writeJson(dir, 'without.json', signDoc('sign-431', false)), size: SIGN.size, targets: ['pre_tone'] }),
    view3dCall({ doc: writeJson(dir, 'with.json', signDoc('sign-431', true)), size: SIGN.size, targets: ['pre_tone'] }),
  ], planted);
  const without = readF32Image(dir, frameAt(a!, 0, 'without the pass').pre_tone, SIGN.size, 'pre_tone without the pass');
  const withPass = readF32Image(dir, frameAt(b!, 0, 'with the pass').pre_tone, SIGN.size, 'pre_tone with the pass');
  const problems: string[] = [];
  const glintPixels: [number, number][] = [];
  let signPixels = 0;
  for (let y = 0; y < SIGN.size[1]; y++) {
    for (let x = 0; x < SIGN.size[0]; x++) {
      const p = without.at(x, y); const q = withPass.at(x, y);
      if (onBall(x, y) && Math.max(p[0], p[1], p[2]) >= 1) glintPixels.push([x, y]);
      if (inRect(SIGN.visible, x, y, 2)) {
        signPixels++;
        const gain = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        if (!(Math.abs(gain[0]! - 4) <= 0.04 && Math.abs(gain[1]!) <= 0.04 && Math.abs(gain[2]!) <= 0.04)) {
          problems.push(`pixel (${x}, ${y}) on the sign's visible half gains (${gain.map((g) => g.toFixed(3)).join(', ')}), not [4, 0, 0] within 1%`);
        }
      } else if (!nearVisible(x, y)) {
        for (let c = 0; c < 3; c++) {
          if (Math.abs(q[c]! - p[c]!) > 0.01 * Math.abs(p[c]!) + 1e-4) {
            problems.push(`pixel (${x}, ${y}) on ${where(x, y)} changes from (${p.slice(0, 3).map((v) => v.toFixed(3)).join(', ')}) to (${q.slice(0, 3).map((v) => v.toFixed(3)).join(', ')})`);
            break;
          }
        }
      }
    }
  }
  expect(signPixels, 'the sign\'s visible half is judged at 76 × 76 px').toBe(76 * 76);
  console.log(`${AC[3]}${planted ? ` (${planted})` : ''}: ${problems.length} pixels off${problems.length ? `, first: ${problems[0]}` : ''}`);
  return { problems, without, withPass, glintPixels };
}

describe(`${AC[3]} the emission target brightens only emissive pixels that show`, () => {
  it(`${AC[3]} each pixel of the sign's visible half gains [4, 0, 0] within 1% before tone mapping; the glint, the wall and every other pixel keep their values within 1%`, () => {
    requireGpu();
    const r = emissionProblems();
    let glint = 0;
    for (let y = 0; y < SIGN.size[1]; y++) for (let x = 0; x < SIGN.size[0]; x++) if (onBall(x, y)) glint = Math.max(glint, ...r.without.at(x, y).slice(0, 3));
    expect(glint, 'the fixture: the chrome ball\'s glint reaches a linear 4').toBeGreaterThanOrEqual(4);
    expect(r.problems.slice(0, 20)).toEqual([]);
  }, 1_800_000);
  it(`${AC[3]} a planted emission target made by thresholding color at 1 (--planted emission_thresholds_color) brightens the glint and fails, naming the pixel`, () => {
    requireGpu();
    const r = emissionProblems('emission_thresholds_color');
    expect(r.glintPixels.length, 'the ball has a glint above linear 1').toBeGreaterThan(0);
    const named = r.problems.filter((p) => /^pixel \(\d+, \d+\) on the ball changes/.test(p));
    expect(named.length, `the check fails naming a pixel of the glint: ${r.problems.slice(0, 5).join('; ')}`).toBeGreaterThan(0);
  }, 1_800_000);
});
