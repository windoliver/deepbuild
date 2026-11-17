// AC4 #2031.fd03b852: "In a lit group with ambient 0.25, an `unlit` text and a status badge have the same pixel hash over
// their bounds as in the fixture with no `light`, while a white rectangle beside them reads 137. A planted pass that
// lights every child darkens the badge and fails, naming the item"
//
// A 480 × 200 document. The group `lamps` holds `light: {ambient: 0.25, lights: []}` and three children: `badge`, a
// 120 × 40 rect whose fill a status binding gives (source a verdict, pinned `pass`); `label`, the text "Menu" in the
// colored role `accent` with `unlit: true`; and `sheet`, a white rect beside them. Its twin is the same document with the
// group's `light` removed. Both are drawn as the app's window shows them (`window2d`, Metal: the writer layer, then the
// status marks and their legend at the top right, clear of every box read here). The pixel hash over an item's bounds
// is SHA-256 of the RGBA bytes inside its box (helpers `boxHash`): the badge's box, and the label's box at its
// position. Both documents also hold `swatch`, a three-stop gradient rect outside the group, so the writer layer takes
// the GPU layer with or without the light, and the two frames come from one renderer (README: Readings).
// Wrong programs: the base (no light read: the sheet stays 255), a pass that lights every child or skips `unlit`, a
// status color lit, `deep-gpu run --planted light_every_child`.
import { describe, expect, it } from 'vitest';
import {
  AC, boxHash, doc, failsNaming, group, item, none, offBy, px, rect, requireMetal, unlitTwin, useBin, useDir, WHITE, windows,
  type Image, type JsonObject,
} from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-gpu');
const dir = useDir();
const VERDICT = 'verdict:01JB2031000000000000000001';
const STATES: JsonObject = { [VERDICT]: 'pass' };
const BOXES: Record<'badge' | 'label' | 'sheet', [number, number, number, number]> = {
  badge: [24, 24, 120, 40],
  label: [24, 120, 140, 40],
  sheet: [200, 120, 120, 56],
};
const lit = doc('lit-interface', [480, 200], [
  group('lamps', 'a0', { ambient: 0.25, lights: [] }),
  item('badge', 'rect@1', 'a1', { box: BOXES.badge }, { parent: 'lamps' }),
  item('label', 'text@1', 'a2', { text: 'Menu', font: 'body', size: 24, box: { w: BOXES.label[2], h: BOXES.label[3] }, autosize: 'none', paint: { fill: { role: 'accent' } }, unlit: true }, { parent: 'lamps', at: { pos: [BOXES.label[0], BOXES.label[1], 0] } }),
  rect('sheet', 'a3', BOXES.sheet, 'lamps'),
  item('swatch', 'rect@1', 'a4', { box: [360, 136, 96, 40], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: WHITE }, { at: 0.5, role: 'accent' }, { at: 1, role: 'focus' }] } } } }),
], { status_bindings: { 'badge-state': { target: 'items/badge/params/paint/fill', source: VERDICT } } });

/** What the criterion holds: the badge's and the label's hashes as without the light, the sheet at 137; each failure names its item. */
function judged(withLight: Image, without: Image): string[] {
  const failures: string[] = [];
  for (const id of ['badge', 'label'] as const) {
    const [a, b] = [boxHash(withLight, BOXES[id]), boxHash(without, BOXES[id])];
    if (a !== b) failures.push(`${id}: the pixel hash over its bounds [${BOXES[id].join(', ')}] is ${a.slice(0, 16)} in the lit group, ${b.slice(0, 16)} in the fixture with no light`);
  }
  const [x, y, w, h] = BOXES.sheet;
  let off = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (offBy(withLight, i, j, 137) > 1) off++;
  if (off) failures.push(`sheet: ${off} of ${w * h} pixels are more than 1 code off 137, such as (${x + 4}, ${y + 4}) at ${px(withLight, x + 4, y + 4).slice(0, 3).join(', ')}`);
  return failures;
}
const sum = (im: Image, [x, y, w, h]: [number, number, number, number]): number => {
  let s = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) s += px(im, i, j).slice(0, 3).reduce((a, c) => a + c, 0);
  return s;
};

describe(`${ID} unlit text and a status badge in a lit group keep full brightness`, () => {
  it(`${ID} the unlit text and the status badge hash as in the fixture with no light, and the white rect beside them reads 137`, () => {
    requireMetal();
    const [withLight, without] = windows(bin(), dir(), [lit, unlitTwin(lit, 'lamps')], { states: STATES });
    none(judged(withLight!, without!), 'the lit group against the fixture with no light');
  });

  it(`${ID} a planted pass that lights every child darkens the badge and fails, naming the item`, () => {
    requireMetal();
    const [without] = windows(bin(), dir(), [unlitTwin(lit, 'lamps')], { states: STATES });
    const [planted] = windows(bin(), dir(), [lit], { states: STATES, planted: 'light_every_child' });
    expect(sum(planted!, BOXES.badge), 'the planted pass darkens the badge: less light over its bounds than in the fixture with no light').toBeLessThan(sum(without!, BOXES.badge));
    failsNaming(judged(planted!, without!), 'badge', 'the planted pass that lights every child');
  });
});
