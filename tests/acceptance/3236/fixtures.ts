// The criteria's fixtures (README: Fixtures). Each document is a figure with a 2D camera over its page and a
// transport, as #539's suite writes one, holding one mark set heard as `data`: the fixture scatter (criteria 1 to 3, 6
// to 8), the bar chart (criterion 4), the 50,000-row series (criterion 5) and the 100,000-row scatter (criterion 9).
// Columns hold little-endian bytes in base64 (Mark set and columns `marks@1`), each numeric column with its `unit`; the
// scatter's missing y is an IEEE NaN in its f64 column. Nothing here draws, checks, focuses or announces anything: this
// file has no test runner in it, so a probe can read it too.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const SEED = 3236;
/** Document IDs the hub minted (26 Crockford characters); each fixture's `id` is its handle. */
export const DOC = (n: number): string => `01JB3236${String(n).padStart(18, '0')}`;

/** A numeric column of f64s, little-endian, in base64, with its unit when given. */
export function f64Column(values: readonly number[], unit?: string): JsonObject {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return { dtype: 'f64', len: values.length, data: b.toString('base64'), ...(unit ? { unit } : {}) };
}
/** A column of i64s, little-endian, in base64. */
export function i64Column(values: readonly number[]): JsonObject {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeBigInt64LE(BigInt(v), i * 8));
  return { dtype: 'i64', len: values.length, data: b.toString('base64') };
}
/** A column of text, one string a row. */
export const strColumn = (values: readonly string[]): JsonObject => ({ dtype: 'str', len: values.length, data: [...values] });

function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A figure with a transport: a 2D camera over the page, 4 s at 60 fps, the items, and `extra` (controls). */
function figure(id: string, title: string, description: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] },
    items: Object.fromEntries([camera2d(size), ...items].map((i) => [String(i['id']), i])),
    ...extra,
  };
}
const scale = (id: string, name: string, order: string, params: JsonObject): JsonObject => ({ id, kind: 'scale@1', name, order, params });

// ---------------------------------------------------------------------------------------------------
// The fixture scatter (criteria 1, 2, 3, 6, 7, 8): 12 rows, x in seconds 0 to 11, y in metres, row 5's y missing. Its
// scales have fixed domains (not the data's), so a row's place on the page is known: x through `time` to 40 + 320 x ÷ 12
// u, y through `height` to 260 − 4 y u (up the page). y falls as x grows, so the rows in #539's reading order (centre y,
// then x) are the rows in key order, which is also x's order: every reading of "in order" agrees.

export const SCATTER = 'scatter';
export const PAGE: [number, number] = [400, 300];
export const XS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const YS: readonly number[] = [40, 37, 33, 30, 26, Number.NaN, 19, 15, 12, 8, 5, 2];
/** The row whose y is missing; it doesn't draw. */
export const MISSING = 5;
/** The criterion 2 edit: row 0's y, 40, becomes 55. */
export const EDITED_ROW = 0;
export const EDITED_Y = 55;
export const UNITS = { x: 'seconds', y: 'metres' } as const;
/** The drawn rows' keys in order. */
export const DRAWN: readonly number[] = XS.map((_, i) => i).filter((i) => i !== MISSING);
/** A row's ID: `<set>#<key>`, the base's row ID (Mark set: picking returns `<id>#<key>`); the scatter is keyed by index. */
export const rowId = (set: string, key: number | string): string => `${set}#${key}`;

export interface ScatterOptions {
  /** Row `EDITED_ROW`'s y set to `EDITED_Y` (criterion 2). */
  edited?: boolean;
  /** The planted document: the agent typed the node's value as the item's `value` (criterion 1). */
  typedValue?: string;
  /** The controls (criterion 6). */
  controls?: JsonObject;
}
export function scatterDoc(id: string, o: ScatterOptions = {}): JsonObject {
  const ys = YS.map((y, i) => (o.edited && i === EDITED_ROW ? EDITED_Y : y));
  const set: JsonObject = {
    id: SCATTER, kind: 'marks@1', name: 'Ball height', role: 'data', order: 'a3',
    params: {
      mark: 'point', n: XS.length,
      columns: { x: f64Column(XS, UNITS.x), y: f64Column(ys, UNITS.y) },
      encode: { x: { column: 'x', scale: 'time' }, y: { column: 'y', scale: 'height' } },
    },
    ...(o.typedValue !== undefined ? { value: o.typedValue } : {}),
  };
  return figure(id, 'Ball height', 'A dropped ball\'s height in metres, read once a second for twelve seconds; one reading is missing.', PAGE, [
    scale('time', 'Time', 'a1', { type: 'linear', domain: [0, 12], range: [40, 360], nice: false }),
    scale('height', 'Height', 'a2', { type: 'linear', domain: [0, 60], range: [260, 20], nice: false }),
    set,
  ], o.controls ? { controls: o.controls } : {});
}

