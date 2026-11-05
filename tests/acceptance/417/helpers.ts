// Test-side tools for the #417 acceptance tests: the three binaries they drive (`deep-canvas-render`,
// `deep-text`, `deep-motion`), built once per file and driven by JSON lines; the shipped looks as `look`
// answers them; OKLab and the sRGB transfer function from their published formulas; a PNG reader; an
// OpenType reader for the three things the criteria ask of a font file (its OS/2 embedding bits, its
// character map and whether it carries a MATH table); and licence texts. Nothing here stands in for the
// look module, the shaper, the check or motion under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/417 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The 2D marks' proof surface (#391, #392, #373, #381): `look`, `check`, `raster`, `session`. */
export const RENDER_BIN = exe('deep-canvas-render');
/** The text module's binary (#390, #381): `fonts`. */
export const TEXT_BIN = exe('deep-text');
/** Motion's binary (#391): `eval`. */
export const MOTION_BIN = exe('deep-motion');

/** The four looks the issue ships first, by the IDs this suite gives them (README: The shipped looks). */
export const FIRST_LOOKS = ['clean', 'notebook_pencil', 'chalk', 'dark_math'] as const;

/** One second in flicks (canvas primitives: Time and the flick). */
export const FLICKS_PER_SECOND = 705_600_000;
export const sec = (s: number): number => Math.round(s * FLICKS_PER_SECOND);

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? String(v);

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}
/** A fixture's path relative to the checkout, as a report names it. */
export const fixtureRel = (name: string): string => `tests/acceptance/417/fixtures/${name}`;

/** True when `value` holds the string `s` anywhere (a key's value, an array's element, nested). */
export function holdsString(value: JsonValue | undefined, s: string): boolean {
  if (value === s) return true;
  if (Array.isArray(value)) return value.some((v) => holdsString(v, s));
  if (isObject(value)) return Object.values(value).some((v) => holdsString(v, s));
  return false;
}

/** A scratch folder deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-417-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// Builds and runs: each binary built once per file with `cargo build --locked --bin <name>`; a test of a
// file whose build failed fails. One process per batch: JSON lines in, exactly one line out per line.

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
  const name = `${basename(bin)} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${(run.stderr ?? '').slice(-4000)}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line, i) => {
    try { return JSON.parse(line) as JsonValue; } catch { throw Error(`${name}: line ${i + 1} of its output is not JSON: ${line.slice(0, 300)}`); }
  });
}

export function one(bin: string, args: string[], input: JsonValue | string): JsonObject {
  return obj(batch(bin, args, [input])[0], `${basename(bin)} ${args.join(' ')}: the answer`);
}

/** An answer that must be an acceptance (`ok: true`). */
export function accepted(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} is accepted, got ${shown(answer)}`).toBe(true);
  return answer;
}

/** Fails with a message that starts INCONCLUSIVE off macOS: the session draws through GPUI's offscreen Metal renderer. */
export function requireMac(what: string): void {
  expect(process.platform, `INCONCLUSIVE: ${what} draws through GPUI's offscreen Metal renderer on macOS; this is not a pass`).toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// Looks, as `deep-canvas-render look` answers them.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];

export interface ResolvedLook {
  /** The look@1 definition the look resolved from. */
  def: JsonObject;
  /** Each theme's color roles as the look resolves them (`#rrggbb`, or `#rrggbbaa` for a role at an alpha). */
  roles: Record<Theme, Record<string, Rgba>>;
  /** Each theme's role entries that aren't colors (font roles), by role. */
  fontRoles: Record<Theme, Record<string, string>>;
  raw: JsonObject;
}

export function hexColor(value: JsonValue | undefined, what: string): Rgba {
  const text = str(value, what);
  expect(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text), `${what} is #rrggbb or #rrggbbaa, got ${text}`).toBe(true);
  const byte = (i: number): number => parseInt(text.slice(i, i + 2), 16);
  return [byte(1), byte(3), byte(5), text.length === 9 ? byte(7) : 255];
}
export const hexOf = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const isHex = (v: JsonValue | undefined): boolean => typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);

