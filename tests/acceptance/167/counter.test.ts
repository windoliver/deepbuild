// AC9 #167.d181ea9b: "A counter from a driver going 0 to 12,345.6 with precision 1, sign always and group locale shows
// `+12,345.6` at the end, its digits tabular so no glyph left of the decimal point moves between frames"
//
// A `text@1` whose `text` is `{counter: {source: <driver ID>, format, tabular: true}}`; the driver multiplies a story
// constant, 12,345.6, by a data value keyed from 0 to 1 over 2 s. `raster`'s `texts` give the shown string and each
// glyph's x (#381). The oracle page's d3-format ebdc2d5302 pins "+,.1f"'s fixed precision, explicit sign and thousands
// grouping; the shape below is that format. The number grows, so its sign moves as digits appear; the place of each
// digit doesn't. Every digit left of the point, by its place, keeps one offset from the number's last glyph in every
// frame, and frames showing as many characters put every glyph left of the point at the same x (README: Readings).
// Proportional figures fail both: a 1 is narrower than an 8 in the body face.
import { describe, expect, it } from 'vitest';
import { AC, LOOK, TIMEOUT, document, fl, glyphsOf, item, passes, ramp, rasterAt, shownText, useRender, useTemp } from './helpers.ts';

const render = useRender();
const temp = useTemp('counter');
const ID = AC[9];
const END = 12345.6;
const doc = document('count-167', 'A counter that climbs', [240, 40], 2, [
  item('count', 'text@1', 'a0', {
    text: { counter: { source: 'count', format: { precision: 1, sign: 'always', group: 'locale' }, tabular: true } },
    font: 'body', size: 24, box: { w: 200, h: 32 }, widest: '+12,345.6',
  }, { at: { pos: [8, 4, 0] } }),
], {
  data: { goal: { value: END, source: 'story' }, share: { value: 0, source: 'story' }, shown: { value: 0, source: 'story' } },
  channels: { share: ramp('data/share', 0, 1, 2) },
  drivers: { count: { target: 'data/shown', expr: 'goal * share', vars: { goal: 'data/goal', share: 'data/share' } } },
});
const FRAMES = Array.from({ length: 121 }, (_, k) => k * fl(1 / 60));

describe(`${ID} a counter's format and its tabular digits`, () => {
  it(`${ID} it shows +12,345.6 at the end, each frame in the format, and no digit left of the point moves`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the counter');
    const drawn = rasterAt(bin, doc, FRAMES, LOOK, temp(), 'count');
    const shown = drawn.map(({ answer }, f) => shownText(answer, 'count', `frame ${f}`));
    expect(shown.at(-1), 'the counter at the end').toBe('+12,345.6');
    shown.forEach((s, f) => {
      expect(s, `frame ${f}: a sign, thousands grouped, one decimal`).toMatch(/^\+\d{1,3}(,\d{3})*\.\d$/);
      expect(Math.abs(Number(s.slice(1).replaceAll(',', '')) - (END * f) / 120), `frame ${f} shows ${s}, the driver's value to one decimal`).toBeLessThanOrEqual(0.051);
    });
    expect(new Set(shown).size, 'the digits change between frames').toBeGreaterThan(100);
    const offsets = new Map<number, number>();
    const byLength = new Map<number, number[]>();
    const wrong: string[] = [];
    drawn.forEach(({ answer }, f) => {
      const s = shown[f]!;
      const glyphs = glyphsOf(answer, 'count', `frame ${f}`);
      expect(glyphs.length, `frame ${f}: one glyph per character of ${s}`).toBe(s.length);
      const last = glyphs.at(-1)!.x;
      const point = s.indexOf('.');
      let place = 0;
      for (let i = point - 1; i >= 0; i--) {
        if (!/\d/.test(s[i]!)) continue;
        const offset = glyphs[i]!.x - last;
        const seen = offsets.get(place);
        if (seen === undefined) offsets.set(place, offset);
        else if (Math.abs(seen - offset) > 1e-3) wrong.push(`frame ${f} (${s}): the digit at place ${place} sits ${offset} from the end, not ${seen}`);
        place++;
      }
      const left = glyphs.slice(0, point).map((g) => g.x);
      const before = byLength.get(s.length);
      if (before === undefined) byLength.set(s.length, left);
      else left.forEach((x, i) => { if (Math.abs(x - before[i]!) > 1e-3) wrong.push(`frame ${f} (${s}): glyph ${i} at ${x}, not ${before[i]}`); });
    });
    expect(wrong.slice(0, 12), `no glyph left of the point moves (${wrong.length} found)`).toEqual([]);
  }, TIMEOUT);
});
