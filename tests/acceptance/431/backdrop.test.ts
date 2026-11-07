// AC7 #431.4f967b2e: backdrop reads only the opaque scene: an unlit card at alpha_mode blend, whose material operator
// sets its base color to the luminance of backdrop(screen_uv, 0), stands before a wall of red, green and blue stripes
// with a red pane at alpha 0.5 between them; with tone map none each card pixel equals the CPU reference of the
// luminance step on the wall pixel behind it, from a composite of the opaque frame, within 1 code value, with none of
// the pane's red; at lod 3 it matches level 3 of that opaque copy, read back in the test, within 1 code value; the same
// graph on an opaque card is refused with operator_kind_rule, naming the step; and a planted copy taken after
// see-through parts shows the pane's red through the card and fails, naming the pixel.
//
// The fixture (helpers: `cardDoc`, `frostOperator`, `CARD`): a 384 × 192 orthographic view at 100 px/m; six 64 px
// stripes, unlit linear 0.8 red, green, blue, red, green, blue; a red unlit pane at alpha_mode blend, alpha 0.5, over
// [32, 224) × [16, 176) px; in front, the card over [64, 320) × [32, 160) px, unlit at alpha_mode blend, alpha 1, its
// material operator `frost` setting base color to luminance(backdrop(screen_uv, lod)) in each of r, g and b. Drawn
// three ways in one run: the opaque frame alone (the stripes; its linear target is "a composite of the opaque frame");
// the card at lod 0 and at lod 3, each with `targets: ["linear", "backdrop"]`, the copy of the opaque scene read back
// with its mips (README: the `backdrop` target). Judged on the card's pixels 2 px inside its edges, on the linear
// target (tone map none, unit exposure), one code value being 1/255 of linear light:
//   - lod 0: each card pixel is lum(opaque frame's pixel), Rec. 709 on linear light, the luminance step's reference;
//   - the read-back copy's level 0 is the opaque frame (so it holds none of the pane), and its level 3 the 8 × 8 mean
//     of level 0 (so it is that copy's chain), each within 1 code a channel;
//   - lod 3: each card pixel is lum(bilinear(level 3, screen_uv)).
// The same graph on a card at alpha_mode opaque is refused by `view3d`'s check with an operator_kind_rule error naming
// step `b`, the backdrop step.
// Wrong program (planted `backdrop_after_see_through`): the copy is taken after see-through parts draw, so the pane's
// red reaches the card's pixels over it; the check fails naming a pixel there.
import { describe, expect, it } from 'vitest';
import {
  AC, CARD, bilinear, cardDoc, errors, frameAt, inRect, lum, names, readF32Image, readLevels, requireGpu, run, shown, useBin, useOut, view3dCall,
  writeJson, type F32Image, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const CODE = 1 / 255;

interface Off { x: number; y: number; text: string }
function backdropProblems(planted?: Planted): Off[] {
  const dir = out();
  const doc = (name: string, d: JsonObject): string => writeJson(dir, `${name}.json`, d);
  const [opaqueR, lod0R, lod3R] = run(bin(), dir, [
    view3dCall({ doc: doc('opaque', cardDoc('card-431', { lod: 0, card: 'blend', opaque: true })), size: CARD.size, targets: ['linear'] }),
    view3dCall({ doc: doc('lod0', cardDoc('card-431', { lod: 0, card: 'blend' })), size: CARD.size, targets: ['linear', 'backdrop'] }),
    view3dCall({ doc: doc('lod3', cardDoc('card-431', { lod: 3, card: 'blend' })), size: CARD.size, targets: ['linear', 'backdrop'] }),
  ], planted);
  const opaque = readF32Image(dir, frameAt(opaqueR!, 0, 'the opaque frame').linear, CARD.size, 'the opaque frame');
  const f0 = frameAt(lod0R!, 0, 'the card at lod 0'); const f3 = frameAt(lod3R!, 0, 'the card at lod 3');
  const card0 = readF32Image(dir, f0.linear, CARD.size, 'the card at lod 0');
  const card3 = readF32Image(dir, f3.linear, CARD.size, 'the card at lod 3');
  const levels = readLevels(dir, f3.backdrop, 'the opaque copy, read back');
  const off: Off[] = [];
  const W = CARD.size[0]; const H = CARD.size[1];
  const each = (f: (x: number, y: number) => void): void => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inRect(CARD.card, x, y, 2)) f(x, y); };

  each((x, y) => {
    const want = lum(opaque.at(x, y)); const got = card0.at(x, y);
    const worst = Math.max(...[0, 1, 2].map((c) => Math.abs(got[c]! - want)));
    if (worst > CODE) off.push({ x, y, text: `lod 0: pixel (${x}, ${y})${inRect(CARD.pane, x, y) ? ' (over the pane)' : ''} reads (${got.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}), not lum of the opaque frame behind it, ${want.toFixed(4)}` });
  });

  expect(levels.length, 'the copy is read back with at least 4 levels').toBeGreaterThanOrEqual(4);
  const l0 = levels[0]!; const l3 = levels[3]!;
  expect([l0.width, l0.height], 'the copy\'s level 0 is the view\'s size').toEqual(CARD.size);
  expect([l3.width, l3.height], 'level 3 is an eighth of it').toEqual([W / 8, H / 8]);
  const copyOff = (img: F32Image, x: number, y: number, want: readonly number[]): boolean => [0, 1, 2].some((c) => Math.abs(img.at(x, y)[c]! - want[c]!) > CODE);
  let level0Off = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (copyOff(l0, x, y, opaque.at(x, y))) { if (level0Off++ === 0) off.push({ x, y, text: `the copy's level 0 at (${x}, ${y}) is (${l0.at(x, y).slice(0, 3).map((v) => v.toFixed(4)).join(', ')}), not the opaque frame's (${opaque.at(x, y).slice(0, 3).map((v) => v.toFixed(4)).join(', ')})` }); }
  let level3Off = 0;
  for (let j = 0; j < H / 8; j++) {
    for (let i = 0; i < W / 8; i++) {
      const mean = [0, 0, 0];
      for (let y = j * 8; y < j * 8 + 8; y++) for (let x = i * 8; x < i * 8 + 8; x++) for (let c = 0; c < 3; c++) mean[c]! += l0.at(x, y)[c]! / 64;
      if (copyOff(l3, i, j, mean) && level3Off++ === 0) off.push({ x: i, y: j, text: `the copy's level 3 texel (${i}, ${j}) isn't the 8 × 8 mean of level 0` });
    }
  }
  const at3 = (u: number, v: number, c: number): number => bilinear(l3.width, l3.height, (i, j) => l3.at(i, j)[c]!, u * l3.width - 0.5, v * l3.height - 0.5, false);
  each((x, y) => {
    const u = (x + 0.5) / W; const v = (y + 0.5) / H;
    const want = lum([at3(u, v, 0), at3(u, v, 1), at3(u, v, 2)]); const got = card3.at(x, y);
    const worst = Math.max(...[0, 1, 2].map((c) => Math.abs(got[c]! - want)));
    if (worst > CODE) off.push({ x, y, text: `lod 3: pixel (${x}, ${y}) reads ${got[0]!.toFixed(4)}, not lum of level 3 of the opaque copy, ${want.toFixed(4)}` });
  });
  console.log(`${AC[7]}${planted ? ` (${planted})` : ''}: ${off.length} problems${off.length ? `; first: ${off[0]!.text}` : ''}`);
  return off;
}

