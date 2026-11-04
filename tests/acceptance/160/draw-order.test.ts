// AC15: "draw_order moves a hand from behind the body to in front exactly on its key, and seeking equals playing"
// AC16: "A dot in group A with z 1 draws over a line in group B with z 0 though B comes later; inside an isolated
// group the same dot stays under B, with the notice `z_inside_isolated`"
//
// Through `raster` and `check`. `draw_order` and `z` are read as the item's params, so their channels target
// `items/<id>/params/draw_order` and `items/<id>/params/z` (README: Readings). draw_order is an enum channel: its
// value holds from its key until the next, so the swap lands on the key's flick, never a flick before. A play is one
// process drawing the times in order; each seek is a fresh process drawing one. Groups A and B are `group-a` and
// `group-b` (IDs are lower case).
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, check, clone, enumChannel, expectClean, figure, firstDifference, fl, item, items, obj, pixel, raster,
  rasterPlay, role, scratch, useRenderBinary, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('draw-order');

// ---------------------------------------------------------------------------------------------------
// AC15

const KEY = fl(1);
const puppet = figure('draw-order', [260, 220], [
  item('rig', 'group@1', 'a0', {}),
  item('body', 'rect@1', 'a1', { box: [60, 60, 120, 120], paint: { fill: { role: 'body' } } }, { parent: 'rig' }),
  item('hand', 'rect@1', 'a2', { box: [150, 100, 80, 40], paint: { fill: { role: 'hand' } }, draw_order: 'back' }, { parent: 'rig' }),
], { transport: { span: '2s' }, channels: { 'hand-order': enumChannel('items/hand/params/draw_order', [[0, 'back'], [1, 'front']]) } });
const OVERLAP: [number, number] = [165, 120]; // inside both the body and the hand

describe('AC15 draw_order as an enum channel', () => {
  it('AC15 draw_order moves a hand from behind the body to in front exactly on its key', () => {
    expectClean(puppet, 'the puppet');
    const times = [0, fl(0.5), KEY - 1, KEY, fl(1.5)];
    const drawn = rasterPlay(dir, puppet, times, 'the puppet');
    const at = (i: number): number[] => pixel(drawn[i]!.image, ...OVERLAP);
    expect(at(0), 'at 0 s the hand is behind the body').toEqual(role('body'));
    expect(at(1), 'at 0.5 s the hand is behind the body').toEqual(role('body'));
    expect(at(2), 'one flick before the key the hand is still behind the body').toEqual(role('body'));
    expect(at(3), 'on the key the hand is in front').toEqual(role('hand'));
    expect(at(4), 'after the key the hand stays in front').toEqual(role('hand'));
    expect(pixel(drawn[0]!.image, 200, 120), 'the hand shows where the body isn\'t').toEqual(role('hand'));
  }, TIMEOUT);

  it('AC15 seeking equals playing across the swap', () => {
    const times = [...Array.from({ length: 37 }, (_, k) => fl(k / 24)), KEY - 1].sort((a, b) => a - b);
    const drawn = rasterPlay(dir, puppet, times, 'the puppet played');
    for (const t of [fl(0.5), KEY - 1, KEY, fl(1.5)]) {
      const seek = raster(dir, puppet, `the puppet seeked to ${t}`, t);
      // The seek lands on the right side of the swap, so the two can't agree by both ignoring draw_order.
      expect(pixel(seek.image, ...OVERLAP), `the seek to ${t} flicks shows the hand ${t < KEY ? 'behind' : 'in front of'} the body`).toEqual(role(t < KEY ? 'body' : 'hand'));
      expect(firstDifference(seek.image, drawn[times.indexOf(t)]!.image), `at ${t} flicks the seek draws the play's pixels`).toBeNull();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC16

function groups(isolate: boolean, dotZ = 1): JsonObject {
  return figure('z-order', [260, 200], [
    item('group-a', 'group@1', 'a0', isolate ? { isolate: true } : {}),
    item('dot', 'circle@1', 'a1', { center: [120, 100], r: 30, z: dotZ, paint: { fill: { role: 'dot' } } }, { parent: 'group-a' }),
    item('group-b', 'group@1', 'a2', {}),
    item('line', 'rect@1', 'a3', { box: [40, 90, 200, 20], z: 0, paint: { fill: { role: 'line' } } }, { parent: 'group-b' }),
  ]);
}

describe('AC16 z across the tree, and inside an isolated group', () => {
  it('AC16 a dot in group A with z 1 draws over a line in group B with z 0 though B comes later', () => {
    const doc = groups(false);
    expectClean(doc, 'the two groups');
    expect(pixel(raster(dir, doc, 'z 1 over z 0').image, 120, 100), 'the dot (z 1) draws over the line (z 0)').toEqual(role('dot'));
    expect(pixel(raster(dir, groups(false, 0), 'both at z 0').image, 120, 100), 'at equal z the tree\'s order holds: B\'s line over A\'s dot').toEqual(role('line'));
    expect(check(doc).issues.filter((i) => i.code === 'z_inside_isolated'), 'no group is isolated, so no notice').toEqual([]);
  }, TIMEOUT);

  it('AC16 inside an isolated group the same dot stays under B, with the notice z_inside_isolated', () => {
    const doc = groups(true);
    const result = check(doc);
    expect(result.ok, 'a notice doesn\'t refuse the document').toBe(true);
    const notices = result.issues.filter((i) => i.code === 'z_inside_isolated');
    expect(notices.map((n) => n.severity), 'one notice z_inside_isolated').toEqual(['notice']);
    expect(notices[0]!.ids, 'it names the dot').toContain('dot');
    expect(pixel(raster(dir, doc, 'the dot inside isolated A').image, 120, 100), 'isolated A draws as one unit at its own z, under B').toEqual(role('line'));
    const lifted = clone(doc);
    obj(obj(items(lifted)['group-a'], 'group-a')['params'], 'group-a.params')['isolate'] = false;
    expect(pixel(raster(dir, lifted, 'A no longer isolated').image, 120, 100), 'the same document with A not isolated draws the dot on top').toEqual(role('dot'));
  }, TIMEOUT);
});
