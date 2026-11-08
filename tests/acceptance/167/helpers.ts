// Test-side tools for the #167 acceptance tests: the `deep-canvas-render` binary (#373's and #391's JSON-lines
// surface, extended as the README says), built once per file; the documents the tests send (a race, a revealed line,
// emphasis, color scales); what the binary answers, read strictly; and the reference math the expected values come
// from (OKLab from its published formula, d3's quantize and nice rules). Nothing here stands in for the canvas: every
// value a test compares comes from the binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/167 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first build of the binary can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #167.18793458',
  2: 'AC2 #167.cf27c591',
  3: 'AC3 #167.0333a2fe',
  4: 'AC4 #167.662f5a55',
  5: 'AC5 #167.5cc51988',
  6: 'AC6 #167.3b65833f',
  7: 'AC7 #167.c3055836',
  8: 'AC8 #167.48674636',
  9: 'AC9 #167.d181ea9b',
  10: 'AC10 #167.25ddf151',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** The frames of a span at 60 Hz, in flicks: 0, 1/60 s, … the span's end. */
export const frames60 = (seconds: number): number[] => Array.from({ length: seconds * 60 + 1 }, (_, k) => k * (FLICKS / 60));

// ---------------------------------------------------------------------------------------------------
// JSON and the answers' checks

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function near(got: number, want: number, tolerance: number, what: string): void {
  expect(Math.abs(got - want), `${what}: ${got}, want ${want} within ${tolerance}`).toBeLessThanOrEqual(tolerance);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-canvas-render`, copied out so a later build can't change it under a running file.

const BIN = 'deep-canvas-render';
const exe = process.platform === 'win32' ? `${BIN}.exe` : BIN;
const CARGO_ENV: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

/** `cargo build --locked --bin deep-canvas-render [--release]`; an empty string, or what cargo said. */
function cargoBuild(release: boolean): string {
  const args = ['build', '--locked', '--bin', BIN, ...(release ? ['--release'] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating/.test(l)).join('\n').slice(0, 4000)}`;
}

