// Test-side tools for the #231 acceptance tests: `deep-show` built once per Cargo feature set (or taken from
// DEEP_231_BIN_DIR) and driven by one JSON scenario on stdin (`deep-show run`), with the scenario's `planted` key for
// the wrong programs; a run timed from outside, from the command to the file; the fixture documents made at test time
// (the holds, the film whose reading and status binding change, the film whose bars read a spectrum, the three speed
// fixtures); the six fixture films read from tests/fixtures/films/; the `export` call and the readers of what it
// answers (the receipt, `work`, `reports`); a still export as the seek render of a frame; this suite's own reader of
// a delivered MP4's video track; the kit call; and the machine's fingerprint and load. Nothing here stands in for the
// export, its guards, an encode tool or the decode worker: each is read from what `deep-show` answers or writes. The
// judges are in judges.ts and are shown failing their planted sets when this file loads. README: The surface under
// test.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, expect, vi } from 'vitest';
import { PHASES, proveJudges, seeded, type Fixture, type Purpose, type Reports, type Timing, type Work } from './judges.ts';

export * from './judges.ts';

// A first cargo build, and a 1080p60 export on a loaded machine, each take many minutes.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });
proveJudges();

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/231 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`: the first eight hex digits of the SHA-256 of the
 * checkbox's text, trimmed, white space collapsed). */
export const AC = {
  1: 'AC1 #231.ceba88e3',
  2: 'AC2 #231.c9318808',
  3: 'AC3 #231.84a45611',
  4: 'AC4 #231.63877b11',
  5: 'AC5 #231.0c28c755',
  6: 'AC6 #231.69ce6ea8',
  7: 'AC7 #231.f202d6a5',
  8: 'AC8 #231.6136cb61',
  9: 'AC9 #231.2bfc9b79',
  10: 'AC10 #231.77030cf3',
} as const;

/** The wrong programs the criteria name, each chosen by the scenario's `planted` (README: Planted programs). The
 * eighth, `judge_times_set_as_whole`, is this suite's own judge (judges.ts `setAsWholeFailures`). */
export type Planted =
  | 'reuse_across_readings' | 'receipt_wall_sums_phases' | 'receipt_books_compiles_under_draw' | 'reuse_ignores_valid_until'
  | 'guard_waits_8_4_ms' | 'content_key_without_spectrum_band' | 'export_hashes_on_cpu';

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
/** A whole number, zero or more. */
export function count(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, `${what} is a whole number, zero or more, got ${show(v)}`).toBe(true);
  return v as number;
}
/** A finite number, zero or more (seconds). */
export function seconds(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v) && v >= 0, `${what} is a finite number of seconds, zero or more, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export function hexes(v: JsonValue | undefined, what: string): string[] {
  return arr(v, what).map((h, i) => {
    const text = str(h, `${what}[${i}]`);
    expect(/^[0-9a-f]{64}$/.test(text), `${what}[${i}] is 32 bytes in lower-case hex, got ${text}`).toBe(true);
    return text;
  });
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Something the test needs is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${String(named)}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds (README: Run them). `cargo build --locked --bin deep-show --no-default-features --features <set>`, made when
// a test first needs the set and copied out of the target folder; with DEEP_231_BIN_DIR set, the binaries are taken
// from that folder and no cargo runs. A build that can't be had reads BLOCKED.

export const FULL = 'full';
/** The build with #518's native test encode tools, one of which takes GPU surfaces (README: Cargo features). */
export const TOOLS = 'full,test-encode-tools';
/** #518's test tool that takes each frame as a slot of the export's ring of GPU surfaces and writes a PNG sequence. */
export const SURFACE_TOOL = 'test-frames@1.0.0';
const binName = (set: string): string => `deep-show-${set.replace(/,/g, '+')}`;

export function useShow(): (set: string) => string {
  let dir = '';
  const made = new Map<string, string>();
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (set: string): string => {
    const have = made.get(set);
    if (have) return have;
    const supplied = process.env['DEEP_231_BIN_DIR'];
    if (supplied !== undefined) {
      const bin = join(resolve(supplied), binName(set));
      if (!existsSync(bin)) blocked(`DEEP_231_BIN_DIR names ${supplied}, which holds no ${binName(set)} (deep-show built with --no-default-features --features ${set})`);
      made.set(set, bin);
      return bin;
    }
    const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', set];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error) blocked(`cargo could not run (${r.error.message}); put the pinned toolchain on PATH (README: Run them)`);
    if (r.status !== 0) blocked(`deep-show with the features ${set} doesn't build: cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`);
    if (!dir) dir = mkdtempSync(join(tmpdir(), 'deep-231-bins-'));
    const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
    const bin = join(dir, binName(set));
    copyFileSync(join(target, 'debug', 'deep-show'), bin);
    made.set(set, bin);
    return bin;
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-231-')); made.push(d); return d; };
}
/** Folders that last for the file (an export several tests read), removed after it. */
export function useFileTemp(): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-231-file-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and `deep-show run` (README: The scenario)

const ulid = (k: number): string => `01JB231E${String(k).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3) } as const;
/** The agent session a Send is made by (criterion 4). */
export const AGENT = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Agent alpha', process: { pid: 4100, start: 1_000 } } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: AGENT.process.pid, ppid: 3001, start: AGENT.process.start },
];
export interface ScenarioExtra { planted?: Planted; record?: JsonObject }
/** A scenario: the evidence store, your shell's process tree and one agent session, a panel for each of three
 * documents, the calls. */
export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docs: JsonObject = {}; const panels: JsonObject = {};
  Object.values(DOC).forEach((id, i) => { docs[id] = { panel: `p${i}` }; panels[`p${i}`] = { rect: [0, 0, 1280, 720] }; });
  const out: JsonObject = {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES, panels, docs,
  };
  if (extra.planted) out['planted'] = extra.planted;
  if (extra.record) out['record'] = extra.record;
  out['calls'] = calls;
  return out;
}
/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what} is presented: ${show(reply ?? null)}`).toBe('presented');
}

