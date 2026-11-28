import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
export const FEATURES = ['test-meter'];
export const LANE = 'scripts/pass-fixtures.mjs';
export const TWO_CRATES = ['crates/deep-effects-render', 'crates/deep-gpu-layer'];
export const TOLERANCE = 2;
export const WORST = 16;

export const AC = {
  1: '#1428.5e263fc9',
  2: '#1428.842a6c09',
  3: '#1428.cc64770c',
  4: '#1428.f55fda22',
  5: '#1428.6b850f58',
} as const;

export type Planted = 'pixel_one_code' | 'pixel_three_codes' | 'skips_fixture';

const HOME = homedir();
const TMP = tmpdir();
export function redact(text: string): string {
  const swaps: [string, string][] = [[REPO, '<checkout>'], ['/private' + TMP, '<tmp>'], [TMP, '<tmp>'], [HOME, '~']];
  let out = text;
  for (const [from, to] of swaps) if (from) out = out.split(from).join(to);
  return out.replace(/-Users-[^-/]+-/g, '-Users-<name>-');
}
export const shown = (v: JsonValue | undefined): string => redact(JSON.stringify(v)?.slice(0, 1500) ?? 'undefined');

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value === 'string' && value.length > 0, `${what} is a non-empty string, got ${shown(value)}`).toBe(true);
  return value as string;
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}

export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: these passes draw on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const buildEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
  CARGO_INCREMENTAL: '0',
  CARGO_PROFILE_DEV_DEBUG: '0',
});
const cargoArgs = ['build', '--locked', '--bin', BIN, '--features', FEATURES.join(',')];
export const buildCommand = `node scripts/throttle.mjs build --wait 240 -- cargo ${cargoArgs.join(' ')}`;
function cargoBuild(): string {
  const run = spawnSync(process.execPath, [join(REPO, 'scripts', 'throttle.mjs'), 'build', '--wait', '240', '--', 'cargo', ...cargoArgs], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: buildEnv(), timeout: 6 * 3_600_000, killSignal: 'SIGKILL',
  });
  if (run.error) return `INCONCLUSIVE: ${buildCommand} could not run: ${redact(run.error.message)}; this is not a pass`;
  if (run.status !== 0) {
    const tail = (run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l)).join('\n').slice(-4000);
    return `${buildCommand} exits ${String(run.status)}:\n${redact(tail)}`;
  }
  return '';
}

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
export function useBin(): () => string {
  let dir = '';
  let error: string | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(TMP, 'deep-1428-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', BIN), join(dir, BIN));
  }, 6 * 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, 'the file built the binary').not.toBeNull();
    expect(error, `the binary builds: ${buildCommand}`).toBe('');
    return join(dir, BIN);
  };
}

