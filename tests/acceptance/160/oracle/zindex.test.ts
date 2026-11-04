// The stacking oracle (the oracle map's WPT row, criterion AC16): WPT's CSS 2 z-index reftests and the compositing
// isolation reftest, ported as our documents and drawn by `raster`.
//
// Each WPT test here is a reftest against "a filled green square and no red" (or, for the stack tests, three boxes
// stacked blue, orange, yellow from the bottom). The port keeps each test's boxes, sizes, z values and tree order:
// a CSS box is a rect@1 with `params.z` (none for z-index: auto, which stacks at 0 as our default does), moved by
// (20, 20) onto the figure; a CSS wrapper or parent is a group@1, and `isolation: isolate` is `isolate: true`. The
// colours are this suite's look roles: green `dot`, red `rim`, blue `body`, orange `hand`, yellow `petal`. A test
// passes when every pixel of the green square is green and no pixel anywhere is red (or the stack's sample pixels
// are the right box's).
//
// Readings (the parent suite's README: Readings 14 for where z lives):
// - WPT's integer z values pass to our f32 z as numbers; −2147483649 sits below −100 in f32 as in CSS's clamp.
// - z-index-abspos-001 (a z −1 child under its z: auto parent's green background) has no background on our group,
//   so its rule, a negative z sinking under earlier z 0 content outside its own non-isolated group, is ported with
//   the green box in one group and the red z −1 box in a later one.
// - isolation-establishes-stacking-context (a z −1 child stays above its isolated parent's red background) is
//   ported the same way: the red box first at the top level, the green z −1 box inside an isolated group after it.
//   Isolated, the group draws as one unit at its own z 0 and the green covers the red; its twin without isolation
//   lets the green sink under the red, as z-index-abspos-001 has it.
// - z-index-dynamic-001 changes z from −1 to 1 after load; here a z channel keyed −1 at 0 s and 1 at 1 s, drawn
//   at 1 s.
// No planted value reaches z or isolation; the base, which ignores z on rect@1, is the wrong program that fails
// these tests (BASE-FAILURE.txt), and the isolation case carries its own twin.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, figure, fl, item, keyed, pixel, raster, role, same, scratch, useRenderBinary, type Image, type JsonObject,
  type Pt, type Rgb,
} from '../helpers.ts';

useRenderBinary();
const dir = scratch('oracle-zindex');
const GREEN = role('dot'); const RED = role('rim');
const BLUE = role('body'); const ORANGE = role('hand'); const YELLOW = role('petal');
const O = 20; // CSS (0, 0) is (20, 20) here

let n = 0;
const box = (id: string, x: number, y: number, w: number, h: number, fill: string, z: number | null, extra: JsonObject = {}): JsonObject => {
  n += 1;
  return item(id, 'rect@1', `a${n}`, { box: [O + x, O + y, w, h], paint: { fill: { role: fill } }, ...(z === null ? {} : { z }) }, extra);
};
const group = (id: string, params: JsonObject = {}, extra: JsonObject = {}): JsonObject => { n += 1; return item(id, 'group@1', `a${n}`, params, extra); };
const doc = (id: string, list: JsonObject[], extra: JsonObject = {}): JsonObject => figure(id, [200, 200], list, extra);

/** Every pixel of the 100 × 100 square at CSS (0, 0) is green, and no pixel of the image is red. */
function greenSquareFailures(image: Image, what: string): string[] {
  const out: string[] = [];
  let notGreen = 0; let first = '';
  for (let y = O; y < O + 100; y++) for (let x = O; x < O + 100; x++) if (!same(pixel(image, x, y), GREEN)) { notGreen++; if (!first) first = `(${x}, ${y}) reads ${JSON.stringify(pixel(image, x, y))}`; }
  if (notGreen) out.push(`${what}: ${notGreen} pixels of the square are not green, first ${first}`);
  let red = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (same(pixel(image, x, y), RED)) red++;
  if (red) out.push(`${what}: ${red} red pixels`);
  return out;
}
const draw = (d: JsonObject, what: string, t = 0): Image => raster(dir, d, what, t).image;

