import { describe, expect, it } from 'vitest';
import {
  LOOK, check, clean, cleanRole, cleanStatus, clone, codeError, deltaE, errorsOf, expectRefused, firstDifference,
  fixture, holdsString, isObject, itemOf, items, lookRole, obj, oklabOf, pixel, raster, rasterInput, scratch, toEncoded,
  toLinear, useRenderBinary, type JsonObject, type Rgb,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('adjust');

const IDENTITY: JsonObject = { contrast: 1, exposure: 0, gamma: 1, invert: false };

/**
 * The document with the identity adjust on every item that draws (a scale and a mask draw nothing), except
 * a status mark, which no adjust may reach (Item and kind: adjust, "It can never: Adjust a status color").
 */
function withIdentity(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const sb = doc['status_bindings'];
  const bindings = isObject(sb) ? Object.values(sb) : [];
  const statusMarks = new Set(bindings.map((b) => String(obj(b, 'status binding')['target']).split('/')[1]));
  for (const [id, value] of Object.entries(items(out))) {
    const item = obj(value, `items.${id}`);
    if (item['kind'] === 'scale@1' || item['kind'] === 'mask@1' || statusMarks.has(id)) continue;
    item['adjust'] = { ...IDENTITY };
  }
  return out;
}

/** Exposure scales linear light by 2^EV (Item and kind: adjust), so EV 1 doubles it: unrounded codes. */
const doubled = (c: Rgb): [number, number, number] => c.map((v) => 255 * toEncoded(Math.min(1, 2 * toLinear(v / 255)))) as [number, number, number];

const SWATCHES = ['g30', 'g60', 'g100', 'g128', 'g160', 'g180', 'c1', 'c2'];
/** Each role twice: as it is on the top row, with `exposure: 1` on the bottom row. */
function exposureDoc(): JsonObject {
  const entries: [string, JsonObject][] = [];
  SWATCHES.forEach((role, i) => {
    for (const [row, y] of [['plain', 16], ['exposed', 80]] as const) {
      const id = `${row}-${role.replace('.', '-')}`;
      entries.push([id, {
        id, kind: 'rect@1', layer: 'main', name: `${role} ${row}`, order: `a${row === 'plain' ? 0 : 1}${i}`,
        params: { box: [16 + 64 * i, y, 48, 48], paint: { fill: { role } } },
        ...(row === 'exposed' ? { adjust: { exposure: 1 } } : {}),
      }]);
    }
  });
  return {
    format: 1, id: 'adjust-exposure', profile: 'figure', title: 'Exposure', description: 'Eight swatches as they are, and the same eight with an exposure of 1 EV.', size: [528, 144],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items: Object.fromEntries(entries),
  };
}

/** The criterion's check of the bottom row: each swatch within one code value of its role with linear light doubled. */
function exposureFailures(read: (role: string, row: 'plain' | 'exposed') => Rgb): string[] {
  const failures: string[] = [];
  for (const role of SWATCHES) {
    const want = doubled(lookRole(role));
    const got = read(role, 'exposed');
    if (codeError(got, want) > 1) failures.push(`${role} at exposure 1 reads ${JSON.stringify(got)}, not ${JSON.stringify(want.map((v) => +v.toFixed(2)))} (linear light doubled)`);
  }
  return failures;
}

describe('AC3 the adjust channels: identity changes nothing, exposure is linear light, and the status distance holds', () => {
  it('AC3 adjust with contrast 1, exposure 0, gamma 1 and invert false changes no pixel', () => {
    const cases: [string, JsonObject | string][] = [
      ['stroke-gradient.figure', LOOK], ['star.figure', LOOK], ['arcs.figure', LOOK], ['marks.figure', LOOK],
      ['groups.figure', LOOK], ['masks.board', 'clean'],
    ];
    for (const [name, look] of cases) {
      const doc = fixture(name);
      const plain = raster(dir, doc, look, name);
      const adjusted = raster(dir, withIdentity(doc), look, `${name} with the identity adjust`);
      expect(firstDifference(plain.image, adjusted.image), `${name}: the identity adjust on every item changes no pixel`).toBeNull();
    }
  }, 600_000);

  it('AC3 exposure 1 doubles linear light within one code value', () => {
    // The check can fail: doubling the encoded values instead misses by tens of code values.
    const encoded = exposureFailures((role) => lookRole(role).map((v) => Math.min(255, 2 * v)) as Rgb);
    expect(encoded.length, 'doubling encoded values fails this check').toBeGreaterThan(4);

    const { image } = raster(dir, exposureDoc(), LOOK, 'exposure');
    const read = (role: string, row: 'plain' | 'exposed'): Rgb => {
      const i = SWATCHES.indexOf(role);
      return pixel(image, 16 + 64 * i + 24, row === 'plain' ? 40 : 104);
    };
    for (const role of SWATCHES) expect(read(role, 'plain'), `${role} with no adjust draws its role exactly`).toEqual(lookRole(role));
    expect(exposureFailures(read), 'the swatches at exposure 1').toEqual([]);
  }, 300_000);

  it('AC3 wherever status can show, an adjust that brings a role the item uses within the status distance is refused naming the role', () => {
    // The fixture shows status (a status mark bound to a verdict). Its `muted-exposed` swatch is the
    // look's muted role at exposure 1; at exposure −1 that role comes within the look's distance of a
    // status color. Computed here from the clean look, so the fixture is checked before it is used.
    const { colors, min } = cleanStatus();
    const muted = cleanRole('muted');
    const at = (ev: number): Rgb => muted.map((v) => Math.round(255 * toEncoded(Math.min(1, toLinear(v / 255) * 2 ** ev)))) as Rgb;
    const nearest = (c: Rgb): number => Math.min(...Object.values(colors).map((s) => deltaE(oklabOf(c), oklabOf(s))));
    expect(nearest(at(-1)), 'muted at exposure −1 is within the status distance of a status color').toBeLessThan(min);
    expect(nearest(at(1)), 'muted at exposure 1 is not').toBeGreaterThan(min);
    expect(nearest(muted), 'muted itself is not').toBeGreaterThan(min);
    expect(clean()['id'], 'the clean look').toBe('clean');

    const doc = fixture('adjust.board');
    const fine = check(doc, 'clean');
    expect(errorsOf(fine).map((e) => `${e.code} ${e.ids.join(',')}`), 'the fixture, whose adjusts keep their roles apart from status, passes').toEqual([]);
    raster(dir, doc, 'clean', 'adjust.board');

    const planted = clone(doc);
    obj(itemOf(planted, 'muted-exposed')['adjust'], 'adjust')['exposure'] = -1;
    const errors = errorsOf(check(planted, 'clean'));
    expect(errors.map((e) => e.code), 'the only error is the status distance').toEqual(['status_distance']);
    const issue = errors[0]!;
    expect(issue.ids, 'the error names the item').toContain('muted-exposed');
    expect(issue.path.startsWith('items/muted-exposed/adjust'), `the error is at the item's adjust, got ${issue.path}`).toBe(true);
    const named = Object.fromEntries(Object.entries(issue.raw).filter(([k]) => k !== 'what' && k !== 'fix'));
    expect(holdsString(named, 'muted'), `the error names the role (outside its message text): ${JSON.stringify(issue.raw)}`).toBe(true);
    expectRefused('raster', rasterInput(dir, planted, 'clean'), 'status_distance', 'the adjust brings muted within the status distance');

    // Where status can't show (no status binding: a figure on its own), the same adjust is any palette's.
    const alone = clone(planted);
    delete items(alone)['gate'];
    delete alone['status_bindings'];
    alone['profile'] = 'figure';
    expect(errorsOf(check(alone, 'clean')).map((e) => e.code), 'with no status binding the same adjust passes').toEqual([]);
    raster(dir, alone, 'clean', 'adjust with no status binding');
  }, 300_000);
});