export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(TMP, 'deep-1428-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface Ran { status: number | null; timedOut: boolean; stdout: string; stderr: string; replies: JsonObject[] | null; answer: JsonValue | null }
export function scenario(bin: string, out: string, calls: JsonObject[], planted?: string, timeoutMs = 1_800_000): Ran {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(redact(`${BIN} ${args.join(' ')}: ${run.error.message}`));
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  let answer: JsonValue | null = null;
  try { answer = lines.length === 1 ? (JSON.parse(lines[0]!) as JsonValue) : null; } catch { answer = null; }
  const replies = isObject(answer ?? undefined) && (answer as JsonObject)['ok'] === true && Array.isArray((answer as JsonObject)['replies'])
    ? ((answer as JsonObject)['replies'] as JsonValue[]).filter(isObject)
    : null;
  return { status: run.status, timedOut, stdout, stderr: run.stderr ?? '', replies, answer };
}
export function run(bin: string, out: string, calls: JsonObject[], planted?: string, timeoutMs?: number): JsonObject[] {
  const name = `${BIN} run${planted ? ` --planted ${planted}` : ''}`;
  const r = scenario(bin, out, calls, planted, timeoutMs);
  expect(r.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exits 0; stdout: ${redact(r.stdout.slice(0, 1500))}; stderr: ${redact(r.stderr.slice(-3000))}`).toBe(0);
  expect(r.replies, `${name} accepts the scenario: ${shown(r.answer ?? r.stdout.slice(0, 1500))}`).not.toBeNull();
  expect(r.replies!.length, `${name}: one reply per call`).toBe(calls.length);
  return r.replies!;
}
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} is answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

export interface PassRow { pass: string; file: string; fixture: string; twin: string }
export function passesTable(bin: string, out: string): PassRow[] {
  const reply = answered(run(bin, out, [{ call: 'passes' }])[0]!, 'the passes call (the fixture table)');
  const rows = arr(reply['passes'], 'passes: passes');
  expect(rows.length, 'the fixture table lists passes').toBeGreaterThan(0);
  return rows.map((value, i) => {
    const row = obj(value, `passes[${i}]`);
    const pass = str(row['pass'], `passes[${i}].pass`);
    return {
      pass,
      file: str(row['file'], `pass ${pass}: file`),
      fixture: str(row['fixture'], `pass ${pass}: fixture (its analytic fixture)`),
      twin: str(row['twin'], `pass ${pass}: twin (its planted twin's --planted name)`),
    };
  });
}

export interface Worst { item: string; pass: string; x: number; y: number; expected: number[]; actual: number[] }
export interface FixtureResult { pass: string; result: string; fixtureRan: boolean; items: string[]; outliers: number; worst: Worst[] }
export function fixtureResult(reply: JsonObject, pass: string): FixtureResult {
  answered(reply, `pass_fixture for ${pass}`);
  expect(reply['pass'], `pass_fixture answers for the pass asked for, ${pass}`).toBe(pass);
  const result = str(reply['result'], `pass ${pass}: result`);
  expect(['PASS', 'FAIL', 'reading'], `pass ${pass}: result is PASS, FAIL or reading`).toContain(result);
  expect(typeof reply['fixture_ran'], `pass ${pass}: fixture_ran is a boolean, got ${shown(reply['fixture_ran'])}`).toBe('boolean');
  const items = arr(reply['items'], `pass ${pass}: items`).map((v, i) => str(v, `pass ${pass}: items[${i}]`));
  const outliers = num(reply['outliers'], `pass ${pass}: outliers`);
  const worst = arr(reply['worst'], `pass ${pass}: worst`).map((v, i) => {
    const w = obj(v, `pass ${pass}: worst[${i}]`);
    const channels = (key: string): number[] => arr(w[key], `pass ${pass}: worst[${i}].${key}`).map((c, k) => num(c, `pass ${pass}: worst[${i}].${key}[${k}]`));
    return {
      item: str(w['item'], `pass ${pass}: worst[${i}].item`),
      pass: str(w['pass'], `pass ${pass}: worst[${i}].pass`),
      x: num(w['x'], `pass ${pass}: worst[${i}].x`),
      y: num(w['y'], `pass ${pass}: worst[${i}].y`),
      expected: channels('expected'),
      actual: channels('actual'),
    };
  });
  return { pass, result, fixtureRan: reply['fixture_ran'] as boolean, items, outliers, worst };
}
export function runFixtures(bin: string, out: string, passes: string[], planted?: string): FixtureResult[] {
  const replies = run(bin, out, passes.map((pass) => ({ call: 'pass_fixture', pass })), planted);
  return replies.map((reply, i) => fixtureResult(reply, passes[i]!));
}
export const diffOf = (w: Worst): number => {
  expect(w.actual.length, `the worst pixel at (${w.x}, ${w.y}) of ${w.pass} gives as many actual channels as expected`).toBe(w.expected.length);
  return Math.max(...w.expected.map((e, k) => Math.abs(w.actual[k]! - e)));
};