// ---------------------------------------------------------------------------------------------------
// The bar chart (criterion 4): 3 series by 4 quarters, one set `bars` of 12 rows keyed by index, the rows in quarter
// order (row i is quarter ⌊i ÷ 3⌋ of series i mod 3), so row order changes series at every row. `series` is a column of
// categories encoded as `role` through the ordinal scale `colors`, whose order is North, South, West.

export const BARS = 'bars';
export const SERIES = ['North', 'South', 'West'] as const;
export const seriesOfRow = (i: number): string => SERIES[i % 3]!;
const SALES = [3, 4, 11, 5, 6, 12, 7, 8, 13, 9, 10, 14];
export function barsDoc(id: string): JsonObject {
  const n = SALES.length;
  const left = Array.from({ length: n }, (_, i) => 40 + 80 * Math.floor(i / 3) + 20 * (i % 3));
  return figure(id, 'Sales by quarter', 'Sales in tonnes for three regions over four quarters, one bar a region each quarter.', PAGE, [
    scale('tons', 'Sales', 'a1', { type: 'linear', domain: [0, 20], range: [260, 20], nice: false }),
    scale('colors', 'Regions', 'a2', { type: 'ordinal', domain: [...SERIES], range: ['ink', 'accent', 'focus'] }),
    {
      id: BARS, kind: 'marks@1', name: 'Sales by region', role: 'data', order: 'a3',
      params: {
        mark: 'bar', n,
        columns: { left: f64Column(left), right: f64Column(left.map((x) => x + 18)), sales: f64Column(SALES, 'tonnes'), series: strColumn(Array.from({ length: n }, (_, i) => seriesOfRow(i))) },
        encode: { x: { column: 'left' }, x2: { column: 'right' }, y: { column: 'sales', scale: 'tons' }, role: { column: 'series', scale: 'colors' } },
      },
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------
// The series (criterion 5): `trace`, a `series@1` line of 50,000 rows decimated by M4 per 1 px column of its 400 px box
// (Series and decimation). Times t = 1 … 50,000 flicks over the window [0, 50,000], so pixel column k holds exactly the
// 125 rows with 125 k < t ≤ 125 (k + 1) (the base's column rule). Row j of column k has the value
// 200 + k + 2 ((37 j) mod 125): each column's least is 200 + k, its greatest 448 + k, and no value is 125.

export const TRACE = 'trace';
export const SERIES_ROWS = 50_000;
export const PIXEL_COLUMNS = 400;
export const PER_COLUMN = SERIES_ROWS / PIXEL_COLUMNS;
export const columnLeast = (k: number): number => 200 + k;
export const columnGreatest = (k: number): number => 448 + k;
export function seriesValues(): number[] {
  return Array.from({ length: SERIES_ROWS }, (_, r) => {
    const k = Math.floor(r / PER_COLUMN);
    const j = r % PER_COLUMN;
    return 200 + k + 2 * ((37 * j) % PER_COLUMN);
  });
}
export function seriesDoc(id: string): JsonObject {
  return figure(id, 'Sensor trace', 'A sensor\'s reading over 50,000 samples, drawn as one line.', [440, 240], [{
    id: TRACE, kind: 'series@1', name: 'Sensor trace', role: 'data', order: 'a1',
    params: {
      t: i64Column(Array.from({ length: SERIES_ROWS }, (_, r) => r + 1)), v: f64Column(seriesValues()),
      window: [0, SERIES_ROWS], decimate: 'm4', bucket: '1px', marks: ['line'], box: [20, 20, PIXEL_COLUMNS, 200],
    },
  }]);
}

// ---------------------------------------------------------------------------------------------------
// The 100,000-row scatter (criterion 9): the fixture scatter's form, x in seconds and y in metres, every row drawn.

export const BIG_ROWS = 100_000;
export function bigScatterDoc(id: string): JsonObject {
  const xs = Array.from({ length: BIG_ROWS }, (_, i) => i / 1000);
  const ys = Array.from({ length: BIG_ROWS }, (_, i) => ((i * 7919) % 1000) / 10);
  return figure(id, 'Many heights', 'A hundred thousand height readings over a hundred seconds.', PAGE, [
    scale('time', 'Time', 'a1', { type: 'linear', domain: [0, 100], range: [40, 360], nice: false }),
    scale('height', 'Height', 'a2', { type: 'linear', domain: [0, 100], range: [260, 20], nice: false }),
    {
      id: SCATTER, kind: 'marks@1', name: 'Heights', role: 'data', order: 'a3',
      params: { mark: 'point', n: BIG_ROWS, columns: { x: f64Column(xs, UNITS.x), y: f64Column(ys, UNITS.y) }, encode: { x: { column: 'x', scale: 'time' }, y: { column: 'y', scale: 'height' } } },
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Controls (criterion 6): #539's pick control on rows with `focus`, and a slider after it.

export const pickControl = (rows: string[]): JsonObject => ({ kind: 'press', class: 'document', verb: 'pick', label: 'Pick a reading', role: 'grid', rows, focus: {} });
export const slider = (label: string): JsonObject => ({ kind: 'slider', class: 'view', label, role: 'slider', range: [0, 1], default: 0.5, increment: 0.1 });