function repliesOf(status: number | null, stdout: string, stderr: string, calls: number, what: string): JsonObject[] {
  expect(status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 800)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  let answer: JsonValue = null;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { /* read below */ }
  const out = obj(answer, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok (README: The surface under test); got ${show(out, 800)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls);
  return replies;
}
/** `deep-show run`: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${what}: deep-show run: ${r.error.message}`);
  return repliesOf(r.status, r.stdout ?? '', r.stderr ?? '', arr(sc['calls'], 'calls').length, what);
}

export interface Timed { replies: JsonObject[]; measured: number | null; loads: { start: number; end: number } }
/**
 * One scenario in a fresh headless `deep-show run`, timed from outside: `measured` is the seconds from the command
 * (the process is started with the scenario on its stdin) to the file (`file` first seen under its name, looked for
 * every millisecond), or null when the file never came. The one-minute load is read at the start and the end.
 */
export function timedShow(bin: string, sc: JsonObject, file: string, what: string): Promise<Timed> {
  return new Promise((done, fail) => {
    const start = loadavg()[0] ?? NaN;
    const began = performance.now();
    const child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let seen: number | null = null;
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-20_000); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify(sc)}\n`);
    const look = (): void => { if (seen === null && existsSync(file)) seen = performance.now(); };
    const poll = setInterval(look, 1);
    // Stopped only by its own PID, at the test's own limit.
    const limit = setTimeout(() => { if (child.pid !== undefined) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* it ended first */ } } }, TIMEOUT - 60_000);
    child.on('error', (e) => { clearInterval(poll); clearTimeout(limit); fail(Error(`${what}: deep-show run: ${e.message}`)); });
    child.on('close', (status) => {
      look();
      clearInterval(poll); clearTimeout(limit);
      try {
        const replies = repliesOf(status, stdout, stderr, arr(sc['calls'], 'calls').length, what);
        done({ replies, measured: seen === null ? null : (seen - began) / 1000, loads: { start, end: loadavg()[0] ?? NaN } });
      } catch (e) { fail(e as Error); }
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (`<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// Time, sound and the look (README: Fixtures). Times in a document are flicks.

export const FLICKS = 705_600_000;
export type Rate = [number, number];
export const R60: Rate = [60, 1];
/** A frame's length in flicks at a whole frame rate. */
export const frameFlicks = (fps: number): number => FLICKS / fps;
const SR = 48_000;
export const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made at test time by the #231 acceptance tests.' };

/** A 32-bit float WAV. */
export function floatWav(channels: Float32Array[], rate: number): Buffer {
  const nch = channels.length; const frames = channels[0]!.length; const data = frames * nch * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return b;
}
/** The stereo tone a fixture film plays: 440 Hz left at 0.2 and 660 Hz right at 0.15. */
function tone(samples: number): Float32Array[] {
  const l = new Float32Array(samples); const r = new Float32Array(samples);
  for (let i = 0; i < samples; i++) { l[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR); r[i] = 0.15 * Math.sin((2 * Math.PI * 660 * i) / SR); }
  return [l, r];
}
/** The film's sound, put in the store: its asset and its strip, played from 0 at full level for `secs` seconds. */
function sound(evidence: string, secs: number): { assets: JsonObject; strips: JsonObject } {
  const sha = putEvidence(evidence, floatWav(tone(secs * SR), SR));
  return { assets: { sound: { sha256: sha, license: CC0 } }, strips: { sound: { track: 1, src: sha, start: 0, in: 0, out: secs * FLICKS, rate: 1 } } };
}

/** The grain of criterion 6: 24 new patterns a second. */
export const GRAIN: JsonObject[] = [{ grain: { amount: '25%', size: 1, tone: 'flat', rate: 24 } }];
/**
 * A look of flat colours, with status colours and a body font, and a finish when given; its bytes go into the store
 * and a film names it. It keeps the look guard's rules (contrast and distance of every role and status colour), as
 * the export guards' suite's look does: a look the guard refuses is replaced by the shipped one.
 */
function look(evidence: string, id: string, finish: JsonObject[] = []): { ref: JsonObject; assets: JsonObject } {
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: `The #231 acceptance look ${id}: flat colours the tests know.`,
    palette: {
      ground: '#e8e8e8', muted: '#8c8c8c', accent: '#f2c230', raised: '#d4d4d4', paper: '#f0f0f0', black: '#000000', white: '#ffffff',
      ramp_lo: '#0838a8', ramp_hi: '#f08020', graphite: '#1b1d22', fog: '#e3e4e6',
      graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d22d6', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
      orchid: '#b0207f', indigo: '#2c3e7b',
    },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog', paper: 'paper', black: 'black', white: 'white',
      ramp_lo: 'ramp_lo', ramp_hi: 'ramp_hi',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled', focus: 'graphite',
      hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo',
    },
    themes: { light: {} },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish,
  };
  const sha = putEvidence(evidence, Buffer.from(`${JSON.stringify(def, null, 1)}\n`));
  return { ref: { asset: `${id}@1`, theme: 'light' }, assets: { [id]: { sha256: sha, license: CC0 } } };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures)

