// AC3 #1484.1be2fec6: "Two sizes at different coordinates never share an atlas entry"
//
// Two sizes at one device size: `Hamburgefonts` at 16 u drawn at zoom 2, then at 32 u at zoom 1, both 32 device px a em,
// so the atlas's size, face, glyph and slant agree and only the coordinates set them apart (opsz 16 and opsz 32 by the
// issue's rule). The 32 u text's place is twice the 16 u text's, so its first glyph's pen also lands on the same
// device pixel and phase (the face's ascent and descent don't vary, so the baselines scale with the size).
// Both lines go to one `deep-canvas-render render` process (GPUI's frame, the window's path), whose atlas carries from
// line to line, as a window's does across frames. The frame report's `rasterized` (#1479: the glyphs the atlas
// rasterized for the line) must count every distinct glyph of the 32 u text: none came from an entry the 16 u text
// left. And what the window then shows for the 32 u text holds #385's first criterion against Vello CPU's snapshot of
// it (`raster`), drawn at its own coordinates. At the base the atlas keys no coordinates (and nothing sets opsz), so
// the 32 u text rasterizes nothing.
import { describe, expect, it } from 'vitest';
import { AC, TEXT, drawLine, drew, lookColors, needsMac, num, obj, arr, picture, run, runName, runProblems, textDoc, useBin, useDir, type Item, type JsonObject } from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');
const dir = useDir('deep-1484-atlas-');

const SMALL: Item = { id: 'label', text: TEXT, size: 16, weight: 400, pos: [8, 4] };
const LARGE: Item = { id: 'label', text: TEXT, size: 32, weight: 400, pos: [16, 8] };

/** The distinct glyphs of a run as `render` reports them (its `texts` rows' `id`s). */
function distinct(answer: JsonObject, what: string): number {
  const rows = arr(obj(obj(answer['texts'], `${what}: texts`)['label'], `${what}: texts.label`)['glyphs'], `${what}: texts.label.glyphs`);
  return new Set(rows.map((r) => num(obj(r, 'glyph row')['id'], 'glyph id'))).size;
}

describe(`${ID} two sizes at different coordinates never share an atlas entry`, () => {
  it(`${ID} after the 16 u text at zoom 2, the 32 u text at zoom 1 (both 32 device px) rasterizes every one of its glyphs, and the window draws it as Vello CPU does`, () => {
    needsMac();
    const colors = lookColors('dark');
    const small = textDoc('atlas-16', [140, 30], [SMALL]);
    const large = textDoc('atlas-32', [280, 60], [LARGE]);
    const lines = [drawLine(dir(), small, 2), drawLine(dir(), large, 1)];
    const [a, b] = run(bin(), ['render'], lines);
    drew(a!, `render of ${runName(SMALL)} at zoom 2`);
    drew(b!, `render of ${runName(LARGE)} at zoom 1, in the same process`);
    const na = distinct(a!, 'the 16 u text');
    const nb = distinct(b!, 'the 32 u text');
    const ra = num(a!['rasterized'], 'the 16 u text\'s frame report: rasterized');
    const rb = num(b!['rasterized'], 'the 32 u text\'s frame report: rasterized');
    console.log(`${ID} rasterized: ${ra} for the 16 u text (${na} distinct glyphs), then ${rb} for the 32 u text (${nb} distinct glyphs)`);
    expect(ra, `the first line, in a fresh process, rasterizes each of its ${na} distinct glyphs: the count counts`).toBeGreaterThanOrEqual(na);
    expect(rb, `${runName(LARGE)} at zoom 1 rasterized ${rb} of its ${nb} distinct glyphs: the rest came from atlas entries ${runName(SMALL)} at zoom 2 left, at the same 32 device px but other coordinates (opsz 16, not 32)`).toBeGreaterThanOrEqual(nb);
    const snap = drawLine(dir(), large, 1);
    const [v] = run(bin(), ['raster'], [snap]);
    const problems = runProblems(runName(LARGE), picture(lines[1]!, b!, 'the window\'s 32 u text'), picture(snap, v!, 'Vello CPU\'s 32 u text'), colors, 'after the 16 u text');
    expect(problems, 'the window draws the 32 u text at its own coordinates, as Vello CPU does').toEqual([]);
  }, 1_800_000);
});
