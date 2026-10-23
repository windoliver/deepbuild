// Test-side tools for the #670 acceptance tests: the merged `deep-show` binary driven by JSON lines
// (its `run` scenario stands in for the hub, and a `deep show` call whose peer runs inside the test
// agent's process tree is the test process standing in for an agent), the figure and its variants,
// the evidence store read through its public entry, the proof kept for the issue's Proof line, and
// the hash check the planted renderer must fail. Nothing here stands in for deep show, the document
// check, the revision diff or render-back. The JSON-lines pieces are copied from #393's helpers.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/670 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
export const SHOW_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/**
 * Where the proof is kept (the issue's Proof line: the document, each reply with its issues, and the
 * snapshots with their hashes from both runs). Each test rewrites its own files there; nothing reads
 * them back.
 */
export const PROOF_DIR = join(tmpdir(), 'deep-670-proof');

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

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

export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, one scenario per stdin line, one JSON line out per line in.

/** Builds deep-show; returns '' or the build's error text. */
function buildShow(): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${SHOW_NAME} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds deep-show once per file and fails every test of the file when it can't be built. */
export function useShowBinary(): void {
  let error = '';
  beforeAll(() => { error = buildShow(); }, 900_000);
  beforeEach(() => { expect(error, `the binary builds: ${SHOW_NAME}`).toBe(''); });
}

/**
 * One process of `deep-show run`, its stdin the scenarios, one per line: each line is its own run
 * of the hub, so a second line is a second run in the same process. Returns each line's replies.
 */
export function runLines(scenarios: JsonObject[]): JsonObject[][] {
  const text = scenarios.map((s) => JSON.stringify(s)).join('\n');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(SHOW_BIN, ['run'], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  const name = `${SHOW_NAME} run`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}${run.signal ? ` (${run.signal})` : ''}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(scenarios.length);
  return lines.map((line, i) => {
    const out = obj(JSON.parse(line) as JsonValue, `${name}: answer ${i + 1}`);
    expect(out['ok'], `${name} refused scenario ${i + 1}: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
    const replies = arr(out['replies'], `${name}: answer ${i + 1}'s replies`).map((r, j) => obj(r, `replies[${j}]`));
    expect(replies.length, `${name}: one reply per call`).toBe(arr(scenarios[i]!['calls'], 'the scenario\'s calls').length);
    return replies;
  });
}

/** One scenario in its own process. */
export const run = (scenario: JsonObject): JsonObject[] => runLines([scenario])[0]!;

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-670-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The bytes of one piece of evidence, read by its hash through the evidence store's public entry. */
export async function readEvidence(root: string, sha256: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha256));
}

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { check?: string; code: string; severity: string; ids: string[]; path?: string; actual?: JsonValue; what?: string }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'], `${what}: issues[${i}].ids`) } as Issue;
  });
}
export const errors = (reply: JsonObject, what = 'the reply'): Issue[] => issues(reply, what).filter((i) => i.severity === 'error');

export interface Snapshot { sha256: string; w: number; h: number }
export function snapshots(reply: JsonObject, what = 'the reply'): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const o = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(o['sha256'], `${what}: snapshots[${i}].sha256`), w: num(o['w'], 'w'), h: num(o['h'], 'h') };
  });
}

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Revision { rev: number; writer: JsonObject; hash: string; state: string }
export function revisions(reply: JsonObject): Revision[] {
  return arr(reply['revisions'], 'revisions').map((v, i) => {
    const o = obj(v, `revisions[${i}]`);
    return { rev: num(o['rev'], `revisions[${i}].rev`), writer: obj(o['writer'], `revisions[${i}].writer`), hash: str(o['hash'], `revisions[${i}].hash`), state: str(o['state'], `revisions[${i}].state`) };
  });
}