const order = (k: number): string => `a${String(k).padStart(5, '0')}`;
function rect(id: string, box: [number, number, number, number], role: string, k: number, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role } } }, ...extra };
}
function text(id: string, words: string, size: number, box: [number, number], pos: [number, number], k: number, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'text@1', name: `Text ${id}`, order: order(k), params: { text: words, font: 'body', size, box: { w: box[0], h: box[1] } }, at: { pos: [pos[0], pos[1], 0] }, ...extra };
}
function box3(id: string, size: [number, number, number], pos: [number, number, number], role: string, k: number): JsonObject {
  return { id, kind: 'mark.box@1', name: `Box ${id}`, order: order(k), params: { size, paint: { fill: { role } } }, at: { pos } };
}
const camera2d = (size: [number, number]): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } });
const camera3d = (position: [number, number, number], target: [number, number, number], fov: number): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'perspective', position, target, fov } });
const byId = (items: JsonObject[]): JsonObject => Object.fromEntries(items.map((i) => [String(i['id']), i]));
/** A channel whose keys are `[frame, value, interp]`: `linear` runs straight to the next key, `hold` keeps its value
 * until the next key. */
function channel(target: string, fps: number, keys: [number, number, 'linear' | 'hold'][]): JsonObject {
  const d = frameFlicks(fps);
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([at, value, interp], i) => [`k${String(i).padStart(5, '0')}`, { t: at * d, value, interp }])) };
}
const transport = (frames: number, fps: number): JsonObject => ({ span: frames * frameFlicks(fps), frame_rate: [fps, 1], sample_rate: SR });

export interface Film { document: JsonObject; frames: number; fps: number; size: [number, number] }
export const HOLD_SIZE: [number, number] = [320, 180];

/**
 * A film that holds still (criteria 1 and 6): 320 × 180 at 60 fps for `secs` seconds, a ground, a side panel, a block
 * and a tick, none of them moving and no channel, so no frame is flat and nothing reads the time; with `grain`, its
 * look's finish is grain at 24 patterns a second, the one time reader in view. It plays a stereo tone.
 */
export function holdFilm(evidence: string, secs: number, grain = false): Film {
  const [W, H] = HOLD_SIZE; const id = grain ? 'hold-grain-231' : 'hold-231';
  const l = look(evidence, id, grain ? GRAIN : []); const s = sound(evidence, secs);
  const document: JsonObject = {
    format: 1, id: `${id}-${secs}s`, profile: 'film', title: grain ? 'A hold under grain' : 'A hold',
    description: `A film the #231 acceptance tests export: ${secs} s in which no item moves${grain ? ', under grain at 24 patterns a second' : ''}.`,
    size: HOLD_SIZE, camera: 'cam', look: l.ref, transport: transport(secs * 60, 60),
    items: byId([camera2d(HOLD_SIZE), rect('back', [0, 0, W, H], 'ground', 1), rect('side', [0, 0, 128, H], 'muted', 2), rect('block', [176, 40, 96, 100], 'accent', 3), rect('tick', [16, 20, 96, 6], 'raised', 4)]),
    channels: {}, assets: { ...l.assets, ...s.assets }, strips: s.strips,
  };
  return { document, frames: secs * 60, fps: 60, size: HOLD_SIZE };
}

/**
 * The hold with a particle item (criterion 6): a 3D film, 320 × 180 at 60 fps for `secs` seconds, a floor and a post
 * that never move, and one `particles@1` item that emits 16 dots a second for the whole film, each living 4 s on a
 * ballistic path, so 64 dots are in view and moving at every frame after the first seconds.
 */
