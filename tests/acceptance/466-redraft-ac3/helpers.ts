// Test-side tools for the blind redraft of #466's AC3: `deep-show run` (#393's scenarios, with #387's `eval` and
// `pixels`, and #403's claims and `verdict` as #407 extended them with the flicker check), built once per file; the boil
// film the tests send and the look it names; the pictures (PNG from the evidence store). Nothing here stands in for the
// canvas: every value a test compares comes from the binary, every expected value from the issue's text.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/466-redraft-ac3 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout (30 min): a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC3 = 'AC3 #466.4f5a25b8';

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** The boil's rate and cycle (the criterion's numbers). */
export const BOIL_HZ = 12;
export const CYCLE = 3;
/** One boil step, 1/12 s, and the period the criterion names, 0.25 s, in whole flicks. */
export const STEP = FLICKS / BOIL_HZ;
export const PERIOD = FLICKS / 4;
/** The film's frame rate and span. */
export const FPS = 24;
export const SPAN_S = 2;
/** A seeded generator (mulberry32), so a failing run replays. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` distinct seeded whole-flick times in [from, to), ascending. */
export function seededTimes(seed: number, n: number, from: number, to: number): number[] {
  const rand = seeded(seed);
  const set = new Set<number>();
  while (set.size < n) set.add(from + Math.floor(rand() * (to - from)));
  return [...set].sort((a, b) => a - b);
}
/** The same list in a seeded order, so every time is reached as a seek, never only after its neighbour. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rand = seeded(seed); const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
/** The boil's step at t: ⌊t × hz⌋, from whole flicks (exact: 1/12 s is a whole number of flicks). */
export const stepOf = (t: number): number => Math.floor(t / STEP);
export const secs = (t: number): string => `${(t / FLICKS).toFixed(6)} s`;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, copied out
// under its own name; a test whose build failed fails with cargo's error.

export function useShow(): () => string {
  let dir = ''; let bin = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-466-ac3-bin-'));
    const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    else { bin = join(dir, `${SHOW}-full`); copyFileSync(join(TARGET, 'debug', SHOW), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${SHOW} --no-default-features --features full`).toBe(''); return bin; };
}

/** Fresh evidence stores for a test, all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-466-ac3-')); made.push(d); return d; };
}

/** `deep-show run`: one scenario line in, one answer line out, exit 0, ok, one reply per call. */
export function run(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const calls = arr(scenario['calls'], 'the calls').length;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${what}: ${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${what}: ${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: ${SHOW} run answers the scenario ok; got ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store and PNG

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const stored = (evidence: string, sha: string): string => join(evidence, sha.slice(0, 2), sha.slice(2));
/** Puts bytes into the scenario's evidence store at their SHA-256, as the hub keeps them. */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(stored(evidence, sha), bytes);
  return sha;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
/** A picture from the evidence store by its SHA-256, checked to hash to its name. */
export function pictureOf(evidence: string, sha: string, what: string): Image {
  const path = stored(evidence, sha);
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored file hashes to its name`).toBe(sha);
  return decodePng(file);
}
/** How many pixels of two same-sized pictures differ in any channel. */
export function differing(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) n++;
  return n;
}
/** How many pixels of a picture differ from its top-left pixel (the ground): what the film draws over it. */
export function inked(a: Image): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i] !== a.rgba[0] || a.rgba[i + 1] !== a.rgba[1] || a.rgba[i + 2] !== a.rgba[2]) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// The look and the film (README: The fixture)

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };
/** The look's boil, exactly as the tests write it on `time` (README: Choices). */
export const BOIL: JsonObject = { hz: BOIL_HZ, amount_px: 2, scope: 'lines', while: 'always', cycle: CYCLE, seed: 'item' };

/**
 * The boil look: a look@1 on a drawing basis with one hand-drawn line, `pencil` (a wobble 3 px wide), and the boil on
 * its `time` with cycle 3 at 12 Hz. Its palette and roles are the flat ones a shipped drawing look resolves with on the
 * base (a white ground, a dark graphite ink); its bytes go into the evidence store.
 */
export function boilLook(): { id: string; sha: string; bytes: Buffer } {
  const id = 'boil-look';
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: 'A drawn look whose pencil line boils through a cycle of drawings.',
    palette: {
      ground: '#ffffff', muted: '#7c7c7c', accent: '#a0a0a0', raised: '#f5f5f5',
      graphite: '#1b1d22', fog: '#e3e4e6',
      graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d2285', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
      orchid: '#b0207f', indigo: '#2c3e7b', cream: '#f4ecd8',
    },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled',
      hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo', paper: 'cream',
    },
    themes: { light: {} },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 }, pencil: { kind: 'wobble', width: 3, wobble_px: 2, segment_px: 8 } },
    fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { boil: BOIL, state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish: [],
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: sha256(bytes), bytes };
}

/** The film's size: 640 × 360 u, 1 u = 1 px. */
export const SIZE: [number, number] = [640, 360];
/** The boiled item: a zigzag drawn in the look's pencil line. */
export const SCRIBBLE = 'scribble';
/** The film's one layer, of yours. */
const LAYER = 'you-main';