describe('AC16 WPT CSS 2 z-index and isolation, ported', () => {
  it('AC16 z-index-001, -007 and -010: a greater z draws in front though it comes first in the tree', () => {
    const cases: [string, number, number | null][] = [
      ['z-index-001', -100, -2147483649], // green −100 over red below the 32-bit minimum
      ['z-index-007', 5, null], // green 5 over red auto
      ['z-index-010', 2147483647, 100], // green at the 32-bit maximum over red 100
    ];
    const failures = cases.flatMap(([name, greenZ, redZ]) => {
      n = 0;
      const d = doc(`oracle-${name}`, [group('wrapper'), box('div1', 0, 0, 100, 100, 'dot', greenZ, { parent: 'wrapper' }), box('div2', 0, 0, 100, 100, 'rim', redZ, { parent: 'wrapper' })]);
      return greenSquareFailures(draw(d, name), name);
    });
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);

  it('AC16 z-index-stack-001 and -002, z-index-005 and -013: boxes stack by z, and at equal z by tree order', () => {
    const samples: [Pt, Rgb, string][] = [[[15, 15], BLUE, 'blue'], [[45, 45], ORANGE, 'orange'], [[40, 80], ORANGE, 'orange'], [[75, 75], YELLOW, 'yellow'], [[100, 100], YELLOW, 'yellow']];
    const stack = (name: string, boxes: [string, number, string, number][]): string[] => {
      n = 0;
      const d = doc(`oracle-${name}`, [group('div1'), ...boxes.map(([id, at, fill, z]) => box(id, at, at, 96, 96, fill, z, { parent: 'div1' }))]);
      const image = draw(d, name);
      return samples.flatMap(([[x, y], want, label]) => (same(pixel(image, O + x, O + y), want) ? [] : [`${name}: CSS (${x}, ${y}) reads ${JSON.stringify(pixel(image, O + x, O + y))}, not ${label}`]));
    };
    const failures = [
      // stack-001: tree order orange (z 2), yellow (z 3), blue (z 1); 1in = 96 px, boxes 30 px apart
      ...stack('z-index-stack-001', [['div2', 30, 'hand', 2], ['div3', 60, 'petal', 3], ['div4', 0, 'body', 1]]),
      // stack-002: blue, orange, yellow, all z 1
      ...stack('z-index-stack-002', [['div2', 0, 'body', 1], ['div3', 30, 'hand', 1], ['div4', 60, 'petal', 1]]),
    ];
    for (const [name, redZ] of [['z-index-005', 0], ['z-index-013', null]] as [string, number | null][]) {
      n = 0;
      const d = doc(`oracle-${name}`, [group('wrapper'), box('div1', 0, 0, 100, 100, 'rim', redZ, { parent: 'wrapper' }), box('div2', 0, 0, 100, 100, 'dot', null, { parent: 'wrapper' })]);
      failures.push(...greenSquareFailures(draw(d, name), name));
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);

  it('AC16 z-index-abspos-001\'s rule across groups: a z −1 box in a later group draws under the z 0 box before it', () => {
    n = 0;
    const d = doc('oracle-z-index-abspos-001', [
      group('background'), box('green', 0, 0, 160, 150, 'dot', null, { parent: 'background' }),
      group('later'), box('negative', 0, 0, 120, 100, 'rim', -1, { parent: 'later' }),
    ]);
    const failures = greenSquareFailures(draw(d, 'z-index-abspos-001'), 'z-index-abspos-001');
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);

  it('AC16 isolation-establishes-stacking-context: an isolated group keeps its z −1 child inside it, over the red before it; without isolation the child sinks under the red', () => {
    const isolation = (isolate: boolean): JsonObject => {
      n = 0;
      return doc('oracle-isolation', [
        box('background', 0, 0, 100, 100, 'rim', null),
        group('parent', isolate ? { isolate: true } : {}),
        box('child', 0, 0, 100, 100, 'dot', -1, { parent: 'parent' }),
      ]);
    };
    const failures = greenSquareFailures(draw(isolation(true), 'the isolated parent'), 'isolated');
    expect(failures, failures.join('\n')).toEqual([]);
    expect(pixel(draw(isolation(false), 'the parent not isolated'), O + 50, O + 50), 'the twin without isolation: the z −1 child sinks under the red').toEqual(RED);
  }, TIMEOUT);

  it('AC16 z-index-dynamic-001: z changed from −1 to 1 brings the green box from under the red to over it', () => {
    n = 0;
    const d = doc('oracle-z-index-dynamic-001', [
      group('holder'), box('test', 0, 0, 100, 100, 'dot', -1, { parent: 'holder' }),
      box('red-layer', 0, 0, 100, 100, 'rim', null),
    ], { transport: { span: '2s' }, channels: { 'test-z': keyed('items/test/params/z', [[0, -1], [1, 1]]) } });
    expect(pixel(draw(d, 'before the change', 0), O + 50, O + 50), 'at 0 s, z −1, the red layer is over the green').toEqual(RED);
    const failures = greenSquareFailures(draw(d, 'after the change', fl(1)), 'z-index-dynamic-001 at 1 s');
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});
