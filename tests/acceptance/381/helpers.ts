// Test-side tools for the #381 acceptance tests: the three binaries they drive (`deep-text`,
// `deep-canvas-render`, `deep-gpu`), built once per file and driven by JSON lines; glyph runs as the
// surface reports them and their comparison, f32 bit for f32 bit; `cargo tree` for the text and marks
// crates and the dependency rule AC1 states; Unicode's conformance files under vendor/ and the
// comparison that names the first line that differs; and an 8-bit grayscale PNG reader for atlas
// pages. Nothing here stands in for the shaper, the atlas, scene3d or the document check under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/381 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The text module's binary (#390): `fit` and `fonts` at the base; `breaks`, `bidi` and `graphemes` added here. */
export const TEXT_BIN = exe('deep-text');
/** The 2D marks' proof surface (#391, #392, #373): `check` read, `raster` extended here. */
export const RENDER_BIN = exe('deep-canvas-render');
/** The GPU layer's proof surface (#377, #378): `run`, whose `view3d` call takes `labels` here. */
export const GPU_BIN = exe('deep-gpu');

/** The Unicode version the shaper's segmentation and bidi data come from at the base (vendor/unicode-17.0.0/README.md). */
export const UNICODE_VERSION = '17.0.0';
export const UNICODE_DIR = join(REPO, 'vendor', `unicode-${UNICODE_VERSION}`);
/** The files and their SHA-256 as unicode.org publishes them (vendor/unicode-17.0.0/README.md). */
export const UNICODE_FILES: Record<string, string> = {
  'LineBreakTest.txt': 'e69884e0dde6a8724873f885d68c52dc14518abf9ae4ca9e2283b8773db3b752',
  'GraphemeBreakTest.txt': 'e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec',
  'BidiCharacterTest.txt': 'a3e6e905ab5afbe318a96df5401d0372a04cd73ef139ab5e3cf0ae241c255488',
};
/** The implementation's list of lines its pinned segmenter tailors (README: Tailored lines); absent means none. */
export const TAILORED = join(REPO, 'crates', 'deep-text', 'conformance', 'tailored.json');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isInteger(value), `${what} is an integer, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}
export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);

// ---------------------------------------------------------------------------------------------------
// Builds and runs: each binary built once per file with `cargo build --locked --bin <name>`; a test of
// a file whose build failed fails. One process per batch: JSON lines in, exactly one line out per line.

function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo build --locked --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
}

export function useBinaries(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(buildBinary).filter((e) => e !== '').join('\n'); }, 3_600_000);
  beforeEach(() => { expect(error, `the binaries build: ${names.join(', ')}`).toBe(''); });
}

/** Pipes every input line into one run of `<bin> <args>`; returns one parsed JSON value per line. */
export function batch(bin: string, args: string[], inputs: (JsonValue | string)[]): JsonValue[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const name = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${(run.stderr ?? '').slice(-4000)}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line, i) => {
    try { return JSON.parse(line) as JsonValue; } catch { throw Error(`${name}: line ${i + 1} of its output is not JSON: ${line.slice(0, 300)}`); }
  });
}

export function one(bin: string, args: string[], input: JsonValue | string): JsonObject {
  return obj(batch(bin, args, [input])[0], `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}: the answer`);
}

/** Every answer of a batch accepted (`ok: true`). */
export function accepted(bin: string, args: string[], inputs: JsonValue[]): JsonObject[] {
  return batch(bin, args, inputs).map((v, i) => {
    const o = obj(v, `${args.join(' ')} line ${i + 1}`);
    expect(o['ok'], `${args.join(' ')} refused line ${i + 1} (${JSON.stringify(inputs[i]).slice(0, 300)}): ${JSON.stringify(o).slice(0, 600)}`).toBe(true);
    return o;
  });
}

// ---------------------------------------------------------------------------------------------------
// Glyph runs, as `raster`'s `texts` and `view3d`'s `labels` report them (README: Glyphs).

export interface Atlas { page: number; x: number; y: number; w: number; h: number; raster: number }
export interface Glyph { font: string; size: number; id: number; x: number; y: number; grapheme: number; role: string | null; atlas: Atlas | null | undefined }

export function glyphsOf(value: JsonValue | undefined, what: string): Glyph[] {
  return arr(value, what).map((v, i) => {
    const g = obj(v, `${what}[${i}]`);
    const at = `${what}[${i}]`;
    let atlas: Atlas | null | undefined;
    if (g['atlas'] === null) atlas = null;
    else if (g['atlas'] !== undefined) {
      const a = obj(g['atlas'], `${at}.atlas`);
      atlas = { page: int(a['page'], `${at}.atlas.page`), x: int(a['x'], `${at}.atlas.x`), y: int(a['y'], `${at}.atlas.y`), w: int(a['w'], `${at}.atlas.w`), h: int(a['h'], `${at}.atlas.h`), raster: num(a['raster'], `${at}.atlas.raster`) };
    }
    return {
      font: str(g['font'], `${at}.font`), size: num(g['size'], `${at}.size`), id: int(g['id'], `${at}.id`),
      x: num(g['x'], `${at}.x`), y: num(g['y'], `${at}.y`), grapheme: int(g['grapheme'], `${at}.grapheme`),
      role: g['role'] === undefined ? null : str(g['role'], `${at}.role`), atlas,
    };
  });
}

/** True when two numbers are the same f32, bit for bit (−0 and 0 differ). */
export const sameF32 = (a: number, b: number): boolean => Object.is(Math.fround(a), Math.fround(b));

/** The next f32 above `x`: a twin one unit in the last place away. */
export function nextF32(x: number): number {
  const f = new Float32Array([x]);
  const u = new Uint32Array(f.buffer);
  if (x === 0) u[0] = 1; else u[0] = u[0]! + (x > 0 ? 1 : -1);
  return f[0]!;
}

/** Where two glyph runs differ: font, size, glyph ID, grapheme or position, naming the first glyph that differs. */
export function runProblems(expected: Glyph[], actual: Glyph[], what: string): string[] {
  if (expected.length !== actual.length) return [`${what}: ${actual.length} glyphs, not ${expected.length}`];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!; const a = actual[i]!;
    const at = `${what}: glyph ${i} (grapheme ${e.grapheme})`;
    if (a.font !== e.font) return [`${at} is from ${a.font}, not ${e.font}`];
    if (!sameF32(a.size, e.size)) return [`${at} is shaped at ${a.size} px, not ${e.size}`];
    if (a.id !== e.id) return [`${at} is glyph ${a.id}, not ${e.id}`];
    if (a.grapheme !== e.grapheme) return [`${at} belongs to grapheme ${a.grapheme}`];
    if (!sameF32(a.x, e.x) || !sameF32(a.y, e.y)) return [`${at} sits at (${a.x}, ${a.y}), not (${e.x}, ${e.y})`];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Looks. 2D rasters draw with a role map (#391's form, no status map), so every color is set here; the
// template's documents are checked and drawn with the shipped clean look by ID (#392).

export const LOOK_2D: JsonObject = {
  light: {
    ground: [255, 255, 255], ink: [0, 0, 0], muted: [120, 120, 120], accent: [20, 120, 200],
    'label-a': [200, 30, 30], 'label-b': [30, 150, 30],
    'run-a': [210, 40, 40], 'run-b': [40, 160, 60], 'run-c': [40, 60, 200], 'paint-a': [150, 90, 20],
  },
};

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377): one scenario per line, one line out.

export function runGpu(out: string, calls: JsonObject[], startup: { planted?: string } = {}): JsonObject[] {
  const args = ['run', '--backend', 'noop', ...(startup.planted ? ['--planted', startup.planted] : [])];
  const answer = one(GPU_BIN, args, { out, calls });
  expect(answer['ok'], `deep-gpu ${args.join(' ')} refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  for (const r of replies) {
    if (r['code'] === 'unsupported_platform') expect.fail('INCONCLUSIVE: deep-gpu reports unsupported_platform for the noop backend; this is not a pass');
  }
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The dependency tree: `cargo tree -p <crate> -e normal --target all`, which resolves features as a
// build of that crate alone does (not the workspace's union).