/** Reads a `look` answer that must be accepted. */
export function readLook(answer: JsonObject, what: string): ResolvedLook {
  accepted(answer, what);
  const def = obj(answer['look'], `${what}: look`);
  const rolesOut = obj(answer['roles'], `${what}: roles`);
  const roles = { light: {}, dark: {} } as Record<Theme, Record<string, Rgba>>;
  const fontRoles = { light: {}, dark: {} } as Record<Theme, Record<string, string>>;
  const fonts = isObject(def['fonts']) ? def['fonts'] : {};
  for (const theme of THEMES) {
    for (const [role, v] of Object.entries(obj(rolesOut[theme], `${what}: roles.${theme}`))) {
      if (isHex(v)) roles[theme][role] = hexColor(v, `${what}: roles.${theme}.${role}`);
      else {
        // A role that isn't a color names one of the look's fonts (Look look@1: roles → font).
        expect(typeof v === 'string' && v in fonts, `${what}: roles.${theme}.${role} is a color or names one of the look's fonts, got ${shown(v)}`).toBe(true);
        fontRoles[theme][role] = v as string;
      }
    }
  }
  return { def, roles, fontRoles, raw: answer };
}

/** Every look `deep-canvas-render look` lists as shipped (README: `look` with `list`). */
export function shippedIds(): string[] {
  const out = accepted(one(RENDER_BIN, ['look'], { list: 'shipped' }), 'look {"list": "shipped"}');
  return arr(out['shipped'], 'look list: shipped').map((v, i) => str(v, `shipped[${i}]`));
}

const lookCache = new Map<string, ResolvedLook>();
/** A shipped look by its ID, as `look` resolves it. */
export function shippedLook(id: string): ResolvedLook {
  if (!lookCache.has(id)) lookCache.set(id, readLook(one(RENDER_BIN, ['look'], { look: id }), `look ${JSON.stringify(id)}`));
  const found = lookCache.get(id)!;
  return { ...found, def: clone(found.def) };
}

/** The look's status colors and its status distance (`min_distance`, 0.10 when it names none). */
export function statusOf(def: JsonObject, what: string): { colors: Record<string, Rgb>; min: number } {
  const map = obj(def['status'], `${what}: status`);
  const colors: Record<string, Rgb> = {};
  for (const [state, c] of Object.entries(map)) {
    if (!isHex(c)) continue;
    const [r, g, b] = hexColor(c, `${what}: status.${state}`);
    colors[state] = [r, g, b];
  }
  for (const state of ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle']) {
    expect(colors[state], `${what}: the status map gives ${state} a color`).toBeDefined();
  }
  const min = typeof def['min_distance'] === 'number' ? def['min_distance'] : 0.1;
  return { colors, min };
}

/** The file of the font a look's font role resolves to: `roles[role]` names a `fonts` entry, else the entry named as the role. */
export function fontFileOf(look: ResolvedLook, role: string, theme: Theme = 'light'): { name: string; file: string; entry: JsonObject } {
  const fonts = obj(look.def['fonts'], 'look.fonts');
  const named = look.fontRoles[theme][role];
  const name = named ?? role;
  const entry = obj(fonts[name], `the look's font for the ${role} role (fonts.${name})`);
  return { name, file: str(entry['file'], `fonts.${name}.file`), entry };
}

/**
 * The look with `role` set to `color` in both themes, through a palette entry of its own: the role's
 * entry in `roles` and in each theme's `roles` that sets it now names `planted_<role>`.
 */