/**
 * The boil film: 640 × 360 at 24 frames a second, 2 s long, under the boil look: two pencil zigzags in the ink role on
 * the look's ground and nothing else, so nothing but the boil changes the drawing from one time to another.
 */
export function boilFilm(doc: string, look: { id: string; sha: string }): JsonObject {
  const zig = (id: string, order: string, d: string): JsonObject => ({
    id, kind: 'path@1', name: `Zigzag ${id}`, order, layer: LAYER,
    params: { d, paint: { stroke: { role: 'ink', width: 3, line: 'pencil' } } },
  });
  const items = [
    zig(SCRIBBLE, 'a0001', 'M 60 80 L 180 40 L 300 120 L 420 50 L 580 130'),
    zig('scrawl', 'a0002', 'M 60 300 L 200 220 L 320 300 L 460 210 L 580 290'),
  ];
  return {
    format: 1, id: doc, profile: 'film', title: 'A boil in pencil', description: 'Two pencil zigzags under a look whose line boils through a cycle of drawings.',
    size: SIZE, safe: 24, transport: { frame_rate: `${FPS}/1`, span: `${SPAN_S}s`, reduced_motion: 'hold' },
    look: { asset: `${look.id}@1`, theme: 'light' }, assets: { [look.id]: { sha256: look.sha, license: LICENSE } },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios: one panel, your shell's process tree, the claim's agent; a planted program by the scenario's `planted`.

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB466B', 1);
const CLAIM = `claim:${ulid('01JB466C', 1)}`;
const REQ = `req:${ulid('01JB466Q', 1)}`;
const AGENT = { id: 'sess-alpha', thread: 'thread-alpha', name: 'An agent making films', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1920, 1080] } };

/** The drawing scenario: the film's panel, `deep show` of the boil film from your shell, then the calls (evals). */
export function drawScenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: PANELS, docs: { [DOC]: { panel: 'main' } }, calls: [presentCall(evidence), ...calls] };
}

/**
 * The judging scenario: the boil film stored on the panel as revision 0 (yours), its look in the evidence store, one
 * claim of the agent's whose deliverable it is with one requirement `{kind: "film.flicker"}`, and the calls.
 */
export function judgeScenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  const look = boilLook();
  putStore(evidence, look.bytes);
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: { [DOC]: { panel: 'main', document: boilFilm(DOC, look) } },
    claims: { [CLAIM]: { session: AGENT.id, deliverables: [DOC], requirements: [{ id: REQ, check: { kind: 'film.flicker' } }] } },
    ...(planted ? { planted } : {}), calls,
  };
}
/** `deep show` of the boil film from your shell, as a revision `eval` draws; the hub stamps the writer layer, so the
 * payload carries no `layers` and no item `layer`. */
function presentCall(evidence: string): JsonObject {
  const look = boilLook();
  putStore(evidence, look.bytes);
  const payload = boilFilm(DOC, look);
  delete payload['layers'];
  for (const item of Object.values(payload['items'] as JsonObject)) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document: payload, include: ['issues'] };
}
/** #387's `eval` at a flick, drawing the canonical snapshot. */
export const evalAt = (t: number): JsonObject => ({ call: 'eval', doc: DOC, t, pixels: true });
/** The snapshot's SHA-256 of an `eval` reply: one PNG in the evidence store. */
export function snapshotSha(reply: JsonObject, what: string): string {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  const sha = obj(list[0], `${what}: snapshots[0]`)['sha256'];
  expect(typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha), `${what}: snapshots[0].sha256 is a SHA-256, got ${show(sha)}`).toBe(true);
  return sha as string;
}
/** The verdict call on the claim. */
export const VERDICT: JsonObject = { call: 'verdict', claim: CLAIM };

/** One issue on a row. */
export interface Issue { code: string; severity: string; raw: JsonObject }
/** The flicker requirement's row of a verdict. */
export interface Row { result: string; issues: Issue[]; raw: JsonObject }
export function flickerRow(reply: JsonObject, what: string): Row | undefined {
  const rows = (Array.isArray(reply['requirements']) ? reply['requirements'] : []).filter(isObject);
  const raw = rows.find((r) => r['id'] === REQ);
  if (!raw) return undefined;
  const issues = (Array.isArray(raw['issues']) ? raw['issues'] : []).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });
  return { result: String(raw['result']), issues, raw };
}

/**
 * The judge, the same for the clean run and the planted one: the flicker check's row PASSes and raises no error or
 * warning. Each failure names the code it raises, so a planted program's failure names `film.reseed`.
 */
export function flickerFailures(row: Row | undefined, what: string): string[] {
  if (!row) return [`${what}: the verdict has no row for the film.flicker requirement`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what}: the flicker check is ${row.result}, not PASS: ${show(row.issues.map((i) => i.raw), 1200)}`);
  for (const i of row.issues.filter((x) => x.severity === 'error' || x.severity === 'warning')) failures.push(`${what}: the flicker check raises ${i.code} (${i.severity}): ${show(i.raw, 600)}`);
  return failures;
}
/** The issue code a boil, hatch or paper seed that follows playback raises under the flicker check (README: Choices). */
export const RESEED = 'film.reseed';
