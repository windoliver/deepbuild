import { describe, expect, it } from 'vitest';
import {
  LOOK, PS, PS_MID, alphaOver, arr, check, clone, codeError, distanceFrom, encodedRamp, errorsOf, expectClean, expectRefused,
  figure, lookRole, obj, oklabOf, deltaE, oklabRamp, paramsOf, pixel, raster, rasterInput, psStops, scratch, useRenderBinary,
  type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('paint');

const grad = (extra: JsonObject): JsonObject => ({ stops: psStops(), ...extra });
const rect = (id: string, box: number[], paint: JsonObject, parent?: string) =>
  ({ id, kind: 'rect@1', params: { box, paint }, ...(parent === undefined ? {} : { parent }) });

describe('AC1 a gradient across a box or a group, and a stroke opacity apart from the fill\'s', () => {
  it('AC1 a square\'s gradient from sw to ne reads its first role at the lower left corner and its last at the upper right within one code value', () => {
    // The square is 200 u at (40, 40); sw is its lower left corner (40, 240), ne its upper right (240, 40), y down.
    const doc = figure([280, 280], [rect('square', [40, 40, 200, 200], { fill: { gradient: grad({ kind: 'linear', from: 'sw', to: 'ne' }) } })]);
    expectClean(doc, LOOK, 'the sw to ne gradient over data roles');
    // t of a pixel centre along the sw → ne axis (d = (200, −200)).
    const t = (px: number, py: number): number => ((px + 0.5 - 40) * 200 - (py + 0.5 - 240) * 200) / 80000;
    // The four corner pixels and the centre: a gradient left at its default w → e reads t = 0 at both left
    // corners and 1 at both right ones, so it misses the upper left and the lower right by half the ramp.
    const samples: [number, number][] = [[40, 239], [239, 40], [40, 40], [239, 239], [140, 140], [90, 190], [190, 90]];
    const { image } = raster(dir, doc, LOOK, 'sw to ne square');
    const failures: string[] = [];
    for (const [x, y] of samples) {
      const expected = oklabRamp(PS, t(x, y));
      const e = codeError(pixel(image, x, y), expected);
      if (e > 1) failures.push(`pixel (${x}, ${y}) reads ${JSON.stringify(pixel(image, x, y))}, ${e.toFixed(2)} code values from the ramp at t = ${t(x, y).toFixed(4)}: ${JSON.stringify(expected.map((v) => +v.toFixed(2)))}`);
    }
    expect(failures, 'the square against its sw to ne OKLab ramp').toEqual([]);
    // The corner pixels' centres sit 0.00125 of the ramp in from the corners, so "the first role at the lower
    // left corner within one code value" is read as the ramp at that t (two code values from the bare role).
  }, 300_000);

  it('AC1 with span: parent over three squares in a row, the middle square\'s centre reads the stops\' OKLab midpoint within 0.001 ΔEOK', () => {
    // The group's parts span x 20 to 361 (341 u wide), so the one gradient's t is (x − 20) ÷ 341; the
    // middle square's centre pixel (190, 70) has its centre at x = 190.5, t = 0.5 exactly. Each square on
    // its own would read t = 0.5 at its own centre, so the left and right centres tell the two apart.
    const doc = figure([400, 140], [
      { id: 'row', kind: 'group@1', params: {} },
      rect('left', [20, 20, 100, 100], { fill: { gradient: grad({ kind: 'linear', span: 'parent' }) } }, 'row'),
      rect('middle', [140.5, 20, 100, 100], { fill: { gradient: grad({ kind: 'linear', span: 'parent' }) } }, 'row'),
      rect('right', [261, 20, 100, 100], { fill: { gradient: grad({ kind: 'linear', span: 'parent' }) } }, 'row'),
    ]);
    expectClean(doc, LOOK, 'span: parent over a group\'s three squares');
    // The check can fail: the same midpoint mixed in encoded sRGB is far outside 0.001 ΔEOK.
    const encodedMid = encodedRamp(PS, 0.5);
    expect(deltaE(oklabOf(encodedMid.map(Math.round) as Rgb), PS_MID), 'a midpoint mixed in encoded sRGB is not the OKLab midpoint').toBeGreaterThan(0.01);

    const { image } = raster(dir, doc, LOOK, 'three squares in a row');
    const middle = pixel(image, 190, 70);
    expect(distanceFrom(middle, PS_MID), `the middle square's centre reads ${JSON.stringify(middle)}, ΔEOK from the OKLab midpoint`).toBeLessThanOrEqual(0.001);
    for (const [x, name] of [[70, 'left'], [310, 'right'], [30, 'left edge'], [350, 'right edge']] as [number, string][]) {
      const expected = oklabRamp(PS, (x + 0.5 - 20) / 341);
      expect(codeError(pixel(image, x, 70), expected), `the ${name} sample (${x}, 70) reads the one gradient at t = ${((x + 0.5 - 20) / 341).toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  }, 300_000);

  it('AC1 fill opacity 0.5 under stroke opacity 1 draws the outline\'s centre line at alpha ≥ 0.99 over a fill at 0.5 ± 0.01', () => {
    // A: a rect with its fill at 0.5 and stroke at 1; the stroke is 20 u wide and centred on the box's edge (y = 40 at the top),
    // so rows 39 (over the ground) and 40 (over the fill) are the centre line.
    const fill = lookRole('fill.c'); const stroke = lookRole('stroke.c'); const white: Rgb = [255, 255, 255];
    const doc = figure([220, 160], [rect('a', [30, 40, 160, 80], {
      fill: { role: 'fill.c', opacity: 0.5 }, stroke: { role: 'stroke.c', width: 20, opacity: 1 },
    })]);
    expectClean(doc, LOOK, 'fill opacity 0.5 under stroke opacity 1');
    const { image } = raster(dir, doc, LOOK, 'fill 0.5, stroke 1');
    const fillAlpha = alphaOver(pixel(image, 110, 80), white, fill);
    expect(Math.abs(fillAlpha - 0.5), `the fill at (110, 80) holds alpha ${fillAlpha.toFixed(3)}, not 0.5 ± 0.01`).toBeLessThanOrEqual(0.01);
    const behind: Rgb = pixel(image, 110, 80);
    const overGround = alphaOver(pixel(image, 110, 39), white, stroke);
    const overFill = alphaOver(pixel(image, 110, 40), behind, stroke);
    expect(overGround, `the centre line over the ground (row 39) holds the stroke at alpha ${overGround.toFixed(3)}`).toBeGreaterThanOrEqual(0.99);
    expect(overFill, `the centre line over the fill (row 40) holds the stroke at alpha ${overFill.toFixed(3)}`).toBeGreaterThanOrEqual(0.99);
  }, 300_000);

  it('AC1 the stroke\'s own opacity applies to the stroke alone, and the paint\'s opacity multiplies both', () => {
    const stroke = lookRole('stroke.c'); const fill = lookRole('fill.c'); const white: Rgb = [255, 255, 255];
    const doc = figure([420, 160], [
      // B: a stroke at 0.5 and a fill at 1: the stroke over the ground at 0.5, the fill untouched.
      rect('b', [30, 40, 160, 80], { fill: { role: 'fill.c' }, stroke: { role: 'stroke.c', width: 20, opacity: 0.5 } }),
      // C: paint opacity 0.5 with both at 1: fill and stroke each at 0.5.
      rect('c', [230, 40, 160, 80], { fill: { role: 'fill.c' }, stroke: { role: 'stroke.c', width: 20 }, opacity: 0.5 }),
    ]);
    expectClean(doc, LOOK, 'stroke opacity apart from the fill\'s, and paint opacity');
    const { image } = raster(dir, doc, LOOK, 'stroke 0.5; paint 0.5');
    const near = (a: number, b: number, what: string): void => { expect(Math.abs(a - b), `${what}: alpha ${a.toFixed(3)}, expected ${b}`).toBeLessThanOrEqual(0.01); };
    near(alphaOver(pixel(image, 110, 39), white, stroke), 0.5, 'B\'s stroke over the ground (row 39)');
    expect(codeError(pixel(image, 110, 80), fill), 'B\'s fill at its centre is the role at full strength').toBeLessThanOrEqual(1);
    near(alphaOver(pixel(image, 310, 39), white, stroke), 0.5, 'C\'s stroke over the ground');
    near(alphaOver(pixel(image, 310, 80), white, fill), 0.5, 'C\'s fill');
  }, 300_000);

  it('AC1 a stop\'s opacity is its own: a ramp from opacity 0 to 1 in one role reads that role at alpha t', () => {
    const role = lookRole('fill.c');
    const doc = figure([300, 80], [rect('fade', [20, 20, 256, 40], {
      fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'fill.c', opacity: 0 }, { at: 1, role: 'fill.c', opacity: 1 }] } },
    })]);
    expectClean(doc, LOOK, 'stops with opacity');
    const { image } = raster(dir, doc, LOOK, 'opacity ramp');
    const failures: string[] = [];
    for (let k = 0; k < 16; k++) {
      const x = 20 + 16 * k; const t = (x + 0.5 - 20) / 256;
      const expected = [0, 1, 2].map((i) => 255 + (role[i]! - 255) * t) as [number, number, number];
      const e = codeError(pixel(image, x, 40), expected);
      if (e > 1) failures.push(`column ${x} (t = ${t.toFixed(3)}) reads ${JSON.stringify(pixel(image, x, 40))}, ${e.toFixed(2)} code values from ${JSON.stringify(expected.map((v) => +v.toFixed(1)))}`);
    }
    expect(failures, 'the ramp over the ground').toEqual([]);
  }, 300_000);

  it('AC1 kind: along colors a stroke by arc length from the path\'s start, around a bend where a box-wise gradient differs', () => {
    // M 40 40 L 240 40 L 240 240, 20 u wide: 400 u long, t = arc length ÷ 400. On the second leg a w → e
    // gradient reads t ≈ 1 all the way down (the box is 200 u wide), and on the first leg it reads twice
    // the arc-length t, so either way a box-wise ramp misses by far more than one code value.
    const doc = figure([280, 280], [{ id: 'bend', kind: 'path@1', params: { d: 'M 40 40 L 240 40 L 240 240', paint: { stroke: { width: 20, gradient: grad({ kind: 'along' }) } } } }]);
    expectClean(doc, LOOK, 'an along stroke over data roles');
    const { image } = raster(dir, doc, LOOK, 'along stroke');
    const samples: [number, number, number][] = [ // [pixel x, pixel y, arc length of its centre's projection]
      [60, 40, 20.5], [100, 40, 60.5], [140, 40, 100.5], [200, 40, 160.5],
      [240, 100, 260.5], [240, 140, 300.5], [240, 180, 340.5], [240, 220, 380.5],
    ];
    const failures: string[] = [];
    for (const [x, y, s] of samples) {
      const expected = oklabRamp(PS, s / 400);
      const e = codeError(pixel(image, x, y), expected);
      if (e > 1) failures.push(`pixel (${x}, ${y}) at arc length ${s} reads ${JSON.stringify(pixel(image, x, y))}, ${e.toFixed(2)} code values from the ramp at t = ${(s / 400).toFixed(3)}`);
    }
    expect(failures, 'the stroke at eight arc lengths, against its OKLab ramp').toEqual([]);
  }, 300_000);

  it('AC1 stops naming a status role are refused in a steps fill, an along stroke and a stop with opacity, naming the item', () => {
    // The paint's "can never": name a status role. The base's code for it is status_color_unbound.
    const bad = (id: string, paint: JsonObject) => figure([200, 100], [rect(id, [20, 20, 100, 50], paint)]);
    const docs: [string, JsonObject, string][] = [
      ['steps', bad('s', { fill: { steps: { over: 'children', stops: [{ at: 0, role: 'ps.a' }, { at: 1, role: 'status.pass' }], by: 'order' } } }), 'items/s/params/paint/fill'],
      ['stop opacity', bad('o', { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ps.a', opacity: 0.5 }, { at: 1, role: 'status.fail', opacity: 1 }] } } }), 'items/o/params/paint/fill'],
      ['along', figure([200, 100], [{ id: 'a', kind: 'path@1', params: { d: 'M 20 40 L 180 40', paint: { stroke: { width: 8, gradient: { kind: 'along', stops: [{ at: 0, role: 'status.pass' }, { at: 1, role: 'ps.b' }] } } } } }]), 'items/a/params/paint/stroke'],
    ];
    for (const [name, doc, path] of docs) {
      const errors = errorsOf(check(doc, LOOK));
      expect(errors.map((e) => e.code), `${name}: the only error is the status-color rule`).toEqual(['status_color_unbound']);
      expect(errors[0]?.ids.length, `${name}: the error names the item`).toBe(1);
      expect(errors[0]?.path.startsWith(path), `${name}: the error's path starts ${path}, got ${errors[0]?.path}`).toBe(true);
    }
    expectRefused('raster', rasterInput(dir, docs[2]![1], LOOK), 'status_color_unbound', 'an along stroke names a status role');
    // The same documents with data roles pass, so the check isn't refusing every new field.
    const fixed = clone(docs[2]![1]);
    const stroke = obj(obj(paramsOf(fixed, 'a')['paint'], 'paint')['stroke'], 'stroke');
    const stops = arr(obj(stroke['gradient'], 'gradient')['stops'], 'stops') as JsonValue[];
    obj(stops[0], 'stops[0]')['role'] = 'ps.a';
    expectClean(fixed, LOOK, 'the along stroke over data roles');
  }, 300_000);
});