export function particleFilm(evidence: string, secs: number): Film {
  const s = sound(evidence, secs);
  const sparks: JsonObject = {
    id: 'sparks', kind: 'particles@1', name: 'Sparks', order: order(3), at: { pos: [0, 0.4, 0] },
    params: {
      count: 64, emit: { shape: 'point', rate: 16, span: secs }, life: [4, 4], motion: { ballistic: { v0: [1, 2], gravity: [0, -1, 0], drag: 0 } },
      draw: 'dot', size: 6, opacity: 1, color: [{ at: 0, role: 'accent' }, { at: 1, role: 'ink' }], seed: 231,
    },
  };
  const document: JsonObject = {
    format: 1, id: `hold-particles-231-${secs}s`, profile: 'film', title: 'A hold with a particle item',
    description: `A film the #231 acceptance tests export: ${secs} s in which only a particle item moves.`,
    size: HOLD_SIZE, camera: 'cam', budget: { class: 'export' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, seed: 231, transport: transport(secs * 60, 60),
    items: byId([camera3d([0, 1.6, 6], [0, 0.8, 0], 40), box3('floor', [6, 0.1, 6], [0, -0.05, 0], 'muted', 1), box3('post', [0.3, 0.8, 0.3], [-1.4, 0.4, 0], 'ink', 2), sparks]),
    channels: {}, assets: s.assets, strips: s.strips,
  };
  return { document, frames: secs * 60, fps: 60, size: HOLD_SIZE };
}

/** The reading and the status source of the film whose record changes (criterion 2). */
export const READING = 'reading:01JB231R000000000000000001';
export const VERDICT = 'verdict:01JB231V000000000000000001';
/** The record before any change: the reading at 3, the verdict running. */
export const RECORD: JsonObject = { [READING]: { session: null, value: 3, as_of: 0 }, [VERDICT]: { session: null, state: 'running' } };
/** Where the record changes on the film's clock: the reading to 7 at frame 40, the verdict to pass at frame 80. */
export const CHANGES = { frames: 120, reading: 40, status: 80 } as const;
export const READINGS: JsonObject[] = [
  { t: CHANGES.reading * frameFlicks(60), handle: READING, value: 7 },
  { t: CHANGES.status * frameFlicks(60), handle: VERDICT, state: 'pass' },
];
/**
 * The film whose reading and status binding change inside a hold (criterion 2): 320 × 180 at 60 fps for 2 s, no item
 * moving and no channel; a text bound to a reading (`bound_values`; its own text is empty, since the reading shows
 * there) and a plate whose fill is bound to a verdict's status (`status_bindings`). Exported with `readings:
 * READINGS` under the record RECORD, its picture changes at frames 40 and 80 and nowhere else.
 */
export function readingsFilm(evidence: string): Film {
  const [W, H] = HOLD_SIZE;
  const l = look(evidence, 'readings-231'); const s = sound(evidence, 2);
  const document: JsonObject = {
    format: 1, id: 'readings-231', profile: 'film', title: 'A hold whose record changes',
    description: 'A film the #231 acceptance tests export: nothing moves, a reading changes at frame 40 and a status at frame 80.',
    size: HOLD_SIZE, camera: 'cam', look: l.ref, transport: transport(CHANGES.frames, 60),
    items: byId([camera2d(HOLD_SIZE), rect('back', [0, 0, W, H], 'ground', 1), rect('side', [0, 0, 16, H], 'muted', 2), rect('plate', [32, 40, 112, 100], 'raised', 3), text('count', '', 24, [140, 32], [168, 72], 4)]),
    channels: {}, bound_values: { shown: { target: 'items/count/params/text', source: READING } },
    status_bindings: { lamp: { target: 'items/plate/params/paint/fill', source: VERDICT } },
    assets: { ...l.assets, ...s.assets }, strips: s.strips,
  };
  return { document, frames: CHANGES.frames, fps: 60, size: HOLD_SIZE };
}

/**
 * The film whose bars read a spectrum (criterion 8's planted twin), as the spectrum bake's own suite's redraft builds
 * one: 320 × 180 at 60 fps for 4 s, a ground, a rule that never moves and a 16-bar chart (`marks@1`, mark `bar`)
 * whose `level` column reads the 16 log bands of the sound's spectrum bake (`bakes`, array `spectrum.tone`) through
 * a linear scale of 1 u a dB from a base at y 170, so a band at its −120 dB floor is a bar 8 u tall. The sound is
 * silent but for a 937.5 Hz tone at 0.5 from 1 s to 2 s, which falls in one band. So the picture holds until the
 * tone, changes as it starts, holds while it sounds, changes as it stops, and holds to the end.
 */
export function spectrumFilm(evidence: string): Film {
  const secs = 4;
  const pcm = new Float32Array(secs * SR);
  for (let i = SR; i < 2 * SR; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 937.5 * i) / SR);
  const sha = putEvidence(evidence, floatWav([pcm], SR));
  const column = (values: number[]): JsonObject => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeFloatLE(v, 4 * i));
    return { dtype: 'f32', len: values.length, data: b.toString('base64') };
  };
  const bars: JsonObject = {
    id: 'bars', kind: 'marks@1', name: 'Bars', order: order(3),
    params: {
      mark: 'bar', paint: { fill: { role: 'accent' } },
      columns: { level: { array: 'spectrum.tone', as: 'f64' }, x: column(Array.from({ length: 16 }, (_, i) => 4 + 20 * i)), x2: column(Array.from({ length: 16 }, (_, i) => 16 + 20 * i)), base: { const: 170 } },
      encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'level', scale: 'db' }, y2: { column: 'base' } },
    },
  };
  const db: JsonObject = { id: 'db', kind: 'scale@1', name: 'Level scale', order: order(2), params: { type: 'linear', domain: [-128, 0], range: [170, 42], nice: false } };
  const document: JsonObject = {
    format: 1, id: 'spectrum-231', profile: 'film', title: 'Bars that read a spectrum', description: 'A film the #231 acceptance tests export: only its bars move, and only as the sound\'s bands do.',
    size: HOLD_SIZE, camera: 'cam', transport: { span: `${secs}s`, frame_rate: [60, 1], sample_rate: SR },
    items: byId([camera2d(HOLD_SIZE), rect('back', [0, 0, 320, 180], 'ground', 1), db, bars, rect('rule', [4, 172, 312, 4], 'muted', 4)]),
    assets: { tone: { sha256: sha, license: CC0 } }, strips: { tone: { track: 1, src: sha, start: '0s', in: 0, out: secs * FLICKS, rate: 1 } },
    bakes: { tone: { asset: sha, analyzer: 'spectrum@1', kind: 'spectrum', bands: 16, scale: 'log', range: [40, 16000], rate: 60, window: 2048 } },
  };
  return { document, frames: secs * 60, fps: 60, size: HOLD_SIZE };
}

// The speed fixture set (README: Fixtures, The speed fixtures): each 1920 × 1080 at 60 fps, with a stereo tone.

export const HD: [number, number] = [1920, 1080];
/** What each speed fixture's export must count, by its construction. */
export const SET: Record<Fixture, { frames: number; draws: number; holds: number }> = {
  /** Six sections of 6 s, each 3.6 s of motion and a 2.4 s reading hold: 864 held frames, 40% of 2,160. */
  explainer: { frames: 2160, draws: 2160 - 6 * 143, holds: 6 },
  orbit: { frames: 600, draws: 600, holds: 0 },
  city: { frames: 3600, draws: 3600, holds: 0 },
};
/** The city's buildings: a 50 × 50 grid (README: Not settled, the city's density). */
export const CITY_GRID = 50;

