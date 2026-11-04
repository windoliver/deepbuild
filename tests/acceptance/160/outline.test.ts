// AC14: "A union outline draws one ring around overlapping parts with no inner seam, and a slit child keeps its own
// line"
//
// Through `raster`. A group with `outline: {kind: union, width: 3, role: rim}` over two overlapping rects in `body`:
// a at [40, 160] × [40, 120] and b at [120, 240] × [80, 160]. Each pixel is read as the nearest of ground, body and
// rim. The ring: pixels 1.5 px outside the union are rim, pixels 9.5 px out are ground, the rim pixels form one
// connected ring (4-connected), and no pixel whose centre is 1 px or more inside the union is rim, so the edges
// where a and b cross inside it draw no seam. With `slits: ["b"]`, b keeps its own line inside the union: 1.5 px
// outside b's west edge, inside a, is rim (drawn over a, which comes before b; README: Readings), where without the
// slit it is body.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, colorError, expectClean, figure, item, none, pixel, raster, role, scratch, useRenderBinary, WHITE,
  type Image, type JsonObject, type Rgb,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('outline');
type Box = [number, number, number, number];
const BOX_A: Box = [40, 40, 120, 80];
const BOX_B: Box = [120, 80, 120, 80];

function puppet(slits: string[] | null): JsonObject {
  const outline: JsonObject = { kind: 'union', width: 3, role: 'rim' };
  if (slits) outline['slits'] = slits;
  return figure('outline', [280, 200], [
    item('pal', 'group@1', 'a0', { outline }),
    item('a', 'rect@1', 'a1', { box: BOX_A, paint: { fill: { role: 'body' } } }, { parent: 'pal' }),
    item('b', 'rect@1', 'a2', { box: BOX_B, paint: { fill: { role: 'body' } } }, { parent: 'pal' }),
  ]);
}

type Label = 'ground' | 'body' | 'rim';
function label(image: Image, x: number, y: number): Label {
  const p = pixel(image, x, y);
  const options: [Label, Rgb][] = [['ground', WHITE], ['body', role('body')], ['rim', role('rim')]];
  return options.map(([n, c]) => [n, colorError(p, c)] as [Label, number]).sort((u, v) => u[1] - v[1])[0]![0];
}
/** How far a point is inside a box (negative outside). */
const inside = (x: number, y: number, [bx, by, w, h]: Box): number => Math.min(x - bx, bx + w - x, y - by, by + h - y);

function ringComponents(image: Image): number {
  const seen = new Uint8Array(image.width * image.height);
  let parts = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (seen[y * image.width + x] || label(image, x, y) !== 'rim') continue;
    parts += 1;
    const stack: [number, number][] = [[x, y]];
    seen[y * image.width + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height || seen[ny * image.width + nx]) continue;
        if (label(image, nx, ny) !== 'rim') continue;
        seen[ny * image.width + nx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  return parts;
}

describe('AC14 a union outline', () => {
  it('AC14 a union outline draws one ring around overlapping parts with no inner seam', () => {
    const doc = puppet(null);
    expectClean(doc, 'the outlined group');
    const { image } = raster(dir, doc, 'the outlined group');
    const failures: string[] = [];
    const want: [number, number, Label, string][] = [
      [38, 80, 'rim', '1.5 px west of a'], [100, 38, 'rim', '1.5 px north of a'], [241, 120, 'rim', '1.5 px east of b'],
      [180, 161, 'rim', '1.5 px south of b'], [161, 70, 'rim', '1.5 px east of a, above b'], [30, 80, 'ground', '9.5 px west of a'],
      [120, 100, 'body', 'on b\'s west edge, inside a'], [119, 100, 'body', 'just west of b\'s west edge, inside a'], [140, 120, 'body', 'on a\'s south edge, inside b'],
    ];
    for (const [x, y, l, what] of want) { const got = label(image, x, y); if (got !== l) failures.push(`pixel (${x}, ${y}), ${what}, reads ${got}, not ${l}: ${JSON.stringify(pixel(image, x, y))}`); }
    let seam = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const depth = Math.max(inside(x + 0.5, y + 0.5, BOX_A), inside(x + 0.5, y + 0.5, BOX_B));
      if (depth >= 1 && label(image, x, y) === 'rim') seam++;
    }
    if (seam > 0) failures.push(`${seam} pixels inside the union draw in the rim: an inner seam`);
    const parts = ringComponents(image);
    if (parts !== 1) failures.push(`the rim pixels form ${parts} rings, not one`);
    none(failures, 'the union outline');
  }, TIMEOUT);

  it('AC14 a slit child keeps its own line inside the union', () => {
    const { image: slit } = raster(dir, puppet(['b']), 'the group with b slit');
    const { image: plain } = raster(dir, puppet(null), 'the group without slits');
    expect(label(slit, 118, 100), `1.5 px west of b's west edge, inside a, the slit b draws its own line: ${JSON.stringify(pixel(slit, 118, 100))}`).toBe('rim');
    expect(label(slit, 136, 78), `1.5 px north of b's north edge, inside a, the slit b draws its own line: ${JSON.stringify(pixel(slit, 136, 78))}`).toBe('rim');
    expect(label(plain, 118, 100), 'without the slit the same pixel is body').toBe('body');
    expect(label(slit, 38, 80), 'the slit keeps the outer ring').toBe('rim');
  }, TIMEOUT);
});
