// Shared helpers for #397's acceptance tests (README: the surfaces, the documents and every stated choice).
// Node built-ins and vitest only. Every expected value is computed here or in the tests from the fixtures and the
// published formulas (sRGB, OKLab, Machado et al. 2009, d3's quantize), never from the implementation.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/397 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every test's timeout: generous enough for a first cargo build of the binaries (prior suites' value). */
export const TIMEOUT = 1_800_000;

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
export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/** True when `value` holds the string `s` anywhere, at any depth, leaving out `what` and `fix` (text for people). */
export function holdsAsData(value: JsonValue | undefined, s: string): boolean {
  if (value === s) return true;
  if (Array.isArray(value)) return value.some((v) => holdsAsData(v, s));
  if (isObject(value)) return Object.entries(value).some(([k, v]) => k !== 'what' && k !== 'fix' && holdsAsData(v, s));
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures

export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);
export const fixtureBytes = (name: string): Buffer => readFileSync(fixturePath(name));
export function fixtureJson(name: string): JsonObject {
  return obj(JSON.parse(readFileSync(fixturePath(name), 'utf8')) as JsonValue, `fixture ${name}`);
}
export const sha256 = (bytes: Buffer | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export type Rgb = [number, number, number];
/** A role table from fixtures/roles.json: role → [r, g, b]. */
export function rolesOf(group: string): Record<string, Rgb> {
  const g = obj(fixtureJson('roles.json')[group], `roles.json ${group}`);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, arr(v, `roles.json ${group}.${k}`).map((x) => num(x, k)) as Rgb]));
}
export const hexOf = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Little-endian column bytes, base64, as marks@1's `data` holds them. */
export function f32s(values: number[]): string {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b.toString('base64');
}
export function u32s(values: number[]): string {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
  return b.toString('base64');
}
export function i64s(values: bigint[]): string {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeBigInt64LE(v, i * 8));
  return b.toString('base64');
}
export const f32Column = (values: number[]): JsonObject => ({ dtype: 'f32', len: values.length, data: f32s(values) });
export const u32Column = (values: number[]): JsonObject => ({ dtype: 'u32', len: values.length, data: u32s(values) });