function explainer(evidence: string): JsonObject {
  const l = look(evidence, 'explainer-231'); const s = sound(evidence, 36);
  const SECTION = 360; const MOVE = 216;
  const items: JsonObject[] = [camera2d(HD), rect('back', [0, 0, 1920, 1080], 'ground', 1), rect('head', [0, 0, 1920, 120], 'muted', 2), text('title', 'How an export spends its time', 56, [1400, 80], [96, 24], 3), rect('marker', [96, 980, 48, 24], 'accent', 4)];
  const channels: JsonObject = {};
  const marker: [number, number, 'linear' | 'hold'][] = [];
  const rnd = seeded(2310);
  const bars: [number, number, 'linear' | 'hold'][][] = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < 6; i++) {
    const at = i * SECTION;
    // The marker crosses 4 px a frame while the section moves, so every moving frame differs from the one before.
    marker.push([at, 96, 'linear'], [at + MOVE, 96 + 4 * MOVE, 'hold']);
    for (const b of bars) b.push([at, 40, 'linear'], [at + MOVE, 120 + Math.round(480 * rnd()), 'hold']);
    // A caption shows no digit: the document check refuses a number a text shows with no source.
    items.push(text(`cap${i}`, `Part ${'ABCDEF'[i]!}: read the chart, then the next part moves in`, 40, [1600, 60], [96, 150], 5 + i, { adjust: { opacity: i === 0 ? 1 : 0 } }));
    const shown: [number, number, 'linear' | 'hold'][] = i === 0 ? [[0, 1, 'hold'], [SECTION, 0, 'hold']] : [[0, 0, 'hold'], [at, 1, 'hold'], ...(i < 5 ? [[at + SECTION, 0, 'hold'] as [number, number, 'hold']] : [])];
    channels[`cap${i}`] = channel(`items/cap${i}/adjust/opacity`, 60, shown);
  }
  channels['marker'] = channel('items/marker/params/box/0', 60, marker);
  bars.forEach((keys, b) => {
    items.push(rect(`bar${b}`, [240 + 120 * b, 260, 80, 40], b % 2 === 0 ? 'accent' : 'raised', 20 + b));
    channels[`bar${b}`] = channel(`items/bar${b}/params/box/3`, 60, keys);
  });
  return {
    format: 1, id: 'speed-explainer-231', profile: 'film', title: 'The speed fixture set: the explainer',
    description: 'A 36 s 2D explainer at 1080p60: six parts, each 3.6 s of motion and a 2.4 s reading hold, 40% of it held.',
    size: HD, camera: 'cam', look: l.ref, budget: { class: 'export' }, transport: transport(2160, 60),
    items: byId(items), channels, assets: { ...l.assets, ...s.assets }, strips: s.strips,
  };
}

function orbit(evidence: string): JsonObject {
  const s = sound(evidence, 10);
  const items: JsonObject[] = [camera3d([9, 3, 0], [0, 0.9, 0], 40), box3('floor', [12, 0.1, 12], [0, -0.05, 0], 'muted', 1), box3('post', [0.4, 3, 0.4], [3.4, 1.5, 1.2], 'accent', 2)];
  let k = 3;
  for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) for (let z = -1; z <= 1; z++) items.push(box3(`b${x + 1}${y}${z + 1}`, [0.7, 0.7, 0.7], [x * 1.1, 0.4 + y * 1.1, z * 1.1], ['ink', 'accent', 'muted'][(x + 2 * y + 3 * z + 9) % 3]!, k++));
  // One turn in 10 s: the camera at frame k stands at angle 2πk/600 on a circle of radius 9.
  const turn = (f: (a: number) => number): [number, number, 'linear'][] => Array.from({ length: 601 }, (_, i) => [i, Number((9 * f((2 * Math.PI * i) / 600)).toFixed(6)), 'linear']);
  return {
    format: 1, id: 'speed-orbit-231', profile: 'film', title: 'The speed fixture set: the orbit',
    description: 'A 10 s 3D orbit at 1080p60: the camera circles 27 boxes and a post once, moving every frame.',
    size: HD, camera: 'cam', budget: { class: 'export' }, requires: { modules: { scene3d: '^1' } }, transport: transport(600, 60),
    items: byId(items), channels: { cam_x: channel('items/cam/params/position/0', 60, turn(Math.cos)), cam_z: channel('items/cam/params/position/2', 60, turn(Math.sin)) },
    assets: s.assets, strips: s.strips,
  };
}

function city(evidence: string): JsonObject {
  const s = sound(evidence, 60);
  const rnd = seeded(231);
  // Roles the shipped look resolves for a solid in depth.
  const roles = ['ink', 'accent', 'muted'];
  const items: JsonObject[] = [camera3d([0, 3, 8], [0, 2.8, -2], 60), box3('ground', [4 * CITY_GRID + 20, 0.1, 4 * CITY_GRID + 20], [0, -0.05, -2 * (CITY_GRID - 1)], 'ground', 1)];
  // Blocks 4 apart with 2.4-wide buildings, so x = 0 is an avenue; heights 1 to 10, seeded.
  for (let j = 0; j < CITY_GRID; j++) {
    for (let i = 0; i < CITY_GRID; i++) {
      const h = Number((1 + 9 * rnd()).toFixed(3));
      items.push(box3(`t${String(j).padStart(2, '0')}${String(i).padStart(2, '0')}`, [2.4, h, 2.4], [(i - (CITY_GRID - 1) / 2) * 4, h / 2, -4 * j], roles[Math.floor(rnd() * roles.length)]!, 2 + j * CITY_GRID + i));
    }
  }
  // The flight: 3 units a second down the avenue, the camera and its target moving every frame, start to end.
  return {
    format: 1, id: 'speed-city-231', profile: 'film', title: 'The speed fixture set: the city',
    description: `A 60 s flight at 1080p60 down an avenue of a city of ${CITY_GRID * CITY_GRID} buildings, moving every frame, with no reading hold.`,
    size: HD, camera: 'cam', budget: { class: 'export' }, requires: { modules: { scene3d: '^1' } }, transport: transport(3600, 60),
    items: byId(items),
    channels: { cam_z: channel('items/cam/params/position/2', 60, [[0, 8, 'linear'], [3600, -172, 'linear']]), aim_z: channel('items/cam/params/target/2', 60, [[0, -2, 'linear'], [3600, -182, 'linear']]) },
    assets: s.assets, strips: s.strips,
  };
}
/** A speed fixture's document, its assets put in the store. */
export function speedFilm(evidence: string, which: Fixture): Film {
  const document = which === 'explainer' ? explainer(evidence) : which === 'orbit' ? orbit(evidence) : city(evidence);
  return { document, frames: SET[which].frames, fps: 60, size: HD };
}

