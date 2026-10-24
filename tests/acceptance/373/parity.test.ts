import { describe, expect, it } from 'vitest';
import {
  LOOK, arr, batch, check, clone, errorsOf, expectClean, expectRefused, firstDifference, fixture, inked, itemOf,
  items, lookRole, obj, paramsOf, pixel, raster, rasterInput, rasterTwiceInOneProcess, same, scratch,
  useRenderBinary, type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('parity');
const WHITE: Rgb = [255, 255, 255]; // the ground in this suite's role map and in the clean look's light theme

/**
 * The parity fixtures of the marks this task ships (fixtures/parity/2d/), one per mark, each with its
 * planted-fault twin: the same document with one fault planted, which the check must refuse with exactly
 * its code, naming the planted item.
 */
interface Parity { name: string; look: JsonValue; code: string; item: string; plant: (doc: JsonObject) => void }

const FIXTURES: Parity[] = [
  {
    name: 'stroke-gradient.figure', look: LOOK, code: 'status_color_unbound', item: 'stroke-ramp',
    plant: (doc) => {
      const stroke = obj(obj(paramsOf(doc, 'stroke-ramp')['paint'], 'paint')['stroke'], 'stroke');
      obj(arr(obj(stroke['gradient'], 'gradient')['stops'], 'stops')[1], 'stop')['role'] = 'status.pass';
    },
  },
  { name: 'star.figure', look: LOOK, code: 'out_of_range', item: 'burst', plant: (doc) => { paramsOf(doc, 'burst')['points'] = 100.5; } },
  {
    name: 'arcs.figure', look: LOOK, code: 'status_color_unbound', item: 'sector',
    plant: (doc) => { obj(obj(paramsOf(doc, 'sector')['paint'], 'paint')['fill'], 'fill')['role'] = 'status.fail'; },
  },
  {
    name: 'adjust.board', look: 'clean', code: 'status_distance', item: 'muted-exposed',
    plant: (doc) => { obj(itemOf(doc, 'muted-exposed')['adjust'], 'adjust')['exposure'] = -1; },
  },
  {
    name: 'masks.board', look: 'clean', code: 'mask_depth', item: 'm5',
    plant: (doc) => {
      items(doc)['m5'] = { id: 'm5', kind: 'mask@1', layer: 'main', name: 'Mask 5', order: 'a08', parent: 'm4', params: { shape: 'rect', box: [304, 80, 96, 80], applies_to: 'children' } };
      itemOf(doc, 'deep')['parent'] = 'm5';
    },
  },
  {
    name: 'marks.figure', look: LOOK, code: 'key_not_unique', item: 'set-rect',
    plant: (doc) => {
      const key = obj(obj(paramsOf(doc, 'set-rect')['columns'], 'columns')['key'], 'columns.key');
      key['data'] = Buffer.from(new Uint32Array([1, 1, 3]).buffer).toString('base64');
    },
  },
  { name: 'groups.figure', look: LOOK, code: 'cycle', item: 'veil', plant: (doc) => { itemOf(doc, 'veil')['parent'] = 'veil-a'; } },
];

describe('AC4 the 2D marks this task ships render bit-identical Vello CPU rasters, and each parity fixture has a planted-fault twin that fails with its exact issue code', () => {
  for (const f of FIXTURES) {
    it(`AC4 ${f.name}: bit-identical rasters in two processes and twice in one; its twin fails with ${f.code}, naming ${f.item}`, () => {
      const doc = fixture(f.name);
      expectClean(doc, f.look, f.name);
      const a = raster(dir, doc, f.look, `${f.name} (process A)`);
      const b = raster(dir, doc, f.look, `${f.name} (process B)`);
      expect(inked(a.image, WHITE), `${f.name} draws its marks (pixels other than the ground)`).toBeGreaterThan(200);
      expect(firstDifference(a.image, b.image), `${f.name}: two processes draw the same raster`).toBeNull();
      const [c, d] = rasterTwiceInOneProcess(dir, doc, f.look, f.name);
      expect(firstDifference(a.image, c.image), `${f.name}: a second process's first line draws the same raster`).toBeNull();
      expect(firstDifference(c.image, d.image), `${f.name}: the same document drawn again in one process draws the same raster`).toBeNull();

      const planted = clone(doc);
      f.plant(planted);
      const errors = errorsOf(check(planted, f.look));
      expect([...new Set(errors.map((e) => e.code))], `${f.name}'s twin fails with exactly its code`).toEqual([f.code]);
      expect(errors.some((e) => e.ids.includes(f.item)), `${f.name}'s twin names ${f.item}: ${JSON.stringify(errors.map((e) => e.ids))}`).toBe(true);
      expectRefused('raster', rasterInput(dir, planted, f.look), f.code, `${f.name}'s twin is refused by the check`);
    }, 600_000);
  }

  it('AC4 marks.figure: every mark type a mark set holds draws its rows where they are, in its role', () => {
    const { image } = raster(dir, fixture('marks.figure'), LOOK, 'marks.figure');
    const role = (r: string): Rgb => lookRole(r);
    const swatch: Rgb = [200, 30, 160]; // the image asset's one color
    const covered: [string, number, number, Rgb][] = [
      ['point row 1 at its centre', 25, 60, role('m.point')], ['point row 2', 50, 120, role('m.point')], ['point row 3', 75, 180, role('m.point')],
      ['rule row 1', 150, 60, role('m.rule')], ['rule row 3', 150, 180, role('m.rule')],
      ['rect row 1', 250, 60, role('m.rect')], ['rect row 2', 230, 120, role('m.rect')], ['rect row 3', 275, 180, role('m.rect')],
      ['bar row 1, above zero', 320, 200, role('m.bar')], ['bar row 2', 350, 150, role('m.bar')], ['bar row 3, near its top', 380, 30, role('m.bar')],
      ['path, first segment', 450, 60, role('m.path')], ['path, second segment', 490, 120, role('m.path')],
      ['area, under its line', 550, 170, role('m.area')],
      ['symbol row 1 at its centre', 650, 60, role('m.symbol')], ['symbol row 3', 650, 180, role('m.symbol')],
      ['image row 1', 850, 45, swatch], ['image row 2', 850, 115, swatch], ['image row 3', 850, 185, swatch],
    ];
    const empty: [string, number, number][] = [
      ['beside point row 1 (12 u from its centre)', 37, 60], ['between rule rows', 150, 90], ['between rect rows', 275, 120],
      ['above bar row 1 (its value is 25 of 100)', 320, 160], ['above bar row 2', 350, 110], ['inside the path\'s bend (a path is not filled)', 450, 120],
      ['above the area\'s line', 550, 100], ['between symbol rows', 650, 90],
    ];
    const failures: string[] = [];
    for (const [what, x, y, want] of covered) {
      const got = pixel(image, x, y);
      if (!same(got, want)) failures.push(`${what}: pixel (${x}, ${y}) reads ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    }
    for (const [what, x, y] of empty) {
      const got = pixel(image, x, y);
      if (!same(got, WHITE)) failures.push(`${what}: pixel (${x}, ${y}) reads ${JSON.stringify(got)}, not the ground`);
    }
    // Text: each row's "HI" at 40 u has stems wider than a pixel, so the band holds pixels exactly its role.
    let text = 0;
    for (let y = 0; y < 240; y++) for (let x = 700; x < 800; x++) if (same(pixel(image, x, y), role('m.text'))) text++;
    if (text < 60) failures.push(`the text set's band holds ${text} pixels of its role, fewer than 60 for three rows of "HI" at 40 u`);
    expect(failures, 'the nine mark sets').toEqual([]);
  }, 300_000);

  it('AC4 marks.figure: a rect mark set\'s rows draw the same pixels as the same rects as rect@1 items (a reftest)', () => {
    const base = fixture('marks.figure');
    const rows = clone(base);
    for (const id of Object.keys(items(rows))) if (id !== 'set-rect') delete items(rows)[id];
    const single = clone(rows);
    delete items(single)['set-rect'];
    const boxes = [[210, 40, 80, 40], [210, 100, 40, 40], [260, 160, 30, 40]];
    boxes.forEach((box, i) => {
      items(single)[`rect-${i + 1}`] = { id: `rect-${i + 1}`, kind: 'rect@1', layer: 'main', name: `Rect ${i + 1}`, order: `a0${i}`, params: { box, paint: { fill: { role: 'm.rect' } } } };
    });
    const a = raster(dir, rows, LOOK, 'the rect set alone');
    const b = raster(dir, single, LOOK, 'the same rects as items');
    expect(inked(a.image, WHITE), 'the rect set draws its three rows: 80 × 40 + 40 × 40 + 30 × 40 pixels').toBe(80 * 40 + 40 * 40 + 30 * 40);
    expect(firstDifference(a.image, b.image), 'the set\'s rows and the single rects draw the same raster').toBeNull();
  }, 300_000);

  it('AC4 groups.figure: a frame masks its overflow, and a group at half opacity draws its overlapping children as one', () => {
    const { image } = raster(dir, fixture('groups.figure'), LOOK, 'groups.figure');
    expect(pixel(image, 40, 40), 'the frame\'s background').toEqual(lookRole('frame.bg'));
    expect(pixel(image, 150, 80), 'the bar inside the frame').toEqual([0, 0, 0]);
    expect(pixel(image, 200, 80), 'the bar past the frame\'s edge is masked').toEqual(WHITE);
    const overlap = pixel(image, 290, 90); const upper = pixel(image, 240, 50); const lower = pixel(image, 340, 130);
    expect(overlap, 'where the two rects overlap, the group draws as where only one is (one offscreen pass, not two blends)').toEqual(upper);
    expect(lower, 'both rects draw at the group\'s opacity').toEqual(upper);
    // Ink at 0.5 over white, composited in sRGB-encoded space (canvas core: Conventions): 127.5.
    expect(upper.every((c) => c >= 126 && c <= 129), `the group's pixels are ink at half opacity over the ground, about 127.5: ${JSON.stringify(upper)}`).toBe(true);
  }, 300_000);

  it('a raster or geometry line that is not JSON, lacks its document or item, or names an unknown planted value is bad_input with no panic', () => {
    const doc = fixture('star.figure');
    const rasters = batch('raster', ['not json', { look: LOOK, out: `${dir}/x.png` }, { ...rasterInput(dir, doc, LOOK), planted: 'no_such_fault' }]);
    rasters.forEach((r, i) => expect(r, `raster line ${i}`).toEqual({ ok: false, code: 'bad_input' }));
    const shapes = batch('geometry', ['{"doc":', { doc }, { item: 'star5' }]);
    shapes.forEach((r, i) => expect(r, `geometry line ${i}`).toEqual({ ok: false, code: 'bad_input' }));
  }, 300_000);
});