export function withRoleColor(def: JsonObject, role: string, color: Rgb, id: string): JsonObject {
  const out = clone(def);
  out['id'] = id;
  const name = `planted_${role}`;
  obj(out['palette'], 'look.palette')[name] = hexOf(color);
  obj(out['roles'], 'look.roles')[role] = name;
  const themes = isObject(out['themes']) ? out['themes'] : {};
  for (const t of Object.values(themes)) {
    if (isObject(t) && isObject(t['roles']) && role in t['roles']) t['roles'][role] = name;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Color, computed in f64 from published formulas, never from the implementation: the sRGB transfer
// function (IEC 61966-2-1) and OKLab (Björn Ottosson, "A perceptual color space for image processing",
// 2020: the M1 and M2 matrices as published there), as #373's tests compute it.

export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toEncoded = (l: number): number => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
export type Lab = [number, number, number];

export function linearToOklab([r, g, b]: [number, number, number]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
/** An sRGB-encoded 0–255 color's OKLab. */
export const oklabOf = (c: Rgb | Rgba): Lab => linearToOklab([toLinear(c[0] / 255), toLinear(c[1] / 255), toLinear(c[2] / 255)]);
export const deltaE = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const distance = (a: Rgb | Rgba, b: Rgb | Rgba): number => deltaE(oklabOf(a), oklabOf(b));

/** `color` at its alpha over an opaque `base`, blended in sRGB-encoded values (as the look guard blends a role at an alpha). */
export function over(color: Rgba, base: Rgb | Rgba): Rgb {
  const a = color[3] / 255;
  return [0, 1, 2].map((i) => Math.round(color[i]! * a + base[i]! * (1 - a))) as Rgb;
}

/**
 * The 8-bit sRGB color nearest in OKLab ΔE to `target` away from `from`, searched over every color within
 * ±`reach` codes of `from`, among those whose nearest color in `others` is at least `clear` away: the
 * planted colors are found from the look's own status map at run time, never written in.
 */
export function colorAtDistance(from: Rgb, target: number, others: Rgb[], clear: number, reach = 60): { color: Rgb; at: number } {
  const f = oklabOf(from);
  const labs = others.map(oklabOf);
  let best: { color: Rgb; at: number; err: number } | null = null;
  for (let r = Math.max(0, from[0] - reach); r <= Math.min(255, from[0] + reach); r++) {
    for (let g = Math.max(0, from[1] - reach); g <= Math.min(255, from[1] + reach); g++) {
      for (let b = Math.max(0, from[2] - reach); b <= Math.min(255, from[2] + reach); b++) {
        const lab = linearToOklab([toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)]);
        const d = deltaE(lab, f);
        const err = Math.abs(d - target);
        if (best && err >= best.err) continue;
        if (labs.some((o) => deltaE(lab, o) < clear)) continue;
        best = { color: [r, g, b], at: d, err };
      }
    }
  }
  if (!best) throw Error(`no color ${target} from ${hexOf(from)} keeps ${clear} from the others`);
  return { color: best.color, at: best.at };
}

// ---------------------------------------------------------------------------------------------------
// The check, the raster and their refusals.

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }

export function issuesOf(out: JsonObject, what: string): Issue[] {
  return arr(out['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const raw = obj(v, `${what}: issues[${i}]`);
    return { code: String(raw['code']), severity: String(raw['severity']), path: String(raw['path']), ids: Array.isArray(raw['ids']) ? raw['ids'].map(String) : [], raw };
  });
}
export const errorsOf = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === 'error');

