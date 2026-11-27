import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

export const AC = { 1: 'AC1 #1316.a4e5e495', 2: 'AC2 #1316.33db7d22' } as const;

export const RUNS = 10;

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}; unblock: ${unblock}`);
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro' },
  { model: 'Mac15,12', chip: 'Apple M3' },
  { model: 'Mac17,10', chip: 'Apple M5 Max' },
  { model: 'Mac18,1', chip: 'Apple M6' },
];
export function requireReferenceMac(): string {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these frames on macOS's Metal device; this is ${process.platform}`);
  const read = (...args: string[]): string | null => {
    try { return execFileSync('sysctl', ['-n', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
  };
  const model = read('hw.model'); const chip = read('machdep.cpu.brand_string');
  const fingerprint = `${model} / ${chip}`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip)) {
    inconclusive(`not a reference Mac (${REFERENCE_MACS.map((m) => `${m.model} ${m.chip}`).join(', ')}): this is ${fingerprint}`);
  }
  return fingerprint;
}

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1316-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, 'deep-gpu'); };
}
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1316-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export type GpuPlanted = 'environment_texture_race';
function runGpu(bin: string, out: string, call: JsonObject, planted?: GpuPlanted): JsonObject {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls: [call] })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = JSON.parse(lines[0]!) as JsonValue;
  expect(isObject(answer) && answer['ok'] === true, `${name} accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = (answer as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === 1 && isObject(replies[0]), `${name}: one reply: ${shown(replies)}`).toBe(true);
  const reply = (replies as JsonObject[])[0]!;
  if (reply['code'] === 'unsupported_platform') inconclusive(`${name} reports unsupported_platform`);
  expect(reply['code'], `${name}: the view3d call was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

const KHRONOS_COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
interface Pin { path: string; sha256: string; size: number }
interface Sample {
  name: SampleName; main: Pin; license: JsonObject;
  eye: V3; target: V3; radius: number;
}
export type SampleName = 'SheenChair' | 'DispersionTest';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
const CCBY = 'https://creativecommons.org/licenses/by/4.0/legalcode';
export const SAMPLES: Record<SampleName, Sample> = {
  SheenChair: {
    name: 'SheenChair', main: { path: 'Models/SheenChair/glTF-Binary/SheenChair.glb', sha256: 'f0af2a2b102d28d540236306ae19f8fb36842df76bd38cf76f063f9bd2853399', size: 4125648 },
    license: { id: 'CC0-1.0', terms: CC0, shareable: true, credit: '© 2020 Wayfair, LLC; by Eric Chadwick (SheenChair, CC0 1.0)' },
    eye: [0.46317521960602176, 0.7406983022835758, 1.3338894043952503], target: [-0.0007434040307998657, 0.3430537677377288, 0.008407622575759888], radius: 0.608139755037773,
  },
  DispersionTest: {
    name: 'DispersionTest', main: { path: 'Models/DispersionTest/glTF-Binary/DispersionTest.glb', sha256: 'bbac38386632b5a7a27289737963314c2f92095074dfdf0e8c0c1c25270b3e37', size: 2310944 },
    license: { id: 'CC-BY-4.0', terms: CCBY, shareable: true, credit: '© 2023 AGI; by Ed Mackey (DispersionTest, CC BY 4.0)' },
    eye: [0.10300130780213142, 0.10950271395544182, 0.3795221636461513], target: [-0.014599724143258275, 0.008701829430822094, 0.043519215230752195], radius: 0.15416036157118432,
  },
};
const KHRONOS_CACHE = join(homedir(), '.cache', 'deepbuild-acceptance', 'khronos');
async function pinned(pin: Pin): Promise<Buffer> {
  const file = join(KHRONOS_CACHE, pin.sha256);
  if (existsSync(file)) { const bytes = readFileSync(file); if (sha256(bytes) === pin.sha256) return bytes; }
  const url = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${KHRONOS_COMMIT}/${pin.path}`;
  let bytes: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) return blocked(`fetching ${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} answered HTTP ${response.status}`, `reach ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (e) {
    return blocked(`${pin.path} isn't cached and the network is unreachable (${(e as Error).message})`, `run once with the network, or place the file at ~/.cache/deepbuild-acceptance/khronos/${pin.sha256}`);
  }
  expect(sha256(bytes), `${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} has its pinned SHA-256`).toBe(pin.sha256);
  expect(bytes.length, `${pin.path} has its pinned size`).toBe(pin.size);
  mkdirSync(KHRONOS_CACHE, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, bytes); renameSync(temp, file);
  return bytes;
}
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function committed(bytes: Buffer): boolean {
  const id = gitBlob(bytes);
  const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const index = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return tree.includes(` ${id}\t`) || index.includes(` ${id} `);
}
export interface Fetched { sample: Sample; sha: string; assets: Record<string, string>; licenses: Record<string, JsonObject> }
export async function khronos(name: SampleName, dir: string): Promise<Fetched> {
  const sample = SAMPLES[name];
  const bytes = await pinned(sample.main);
  expect(committed(bytes), `${sample.main.path} is never committed: no blob in HEAD or the index has its bytes`).toBe(false);
  const path = join(dir, sample.main.sha256);
  writeFileSync(path, bytes);
  return { sample, sha: sample.main.sha256, assets: { [sample.main.sha256]: path }, licenses: { [sample.main.sha256]: sample.license } };
}

const STATUS: JsonObject = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const LOOK: JsonObject = {
  id: 'look-1316-filmic', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1316 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: STATUS, status_treatment: { core_min_px: 4, glyph: GLYPHS }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
const SKY: JsonObject = {
  kind: 'sky@1', params: { top: [0.25, 0.4, 0.8, 1], low: [0.8, 0.8, 0.78, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
const SUN: JsonObject = { kind: 'light.sun@1', params: { illuminance: 1.8919519189934, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 25, 0] } };
export const SIZE: [number, number] = [1280, 800];

function sceneDoc(f: Fetched): JsonObject {
  const s = f.sample;
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: s.eye, target: s.target, fov: 40, near: s.radius / 100, far: s.radius * 20 } },
    sky: SKY, sun: SUN, asset: { kind: 'mesh.asset@1', params: { sha256: f.sha, node: { scene: 0 } }, at: { pos: [0, 0, 0] } },
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  const id = `env-lit-${s.name}`;
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1316 acceptance fixture.`, size: SIZE, camera: 'cam', transport: { span: '4s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-1316', title: 'Main', order: 'a0' } }, items: withIds,
  };
}

type Target = 'final' | 'linear';
interface Drawn { final: string; linear: string }
function drawOnce(bin: string, out: string, doc: string, f: Fetched, planted?: GpuPlanted): Drawn {
  const what = `${f.sample.name}${planted ? ` (planted ${planted})` : ''}`;
  const reply = runGpu(bin, out, { call: 'view3d', doc, look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'linear'], assets: f.assets, licenses: f.licenses }, planted);
  const frames = reply['frames'];
  expect(Array.isArray(frames), `${what}: the reply has frames: ${shown(reply)}`).toBe(true);
  const frame = (frames as JsonValue[]).find((x) => isObject(x) && x['frame'] === 0) as JsonObject | undefined;
  expect(frame, `${what}: frame 0 is in the reply: ${shown(frames)}`).toBeDefined();
  const named = (target: Target, ext: string): string => {
    const hash = frame![target];
    expect(hash, `${what}: the ${target} target is written, named by a SHA-256`).toMatch(SHA);
    expect(sha256(readFileSync(join(out, `${String(hash)}.${ext}`))), `${what}: the ${target} target's file hashes to its name`).toBe(hash);
    return hash as string;
  };
  return { final: named('final', 'png'), linear: named('linear', 'f32') };
}

function linearDiff(a: Buffer, b: Buffer): string {
  if (a.length !== b.length) return `sizes differ (${a.length} and ${b.length} bytes)`;
  let n = 0; let worst = 0; let at = '';
  for (let p = 0; p < a.length / 16; p++) {
    if (a.compare(b, p * 16, p * 16 + 16, p * 16, p * 16 + 16) === 0) continue;
    n++;
    for (let c = 0; c < 4; c++) {
      const x = a.readFloatLE(p * 16 + c * 4); const y = b.readFloatLE(p * 16 + c * 4);
      const rel = x === y ? 0 : Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-6);
      if (rel > worst) { worst = rel; at = `(${p % SIZE[0]}, ${Math.floor(p / SIZE[0])}) channel ${c}: ${x} vs ${y}`; }
    }
  }
  return `${n} of ${a.length / 16} pixels differ, worst ${(worst * 100).toFixed(3)}% relative at ${at}`;
}
function finalDiff(a: Buffer, b: Buffer): string {
  let pa: Png; let pb: Png;
  try { pa = decodePng(a); pb = decodePng(b); } catch (e) { return `the PNGs could not be compared (${(e as Error).message})`; }
  if (pa.width !== pb.width || pa.height !== pb.height) return `sizes differ (${pa.width}×${pa.height} and ${pb.width}×${pb.height})`;
  let n = 0;
  for (let p = 0; p < pa.width * pa.height; p++) for (let c = 0; c < 4; c++) if (pa.rgba[p * 4 + c] !== pb.rgba[p * 4 + c]) { n++; break; }
  return n === 0 ? 'no pixel differs (the PNG bytes differ only in their encoding)' : `${n} of ${pa.width * pa.height} pixels differ`;
}

