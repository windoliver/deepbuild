// AC3 #496.0e4aa65f: "MOTION" at 112 u with its weight driven by round(100 + 800 × (0.5 − 0.5·cos(2π × 2t ÷ 4.7))) draws
// at 1.175 s the glyph outlines and advances of a still item at weight 900, and at 0 s those of weight 100, within 0.01 u;
// playing the 4.7 s at 60 fps shapes nothing after check; a planted build that snaps to the nearest bundled static
// weight draws weight 600's advances at 1.175 s and fails, naming the item.
//
// The weight is a driver on items/motion/params/weight over the document's time, the issue's formula as written. Each
// glyph's `advance` and `outline` (in its own frame) at 1.175 s and at 0 s are compared with a still MOTION at weight 900
// and 100. Guards ask that weight 900 really differs from 600 and weight 100 from 400 (the body role's static faces are
// 400, 500 and 600), so a build that snaps every weight, the stills included, can't pass. The play draws every 60 fps
// frame from 0 to 4.7 s in one process; `shaped` counts the runs each line shaped, its check included: the first line's
// check shapes, and no line after it shapes anything.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TIMEOUT, drawn, failsNaming, film, fl, frames60, int, none, outlineGap, raster, run, textItem, textOf, useRender,
  type JsonObject, type Text,
} from './helpers.ts';

const render = useRender();

const ITEM = 'motion';
const params = (weight: number): JsonObject => ({ text: 'MOTION', size: 112, weight });
const DRIVEN = film('motion-weight', [textItem(ITEM, params(400))], {
  drivers: { sweep: { target: `items/${ITEM}/params/weight`, expr: 'round(100 + 800 * (0.5 - 0.5 * cos(2 * pi * 2 * t / 4.7)))', vars: { t: 'time' } } },
}, '4.7s', [720, 200]);
const still = (weight: number): JsonObject => film(`motion-still-${weight}`, [textItem(ITEM, params(weight))], {}, '4.7s', [720, 200]);
const PEAK = fl(1.175);

/** Where a drawn MOTION differs from a still one by more than 0.01 u in a glyph's advance or outline, naming the item. */
function weightFailures(got: Text, want: Text, what: string): string[] {
  if (got.glyphs.length !== want.glyphs.length) return [`${ITEM} ${what}: ${got.glyphs.length} glyphs, not ${want.glyphs.length}`];
  const out: string[] = [];
  got.glyphs.forEach((g, i) => {
    const w = want.glyphs[i]!;
    const at = `${ITEM} ${what}: grapheme ${g.grapheme} (glyph ${i})`;
    if (g.id !== w.id) out.push(`${at} is glyph ${g.id}, not ${w.id}`);
    if (!(Math.abs(g.advance - w.advance) <= 0.01)) out.push(`${at} advances ${g.advance} u, not ${w.advance}`);
    const gap = outlineGap(g.outline, w.outline, 0.01);
    if (gap !== null) out.push(`${at} outline: ${gap}`);
  });
  return out;
}

/** MOTION drawn at `lines`, each a document at a time, in one process. */
function draw(lines: { doc: JsonObject; t: number; planted?: string }[], what: string): Text[] {
  const b = render;
  const png = `${b.out()}/motion.png`;
  return drawn(run(b.bin(), 'raster', lines.map((l) => ({ out: png, doc: l.doc, look: LOOK, t: l.t, ...(l.planted ? { planted: l.planted } : {}) }))), what)
    .map((a, i) => textOf(a, ITEM, `${what}, line ${i + 1}`));
}
const differs = (a: Text, b: Text): boolean => a.glyphs.length === b.glyphs.length && a.glyphs.some((g, i) => Math.abs(g.advance - b.glyphs[i]!.advance) > 0.01);

describe(`${AC[3]} a weight a channel drives draws the variable font's outlines and advances, shaped at check`, () => {
  it(`${AC[3]} at 1.175 s MOTION draws weight 900's outlines and advances, and at 0 s weight 100's, within 0.01 u`, () => {
    const [peak, start, w900, w100, w600, w400] = draw([
      { doc: DRIVEN, t: PEAK }, { doc: DRIVEN, t: 0 }, { doc: still(900), t: 0 }, { doc: still(100), t: 0 }, { doc: still(600), t: 0 }, { doc: still(400), t: 0 },
    ], 'MOTION driven and still');
    expect(w900!.glyphs.length, 'the still MOTION draws six glyphs').toBe(6);
    expect(differs(w900!, w600!), 'weight 900 draws other advances than the static 600 (the variable face, not a snapped one)').toBe(true);
    expect(differs(w100!, w400!), 'weight 100 draws other advances than the static 400').toBe(true);
    none([...weightFailures(peak!, w900!, 'at 1.175 s'), ...weightFailures(start!, w100!, 'at 0 s')], 'the driven MOTION draws the still weights it reaches');
  }, TIMEOUT);

  it(`${AC[3]} playing the 4.7 s at 60 fps shapes nothing after check: every line after the first shapes no run`, () => {
    const times = frames60(4.7);
    expect(times.length, '0 to 4.7 s at 60 fps is 283 frames').toBe(283);
    const answers = drawn(raster(render, DRIVEN, times.map((t) => ({ t }))), 'the play');
    const shaped = answers.map((a, k) => int(a['shaped'], `frame ${k}: shaped`));
    expect(shaped[0], 'the first line, whose check shapes the weights the driver takes, shapes something').toBeGreaterThan(0);
    none(shaped.flatMap((n, k) => (k > 0 && n !== 0 ? [`frame ${k} (${times[k]} flicks) shaped ${n} runs`] : [])), 'no frame after the check shapes');
    const first = textOf(answers[0]!, ITEM, 'frame 0');
    expect(answers.some((a, k) => differs(textOf(a, ITEM, `frame ${k}`), first)), 'the play sweeps the weight: some frame draws other advances than frame 0').toBe(true);
  }, TIMEOUT);

  it(`${AC[3]} a planted build that snaps to the nearest bundled static weight draws weight 600's advances at 1.175 s and fails, naming the item`, () => {
    const [snapped, w900, w600] = draw([{ doc: DRIVEN, t: PEAK, planted: 'weight_snaps_to_static' }, { doc: still(900), t: 0 }, { doc: still(600), t: 0 }], 'the snapping build and the stills');
    expect(snapped!.glyphs.length, 'the snapping build draws six glyphs').toBe(6);
    const apart = snapped!.glyphs.map((_, i) => i).filter((i) => Math.abs(w600!.glyphs[i]!.advance - w900!.glyphs[i]!.advance) > 0.01);
    expect(apart.length, 'weights 600 and 900 advance differently somewhere').toBeGreaterThan(0);
    const farther = apart.filter((i) => {
      const a = snapped!.glyphs[i]!.advance;
      return !(Math.abs(a - w600!.glyphs[i]!.advance) < Math.abs(a - w900!.glyphs[i]!.advance));
    });
    expect(farther, 'the snapping build draws weight 600\'s advances: each is nearer 600\'s than 900\'s').toEqual([]);
    failsNaming(weightFailures(snapped!, w900!, 'at 1.175 s'), [ITEM], 'weight_snaps_to_static');
  }, TIMEOUT);
});