/** `check` over a document in a look. */
export function check(doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject {
  return one(RENDER_BIN, ['check'], { doc, look, ...extra });
}

/**
 * Where an answer (a check's, a raster's or a look's refusal) names a status-distance clash: the role and
 * the state, from a refusal `{code: "status_distance", role, state}` or an error issue of that code whose
 * fields (outside its message text) name them.
 */
export function distanceClash(out: JsonObject): { role: string; state: string } | null {
  if (out['code'] === 'status_distance' && typeof out['role'] === 'string' && typeof out['state'] === 'string') {
    return { role: out['role'], state: out['state'] };
  }
  for (const issue of Array.isArray(out['issues']) ? out['issues'] : []) {
    if (!isObject(issue) || issue['code'] !== 'status_distance' || issue['severity'] !== 'error') continue;
    const actual = isObject(issue['actual']) ? issue['actual'] : {};
    if (typeof actual['role'] === 'string' && typeof actual['state'] === 'string') return { role: actual['role'], state: actual['state'] };
  }
  return null;
}

let rasters = 0;
/** A `raster` line for `doc` in `look`, writing its PNG under `dir`. */
export function rasterInput(dir: string, doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${rasters}.png`), doc, look, ...extra };
}

export interface Drawn { report: JsonObject; image: Image }
/** Reads a raster's answer and its PNG; the answer must be accepted and the PNG the document's size. */
export function readRaster(input: JsonObject, out: JsonValue | undefined, what: string): Drawn {
  const report = obj(out, `raster ${what}: the answer`);
  expect(report['ok'], `raster ${what} is drawn, got ${shown(report)}`).toBe(true);
  const size = arr(obj(input['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const image = readPng(String(input['out']));
  expect([image.width, image.height], `raster ${what}: the PNG is the document's size`).toEqual(size);
  return { report, image };
}

/** Each line of a batch drawn by one `raster` process. */
export function rasterAll(inputs: JsonObject[], what: string[]): Drawn[] {
  return batch(RENDER_BIN, ['raster'], inputs).map((out, i) => readRaster(inputs[i]!, out, what[i]!));
}

/** The glyphs `raster` reports for one text item (#381's `texts`), with the fields this suite reads. */
export interface Glyph { font: string; id: number; grapheme: number; lang: string | null; raw: JsonObject }
export function glyphsOf(report: JsonObject, item: string): Glyph[] {
  const texts = obj(report['texts'], 'raster: texts');
  const text = obj(texts[item], `raster: texts.${item}`);
  return arr(text['glyphs'], `texts.${item}.glyphs`).map((v, i) => {
    const g = obj(v, `texts.${item}.glyphs[${i}]`);
    return {
      font: str(g['font'], `texts.${item}.glyphs[${i}].font`), id: num(g['id'], `texts.${item}.glyphs[${i}].id`),
      grapheme: num(g['grapheme'], `texts.${item}.glyphs[${i}].grapheme`),
      lang: typeof g['lang'] === 'string' ? g['lang'] : null, raw: g,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the raster writes (8-bit RGB or RGBA, no interlace), node built-ins only.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!file.subarray(0, 8).equals(signature)) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
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
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
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
export function readPng(path: string): Image { return decodePng(readFileSync(path)); }

export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** How many pixels differ between two images of one size. */
export function pixelsDiffering(a: Image, b: Image): number {
  let n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    const o = p * 4;
    if (a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2]) n++;
  }
  return n;
}
/** The image's per-channel median in OKLab: what most of a frame's ground reads, texture and all. */
export function medianLab(image: Image): Lab {
  const ch: number[][] = [[], [], []];
  for (let p = 0; p < image.width * image.height; p += 3) {
    const o = p * 4;
    const lab = oklabOf([image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!]);
    ch[0]!.push(lab[0]); ch[1]!.push(lab[1]); ch[2]!.push(lab[2]);
  }
  return ch.map((c) => c.sort((x, y) => x - y)[c.length >> 1]!) as Lab;
}

// ---------------------------------------------------------------------------------------------------
// OpenType: the table directory (of a face, or of face `index` in a collection), the OS/2 table's
// embedding bits (fsType), the character map (formats 4 and 12) and the MATH table's presence, read as
// the OpenType specification (ISO/IEC 14496-22) lays them out.

export interface Sfnt { tables: Map<string, { offset: number; length: number }>; bytes: Buffer }

export function sfnt(bytes: Buffer, index = 0): Sfnt {
  let base = 0;
  if (bytes.toString('latin1', 0, 4) === 'ttcf') {
    const faces = bytes.readUInt32BE(8);
    if (index >= faces) throw Error(`face ${index} of a collection of ${faces}`);
    base = bytes.readUInt32BE(12 + 4 * index);
  }
  const count = bytes.readUInt16BE(base + 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i;
    tables.set(bytes.toString('latin1', at, at + 4), { offset: bytes.readUInt32BE(at + 8), length: bytes.readUInt32BE(at + 12) });
  }
  return { tables, bytes };
}

/** The faces a font file holds: 1, or a collection's count. */
export const faceCount = (bytes: Buffer): number => (bytes.toString('latin1', 0, 4) === 'ttcf' ? bytes.readUInt32BE(8) : 1);

/** OS/2 fsType: 0 installable; bit 1 (0x0002) restricted licence embedding; bit 9 (0x0200) bitmap embedding only. */
export function fsType(font: Sfnt): number | null {
  const os2 = font.tables.get('OS/2');
  return os2 ? font.bytes.readUInt16BE(os2.offset + 8) : null;
}
/** Whether the face's own embedding bits let it be embedded as outlines: OS/2 present, not restricted, not bitmap-only. */
export const embeddable = (type: number | null): boolean => type !== null && (type & 0x0002) === 0 && (type & 0x0200) === 0;

export const hasTable = (font: Sfnt, tag: string): boolean => font.tables.has(tag);

/** The glyph the face's character map gives a code point (0: none), from a Unicode subtable of format 4 or 12. */
export function cmapGlyph(font: Sfnt, cp: number): number {
  const cmap = font.tables.get('cmap');
  if (!cmap) return 0;
  const b = font.bytes;
  const n = b.readUInt16BE(cmap.offset + 2);
  const subtables: { platform: number; encoding: number; offset: number }[] = [];
  for (let i = 0; i < n; i++) {
    const at = cmap.offset + 4 + 8 * i;
    subtables.push({ platform: b.readUInt16BE(at), encoding: b.readUInt16BE(at + 2), offset: cmap.offset + b.readUInt32BE(at + 4) });
  }
  const unicode = subtables.filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
  let found = 0;
  for (const s of unicode) {
    const format = b.readUInt16BE(s.offset);
    let g = 0;
    if (format === 12) {
      const groups = b.readUInt32BE(s.offset + 12);
      for (let i = 0; i < groups; i++) {
        const at = s.offset + 16 + 12 * i;
        const start = b.readUInt32BE(at); const end = b.readUInt32BE(at + 4);
        if (cp >= start && cp <= end) { g = b.readUInt32BE(at + 8) + (cp - start); break; }
      }
    } else if (format === 4 && cp <= 0xffff) {
      const segX2 = b.readUInt16BE(s.offset + 6);
      const ends = s.offset + 14; const starts = ends + segX2 + 2; const deltas = starts + segX2; const ranges = deltas + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        const end = b.readUInt16BE(ends + 2 * i);
        if (cp > end) continue;
        const start = b.readUInt16BE(starts + 2 * i);
        if (cp < start) break;
        const delta = b.readInt16BE(deltas + 2 * i);
        const range = b.readUInt16BE(ranges + 2 * i);
        if (range === 0) g = (cp + delta) & 0xffff;
        else {
          const at = ranges + 2 * i + range + 2 * (cp - start);
          const raw = b.readUInt16BE(at);
          g = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        break;
      }
    }
    if (g !== 0) { found = g; break; }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// Licences: which licences let a font be embedded in what we ship, and the words of each licence's own
// text, so a licence file beside a face is that licence (README: Licences).

export const EMBEDDABLE_LICENSES: Record<string, RegExp[]> = {
  'OFL-1.1': [/SIL OPEN FONT LICENSE/i, /Version 1\.1/i],
  'Apache-2.0': [/Apache License/i, /Version 2\.0/i],
  MIT: [/Permission is hereby granted, free of charge/i],
  'BSD-3-Clause': [/Redistribution and use in source and binary forms/i, /Neither the name/i],
  'CC0-1.0': [/CC0 1\.0/i],
  'Ubuntu-font-1.0': [/UBUNTU FONT LICEN[CS]E/i],
  'Bitstream-Vera': [/Bitstream Vera/i],
};
/** Problems with a face's licence record: a licence that allows embedding, its text beside the face. */
export function licenceProblems(face: { file: string; license: string; licenseFile: string }): string[] {
  const problems: string[] = [];
  const markers = EMBEDDABLE_LICENSES[face.license];
  if (/GPL/i.test(face.license)) problems.push(`${face.file}: licence ${face.license} is GPL, which this project never ships`);
  if (!markers) problems.push(`${face.file}: licence ${JSON.stringify(face.license)} is not one that allows embedding (${Object.keys(EMBEDDABLE_LICENSES).join(', ')})`);
  if (dirname(face.licenseFile) !== dirname(face.file)) problems.push(`${face.file}: its licence file ${face.licenseFile} is not beside it`);
  let text = '';
  try { text = readFileSync(join(REPO, face.licenseFile), 'utf8'); } catch { problems.push(`${face.file}: its licence file ${face.licenseFile} can't be read`); }
  if (text && markers && !markers.every((m) => m.test(text))) problems.push(`${face.file}: ${face.licenseFile} isn't the ${face.license} text`);
  return problems;
}

/** Every face `deep-text fonts` lists (README: `deep-text fonts`). */
export interface Face { file: string; family: string; license: string; licenseFile: string }
export function bundledFaces(): Face[] {
  const out = accepted(one(TEXT_BIN, ['fonts'], {}), 'deep-text fonts');
  return arr(out['faces'], 'fonts: faces').map((v, i) => {
    const f = obj(v, `faces[${i}]`);
    return { file: str(f['file'], `faces[${i}].file`), family: str(f['family'], `faces[${i}].family`), license: str(f['license'], `faces[${i}].license`), licenseFile: str(f['license_file'], `faces[${i}].license_file`) };
  });
}
export const FONT_DIR = 'crates/deep-text/fonts';
export const isFontFile = (name: string): boolean => /\.(ttf|otf|ttc|otc)$/i.test(name);
export const readFace = (rel: string, index = 0): Sfnt => sfnt(readFileSync(join(REPO, rel)), index);