export function cleanProblems(results: FixtureResult[]): string[] {
  const problems: string[] = [];
  for (const r of results) {
    if (r.result !== 'PASS') problems.push(`pass ${r.pass}: its analytic fixture reads ${r.result}, not PASS (outliers ${r.outliers}; worst ${JSON.stringify(r.worst.slice(0, 2))})`);
    if (!r.fixtureRan) problems.push(`pass ${r.pass}: fixture_ran is false on the clean build`);
    if (r.outliers !== 0) problems.push(`pass ${r.pass}: ${r.outliers} outlier pixels on the clean build, where zero are allowed`);
    if (r.worst.length !== 0) problems.push(`pass ${r.pass}: lists ${r.worst.length} failing pixels on a PASS`);
  }
  return problems;
}

export function namedFailureProblems(r: FixtureResult, passes: string[]): string[] {
  const problems: string[] = [];
  const at = `pass ${r.pass}`;
  if (r.result !== 'FAIL') problems.push(`${at}: reads ${r.result}, not FAIL`);
  if (!(r.outliers >= 1)) problems.push(`${at}: counts ${r.outliers} outlier pixels on a failure`);
  if (r.worst.length !== Math.min(WORST, r.outliers)) problems.push(`${at}: lists ${r.worst.length} failing pixels for ${r.outliers} outliers, not the worst ${Math.min(WORST, r.outliers)}`);
  if (r.items.length === 0) problems.push(`${at}: its fixture names no item it draws`);
  let previous = Infinity;
  for (const w of r.worst) {
    if (!passes.includes(w.pass)) problems.push(`${at}: the pixel at (${w.x}, ${w.y}) names pass ${w.pass}, not ${passes.join(' or ')}`);
    if (!r.items.includes(w.item)) problems.push(`${at}: the pixel at (${w.x}, ${w.y}) names item ${w.item}, which is not one its fixture draws (${r.items.join(', ')})`);
    const d = diffOf(w);
    if (!(d > TOLERANCE)) problems.push(`${at}: the listed pixel at (${w.x}, ${w.y}) is ${d} code values off, inside the tolerance of ${TOLERANCE}`);
    if (d > previous) problems.push(`${at}: the failing pixels are not worst first (${d} after ${previous})`);
    previous = d;
  }
  return problems;
}

export function wgslFilesUnder(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'target' || name === 'node_modules' || name.startsWith('.')) continue;
      const path = join(dir, name);
      const s = statSync(path);
      if (s.isDirectory()) walk(path);
      else if (name.endsWith('.wgsl')) found.push(relative(REPO, path).split(sep).join('/'));
    }
  };
  for (const root of roots) walk(join(REPO, root));
  return found.sort();
}

export const lanePath = (): string => join(REPO, LANE);
export interface Lane { status: number | null; stdout: string; stderr: string; failLines: string[]; passLine: boolean }
export function runLane(root?: string): Lane {
  expect(existsSync(lanePath()), `the lane ${LANE} exists`).toBe(true);
  const args = [lanePath(), ...(root ? ['--root', root] : [])];
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL', env: gitFreeEnv() });
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n');
  return {
    status: r.status, stdout, stderr: r.stderr ?? '',
    failLines: lines.filter((l) => /^FAIL\b/.test(l)),
    passLine: lines.some((l) => /^PASS\b/.test(l)),
  };
}
export const laneShown = (l: Lane): string => redact(`exit ${String(l.status)}; stdout: ${l.stdout.slice(0, 3000)}; stderr: ${l.stderr.slice(-2000)}`);

export function gitFreeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}

function listCheckout(): string[] {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: gitFreeEnv() });
  if (r.status !== 0) throw Error(redact(`git ls-files in the checkout failed: ${r.stderr}`));
  return [...new Set(r.stdout.split('\0').filter((p) => p !== ''))];
}