/** A CSV's cells with their byte ranges in the file: row 0 is the header; a row ends at LF, a CR before it is not in a cell. */
export interface Cell { text: string; start: number; end: number }
export function csvCells(bytes: Buffer): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? bytes[i] : 0x0a;
    if (b === 0x2c || b === 0x0a) {
      const end = b === 0x0a && i > start && bytes[i - 1] === 0x0d ? i - 1 : i;
      row.push({ text: bytes.subarray(start, end).toString('utf8'), start, end });
      start = i + 1;
      if (b === 0x0a) {
        if (!(i === bytes.length && row.length === 1 && row[0]!.start === row[0]!.end)) rows.push(row);
        row = [];
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// Building and starting the binaries. Each file builds what it uses once; every test that uses a build that failed
// fails with cargo's error. deep-show builds are copied out under their own names, since two feature sets share one
// target path.

const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

function cargoBuild(bin: string, features: string[]): string {
  const args = ['build', '--locked', '--bin', bin, ...(features.length ? ['--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  const lines = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(0, 4000)}`;
}

export interface Build { bin: 'deep-canvas-render' | 'deep-show' | 'deep-gpu'; features?: string[] }
const buildName = (b: Build): string => [b.bin, ...(b.features ?? [])].join('+');

/** Builds each listed binary once before the file's tests; `path(build)` fails the test when that build failed. */
export function useBuilds(builds: Build[]): { path: (build: Build) => string } {
  const made = new Map<string, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-397-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const error = cargoBuild(build.bin, build.features ?? []);
      const path = join(dir, name.replace(/[^a-z0-9.+-]/g, '_'));
      if (error === '') copyFileSync(join(targetDir(), 'debug', build.bin), path);
      made.set(name, { path, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return {
    path(build: Build): string {
      const entry = made.get(buildName(build));
      if (!entry) throw Error(`the file didn't list the build ${buildName(build)}`);
      expect(entry.error, `the binary builds: ${buildName(build)}`).toBe('');
      return entry.path;
    },
  };
}

/** One run of `bin args`, the inputs as JSON lines on stdin: one JSON line out per line in, exit 0. */
export function lines(bin: string, args: string[], inputs: JsonValue[]): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  expect(run.status, `${name} exits 0: ${run.stderr.slice(0, 2000)}`).toBe(0);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
  return out.map((l) => JSON.parse(l) as JsonValue);
}

/** The same, without blocking the event loop (so this process can serve the URLs a run fetches). */
export function linesAsync(bin: string, args: string[], inputs: JsonValue[]): Promise<JsonValue[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT);
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (status) => {
      clearTimeout(timer);
      try {
        const name = `${bin.split('/').pop()} ${args.join(' ')}`;
        expect(status, `${name} exits 0: ${stderr.slice(0, 2000)}`).toBe(0);
        const out = stdout.split('\n').filter((l) => l !== '');
        expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
        resolve(out.map((l) => JSON.parse(l) as JsonValue));
      } catch (e) { reject(e); }
    });
    child.stdin.end(`${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`);
  });
}

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-397-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-canvas-render (#373's and #391's surface): check, raster, look.

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Checked { ok: boolean; issues: Issue[]; errors: Issue[]; raw: JsonObject }

export function issuesOf(value: JsonValue | undefined, what: string): Issue[] {
  return arr(value ?? [], what).map((v, i) => {
    const raw = obj(v, `${what}[${i}]`);
    return { code: String(raw['code']), severity: String(raw['severity']), ids: Array.isArray(raw['ids']) ? (raw['ids'] as JsonValue[]).map(String) : [], raw };
  });
}

export function checked(value: JsonValue | undefined, what: string): Checked {
  const raw = obj(value, what);
  expect(typeof raw['ok'], `${what}: the check answers ok: ${JSON.stringify(raw).slice(0, 2000)}`).toBe('boolean');
  const issues = issuesOf(raw['issues'], `${what}: issues`);
  return { ok: raw['ok'] === true, issues, errors: issues.filter((i) => i.severity === 'error'), raw };
}

export const shownIssues = (c: { issues: Issue[] }): string => JSON.stringify(c.issues.map((i) => ({ code: i.code, severity: i.severity, ids: i.ids, path: i.raw['path'] }))).slice(0, 3000);

/** One number the honest-numbers check found in displayed text, with what it traces to (README: `numbers`). */
export interface Trace { item: string; row: string | null; text: string; source: JsonObject; raw: JsonObject }
export function tracesOf(c: Checked): Trace[] {
  return arr(c.raw['numbers'], `check: numbers (${JSON.stringify(c.raw).slice(0, 600)})`).map((v, i) => {
    const raw = obj(v, `numbers[${i}]`);
    return {
      item: str(raw['item'], `numbers[${i}].item`), row: raw['row'] === null || raw['row'] === undefined ? null : String(raw['row']),
      text: str(raw['text'], `numbers[${i}].text`), source: obj(raw['source'], `numbers[${i}].source`), raw,
    };
  });
}

/** A table asset's entry in a document's `assets` (Document envelope: `{id → {sha256, license}}`). */
export const tableAsset = (sha: string): JsonObject => ({ sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' } });

/** The document with a status mark bound to a verdict, as #381's and #373's suites bind one. */
export function withStatus(doc: JsonObject): JsonObject {
  const d = clone(doc);
  obj(d['items'], 'doc.items')['gate'] = { id: 'gate', kind: 'rect@1', layer: 'main', name: 'Status of the release', order: 'z0', params: { box: [560, 8, 64, 20] } };
  d['status_bindings'] = { 'gate-state': { target: 'items/gate/params/paint/fill', source: 'verdict:01JB3970000000000000000001' } };
  return d;
}

/** The shipped clean look as look@1, as `look` resolves it. */
export function cleanLook(render: string): JsonObject {
  const [out] = lines(render, ['look'], [{ look: 'clean' }]);
  const o = obj(out, 'look "clean"');
  expect(o['ok'], `look "clean" answers the shipped look: ${JSON.stringify(o).slice(0, 1500)}`).toBe(true);
  return obj(o['look'], 'look "clean": look');
}

/** A look@1: the clean look with these roles added, each a palette entry of its own name. */
export function lookWith(clean: JsonObject, roles: Record<string, Rgb>): JsonObject {
  const look = clone(clean);
  const palette = obj(look['palette'], 'look.palette');
  const named = obj(look['roles'], 'look.roles');
  for (const [role, c] of Object.entries(roles)) { palette[role] = hexOf(c); named[role] = role; }
  return look;
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace) and pixels.

export interface Image { width: number; height: number; rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
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

export const readPng = (path: string): Image => decodePng(readFileSync(path));

export function pixel(image: Image, x: number, y: number): Rgb {
  const px = Math.floor(x); const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (py * image.width + px) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const near = (a: Rgb, b: Rgb, tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

// ---------------------------------------------------------------------------------------------------
// Color, computed in f64 from published formulas: the sRGB transfer function (IEC 61966-2-1), OKLab (Björn
// Ottosson, 2020) and Machado, Oliveira and Fernandes 2009's simulation matrices at severity 100, applied in linear
// sRGB as colorspacious applies them (the Oracle page's colorspacious cb21a8d0aa, colorspacious/cvd.py).

const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
type Vec3 = [number, number, number];
function linearToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** cvd.py's machado_et_al_2009_matrices[...][100]: protanomaly, deuteranomaly and tritanomaly at full severity. */
export const MACHADO_100: Record<'protanopia' | 'deuteranopia' | 'tritanopia', Vec3[]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export type Vision = 'seen' | keyof typeof MACHADO_100;
export const VISIONS: Vision[] = ['seen', 'protanopia', 'deuteranopia', 'tritanopia'];
function simulated(c: Rgb, vision: Vision, clip: boolean): Vec3 {
  const lin = c.map(toLinear) as Vec3;
  if (vision === 'seen') return lin;
  const out = MACHADO_100[vision].map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]) as Vec3;
  return clip ? (out.map((v) => Math.min(1, Math.max(0, v))) as Vec3) : out;
}
/** OKLab ΔE between two sRGB colors as seen or under a simulated deficiency (unclipped, and clipped to [0, 1]). */
export function deltaE(a: Rgb, b: Rgb, vision: Vision, clip = false): number {
  const x = linearToOklab(simulated(a, vision, clip)); const y = linearToOklab(simulated(b, vision, clip));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393's scenario): one agent's session, a panel and a hub-minted document ID.

export const DOC = '01JB397D000000000000000001';
export const SESSION = 'sess-alpha';
export const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-alpha', name: 'Alpha', process: { pid: 4100, start: 1000 } } };

export function scenario(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return { evidence, sessions: SESSIONS, panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main' } }, calls, ...extra };
}

/** `deep-show run` over one scenario: accepted, one reply per call. */
export function replies(out: JsonValue | undefined, calls: number): JsonObject[] {
  const o = obj(out, 'deep-show run: the answer');
  expect(o['ok'], `deep-show run accepts the scenario: ${JSON.stringify(o).slice(0, 2000)}`).toBe(true);
  const list = arr(o['replies'], 'deep-show run: replies').map((r, i) => obj(r, `replies[${i}]`));
  expect(list.length, 'deep-show run: one reply per call').toBe(calls);
  return list;
}

/** A piece of evidence by hash (`<first 2 hex>/<other 62 hex>` under the root, as packages/evidence keeps it). */
export const evidenceFile = (root: string, sha: string): string => join(root, sha.slice(0, 2), sha.slice(2));

/** Serves `bytes` at `/<name>` on 127.0.0.1 for the file's tests; the URL it is fetched at. */
export function useServer(files: Record<string, Buffer>): () => string {
  let base = '';
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').slice(1);
    const body = files[name];
    if (req.method !== 'GET' || !body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  return () => base;
}

/** A table asset as `table_import` answers it. */
export interface Imported { sha256: string; asset: JsonObject }
export function importedOf(reply: JsonObject, what: string): Imported {
  const asset = obj(reply['asset'], `${what}: asset`);
  return { sha256: str(asset['sha256'], `${what}: asset.sha256`), asset };
}

export const writeJson = (dir: string, name: string, value: JsonValue): string => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};

// ---------------------------------------------------------------------------------------------------
// Timing: the reference-Mac gate (#387's, #855's) and the design's judge (Every task carries its own budgets: five
// runs after warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin, the
// larger of 5% and their spread; else INCONCLUSIVE). Mains power never gates (the owner's rule); load does.

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

/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
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