/** The one revision of a document in the state `current`. */
export function current(reply: JsonObject): Revision {
  const now = revisions(reply).filter((r) => r.state === 'current');
  expect(now.length, `exactly one revision is current: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return now[0]!;
}

export interface Band { owner: JsonObject; band: string }
export function bands(reply: JsonObject): Band[] {
  return arr(reply['bands'], 'screen: bands').map((v, i) => {
    const o = obj(v, `screen: bands[${i}]`);
    return { owner: isObject(o['owner']) ? o['owner'] : {}, band: str(o['band'], `screen: bands[${i}].band`) };
  });
}

/** A whole revision's diff lists, each sorted. */
export function diff(reply: JsonObject): { changed: string[]; unchanged: string[]; created: string[]; removed: string[] } {
  const list = (k: string) => strs(reply[k], `the reply's ${k}`).sort();
  return { changed: list('changed'), unchanged: list('unchanged'), created: list('created'), removed: list('removed') };
}

// ---------------------------------------------------------------------------------------------------
// The world: one test agent, the process its `deep show` runs in, the panel, the record.

/** The test agent's session; `process` is the agent's process, the parent its hooks came from. */
export const AGENT = { id: 'sess-checkpoint', thread: 'thread-checkpoint', name: 'Test agent: checkpoint figure', process: { pid: 4100, start: 1_000 } } as const;

/** The OS process table the peer check reads: the test process runs `deep show` inside the agent's tree. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3001, ppid: 1, start: 110 }, // your shell
  { pid: 4100, ppid: 3001, start: 1_000 }, // the test agent
  { pid: 4101, ppid: 4100, start: 1_100 }, // its tool shell
  { pid: 4102, ppid: 4101, start: 1_200 }, // the test process that runs `deep show`
];
export const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };

/** The document the hub minted for the figure, and the panel it draws on. */
export const DOC = '01JB7D00000000000000000670';
export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };

/** The reading the middle bar is bound to, with its as-of time (flicks), and the verdict the badge shows. */
export const READING = 'reading:01JB7R00000000000000000670';
export const VERDICT = 'verdict:01JB7V00000000000000000670';
export const RECORD: JsonObject = {
  [READING]: { session: AGENT.id, value: 75, as_of: 705_600_000 },
  [VERDICT]: { session: AGENT.id, state: 'pass' },
};

/** The figure as the test agent sends it (no `id`, no `layers`, no item `layer`). */
export const FIGURE = fixture('figure.json');
/** The bound bar: row 2 of the mark set `chart`, as picking names it (`<id>#<key>`). */
export const BOUND_BAR = 'chart#2';
export const SNAP_SIZE: [number, number] = [640, 400];

/** The figure with the bound bar's source removed (`bound_values/middle-bar/source`), nothing else changed. */
export const NO_BAR_SOURCE = fixture('figure-no-bar-source.json');
/** The figure with the badge painted `status.pass` and its verdict binding removed, nothing else changed. */
export const LITERAL_BADGE = fixture('figure-literal-badge.json');
/** The marker's own IDs: the item and the channel that keys it. */
export const MARKER_IDS = ['marker', 'marker-x'];
/** The figure with the marker left out (its item and its channel), nothing else changed. */
export const NO_MARKER = fixture('figure-no-marker.json');

/** `deep show` from the test process, at time `t` (the time grammar's text), with a snapshot unless asked not to. */
export function show(document: JsonObject, t: string, extra: JsonObject = {}): JsonObject {
  return { call: 'deep show', peer: IN_AGENT, doc: DOC, document, t, size: SNAP_SIZE, include: ['issues', 'pixels'], ...extra };
}
export const REVISIONS: JsonObject = { call: 'revisions', doc: DOC };
export const SCREEN: JsonObject = { call: 'screen' };

export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } },
    processes: PROCESSES,
    panels: PANELS,
    docs: { [DOC]: { panel: 'main' } },
    record: RECORD,
    calls,
    ...(planted ? { planted } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// The proof

/** Keeps one piece of proof as JSON under PROOF_DIR. */
export function keepProof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

/** Keeps a snapshot's PNG under PROOF_DIR. */
export function keepSnapshot(name: string, png: Buffer): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, `${name}.png`), png);
}

// ---------------------------------------------------------------------------------------------------
// The hash criterion's check, which the planted renderer must fail.

/** One run's snapshot hashes by render-back time. */
export type Hashes = Record<string, string | undefined>;

/**
 * Criterion 2: each time's snapshot hash is the first run's on a second run in the same process and
 * in a fresh process. Each failure names the snapshot (its render-back time) and the runs that differ;
 * a missing snapshot is a failure too. An empty list is a pass.
 */
export function hashFailures(times: readonly string[], first: Hashes, second: Hashes, fresh: Hashes): string[] {
  const failures: string[] = [];
  for (const t of times) {
    const name = `snapshot at ${t}`;
    const a = first[t];
    if (a === undefined) { failures.push(`${name}: the first run returned no snapshot`); continue; }
    if (second[t] === undefined) failures.push(`${name}: the second run returned no snapshot`);
    else if (second[t] !== a) failures.push(`${name}: hash ${second[t]} on the second run, ${a} on the first`);
    if (fresh[t] === undefined) failures.push(`${name}: the fresh process returned no snapshot`);
    else if (fresh[t] !== a) failures.push(`${name}: hash ${fresh[t]} in a fresh process, ${a} on the first run`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// PNG: enough to read a snapshot's size and a pixel (8-bit RGB or RGBA, no interlace).

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
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