// The six fixture films (Films and figures on the canvas: Six fixture films first), read from tests/fixtures/films/.

export const SIX = ['strokes and paper', 'camera and transitions', 'a figure with controls', 'physics with sound', 'narration with captions and ducking', 'a claim\'s film built from the record'] as const;
const FILMS_DIR = join(REPO, 'tests', 'fixtures', 'films');
/** The release's own still, kept beside the fixture films and not one of the six. */
const NOT_OF_THE_SIX = ['release-still'];
export interface Delivered { name: string; document: JsonObject; assets: Buffer[]; frames: number; fps: number }
/** Every fixture film delivered: `<name>/film.json` and the files under `<name>/assets/`, in name order. */
export function fixtureFilms(): Delivered[] {
  if (!existsSync(FILMS_DIR)) return [];
  const files = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().flatMap((e) => (statSync(join(d, e)).isDirectory() ? files(join(d, e)) : [join(d, e)])) : []);
  return readdirSync(FILMS_DIR).sort().filter((name) => !NOT_OF_THE_SIX.includes(name) && existsSync(join(FILMS_DIR, name, 'film.json'))).map((name) => {
    const rel = relative(REPO, join(FILMS_DIR, name, 'film.json'));
    const document = obj(JSON.parse(readFileSync(join(FILMS_DIR, name, 'film.json'), 'utf8')) as JsonValue, rel);
    const tr = obj(document['transport'], `${rel}: transport`);
    const rate = tr['frame_rate'] === undefined ? [60, 1] : arr(tr['frame_rate'], `${rel}: transport.frame_rate`);
    expect(rate[1], `${rel}: a whole number of frames a second, got ${show(rate)}`).toBe(1);
    const fps = count(rate[0], `${rel}: transport.frame_rate[0]`);
    const span = tr['span'];
    const m = typeof span === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(span) : null;
    const flicks = typeof span === 'number' ? span : m ? Math.round(Number(m[1]) * FLICKS) : NaN;
    expect(Number.isSafeInteger(flicks) && flicks % frameFlicks(fps) === 0, `${rel}: transport.span is a whole number of frames, in flicks or as "<n>s", got ${show(span ?? null)}`).toBe(true);
    return { name, document, assets: files(join(FILMS_DIR, name, 'assets')).map((p) => readFileSync(p)), frames: flicks / frameFlicks(fps), fps };
  });
}

// ---------------------------------------------------------------------------------------------------
// The export call and what it answers (README: `export`)

/** An export as H.264 with AAC at `out`; `extra` adds `purpose`, `range`, `readings`, `tool` and `brief`, or another
 * `video`. */
export const exportCall = (doc: string, out: string, extra: JsonObject = {}): JsonObject => ({ call: 'export', doc, out, video: { codec: 'h264' }, audio: { codec: 'aac' }, ...extra });
export const DRAFT: JsonObject = { purpose: 'draft' };
/** An export through the tool that takes GPU surfaces, which its brief pins: a PNG sequence. */
export const BY_SURFACE: JsonObject = { video: { codec: 'png_seq' }, tool: SURFACE_TOOL, brief: { tools: [SURFACE_TOOL] } };

