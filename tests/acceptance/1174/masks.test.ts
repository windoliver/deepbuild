// #1174.46adb7ec: The same 13 px label drawn by scene3d at screen size and by the 2D path at the same device position
// gives glyph masks within 8 codes of each other at every pixel; the merge base fails, naming the largest difference.
//
// scene3d's side is #378's `view3d` at scale 1 drawing `labelScene` (one screen-size `mark.text@1`, "Shard 7 lag 33.5
// ms" at 13 px, in ink on paper, its centre projected off the device grid). The 2D side is #385's `layers` drawing
// `labelBoard` (the same text, font, size and paint as a text@1 over a paper rect, its box on the device grid), read
// from the side the live view's path for that layer names (`path`: GPUI on macOS). Each picture becomes a glyph mask
// (helpers.ts, `maskOf`); "the same device position" is the whole-pixel placement of the 2D text that brings its mask
// closest to scene3d's (README), so a label in depth that isn't on the device grid can't match one that is.
// Wrong program: the merge base (coverage as alpha in the linear target, then encoded; labels off the grid; the atlas
// sampled bilinearly), which must fail naming the largest difference.
import { describe, expect, it } from 'vitest';
import {
  AC1_SIZE, AC1_TEXT, AC1_VIEW, MASK_CODES, labelBoard, labelScene, layersCall, maskOf, requireReferenceMac, run, twoD, useBuild, useOut,
  view3dCall, viewFrame, writeJson,
} from './helpers.ts';

const ID = '#1174.46adb7ec';
const bin = useBuild();
const out = useOut();

interface Box { x0: number; y0: number; x1: number; y1: number }
function inkBox(mask: Uint8Array, w: number, h: number): Box | null {
  let b: Box | null = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]! < 64) continue;
    if (!b) b = { x0: x, y0: y, x1: x, y1: y };
    else { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
  }
  return b;
}
const count = (mask: Uint8Array, at: number): number => mask.reduce((n, v) => n + (v >= at ? 1 : 0), 0);

interface Compared { worst: number; at: [number, number]; m3: number; m2: number; shift: [number, number] }
/**
 * scene3d's mask against the 2D path's at every pixel, the 2D picture moved by whole pixels (dx, dy) within 2 px of
 * where their ink boxes line up: the placement with the smallest largest difference (then the smallest sum), and that
 * largest difference with where it is.
 */
function compare(m3: Uint8Array, m2: Uint8Array, [w, h]: [number, number]): Compared {
  const b3 = inkBox(m3, w, h); const b2 = inkBox(m2, w, h);
  expect(b3, 'scene3d drew the label: its mask holds ink').not.toBeNull();
  expect(b2, 'the 2D path drew the text: its mask holds ink').not.toBeNull();
  const cx = Math.round((b2!.x0 + b2!.x1 - b3!.x0 - b3!.x1) / 2); const cy = Math.round((b2!.y0 + b2!.y1 - b3!.y0 - b3!.y1) / 2);
  let best: (Compared & { sum: number }) | null = null;
  for (let dy = cy - 2; dy <= cy + 2; dy++) for (let dx = cx - 2; dx <= cx + 2; dx++) {
    let worst = -1; let at: [number, number] = [0, 0]; let sum = 0; let a = 0; let b = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x + dx; const v = y + dy;
      const two = u >= 0 && v >= 0 && u < w && v < h ? m2[v * w + u]! : 0;
      const d = Math.abs(m3[y * w + x]! - two);
      sum += d;
      if (d > worst) { worst = d; at = [x, y]; a = m3[y * w + x]!; b = two; }
    }
    if (!best || worst < best.worst || (worst === best.worst && sum < best.sum)) best = { worst, at, m3: a, m2: b, shift: [dx, dy], sum };
  }
  return best!;
}

describe(`${ID} the same 13 px label by scene3d at screen size and by the 2D path at the same device position: glyph masks within 8 codes at every pixel`, () => {
  it(`${ID} "${AC1_TEXT}" at 13 px in ink on paper: scene3d's glyph mask and the 2D path's are within 8 codes of each other at every pixel`, () => {
    requireReferenceMac();
    const doc = writeJson(out(), 'label-3d', labelScene());
    const [r3, r2] = run(bin(), out(), [view3dCall(doc, AC1_VIEW), layersCall(labelBoard())]);
    const three = viewFrame(out(), r3!, 'scene3d\'s label');
    expect([three.scale, three.upscale], 'scene3d drew at internal scale 1, no upscale').toEqual([1, 'none']);
    const two = twoD(out(), r2!, 'the 2D text');
    for (const [who, im] of [['scene3d', three.image], ['the 2D path', two.image]] as const) {
      expect([im.width, im.height], `${who}'s picture is the view's size`).toEqual(AC1_VIEW);
    }
    const m3 = maskOf(three.image); const m2 = maskOf(two.image);
    // The fixture tries: both draw a whole 13 px label (over 200 pixels of mask 32 or more each), away from the view's edges.
    expect(count(m3, 32), 'scene3d\'s label has ink').toBeGreaterThan(200);
    expect(count(m2, 32), 'the 2D text has ink').toBeGreaterThan(200);
    for (const [who, m] of [['scene3d', m3], ['the 2D path', m2]] as const) {
      const b = inkBox(m, AC1_VIEW[0], AC1_VIEW[1])!;
      expect(b.x0 >= 8 && b.y0 >= 8 && b.x1 < AC1_VIEW[0] - 8 && b.y1 < AC1_VIEW[1] - 8, `${who}'s ink stays 8 px inside the view: ${JSON.stringify(b)}`).toBe(true);
    }
    const c = compare(m3, m2, AC1_VIEW);
    const line = `the ${AC1_SIZE} px label "${AC1_TEXT}": glyph masks differ by up to ${c.worst} codes, at device px (${c.at[0]}, ${c.at[1]}): scene3d ${c.m3}, the 2D path (${two.path}) ${c.m2}, with the 2D text moved (${c.shift[0]}, ${c.shift[1]}) px to its closest placement`;
    console.log(`${ID}: ${line}`);
    expect(c.worst <= MASK_CODES, line).toBe(true);
  }, 1_800_000);
});