export function makeScratch(): string {
  const scratch = mkdtempSync(join(TMP, 'deep-1428-scratch-'));
  for (const path of listCheckout()) {
    if (path.startsWith('tests/acceptance/') || path === '.git' || path.startsWith('.git/')) continue;
    const from = join(REPO, path);
    let info;
    try { info = lstatSync(from); } catch { continue; }
    const to = join(scratch, path);
    mkdirSync(dirname(to), { recursive: true });
    if (info.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else if (info.isFile()) copyFileSync(from, to, constants.COPYFILE_FICLONE);
  }
  const init = spawnSync('git', ['init', '-q'], { cwd: scratch, encoding: 'utf8', env: gitFreeEnv() });
  if (init.status !== 0) throw Error(redact(`git init in the scratch copy failed: ${init.stderr}`));
  return scratch;
}
export function useScratch(): () => string {
  let scratch = '';
  beforeAll(() => { scratch = makeScratch(); }, 1_800_000);
  afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); scratch = ''; });
  return () => scratch;
}
export function plant(scratch: string, files: Record<string, string>): () => void {
  const made: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const to = join(scratch, path);
    expect(existsSync(to), `${path} is new to the checkout`).toBe(false);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
    made.push(to);
  }
  return () => { for (const to of made) rmSync(to, { force: true }); };
}

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  expect(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'the render is a PNG').toBe(true);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  expect(depth === 8 && (color === 2 || color === 6) && interlace === 0, `the render is an 8-bit RGB or RGBA PNG with no interlace (depth ${depth}, color type ${color}, interlace ${interlace})`).toBe(true);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      expect(Number.isNaN(v), `the PNG's filter ${filter} is one of 0 to 4`).toBe(false);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export function readRender(out: string, reply: JsonObject, what: string): Image {
  const given = str(reply['png'], `${what}: png`);
  const path = isAbsolute(given) ? given : join(out, given);
  expect(existsSync(path), `${what}: the PNG it names is written`).toBe(true);
  return decodePng(readFileSync(path));
}
export function distinctColors(img: Image): number {
  const seen = new Set<number>();
  for (let i = 0; i < img.width * img.height; i++) seen.add(((img.rgba[i * 4]! << 24) | (img.rgba[i * 4 + 1]! << 16) | (img.rgba[i * 4 + 2]! << 8) | img.rgba[i * 4 + 3]!) >>> 0);
  return seen.size;
}
export function differingPixels(a: Image, b: Image, box?: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = box ?? [0, 0, a.width, a.height];
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * a.width + x) * 4;
    if (a.rgba[o] !== b.rgba[o] || a.rgba[o + 1] !== b.rgba[o + 1] || a.rgba[o + 2] !== b.rgba[o + 2] || a.rgba[o + 3] !== b.rgba[o + 3]) n++;
  }
  return n;
}

export const LOOK: JsonObject = {
  light: { panel: [214, 218, 224], ink: [24, 26, 31], accent: [26, 163, 200], band: [236, 210, 120] },
};
export const TEXT_BOX: [number, number, number, number] = [16, 16, 280, 44];
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
export function frameDoc(): JsonObject {
  return {
    format: 1, id: 'saved-frame-1428', profile: 'figure', title: 'A frame to save and replay',
    description: 'A panel, a band, a disc and a line of text in one writer layer, saved as its draw data and atlas bytes and replayed.',
    size: [320, 200],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
    items: {
      panel: item('panel', 'rect@1', 'a0', { box: [0, 0, 320, 200], paint: { fill: { role: 'panel' } } }),
      band: item('band', 'rect@1', 'a1', { box: [16, 128, 288, 56], paint: { fill: { role: 'band' } } }),
      dot: item('dot', 'circle@1', 'a2', { center: [262, 92], r: 26, paint: { fill: { role: 'accent' } } }),
      title: item('title', 'text@1', 'a3', { text: 'Saved draws, replayed glyphs', font: 'body', size: 18, box: { w: 264, h: 28 } }, { at: { pos: [16, 16, 0] } }),
    },
  };
}

export function copyFolder(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const a = join(from, name); const b = join(to, name);
    if (statSync(a).isDirectory()) copyFolder(a, b);
    else copyFileSync(a, b);
  }
}
