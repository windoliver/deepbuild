// AC5 #467.2184c808: On a 200 u disc lit from 135°, the bevel's mean highlight alpha on the upper-left rim exceeds the
// lower-right's by at least 0.5, satin at angle a equals satin at a + 180° within one code value, and an outer glow's
// alpha is 0 inside the edge and falls monotonically outside it; a planted bevel lit from the opposite side fails,
// naming the rim
//
// The disc (helpers.ts `disc`) is black, 200 u across, centered on a pixel center, the only item of its writer layer,
// drawn by the GPU layer through `deep-gpu run`'s `layers` (#385) over transparent black. Angles are the look light's
// convention (#149): 0° right, 90° up, counter-clockwise on the screen, so 135° is the upper left. The bevel's highlight
// is white at opacity 1 and its shadow black, so over the black disc a pixel's red ÷ 255 is the highlight's alpha there.
// A rim is the bevel's band (within its 10 px size of the edge, 1.5 px clear of the anti-aliased edge) in the sector
// within 45° of its direction. The glow is white at opacity 1 in normal mode, so outside the disc its alpha is the
// layer's alpha. The planted program is `deep-gpu run --planted bevel_lit_opposite`.
import { describe, expect, it } from 'vitest';
import {
  AC, DISC_CENTER, DISC_R, DISC_SIZE, disc, diffAt, failsNaming, layersCall, none, px, requireMetal, runGpu, sideOf, useBin, useDir,
  type Image, type JsonObject, type Planted,
} from './helpers.ts';

const ID = AC[5];
const bin = useBin('deep-gpu');
const dir = useDir();

const BEVEL_SIZE = 10;
const LIT_FROM = 135;
const bevel: JsonObject = { bevel: { shape: 'inner', technique: 'smooth', depth: 1, size: BEVEL_SIZE, light: { angle: LIT_FROM, altitude: 30 }, highlight: { role: 'white', opacity: 1 }, shadow: { role: 'black', opacity: 1 } } };
const satin = (angle: number): JsonObject => ({ satin: { role: 'white', offset: 10, size: 14, angle, opacity: 1, mode: 'normal' } });
const GLOW_SIZE = 12;
const glow: JsonObject = { glow: { where: 'outer', role: 'white', size: GLOW_SIZE, spread: 0, opacity: 1, source: 'edge', mode: 'normal' } };

/** The GPU layer's drawing of each document, in one process. */
function draw(docs: JsonObject[], planted?: Planted): Image[] {
  const out = dir();
  const replies = runGpu(bin(), out, docs.map((d) => layersCall(d, ['gpu_layer'])), planted);
  return replies.map((r, i) => sideOf(out, r, 'gpu_layer', `disc ${i}`).image);
}
/** A pixel center's distance inside the disc's edge (negative outside), and its direction in the light's convention. */
function polar(x: number, y: number): { inside: number; deg: number } {
  const dx = x + 0.5 - DISC_CENTER[0]; const dy = y + 0.5 - DISC_CENTER[1];
  return { inside: DISC_R - Math.hypot(dx, dy), deg: ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360 };
}
const within45 = (deg: number, of: number): boolean => Math.abs(((deg - of + 540) % 360) - 180) <= 45;
/** Each way the bevel misses the criterion: the failures name the rim that falls short. */
function bevelProblems(image: Image): string[] {
  const rim = (of: number): number => {
    let sum = 0; let n = 0;
    for (let y = 0; y < DISC_SIZE[1]; y++) for (let x = 0; x < DISC_SIZE[0]; x++) {
      const p = polar(x, y);
      if (p.inside >= 1.5 && p.inside <= BEVEL_SIZE - 0.5 && within45(p.deg, of)) { sum += px(image, x, y)[0] / 255; n++; }
    }
    return sum / n;
  };
  const upperLeft = rim(LIT_FROM); const lowerRight = rim(LIT_FROM + 180);
  console.log(`${ID}: mean highlight alpha: upper-left rim ${upperLeft.toFixed(4)}, lower-right rim ${lowerRight.toFixed(4)}`);
  return upperLeft - lowerRight >= 0.5 ? [] : [`the upper-left rim's mean highlight alpha ${upperLeft.toFixed(4)} doesn't exceed the lower-right rim's ${lowerRight.toFixed(4)} by 0.5`];
}

