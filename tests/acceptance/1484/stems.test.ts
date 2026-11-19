// AC2 #1484.2a04de3f: "`weight: 450` stems fall strictly between those of 400 and 500"
//
// Read where the issue's fault is, in the live window: GPUI's frame (`deep-canvas-render render`, the window's path at
// the reference window's scale, zoom 2) of a figure with `Il` at 24 u (48 device px a em, under the 64 px threshold,
// so drawn from the atlas) at weights 400, 450 and 500 in the body role, light ink on the clean look's dark ground.
// `I` and `l` are plain vertical bars in Inter, so a stem is read as the coverage summed across one row of device
// pixels through the bar, in the glyph's band (its pen position to one advance on, from Vello CPU's glyph rows),
// averaged over the rows from 0.1 to 0.6 em above the baseline. 450's stem must exceed 400's and fall short of 500's,
// each by more than 0.02 device px, the reading's resolution (README: Readings). At the base the window draws 450 from
// an atlas raster at the variable face's default instance, 400's design, so its stems read the same as 400's.
import { describe, expect, it } from 'vitest';
import { AC, coverage, drawLine, glyphsOf, lookColors, needsMac, picture, run, runName, textDoc, useBin, useDir, type Glyph, type Image, type Item } from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const dir = useDir('deep-1484-stems-');

const ZOOM = 2;
const EM = 24;
/** Readings closer than this, in device px, are not told apart (README: Readings). */
const RESOLUTION = 0.02;
const RUNS: Item[] = [400, 450, 500].map((weight, k) => ({ id: `w${weight}`, text: 'Il', size: EM, weight, pos: [8, 4 + 36 * k] }));

/** A bar's stem in device px: the row sums of coverage across the glyph's band, averaged over its middle rows. */
function stem(image: Image, g: Glyph, colors: ReturnType<typeof lookColors>): number {
  const [x0, x1] = [g.pen[0] * ZOOM, (g.pen[0] + g.advance) * ZOOM];
  const base = g.pen[1] * ZOOM;
  const em = g.size * ZOOM;
  const rows: number[] = [];
  for (let y = Math.ceil(base - 0.6 * em); y < Math.floor(base - 0.1 * em); y++) rows.push(coverage(image, colors, x0, x1, y, y + 1).sum);
  return rows.reduce((s, r) => s + r, 0) / rows.length;
}

describe(`${ID} weight 450's stems fall strictly between 400's and 500's`, () => {
  it(`${ID} in the window, each bar of Il at weight 450 is thicker than at 400 and thinner than at 500, each by more than ${RESOLUTION} device px`, () => {
    needsMac();
    const colors = lookColors('dark');
    const doc = textDoc('stems-1484', [60, 112], RUNS);
    const live = drawLine(dir(), doc, ZOOM);
    const snap = drawLine(dir(), doc, ZOOM);
    const [g] = run(bin(), ['render'], [live]);
    const [v] = run(bin(), ['raster'], [snap]);
    const window = picture(live, g!, 'render (the window) of Il at 400, 450 and 500');
    picture(snap, v!, 'raster (Vello CPU) of the same figure, for the glyphs\' places');
    const stems = RUNS.map((t) => {
      const glyphs = glyphsOf(v!, t.id, 'raster');
      expect(glyphs.length, `${runName(t)} has one glyph per letter`).toBe(2);
      return glyphs.map((gl) => stem(window, gl, colors));
    });
    const readings = RUNS.map((t, k) => `${t.weight}: ${stems[k]!.map((s) => s.toFixed(3)).join(', ')}`).join('; ');
    console.log(`${ID} stems of I and l in the window, device px: ${readings}`);
    const problems: string[] = [];
    ['I', 'l'].forEach((char, i) => {
      const [s400, s450, s500] = [stems[0]![i]!, stems[1]![i]!, stems[2]![i]!];
      if (!(s450 - s400 > RESOLUTION)) problems.push(`${runName(RUNS[1]!)}: ${char}'s stem reads ${s450.toFixed(3)} device px against ${s400.toFixed(3)} at weight 400: not thicker`);
      if (!(s500 - s450 > RESOLUTION)) problems.push(`${runName(RUNS[1]!)}: ${char}'s stem reads ${s450.toFixed(3)} device px against ${s500.toFixed(3)} at weight 500: not thinner`);
    });
    expect(problems, `weight 450's stems against 400's and 500's in the window (${readings})`).toEqual([]);
  }, 1_800_000);
});