/** Why a reply isn't a delivery or a draft: its outcome, code and issues. */
export function why(reply: JsonObject | undefined): string {
  if (!reply) return 'no reply';
  const list = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const head = `${String(reply['outcome'])}${reply['code'] === undefined ? '' : ` ${String(reply['code'])}`}`;
  return list.length === 0 ? `${head}: ${show(reply, 800)}` : `${head}: ${list.map((i) => `${String(i['check'] ?? i['code'] ?? 'issue')}: ${JSON.stringify(i).slice(0, 400)}`).join(' | ')}`;
}
export interface Receipt { frames: number; hashes: string[]; rate: Rate; size: [number, number]; raw: JsonObject }
/** An exported reply's receipt, as far as the base's receipt goes; a missing field fails, naming it. */
export function receiptOf(reply: JsonObject | undefined, what: string): Receipt {
  expect(reply?.['outcome'], `${what} is exported: ${why(reply)}`).toBe('exported');
  const r = obj(reply!['receipt'], `${what}: receipt`);
  const pair = (k: string): [number, number] => {
    const a = arr(r[k], `${what}: receipt.${k}`);
    return [count(a[0], `${what}: receipt.${k}[0]`), count(a[1], `${what}: receipt.${k}[1]`)];
  };
  return { frames: count(r['frames'], `${what}: receipt.frames`), hashes: hexes(r['frame_hashes'], `${what}: receipt.frame_hashes`), rate: pair('frame_rate'), size: pair('size'), raw: r };
}
/** The receipt's `reused_frames`. */
export const reusedOf = (r: Receipt, what: string): number => count(r.raw['reused_frames'], `${what}: receipt.reused_frames`);
/** The receipt's `start`. */
export function startOf(r: Receipt, what: string): string {
  const v = r.raw['start'];
  expect(v === 'cold' || v === 'warm', `${what}: receipt.start is cold or warm, got ${show(v ?? null)}`).toBe(true);
  return v as string;
}
/** The receipt's `timing {prepare, evaluate, draw, hash, convert, handoff, encode, guards, wall}`, each in seconds. */
export function timingOf(r: Receipt, what: string): Timing {
  const t = obj(r.raw['timing'], `${what}: receipt.timing`);
  const read = (k: string): number => seconds(t[k], `${what}: receipt.timing.${k}`);
  const out = { wall: read('wall') } as Timing;
  for (const p of PHASES) out[p] = read(p);
  return out;
}
/** The receipt's `handoff`: how the frames reached the encode tool. */
export function handoffOf(r: Receipt, what: string): 'surface' | 'copy' {
  const h = r.raw['handoff'];
  expect(h === 'surface' || h === 'copy', `${what}: receipt.handoff is surface or copy, got ${show(h ?? null)}`).toBe(true);
  return h as 'surface' | 'copy';
}
/** The reply's `work`, the export's work counters (README: `work`). */
export function workOf(reply: JsonObject | undefined, what: string): Work {
  const w = obj(reply?.['work'], `${what}: the reply's work (the export's work counters)`);
  const fid = obj(w['fidelity'], `${what}: work.fidelity`);
  const c = (k: string): number => count(w[k], `${what}: work.${k}`);
  return {
    draws: c('draws'), hashes: c('hashes'), fidelity: { draws: count(fid['draws'], `${what}: work.fidelity.draws`), hashes: count(fid['hashes'], `${what}: work.fidelity.hashes`) },
    frames_read_back: c('frames_read_back'), digests_read_back: c('digests_read_back'), digest_bytes_read_back: c('digest_bytes_read_back'),
  };
}
/** The reply's `reports`: what the compile thread and the decode worker report of the export's preparing. */
export function reportsOf(reply: JsonObject | undefined, what: string): Reports {
  const r = obj(reply?.['reports'], `${what}: the reply's reports (the compile thread's and the decode worker's)`);
  const rows = <K extends string>(list: string, name: K): ({ seconds: number } & Record<K, string>)[] => arr(r[list], `${what}: reports.${list}`).map((v, i) => {
    const o = obj(v, `${what}: reports.${list}[${i}]`);
    return { [name]: str(o[name], `${what}: reports.${list}[${i}].${name}`), seconds: seconds(o['seconds'], `${what}: reports.${list}[${i}].seconds`) } as { seconds: number } & Record<K, string>;
  });
  return { compiles: rows('compiles', 'pipeline'), decodes: rows('decodes', 'asset') };
}
/** What countFailures reads of an exported reply. */
export function countedOf(reply: JsonObject | undefined, what: string): { frames: number; hashes: string[]; reused: number; work: Work } {
  const r = receiptOf(reply, what);
  return { frames: r.frames, hashes: r.hashes, reused: reusedOf(r, what), work: workOf(reply, what) };
}

/**
 * Seek renders: each of `frames` exported alone as a still (`range: {still: {t}}`, a PNG sequence of one frame) in
 * one fresh `deep-show run`, so each is drawn in a fresh session at its own time with no frame before it; its hash
 * is the still's receipt's one frame hash, taken by the same pass as an export's. `setup` puts the film's assets in
 * the store and gives its document; `extra` is added to every still's call (the film's `readings`).
 */
export function seekRenders(bin: string, dir: string, setup: (evidence: string) => JsonObject, frames: readonly number[], fps: number, what: string, o: { extra?: JsonObject; record?: JsonObject } = {}): { frame: number; hash: string }[] {
  const evidence = join(dir, 'seek-evidence'); const out = join(dir, 'seek-stills');
  mkdirSync(evidence, { recursive: true }); mkdirSync(out, { recursive: true });
  const calls = frames.map((k) => ({ call: 'export', doc: DOC.a, out: join(out, `frame-${k}`), range: { still: { t: k * frameFlicks(fps) } }, video: { codec: 'png_seq' }, ...(o.extra ?? {}) }));
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, setup(evidence)), ...calls], o.record ? { record: o.record } : {}), `${what}: the seek renders`);
  presented(replies[0], `${what}: the document`);
  return frames.map((frame, i) => {
    const r = receiptOf(replies[i + 1], `${what}: the seek render of frame ${frame}`);
    expect(r.hashes.length, `${what}: the seek render of frame ${frame} is one frame`).toBe(1);
    return { frame, hash: r.hashes[0]! };
  });
}

// ---------------------------------------------------------------------------------------------------
// A delivered MP4's video track, read here: its samples and their lengths (criterion 1's 1,800 frames at 60 fps).

interface Box { type: string; start: number; size: number; header: number }
function boxes(b: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = b.readUInt32BE(at); let header = 8;
    const type = b.toString('latin1', at + 4, at + 8);
    if (size === 1) { size = Number(b.readBigUInt64BE(at + 8)); header = 16; } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type, start: at, size, header });
    at += size;
  }
  return out;
}
/** The file's one video track: how many samples it holds, its timescale, and its sample lengths as `[count, delta]`. */
export function videoTrack(path: string, what: string): { samples: number; timescale: number; lengths: [number, number][] } {
  expect(existsSync(path), `${what}: the file is at ${path}`).toBe(true);
  const b = readFileSync(path);
  const inside = (p: Box, type: string): Box | undefined => boxes(b, p.start + p.header, p.start + p.size).find((x) => x.type === type);
  const body = (x: Box): Buffer => b.subarray(x.start + x.header, x.start + x.size);
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov');
  expect(moov, `${what}: the file has a moov box`).toBeDefined();
  const found = boxes(b, moov!.start + moov!.header, moov!.start + moov!.size).filter((x) => x.type === 'trak').flatMap((trak) => {
    const mdia = inside(trak, 'mdia'); const hdlr = mdia && inside(mdia, 'hdlr'); const mdhd = mdia && inside(mdia, 'mdhd');
    const minf = mdia && inside(mdia, 'minf'); const stbl = minf && inside(minf, 'stbl');
    const stts = stbl && inside(stbl, 'stts'); const stsz = stbl && inside(stbl, 'stsz');
    if (!hdlr || !mdhd || !stts || !stsz || body(hdlr).toString('latin1', 8, 12) !== 'vide') return [];
    const head = body(mdhd); const times = body(stts);
    const lengths = Array.from({ length: times.readUInt32BE(4) }, (_, i): [number, number] => [times.readUInt32BE(8 + 8 * i), times.readUInt32BE(12 + 8 * i)]);
    return [{ samples: body(stsz).readUInt32BE(8), timescale: head.readUInt32BE(head[0] === 1 ? 20 : 12), lengths }];
  });
  expect(found.length, `${what}: the file holds one video track`).toBe(1);
  return found[0]!;
}