/** Builds the debug binary once before the file's tests; `bin()` fails a test when the build failed. */
export function useRender(): () => string {
  let dir = ''; let error = ''; let path = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-167-bin-'));
    error = cargoBuild(false);
    if (error === '') { path = join(dir, exe); copyFileSync(join(targetDir(), 'debug', exe), path); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: ${BIN}`).toBe(''); return path; };
}

/** The release binary, built when first asked for: only a budget that will be judged asks (README: Run). */
export function releaseRender(into: string): string {
  const error = cargoBuild(true);
  expect(error, `the release binary builds: ${BIN}`).toBe('');
  const path = join(into, `${BIN}-release`);
  copyFileSync(join(targetDir(), 'release', exe), path);
  return path;
}

/** One run of `deep-canvas-render <subcommand>`: exit 0, one parsed line out per line in. */
export function lines(bin: string, subcommand: string, inputs: JsonValue[]): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${BIN} ${subcommand}: ${run.error.message}`);
  expect(run.status, `${BIN} ${subcommand} exits 0: ${run.stderr.slice(0, 2000)}`).toBe(0);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${BIN} ${subcommand}: one output line per input line`).toBe(inputs.length);
  return out.map((l) => JSON.parse(l) as JsonValue);
}

export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-167-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// What the surfaces answer (README: The surface under test)

export interface Issue { code: string; severity: string; ids: string[]; path: string }
export interface Checked { issues: Issue[]; errors: Issue[]; raw: JsonObject }
export function checked(value: JsonValue | undefined, what: string): Checked {
  const raw = obj(value, what);
  const issues = arr(raw['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity']), ids: arr(o['ids'] ?? [], 'ids').map(String), path: String(o['path'] ?? '') };
  });
  return { issues, errors: issues.filter((i) => i.severity === 'error'), raw };
}
export const shownIssues = (c: Checked): string => JSON.stringify(c.issues.map((i) => ({ code: i.code, severity: i.severity, ids: i.ids, path: i.path }))).slice(0, 1500);

/** `check`: the document passes, no error issue. */
export function passes(bin: string, doc: JsonObject, look: JsonObject, what: string): void {
  const c = checked(lines(bin, 'check', [{ doc, look }])[0], `check ${what}`);
  expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `${what} passes the check: ${shownIssues(c)}`).toEqual([]);
}

/** One row of `geometry`'s `rows` at t, after the set's transforms. */
export interface Row {
  columns: JsonObject;
  opacity: number;
  place: { x: number; y: number; x2: number | null; y2: number | null };
  oklab: [number, number, number] | null;
}
export function rowsOf(answer: JsonValue | undefined, what: string): Record<string, Row> {
  const a = obj(answer, what);
  expect(a['ok'], `${what}: geometry answers: ${show(a)}`).toBe(true);
  const rows = obj(a['rows'], `${what}: rows`);
  return Object.fromEntries(Object.entries(rows).map(([key, v]) => {
    const r = obj(v, `${what}: rows.${key}`);
    const p = obj(r['place'], `${what}: rows.${key}.place`);
    const opt = (k: string): number | null => (p[k] === undefined || p[k] === null ? null : num(p[k], `${what}: rows.${key}.place.${k}`));
    const lab = r['oklab'] === undefined || r['oklab'] === null ? null : arr(r['oklab'], 'oklab').map((c) => num(c, 'oklab')) as [number, number, number];
    return [key, {
      columns: obj(r['columns'], `${what}: rows.${key}.columns`), opacity: num(r['opacity'], `${what}: rows.${key}.opacity`),
      place: { x: num(p['x'], `${what}: rows.${key}.place.x`), y: num(p['y'], `${what}: rows.${key}.place.y`), x2: opt('x2'), y2: opt('y2') }, oklab: lab,
    }];
  }));
}
export const column = (r: Row, name: string, what: string): number => num(r.columns[name], `${what}: column ${name}`);

/** `geometry` of one item at each time, in order, in one process. */
export function geometryAt(bin: string, doc: JsonObject, item: string, times: number[], look: JsonObject): JsonValue[] {
  return lines(bin, 'geometry', times.map((t) => ({ doc, item, t, look })));
}
/** The rows of each named set at each time. */
export function rowsAt(bin: string, doc: JsonObject, item: string, times: number[], look: JsonObject): Record<string, Row>[] {
  return geometryAt(bin, doc, item, times, look).map((a, i) => rowsOf(a, `${item} at ${times[i]} flicks`));
}

/** `raster` of a document at each time, in order, in one process; each frame's PNG path and its answer. */
export function rasterAt(bin: string, doc: JsonObject, times: number[], look: JsonObject, dir: string, name: string): { out: string; answer: JsonObject }[] {
  const outs = times.map((_, i) => join(dir, `${name}-${i}.png`));
  const answers = lines(bin, 'raster', times.map((t, i) => ({ out: outs[i]!, doc, look, t })));
  return answers.map((a, i) => {
    const answer = obj(a, `raster ${name} at ${times[i]} flicks`);
    expect(answer['ok'], `raster ${name} draws: ${show(answer)}`).toBe(true);
    return { out: outs[i]!, answer };
  });
}
/** A text's shown string in `raster`'s `texts` (#381): `<item>`, or a text set's `<set>#<row key>` (#397). */
export function shownText(answer: JsonObject, id: string, what: string): string {
  const texts = obj(answer['texts'], `${what}: texts`);
  return str(obj(texts[id], `${what}: texts["${id}"]`)['shown'], `${what}: texts["${id}"].shown`);
}
export interface Glyph { x: number; grapheme: number }
export function glyphsOf(answer: JsonObject, id: string, what: string): Glyph[] {
  const entry = obj(obj(answer['texts'], `${what}: texts`)[id], `${what}: texts["${id}"]`);
  return arr(entry['glyphs'], `${what}: glyphs`).map((g, i) => {
    const o = obj(g, `${what}: glyphs[${i}]`);
    return { x: num(o['x'], `${what}: glyphs[${i}].x`), grapheme: num(o['grapheme'], `${what}: glyphs[${i}].grapheme`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// Documents

export type Rgb = [number, number, number];
export const GROUND: Rgb = [255, 255, 255];
export const INK: Rgb = [0, 0, 0];
export const BLUE: Rgb = [0, 0, 255];
export const YELLOW: Rgb = [255, 255, 0];
/** #373's role-map look form; `muted` is what an axis draws in, `blue` and `yellow` AC8's two palette roles. */
export const LOOK: JsonObject = { light: { ground: GROUND, ink: INK, muted: [90, 90, 90], blue: BLUE, yellow: YELLOW } };

function column32(values: number[], dtype: 'i32' | 'f32'): JsonObject {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => (dtype === 'i32' ? b.writeInt32LE(v, i * 4) : b.writeFloatLE(v, i * 4)));
  return { dtype, len: values.length, data: b.toString('base64') };
}
export const i32Column = (values: number[]): JsonObject => column32(values, 'i32');
export const f32Column = (values: number[]): JsonObject => column32(values, 'f32');
export const strColumn = (values: string[]): JsonObject => ({ dtype: 'str', len: values.length, data: values });

export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** A linear scale with its domain as written (`nice: false`), so a position is the plain map. */
export const fixedScale = (id: string, order: string, domain: [number, number], range: [number, number]): JsonObject =>
  item(id, 'scale@1', order, { type: 'linear', domain, range, nice: false });

export function document(id: string, title: string, size: [number, number], span: number, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description: `${title}, for the #167 acceptance tests.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: `${span}s` },
    items: Object.fromEntries(items.map((i) => [str(i['id'], 'item id'), i])), ...extra,
  };
}
/** A channel keyed linearly from `from` at 0 s to `to` at `span` s (a mark set's field, by its path). */
export const ramp = (target: string, from: number, to: number, span: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } });

export type Period = [by: number, values: Record<string, number>];
/** Rows of periods: `year` (i32), `key` (str), `value` (i32), one row per key per period. */
export function periodRows(periods: Period[]): { n: number; columns: JsonObject } {
  const rows = periods.flatMap(([year, values]) => Object.entries(values).map(([key, value]) => ({ year, key, value })));
  return { n: rows.length, columns: { year: i32Column(rows.map((r) => r.year)), key: strColumn(rows.map((r) => r.key)), value: i32Column(rows.map((r) => r.value)) } };
}

/** Standing 1 to 4 across x, a bar 60 u wide, at a pitch of 80 u; values up the y scale, zero at y = 240. */
export const SLOTS = { left: [40, 280], right: [100, 340], mid: [70, 310], ys: [240, 40], standing: [1, 4], value: [0, 50] } as const;
export const RACE_SCALES: JsonObject[] = [
  fixedScale('left', 'a0', [...SLOTS.standing], [...SLOTS.left]),
  fixedScale('right', 'a1', [...SLOTS.standing], [...SLOTS.right]),
  fixedScale('mid', 'a2', [...SLOTS.standing], [...SLOTS.mid]),
  fixedScale('ys', 'a3', [...SLOTS.value], [...SLOTS.ys]),
];
/** The bar set of a race: bars side by side in standing order, each rising from the y scale's zero to its value. */
export function raceBars(periods: Period[], top?: number, ys = 'ys'): JsonObject {
  const { n, columns } = periodRows(periods);
  return item('race', 'marks@1', 'b0', {
    mark: 'bar', n, key: 'key', columns,
    transforms: [{ periods: { by: 'year', at: periods[0]![0] } }, { standing: { by: 'value', ...(top === undefined ? {} : { top }) } }],
    encode: { x: { column: 'standing', scale: 'left' }, x2: { column: 'standing', scale: 'right' }, y: { column: 'value', scale: ys } },
    paint: { fill: { role: 'ink' } },
  });
}
/** The value labels: a text set that draws the bars' rows through rows_of, at each bar's end (top centre). */
export const raceLabels = (): JsonObject => item('labels', 'marks@1', 'b1', {
  mark: 'text', rows_of: 'race',
  encode: { x: { column: 'standing', scale: 'mid' }, y: { column: 'value', scale: 'ys' }, text: { column: 'value' }, size: 12 },
  paint: { fill: { role: 'ink' } },
});
/** The channel that plays `at` from `from` to `from + 1` over `span` seconds. */
export const atChannel = (from: number, span: number): JsonObject => ({ at: ramp('items/race/params/transforms/0/periods/at', from, from + 1, span) });

/** AC1's race, its issue's values. */
export const AC1_PERIODS: Period[] = [[2000, { a: 10, b: 20, c: 30 }], [2001, { a: 40, b: 25, c: 15 }]];
export const raceDoc = (): JsonObject => document('race-167', 'A race of three keys', [400, 280], 1,
  [...RACE_SCALES, raceBars(AC1_PERIODS), raceLabels()], { channels: atChannel(2000, 1) });

/** AC1's bars with their y scale following the periods (defaults: nice on, zero for bars), and an axis over it. */
export const growingDoc = (): JsonObject => document('grow-167', 'An axis that grows with its data', [400, 280], 1, [
  ...RACE_SCALES.filter((s) => s['id'] !== 'ys'),
  item('grows', 'scale@1', 'a4', { type: 'linear', domain: 'periods', range: [240, 40] }),
  raceBars(AC1_PERIODS, undefined, 'grows'),
  item('axis', 'axis@1', 'b1', { scale: 'grows', side: 'left', at: 30 }),
], { channels: atChannel(2000, 1) });

/** AC2's line: ten yearly rows (i32 values) revealed over nine seconds, `to` from 2010 to 2019. */
export const LINE_YEARS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019];
export const LINE_VALUES = [12, 18, 15, 27, 33, 29, 41, 38, 52, 47];
export const LINE_SPAN = 9;
export const lineX = (year: number): number => 40 + ((year - 2010) / 9) * 360;
export const lineY = (value: number): number => 220 - (value / 60) * 180;
export const lineDoc = (extra: JsonObject[] = []): JsonObject => document('line-167', 'A line revealed by year', [440, 240], LINE_SPAN, [
  fixedScale('xs', 'a0', [2010, 2019], [40, 400]),
  fixedScale('vs', 'a1', [0, 60], [220, 40]),
  item('line', 'marks@1', 'b0', {
    mark: 'path', n: LINE_YEARS.length, key: 'year', columns: { year: i32Column(LINE_YEARS), value: i32Column(LINE_VALUES) },
    transforms: [{ reveal: { by: 'year', to: 2010 } }],
    encode: { x: { column: 'year', scale: 'xs' }, y: { column: 'value', scale: 'vs' } },
    paint: { stroke: { role: 'ink', width: 2 } },
  }),
  item('count', 'text@1', 'b1', { text: { counter: { source: 'items/line#head/value', tabular: true } }, font: 'body', size: 13, box: { w: 120, h: 20 } }, { at: { pos: [40, 8, 0] } }),
  ...extra,
], { channels: { to: ramp('items/line/params/transforms/0/reveal/to', 2010, 2019, LINE_SPAN) } });

/** Seeded uniform numbers in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Pictures (PNG reading as #397's suite, written from the PNG specification)

export interface Image { width: number; height: number; rgba: Uint8Array }
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export function readPng(path: string): Image {
  const file = readFileSync(path);
  let width = 0; let height = 0; let color = 0; let depth = 0; let interlace = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export const same = (a: Rgb, b: Rgb): boolean => a.every((v, i) => v === b[i]);

/** An animated PNG from same-sized PNG frames, each shown `delayMs` (the APNG specification). The frames stay the canvas's bytes. */
export function apng(frames: Buffer[], delayMs: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const chunk = (type: string, body: Buffer): Buffer => { const t = Buffer.concat([Buffer.from(type, 'latin1'), body]); return Buffer.concat([u32(body.length), t, u32(crc(t))]); };
  const chunks = (png: Buffer): { type: string; body: Buffer }[] => {
    const out: { type: string; body: Buffer }[] = [];
    for (let at = 8; at < png.length;) { const n = png.readUInt32BE(at); out.push({ type: png.toString('latin1', at + 4, at + 8), body: png.subarray(at + 8, at + 8 + n) }); at += 12 + n; }
    return out;
  };
  const ihdr = chunks(frames[0]!).find((c) => c.type === 'IHDR')!.body;
  const parts: Buffer[] = [frames[0]!.subarray(0, 8), chunk('IHDR', ihdr), chunk('acTL', Buffer.concat([u32(frames.length), u32(0)]))];
  let seq = 0;
  frames.forEach((png, f) => {
    const delay = Buffer.alloc(4); delay.writeUInt16BE(delayMs, 0); delay.writeUInt16BE(1000, 2);
    parts.push(chunk('fcTL', Buffer.concat([u32(seq++), ihdr.subarray(0, 8), u32(0), u32(0), delay, Buffer.from([0, 0])])));
    for (const c of chunks(png)) {
      if (c.type !== 'IDAT') continue;
      parts.push(f === 0 ? chunk('IDAT', c.body) : chunk('fdAT', Buffer.concat([u32(seq++), c.body])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// Color, in f64 from published formulas: the sRGB transfer function (IEC 61966-2-1) and OKLab (Björn Ottosson, 2020).

export type Lab = [number, number, number];
const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toEncoded = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export function oklab([r8, g8, b8]: Rgb): Lab {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** A color in gamut, in sRGB 0–1 before 8-bit rounding. */
export function srgbOf([L, a, b]: Lab): Lab {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return linear.map(toEncoded) as Lab;
}
export const deltaEok = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const midpoint = (a: Lab, b: Lab): Lab => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** d3-scale's scaleQuantize (83555bd759, test/quantize-test.js): thresholds, then the count at or below the value. */
export function quantizeBand(v: number, [x0, x1]: [number, number], roles: number): number {
  const n = roles - 1;
  const thresholds = Array.from({ length: n }, (_, i) => ((i + 1) * x1 - (i - n) * x0) / (n + 1));
  return thresholds.filter((t) => t <= v).length;
}
/** d3-scale's linear.nice: extends a domain to a whole number of steps, each 1, 2 or 5 × 10^k (test/linear-test.js). */
export function niceDomain([lo, hi]: [number, number], count: number): [number, number] {
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  const step = power * (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.SQRT2 ? 2 : 1);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

// ---------------------------------------------------------------------------------------------------
// Timing: the reference-Mac gate and the design's judge, as #397's and #380's suites hold them (five runs after a
// warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin, the larger of 5% and
// their spread; else INCONCLUSIVE). Mains power never gates (the owner's rule); load does.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => spawnSync(cmd, args, { encoding: 'utf8' }).stdout.trim();

/** Why a timing reading here can't pass or fail, or null on a reference Mac that is idle enough. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = sh('sysctl', '-n', 'hw.model');
  const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
  const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const therm = sh('pmset', '-g', 'therm');
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}

export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