describe(`${AC[7]} backdrop reads only the opaque scene`, () => {
  it(`${AC[7]} each card pixel is the luminance of the opaque frame behind it at lod 0 and of the copy's level 3 at lod 3, within 1 code, none of the pane's red; on an opaque card the graph is refused naming the step`, () => {
    requireGpu();
    expect(backdropProblems().slice(0, 20).map((o) => o.text)).toEqual([]);
    const dir = out();
    const reply = run(bin(), dir, [view3dCall({ doc: writeJson(dir, 'opaque-card.json', cardDoc('card-431', { lod: 0, card: 'opaque' })), size: CARD.size, targets: ['linear'] })])[0]!;
    expect(reply['code'], `the opaque card's document is refused at its check: ${shown(reply).slice(0, 600)}`).toBe('refused');
    const issues = (reply['issues'] as JsonObject[] | undefined) ?? [];
    const rule = errors({ outcome: 'refused', issues, reached: [], raw: reply }, 'operator_kind_rule').filter((e) => names(e, 'b'));
    expect(rule.length, `an operator_kind_rule error names step b: ${shown(issues)}`).toBeGreaterThan(0);
  }, 1_800_000);
  it(`${AC[7]} a planted copy taken after see-through parts (--planted backdrop_after_see_through) shows the pane's red through the card and fails, naming the pixel`, () => {
    requireGpu();
    const off = backdropProblems('backdrop_after_see_through');
    const named = off.filter((o) => /^lod 0: pixel \(\d+, \d+\) \(over the pane\)/.test(o.text));
    expect(named.length, `the check names a card pixel over the pane: ${off.slice(0, 5).map((o) => o.text).join('; ')}`).toBeGreaterThan(0);
  }, 1_800_000);
});