// ---------------------------------------------------------------------------------------------------
// The export module's kit (README: The kit's two laws)

export interface Law { verdict: string; counted: JsonObject; raw: JsonObject }
/** A `kit` run of the export module's `laws` part on the GPU: its cases by name. */
export function kitLaws(bin: string, evidence: string, planted?: Planted): Map<string, Law> {
  const [reply] = runShow(bin, scenario(evidence, [{ call: 'kit', modules: ['export'], parts: ['laws'], backends: ['gpu'] }], planted ? { planted } : {}), `the export module's kit, its laws part${planted ? ` (planted ${planted})` : ''}`);
  const modules = arr(reply!['modules'], 'the kit: modules').map((m, i) => obj(m, `the kit: modules[${i}]`));
  const module = modules.find((m) => m['module'] === 'export');
  expect(module, `the kit's report holds the module export; it holds ${modules.map((m) => String(m['module'])).join(', ')}`).toBeDefined();
  const parts = arr(module!['parts'], 'export.parts').map((p, i) => obj(p, `export.parts[${i}]`));
  const part = parts.find((p) => p['part'] === 'laws');
  expect(part, `the export module ran the laws part; it ran ${parts.map((p) => String(p['part'])).join(', ')}`).toBeDefined();
  const out = new Map<string, Law>();
  for (const [i, v] of arr(part!['cases'], 'laws.cases').entries()) {
    const c = obj(v, `laws.cases[${i}]`);
    out.set(str(c['case'], `laws.cases[${i}].case`), { verdict: str(c['verdict'], `laws.cases[${i}].verdict`), counted: isObject(c['counted']) ? c['counted'] : {}, raw: c });
  }
  return out;
}
export function lawOf(laws: Map<string, Law>, name: string): Law {
  const law = laws.get(name);
  expect(law, `the laws part states the law ${name}; it states ${[...laws.keys()].join(', ') || 'none'}`).toBeDefined();
  return law!;
}

// ---------------------------------------------------------------------------------------------------
// The machine (docs/technical-design.md: The reference Macs), read through the perf lane's own fingerprint.

interface Machine { model: string | null; chip: string | null; memoryBytes: number | null; power: string | null; lowPowerMode: boolean | null; thermalState: string | null; macosBuild: string | null }
interface Benchmark { fingerprint(): Machine; references: { model: string; chip: string; memoryBytes: number }[]; validateBudgets(current: unknown, base: unknown): void }
export const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;
/** Why this machine isn't a reference Mac on mains power with Low Power Mode off and the thermal state nominal; null
 * when it is. */
export async function referenceMacProblem(): Promise<string | null> {
  if (process.platform !== 'darwin') return `platform ${process.platform}, not a reference Mac`;
  const { fingerprint, references } = await benchmark();
  const m = fingerprint();
  if (!references.some((r) => r.model === m.model && r.chip === m.chip && r.memoryBytes === m.memoryBytes)) return `not a reference Mac: ${String(m.model)} / ${String(m.chip)} / ${m.memoryBytes === null ? 'unknown' : Math.round(m.memoryBytes / 2 ** 30)} GiB`;
  if (m.power !== 'ac') return `not on mains power (${m.power ?? 'unknown'})`;
  if (m.lowPowerMode !== false) return `Low Power Mode is ${m.lowPowerMode === null ? 'unknown' : 'on'}`;
  if (m.thermalState !== 'nominal') return `the thermal state is ${m.thermalState ?? 'unknown'}, not nominal`;
  return null;
}
/** Why a clock reading doesn't count: a one-minute load above the core count, or one that can't be read. */
export function loadProblem(loads: readonly { start: number; end: number }[] = [{ start: loadavg()[0] ?? NaN, end: loadavg()[0] ?? NaN }]): string | null {
  const cores = availableParallelism();
  const all = loads.flatMap((l) => [l.start, l.end]);
  if (all.some((l) => !Number.isFinite(l))) return 'the machine\'s load can\'t be read';
  const top = Math.max(...all);
  return top > cores ? `the one-minute load reached ${top.toFixed(1)}, above the ${cores} cores` : null;
}

/** One speed fixture exported once in a fresh headless process, timed from the command to the file. */
export interface SpeedRun { measured: number | null; reply: JsonObject; loads: { start: number; end: number }; out: string }
export async function speedRun(bin: string, dir: string, which: Fixture, purpose: Purpose, planted?: Planted): Promise<SpeedRun> {
  const evidence = join(dir, 'evidence'); const out = join(dir, 'out', `${which}.mp4`);
  mkdirSync(evidence, { recursive: true }); mkdirSync(join(dir, 'out'), { recursive: true });
  const film = speedFilm(evidence, which);
  const what = `the ${which}'s ${purpose}${planted ? ` (planted ${planted})` : ''}`;
  const t = await timedShow(bin, scenario(evidence, [present(DOC.a, film.document), exportCall(DOC.a, out, purpose === 'draft' ? DRAFT : {})], planted ? { planted } : {}), out, what);
  presented(t.replies[0], `${what}: the document`);
  return { measured: t.measured, reply: t.replies[1]!, loads: t.loads, out };
}
