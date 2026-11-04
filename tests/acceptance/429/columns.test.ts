// #429.7004cb63: an operator reads a 1,001-row u16 column, a 1,001-row f64 column and a 1,001-element vec3
// attribute, and at rows 0, 1, 712, 713 and 1,000 returns the exact value the CPU column holds, the f64 after its
// checked narrowing to f32. After a patch changes only row 713 of the u16 column, the upload for that column covers
// only the 4-byte word or words holding row 713, and row 712 still reads its value. A planted binding that declares
// the vec3 attribute with a 16-byte stride over packed 12-byte data reads row 1 wrong; a planted partial update
// that writes row 713's 2 bytes alone is refused by the device, and one that re-copies the whole column on that
// patch uploads 4,004 bytes; each fails, naming the column and the row.
//
// The `columns` call (README) puts the columns on a mark set and the attribute on a builder's mesh, binds them to
// a composed compute operator whose inputs are `column: {item, name}` and `attribute: {name, domain}`, and reads
// each input at the rows given back through a readback; then applies the patch and reads again, reporting every
// upload the patch made. The u16 column is copied into 32-bit words (Operator input: Cost), so row 713 is the
// word at byte 2,852 and the whole column is 4,004 bytes. At the base there is no columns call.
import { describe, expect, it } from 'vitest';
import { answered, isObject, objs, requireGpu, run1, shown, useBins, useOut, type JsonValue, type Planted } from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 1001;
const ROWS = [0, 1, 712, 713, 1000];
const u16 = Array.from({ length: N }, (_, r) => (r * 37 + 11) % 65536);
const f64 = Array.from({ length: N }, (_, r) => r * 0.1 + 1 / 3);
const vec3 = Array.from({ length: N }, (_, r) => [r, r + 0.5, -r * 0.25]);
const PATCHED = 60000;
/** Equal as the GPU holds them: integers exactly, f32 values by their f32 (so 71.53333 and its full double agree). */
const same = (g: JsonValue | undefined, w: JsonValue): boolean =>
  Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x))
    : typeof g === 'number' && typeof w === 'number' && Math.fround(g) === Math.fround(w);

function columnProblems(planted?: Planted): string[] {
  const reply = answered(run1(bins.bin(), out(), {
    call: 'columns',
    columns: { c16: { type: 'u16', values: u16 }, c64: { type: 'f64', values: f64 } },
    attributes: { a3: { type: 'vec3', domain: 'point', values: vec3 } },
    rows: ROWS, patch: { column: 'c16', row: 713, value: PATCHED },
  }, planted), 'the columns call');
  const p: string[] = [];
  const reads = (r: JsonValue | undefined, when: string, want: (name: string, row: number) => JsonValue): void => {
    const got = isObject(r) ? r : {};
    for (const name of ['c16', 'c64', 'a3']) {
      const list = Array.isArray(got[name]) ? (got[name] as JsonValue[]) : [];
      ROWS.forEach((row, i) => {
        if (!same(list[i], want(name, row))) p.push(`${name} row ${row} ${when}: read ${shown(list[i])}, not ${shown(want(name, row))}`);
      });
    }
  };
  const held = (name: string, row: number, patched: boolean): JsonValue =>
    name === 'c16' ? (patched && row === 713 ? PATCHED : u16[row]!) : name === 'c64' ? Math.fround(f64[row]!) : vec3[row]!;
  reads(reply['read'], 'before the patch', (n, r) => held(n, r, false));
  const patch = isObject(reply['patch']) ? reply['patch'] : {};
  const uploads = objs(patch['uploads'] ?? [], 'patch.uploads').filter((u) => u['column'] === 'c16');
  if (uploads.length === 0) p.push('c16 row 713: the patch made no upload of the column');
  let bytes = 0;
  for (const u of uploads) {
    const offset = Number(u['offset']); const n = Number(u['bytes']);
    bytes += n;
    if (u['outcome'] !== 'written') p.push(`c16 row 713: the device refused the upload of ${n} bytes at ${offset}: ${shown(u['error'])}`);
    else if (offset < 2852 || offset + n > 2856 || offset % 4 || n % 4) p.push(`c16 row 713: an upload of ${n} bytes at ${offset} isn't within the word holding row 713 (bytes 2,852 to 2,856)`);
  }
  if (bytes > 4) p.push(`c16 row 713: the patch uploaded ${bytes} bytes, not the 4-byte word holding row 713`);
  reads(patch['read'], 'after the patch', (n, r) => held(n, r, true));
  return p;
}

describe('#429.7004cb63 an operator reads columns and attributes exactly, and a patch uploads only the word it changed', () => {
  it('#429.7004cb63 rows 0, 1, 712, 713 and 1,000 read the CPU values (f64 narrowed to f32); the patch of row 713 uploads its one word and row 712 keeps its value', () => {
    requireGpu();
    expect(columnProblems()).toEqual([]);
  }, 1_800_000);

  const TWINS: { planted: Planted; names: RegExp; what: string }[] = [
    { planted: 'attribute_stride_16', names: /^a3 row 1 before the patch: read/m, what: 'a 16-byte stride over packed vec3 data reads a3 row 1 wrong' },
    { planted: 'partial_update_2_bytes', names: /^c16 row 713: the device refused the upload of 2 bytes/m, what: 'writing row 713\'s 2 bytes alone is refused by the device' },
    { planted: 'recopies_whole_column', names: /^c16 row 713: the patch uploaded 4004 bytes/m, what: 're-copying the whole column uploads 4,004 bytes' },
  ];
  for (const t of TWINS) {
    it(`#429.7004cb63 a planted ${t.planted.replace(/_/g, ' ')} (--planted ${t.planted}) fails, naming the column and the row: ${t.what}`, () => {
      requireGpu();
      expect(columnProblems(t.planted).join('\n')).toMatch(t.names);
    }, 1_800_000);
  }
});