export interface TreePkg { name: string; versions: Set<string>; features: Set<string> }

export function cargoTree(crate: string, cwd = REPO, locked = true): Map<string, TreePkg> {
  const args = ['tree', locked ? '--locked' : '--offline', '-p', crate, '-e', 'normal', '--target', 'all', '--prefix', 'none', '-f', '{p}|{f}'];
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw Error(`cargo ${args.join(' ')}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`cargo ${args.join(' ')} exited ${run.status}:\n${run.stderr.slice(-3000)}`);
  const pkgs = new Map<string, TreePkg>();
  for (const raw of run.stdout.split('\n')) {
    const line = raw.replace(/ \(\*\)$/, '').trim();
    if (line === '') continue;
    const bar = line.lastIndexOf('|');
    const [name, version] = line.slice(0, bar).split(' ');
    if (!name || !version) continue;
    const pkg = pkgs.get(name) ?? { name, versions: new Set<string>(), features: new Set<string>() };
    pkg.versions.add(version.replace(/^v/, ''));
    for (const f of line.slice(bar + 1).split(',')) if (f !== '') pkg.features.add(f);
    pkgs.set(name, pkg);
  }
  return pkgs;
}

/** The canvas's text and marks crates (README: The dependency tree). */
export const TEXT_AND_MARKS_CRATES = ['deep-text', 'deep-canvas-marks', 'deep-marks-vello', 'deep-canvas-scene3d', 'deep-scene3d-render'];
/** Libraries that shape text themselves, or bring a shaper with them. */
export const OTHER_SHAPERS = [
  'swash', 'rustybuzz', 'harfbuzz', 'harfbuzz-sys', 'harfbuzz_rs', 'allsorts', 'cosmic-text',
  'skia-safe', 'skia-bindings', 'pango', 'pango-sys', 'pangocairo',
];
/** Libraries that find, load or rasterize fonts from the system. */
export const SYSTEM_FONT_LIBS = [
  'core-text', 'objc2-core-text', 'font-kit', 'fontdb', 'fontconfig', 'fontconfig-sys', 'yeslogic-fontconfig-sys',
  'servo-fontconfig', 'servo-fontconfig-sys', 'fontconfig-cache-parser', 'fontconfig-parser', 'dwrote', 'freetype',
  'freetype-sys', 'freetype-rs', 'font-loader',
];
/** Features that reach the system's fonts through a crate that is otherwise allowed. */
export const SYSTEM_FONT_FEATURES: [string, string][] = [
  ['fontique', 'system'], ['windows', 'Win32_Graphics_DirectWrite'], ['windows-sys', 'Win32_Graphics_DirectWrite'],
  ['objc2-core-graphics', 'CGFont'], ['objc2-app-kit', 'NSFont'],
];

/** What breaks AC1's rule in one crate's tree: GPUI, no HarfRust or two of it, another shaper, a system font library. */
export function treeProblems(crate: string, tree: Map<string, TreePkg>): string[] {
  const problems: string[] = [];
  for (const name of tree.keys()) if (/^gpui/.test(name)) problems.push(`${crate} depends on ${name} (GPUI)`);
  const harfrust = tree.get('harfrust');
  if (!harfrust) problems.push(`${crate} links no harfrust: HarfRust is not its shaper`);
  else if (harfrust.versions.size !== 1) problems.push(`${crate} links harfrust ${harfrust.versions.size} times (${[...harfrust.versions].join(', ')}): not one shaper`);
  for (const name of OTHER_SHAPERS) if (tree.has(name)) problems.push(`${crate} links ${name}, a second shaper`);
  for (const name of SYSTEM_FONT_LIBS) if (tree.has(name)) problems.push(`${crate} links ${name}, a system font library`);
  for (const [name, feature] of SYSTEM_FONT_FEATURES) {
    if (tree.get(name)?.features.has(feature)) problems.push(`${crate} enables ${name}/${feature}, which reaches the system's fonts`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Unicode's conformance files (vendor/unicode-17.0.0/). Lines are numbered from 1 as the file holds
// them, comments included, so a failure names the line an editor shows.

export function unicodeFile(name: string): string {
  const path = join(UNICODE_DIR, name);
  expect(existsSync(path), `${path} is vendored`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${name} is byte for byte unicode.org's ${UNICODE_VERSION} file`).toBe(UNICODE_FILES[name]);
  const text = bytes.toString('utf8');
  expect(text.split('\n', 1)[0], `${name} says its version`).toContain(`-${UNICODE_VERSION}.txt`);
  return text;
}

/** A line of LineBreakTest.txt or GraphemeBreakTest.txt: its code points and the offsets (1..n) marked ÷. */
export interface BreakCase { line: number; cps: number[]; breaks: number[] }

export function breakCases(name: string): BreakCase[] {
  const cases: BreakCase[] = [];
  unicodeFile(name).split('\n').forEach((raw, i) => {
    const body = raw.split('#')[0]!.trim();
    if (body === '') return;
    const tokens = body.split(/\s+/);
    const cps: number[] = []; const breaks: number[] = [];
    tokens.forEach((t, j) => {
      if (j % 2 === 1) cps.push(parseInt(t, 16));
      else if (t === '÷') { if (j > 0) breaks.push(j / 2); } else if (t !== '×') throw Error(`${name}:${i + 1}: unexpected token ${t}`);
    });
    cases.push({ line: i + 1, cps, breaks });
  });
  return cases;
}

/** A line of BidiCharacterTest.txt. `levels` holds null where the file says x (removed by X9). */
export interface BidiCase { line: number; cps: number[]; dir: 'ltr' | 'rtl' | 'auto'; paragraph: number; levels: (number | null)[]; order: number[] }

export function bidiCases(): BidiCase[] {
  const cases: BidiCase[] = [];
  unicodeFile('BidiCharacterTest.txt').split('\n').forEach((raw, i) => {
    const body = raw.split('#')[0]!.trim();
    if (body === '') return;
    const f = body.split(';');
    if (f.length !== 5) throw Error(`BidiCharacterTest.txt:${i + 1}: ${f.length} fields`);
    const dir = (['ltr', 'rtl', 'auto'] as const)[Number(f[1])];
    if (!dir) throw Error(`BidiCharacterTest.txt:${i + 1}: direction ${f[1]}`);
    cases.push({
      line: i + 1, cps: f[0]!.trim().split(/\s+/).map((h) => parseInt(h, 16)), dir, paragraph: Number(f[2]),
      levels: f[3]!.trim().split(/\s+/).map((l) => (l === 'x' ? null : Number(l))),
      order: f[4]!.trim() === '' ? [] : f[4]!.trim().split(/\s+/).map(Number),
    });
  });
  return cases;
}

export const textOf = (cps: number[]): string => String.fromCodePoint(...cps);

/** One entry of the implementation's tailored-lines list. */
export interface Tailored { file: string; line: number; reason: string }

/** The tailored-lines list (README: Tailored lines) and what's wrong with its shape; absent is empty. */
export function tailoredLines(): { entries: Tailored[]; problems: string[] } {
  if (!existsSync(TAILORED)) return { entries: [], problems: [] };
  const problems: string[] = [];
  let value: JsonValue;
  try { value = JSON.parse(readFileSync(TAILORED, 'utf8')) as JsonValue; } catch (e) { return { entries: [], problems: [`${TAILORED} is not JSON: ${String(e)}`] }; }
  if (!isObject(value)) return { entries: [], problems: [`${TAILORED} is not an object`] };
  if (value['unicode'] !== UNICODE_VERSION) problems.push(`${TAILORED} is for Unicode ${JSON.stringify(value['unicode'])}, not ${UNICODE_VERSION}`);
  const lines = value['lines'];
  if (!Array.isArray(lines)) return { entries: [], problems: [...problems, `${TAILORED} has no lines list`] };
  const entries: Tailored[] = [];
  lines.forEach((e, i) => {
    if (!isObject(e) || typeof e['file'] !== 'string' || !(e['file'] in UNICODE_FILES) || !Number.isInteger(e['line']) || (e['line'] as number) < 1
      || typeof e['reason'] !== 'string' || e['reason'].trim() === '') {
      problems.push(`${TAILORED} lines[${i}] doesn't name a file, its line and a reason: ${JSON.stringify(e)}`);
      return;
    }
    entries.push({ file: e['file'], line: e['line'] as number, reason: e['reason'] });
  });
  return { entries, problems };
}

export interface Conformance { failures: string[]; first: number | null; differing: number }

/**
 * Compares a program's answers with a conformance file, line by line. A line that differs fails unless
 * the tailored list names it; with `stale`, a listed line that doesn't differ fails too, so the list is
 * exactly the lines that differ. `first` is the first line that differs and isn't listed.
 */
export function conformance<C extends { line: number }>(
  file: string, cases: C[], answers: JsonValue[], diff: (c: C, answer: JsonObject) => string | null,
  tailored: Tailored[], stale: boolean,
): Conformance {
  const listed = new Set(tailored.filter((t) => t.file === file).map((t) => t.line));
  const lines = new Set(cases.map((c) => c.line));
  const failures: string[] = [];
  let first: number | null = null; let differing = 0;
  for (const l of listed) if (!lines.has(l)) failures.push(`${file}:${l} is listed as tailored but is not a test line`);
  cases.forEach((c, i) => {
    const a = answers[i];
    const d = isObject(a) && a['ok'] === true ? diff(c, a) : `refused: ${JSON.stringify(a).slice(0, 200)}`;
    if (d !== null && !listed.has(c.line)) {
      differing++;
      first ??= c.line;
      if (failures.length < 25) failures.push(`${file}:${c.line}: ${d}`);
    } else if (d === null && listed.has(c.line) && stale) {
      failures.push(`${file}:${c.line} is listed as tailored, but the shaper matches it`);
    }
  });
  return { failures, first, differing };
}

export const conformanceMessage = (file: string, r: Conformance): string =>
  `${r.differing} lines of ${file} differ${r.first === null ? '' : `; the first is ${file}:${r.first}`}:\n${r.failures.join('\n')}`;

/** Two lists of integers, equal element for element. */
export const sameInts = (a: JsonValue | undefined, b: number[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------------------------------
// PNG: an 8-bit grayscale reader (color type 0, no interlace) for atlas pages, with node built-ins only.

export interface Gray { width: number; height: number; data: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function readGrayPng(path: string): Gray {
  const file = readFileSync(path);
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error(`${path} is not a PNG`);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || color !== 0 || interlace !== 0) throw Error(`${path} is depth ${depth}, color type ${color}, interlace ${interlace}; an atlas page is 8-bit grayscale, no interlace`);
  const raw = inflateSync(Buffer.concat(data));
  const out = new Uint8Array(width * height);
  let previous = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)));
    for (let i = 0; i < width; i++) {
      const a = i >= 1 ? line[i - 1]! : 0; const b = previous[i]!; const c = i >= 1 ? previous[i - 1]! : 0;
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`${path}: PNG filter ${filter}`);
      line[i] = v & 255;
    }
    out.set(line, y * width);
    previous = line;
  }
  return { width, height, data: out };
}