describe(`${ID} bevel, satin and glow on a 200 u disc`, () => {
  it(`${ID} lit from 135°, the bevel's mean highlight alpha on the upper-left rim exceeds the lower-right's by at least 0.5`, () => {
    requireMetal();
    const [lit] = draw([disc('bevel', bevel)]);
    none(bevelProblems(lit!), 'the bevel lit from the upper left');
  });

  it(`${ID} a planted bevel lit from the opposite side fails, naming the rim`, () => {
    requireMetal();
    const [opposite] = draw([disc('bevel', bevel)], 'bevel_lit_opposite');
    failsNaming(bevelProblems(opposite!), 'upper-left rim', 'the bevel lit from the opposite side');
  });

  it(`${ID} satin at angle a equals satin at a + 180° within one code value`, () => {
    requireMetal();
    const [bare, a, flipped] = draw([disc('bare'), disc('satin-19', satin(19)), disc('satin-199', satin(199))]);
    let drawn = 0; let discPixels = 0; const apart: string[] = [];
    for (let y = 0; y < DISC_SIZE[1]; y++) for (let x = 0; x < DISC_SIZE[0]; x++) {
      if (polar(x, y).inside > 0) { discPixels++; if (diffAt(a!, bare!, x, y) > 1) drawn++; }
      const d = diffAt(a!, flipped!, x, y);
      if (d > 1) apart.push(`(${x}, ${y}): ${d} codes`);
    }
    expect(drawn, `satin draws: it changes ${drawn} of the disc's ${discPixels} pixels, at least 1%`).toBeGreaterThanOrEqual(discPixels * 0.01);
    expect(apart, `satin at 19° and at 199° within one code value at every pixel (${apart.length} aren't): ${apart.slice(0, 10).join('; ')}`).toEqual([]);
  });

  it(`${ID} an outer glow's alpha is 0 inside the edge and falls monotonically outside it`, () => {
    requireMetal();
    const [bare, glowing] = draw([disc('bare'), disc('glow', glow)]);
    const inside: string[] = [];
    for (let y = 0; y < DISC_SIZE[1]; y++) for (let x = 0; x < DISC_SIZE[0]; x++) {
      if (polar(x, y).inside >= 1.5 && diffAt(glowing!, bare!, x, y) !== 0) inside.push(`(${x}, ${y})`);
    }
    expect(inside, `inside the edge the glow adds nothing: the disc's pixels are the same with and without it (${inside.length} differ): ${inside.slice(0, 10).join(' ')}`).toEqual([]);
    const problems: string[] = [];
    // Eight rays from the center through pixel centers: along the axes and the diagonals.
    for (const [sx, sy] of [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]] as [number, number][]) {
      const alphas: number[] = [];
      for (let k = 1; ; k++) {
        const x = Math.floor(DISC_CENTER[0]) + sx * k; const y = Math.floor(DISC_CENTER[1]) + sy * k;
        const outside = -polar(x, y).inside;
        if (outside < 1.5) continue;
        if (outside > GLOW_SIZE * 2 + 4) break;
        alphas.push(px(glowing!, x, y)[3]);
      }
      const ray = `the ray toward (${sx}, ${sy})`;
      if (!(alphas[0]! > 0)) problems.push(`${ray}: the glow's alpha just outside the edge is ${alphas[0]}, so it draws nothing there`);
      alphas.forEach((a, i) => { if (i > 0 && a > alphas[i - 1]!) problems.push(`${ray}: the alpha rises from ${alphas[i - 1]} to ${a} at step ${i} outside the edge`); });
      if (!(alphas[alphas.length - 1]! < alphas[0]!)) problems.push(`${ray}: the alpha doesn't fall: ${alphas.join(' ')}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
