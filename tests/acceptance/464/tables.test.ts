// #464.6ebf11ae: "An item whose `table` channel keys `flash` at 1.00 s and `none` at 1.05 s draws every pixel it covers
// through the flash table on the frames in that span and through the base table before and after, played straight and
// after a seek to 1.02 s, while a child naming `frozen` keeps `frozen`; a table that would remap a protected index is
// refused at check, naming the table and the index"
//
// An indexed look (palette ground, body, flashc, ice, guard; `guard` protected) with tables `flash` (body → flashc) and
// `frozen` (body → ice). The group `hero` has `table: none` and a channel `items/hero/table` (type enum, hold) keyed
// `flash` at 1.00 s and `none` at 1.05 s; its children are `hero-body` (role body, target (40, 40)–(80, 80)), which
// names no table, and `hero-cape` (role body, target (90, 40)–(120, 80)) with `table: frozen`. At 100 fps the span is
// frames 100 to 104. Played straight from frame 0: every pixel of hero-body holds flashc's index on frames 100 and 104
// and body's on 99 and 105; hero-cape holds ice's on all four. After a cold seek to 1.02 s (frame 102) and on to 105:
// flashc at 102, body at 105, ice throughout. A look whose table `bad` maps the protected guard to body is refused before
// any frame is drawn, the refusal naming `table: "bad"` and `index: 4` (guard's index).
import { describe, expect, it } from 'vitest';
import {
  AC, type Indices, TARGET, doc2d, film2d, frameAt, FRAME_SIZE, indexedLook, item, none, readIndices, rect, requireGpu, runGpu, shown, tbox, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const COLORS = { body: '#2c3e7b', flashc: '#ffd9a0', ice: '#a8d8ff', guard: '#5f7f3b' };
const PALETTE = ['body', 'flashc', 'ice', 'guard'];
const index = (role: string): number => ['ground', ...PALETTE].indexOf(role);
const DOC = doc2d('flash-464', FRAME_SIZE, [
  item('hero', 'group@1', 'a0', {}, { table: 'none' }),
  rect('hero-body', 'a0', tbox(40, 40, 40, 40), 'body', { parent: 'hero' }),
  rect('hero-cape', 'a1', tbox(90, 40, 30, 40), 'body', { parent: 'hero', table: 'frozen' }),
], {
  channels: { flash: { target: 'items/hero/table', type: 'enum', keys: { k0: { t: '0s', value: 'none', interp: 'hold' }, k1: { t: '1s', value: 'flash', interp: 'hold' }, k2: { t: '1.05s', value: 'none', interp: 'hold' } } } },
});
const TABLES = { flash: { body: 'flashc' }, frozen: { body: 'ice' } };

/** Every pixel of a box in target pixels holds `role`'s index; failures name the frame and the item. */
function holds(idx: Indices, box: [number, number, number, number], role: string, what: string): string[] {
  const [x0, y0, w, h] = box;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (idx.at(x, y) !== index(role)) return [`${what}: pixel (${x}, ${y}) holds index ${idx.at(x, y)}, not ${role}'s ${index(role)}`];
  return [];
}

describe(`${AC[9]} a palette table chosen by an enum channel, inherited by children, and protected indices refused`, () => {
  it(`${AC[9]} the hero draws through flash from 1.00 s to before 1.05 s and through the base table around it, played and after a seek to 1.02 s, while the child naming frozen keeps frozen`, () => {
    requireGpu();
    const look = indexedLook('flash-464', COLORS, PALETTE, { tables: TABLES, protected: ['guard'] });
    const [played, seeked] = runGpu(bins.bin('deep-gpu'), out(), [
      film2d(DOC, look, { fps: 100, frames: 106, capture: [99, 100, 104, 105], targets: ['indices'] }),
      film2d(DOC, look, { fps: 100, from: 102, frames: 4, capture: [102, 105], targets: ['indices'] }),
    ]);
    const problems: string[] = [];
    const check = (reply: typeof played, n: number, how: string): void => {
      const idx = readIndices(out(), frameAt(reply!, n, `${how}, frame ${n}`), TARGET, `${how}, frame ${n}`);
      const flash = n >= 100 && n < 105;
      problems.push(...holds(idx, [40, 40, 40, 40], flash ? 'flashc' : 'body', `${how}, frame ${n} (${(n / 100).toFixed(2)} s): hero-body`));
      problems.push(...holds(idx, [90, 40, 30, 40], 'ice', `${how}, frame ${n} (${(n / 100).toFixed(2)} s): hero-cape, which names frozen`));
    };
    for (const n of [99, 100, 104, 105]) check(played, n, 'played straight');
    for (const n of [102, 105]) check(seeked, n, 'after a seek to 1.02 s');
    none(problems, `${AC[9]} the keyed table`);
  });

  it(`${AC[9]} a table that would remap a protected index is refused at check, naming the table and the index`, () => {
    requireGpu();
    const look = indexedLook('bad-table-464', COLORS, PALETTE, { tables: { ...TABLES, bad: { guard: 'body' } }, protected: ['guard'] });
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(DOC, look, { frames: 1, capture: [0], targets: ['indices'] })]);
    expect(typeof r!['code'], `the look is refused at check, before any frame is drawn: ${shown(r)}`).toBe('string');
    expect(r!['frames'], 'no frame is drawn').toBeUndefined();
    expect(r!['table'], `the refusal names the table: ${shown(r)}`).toBe('bad');
    expect(r!['index'], `the refusal names the protected index, guard's ${index('guard')}: ${shown(r)}`).toBe(index('guard'));
  });
});
