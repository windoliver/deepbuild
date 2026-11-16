// #458, criterion 13: translating every item, light and the camera of a lit, shadowed, velocity-blurred fixture
// together by (1e7, −3e6, 5e6) m gives a frame within one code value of the untranslated one on 99.9% of pixels, with
// no pixel more than 4 code values off. The fixture (helpers.ts, `translationFixture`): a floor, three shapes and a box
// sliding 4 m/s under a casting sun and a point light, velocity blur on, filmic, 480 × 270, frame 15 of 30 fps; its
// translated side adds the vector to every item's position, the point light's, the camera's position and target and
// the slide's keys. The lane's `relation` call draws both and judges; this file reads the two final frames it returns
// with the same numbers. Wrong programs: the base (no `relation` call) and `--planted absolute_f32_world_positions`
// (world positions uploaded as absolute f32: at 1e7 m an f32 steps by 1 m), which must fail, naming an item.

import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, TRANSLATED_ITEMS, TRANSLATION, callsFor, codeDifferences, colors, drew, heldOf, laneFailsNaming, lanePasses, obj, pngOf,
  requireMetal, runGpu, str, translationFixture, useBuilds, useDir,
  type Held,
} from './helpers.ts';

const bin = useBuilds(['default']);
const dir = useDir();

/** The criterion's measure over the two final frames the lane returned; each failure names the relation. */
function problems(h: Held, out: string): string[] {
  const what = 'translation (read here)';
  const base = pngOf(out, h, 'base', 'final', what); const moved = pngOf(out, h, 'moved', 'final', what);
  expect(colors(base), `${what}: the untranslated frame holds at least 32 colors (fixture)`).toBeGreaterThanOrEqual(32);
  const d = codeDifferences(base, moved);
  const p: string[] = [];
  if (d.within1 < 0.999 * d.pixels) p.push(`translation: ${d.within1} of ${d.pixels} pixels are within one code value of the untranslated frame, under 99.9%`);
  if (d.worst > 4) p.push(`translation: pixel (${d.worstAt[0]}, ${d.worstAt[1]}) is ${d.worst} code values off the untranslated frame, over 4`);
  return p;
}

describe('#458 criterion 13: translation invariance', () => {
  it(`${AC[13]}: the fixture moved by (1e7, −3e6, 5e6) m draws within one code value on 99.9% of pixels and no pixel is more than 4 off`, () => {
    requireMetal();
    const out = dir();
    const f = translationFixture();
    // Fixture checks: the translated side is the base side moved by the criterion's vector, and both draw at the base.
    const pos = (side: string, id: string): number[] => (obj(obj(obj(f.sides[side]!.doc['items'], 'items')[id], id)['at'], `${id}.at`)['pos'] as number[]);
    for (const id of [...TRANSLATED_ITEMS, 'lamp']) pos('moved', id).forEach((v, c) => expect(v - pos('base', id)[c]!, `${id} moves by the criterion's vector (axis ${c})`).toBeCloseTo(TRANSLATION[c]!, 6));
    const m = callsFor(out, f);
    const replies = runGpu(bin('default'), out, [...m.draws, m.relation]);
    m.sides.forEach((side, i) => drew(replies[i]!, `translation: view3d of side ${side}`));
    const h = heldOf(replies[m.sides.length]!, f, 'relation translation');
    expect(problems(h, out), 'the translated frame is within the criterion\'s tolerance of the untranslated one').toEqual([]);
    lanePasses(h, 'relation translation');
  }, TIMEOUT);

  it(`${AC[13]}: a planted renderer that uploads absolute f32 world positions jitters vertices by whole pixels and fails, naming the item`, () => {
    requireMetal();
    const out = dir();
    const f = translationFixture();
    const planted = 'absolute_f32_world_positions';
    const h = heldOf(runGpu(bin('default'), out, [callsFor(out, f).relation], { planted })[0]!, f, `relation translation under --planted ${planted}`);
    const found = problems(h, out);
    expect(found.some((p) => p.includes('code values off')), `--planted ${planted}: a pixel is more than 4 code values off; found: ${found.join(' | ') || 'nothing'}`).toBe(true);
    laneFailsNaming(h, `--planted ${planted}`);
    const item = str(obj(h.first ?? undefined, `--planted ${planted}: first`)['item'], `--planted ${planted}: first.item`);
    expect(TRANSLATED_ITEMS as readonly string[], `--planted ${planted}: the lane names an item of the fixture whose vertices moved, got ${item}`).toContain(item);
    expect(h.reason, `--planted ${planted}: the lane's reason names the item`).toContain(item);
  }, TIMEOUT);
});
