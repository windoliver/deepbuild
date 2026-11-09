// AC7 #505.6af13a53: "y = x over [0, 1] with `color: {by: y, ramp: [a, b], domain: [0, 1]}` draws the stroke at
// x = 0.5 at a and b's OKLab midpoint within 0.001 ΔEOK"
//
// The look's roles `a` (sRGB blue) and `b` (sRGB yellow), named as the issue names them: their sRGB midpoint is far
// from their OKLab midpoint, so a ramp mixed in encoded sRGB fails. `geometry` with `color_at: [x]` answers the
// stroke's color at each x as drawn, unrounded, in OKLab (README: `geometry`), since 8-bit pixels can't show 0.001
// ΔEOK; the raster's pixel on the line at x = 0.5 is also within one code value of the midpoint, so the color read
// is the color drawn. OKLab from Ottosson's published matrices in f64 (the oracle page's palette and WPT files fix
// the same formula). The ends read a and b.
import { describe, expect, it } from 'vitest';
import { colorDoc, unitU } from './docs.ts';
import {
  AC, ROLES, TIMEOUT, codeDiff, deltaEok, fnAt, midpoint, oklab, passes, pixel, rasterAt, readPng, srgb255, useRender, useTemp,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('color');
const ID = AC[7];

describe(`${ID} a stroke colored by value through an OKLab ramp`, () => {
  it(`${ID} y = x colored by y through [a, b] draws its stroke at x = 0.5 at a and b's OKLab midpoint within 0.001 ΔEOK`, () => {
    const a = oklab(ROLES['a']!);
    const b = oklab(ROLES['b']!);
    const mid = midpoint(a, b);
    const encodedMix = oklab([127.5, 127.5, 127.5]);
    expect(deltaEok(encodedMix, mid), 'blue and yellow mixed in encoded sRGB are far from their OKLab midpoint').toBeGreaterThan(0.05);
    const bin = render();
    const doc = colorDoc();
    passes(bin, doc, 'the colored line');
    const [g] = fnAt(bin, doc, 'line', [{ color_at: [0, 0.5, 1] }], 'the colored line');
    expect(g!.colorAt.length, `one color per x asked: ${JSON.stringify(g!.raw).slice(0, 600)}`).toBe(3);
    expect(deltaEok(g!.colorAt[1]!, mid), `the stroke at x = 0.5, ${JSON.stringify(g!.colorAt[1])}, against the midpoint ${JSON.stringify(mid)}`).toBeLessThanOrEqual(0.001);
    expect(deltaEok(g!.colorAt[0]!, a), 'the stroke at x = 0 is a').toBeLessThanOrEqual(0.001);
    expect(deltaEok(g!.colorAt[2]!, b), 'the stroke at x = 1 is b').toBeLessThanOrEqual(0.001);
    const image = readPng(rasterAt(bin, doc, [{}], temp(), 'color')[0]!.out);
    const c = pixel(image, unitU.x(0.5), unitU.y(0.5));
    const want = srgb255(mid);
    expect(codeDiff(c, want), `the drawn pixel on the line at x = 0.5, ${c.join(',')}, within one code value of ${want.map((v) => v.toFixed(1)).join(',')}`).toBeLessThanOrEqual(1);
  }, TIMEOUT);
});