export function sameEveryRun(bin: string, out: string, f: Fetched, runs: number, planted?: GpuPlanted, stopAtFirst = false): string | null {
  const name = f.sample.name;
  const doc = join(out, `scene-${name}.json`);
  writeFileSync(doc, JSON.stringify(sceneDoc(f)));
  const drawn: Drawn[] = [drawOnce(bin, out, doc, f, planted)];
  const problems: string[] = [];
  for (let i = 2; i <= runs; i++) {
    const d = drawOnce(bin, out, doc, f, planted);
    drawn.push(d);
    for (const [target, ext] of [['final', 'png'], ['linear', 'f32']] as const) {
      if (d[target] === drawn[0]![target]) continue;
      const a = readFileSync(join(out, `${drawn[0]![target]}.${ext}`)); const b = readFileSync(join(out, `${d[target]}.${ext}`));
      problems.push(`${name}: run ${i}'s ${target} target (${d[target].slice(0, 12)}) differs from run 1's (${drawn[0]![target].slice(0, 12)}): ${target === 'linear' ? linearDiff(a, b) : finalDiff(a, b)}`);
    }
    if (stopAtFirst && problems.length) break;
  }
  const distinct = (t: Target): number => new Set(drawn.map((d) => d[t])).size;
  console.log(`${name}${planted ? ` (planted ${planted})` : ''}: ${drawn.length} fresh processes, ${distinct('final')} distinct final and ${distinct('linear')} distinct linear targets at frame 0`);
  if (problems.length === 0) return null;
  return `${name} at frame 0 is not byte-identical across ${drawn.length} fresh deep-gpu run processes (${distinct('final')} distinct final, ${distinct('linear')} distinct linear targets):\n  ${problems.join('\n  ')}`;
}

interface Png { width: number; height: number; rgba: Uint8Array }
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
function decodePng(file: Uint8Array): Png {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0; let palette = Buffer.alloc(0);
  const data: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at); const type = buf.toString('latin1', at + 4, at + 8); const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (depth !== 8 || channels === undefined || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const s = x * channels;
      const px = color === 0 ? [line[s]!, line[s]!, line[s]!, 255] : color === 4 ? [line[s]!, line[s]!, line[s]!, line[s + 1]!]
        : color === 3 ? [palette[line[s]! * 3]!, palette[line[s]! * 3 + 1]!, palette[line[s]! * 3 + 2]!, 255]
          : [line[s]!, line[s + 1]!, line[s + 2]!, channels === 4 ? line[s + 3]! : 255];
      rgba.set(px, o);
    }
    previous = line;
  }
  return { width, height, rgba };
}
