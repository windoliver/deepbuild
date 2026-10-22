// Test-side tools for the #393 acceptance tests: the `deep-show` binary driven by JSON lines, the
// scenario it runs (sessions, the process table the peer check reads, panels, documents the hub
// minted, the record's handles, claims, the window and its question card), the evidence store opened
// through its public entry, PNG reading and writing, and the checks the criteria's planted programs
// must fail. Nothing here stands in for deep_show, the document check, the revision diff or the
// compositor.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/393 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
/** deep_show and `deep show` over a scenario (`run`), and the window they leave drawn (`screen`). */
export const SHOW_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** The read cap: the most characters of issues a reply inlines (What holds a document to its rules). */
export const READ_CAP = 8_192;
/** deep_show answers within 2 s (Admission and latch; Frame callback). */
export const REPLY_BOUND_MS = 2_000;
/** What process start-up and scheduling may add on top of the 2 s, measured against a trivial run. */
export const SLACK_MS = 750;

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

/** The text's length in Unicode code points: the read cap counts characters. */
export const chars = (text: string): number => [...text].length;

/** Sorted copy, by code point. */
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, one scenario per stdin line, one JSON line out per line in.

/** Builds one binary by name across the workspace; returns '' or the build's error text. */
export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds deep-show once per file and fails every test of the file when it can't be built. */
export function useShowBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(SHOW_NAME); }, 900_000);
  beforeEach(() => { expect(error, `the binary builds: ${SHOW_NAME}`).toBe(''); });
}

export interface Timed { lines: JsonValue[]; ms: number }

/** Pipes the lines into one run of `deep-show <subcommand>`, timing the whole process. */
export function timedLines(subcommand: 'run' | 'screen', inputs: (JsonValue | string)[]): Timed {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const started = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(SHOW_BIN, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 90_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - started;
  const name = `${SHOW_NAME} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}${run.signal ? ` (${run.signal})` : ''}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return { lines: lines.map((line) => JSON.parse(line) as JsonValue), ms };
}

/** The JSON-lines convention: a line that isn't JSON, and one missing its required fields, each answer bad_input. */
export function expectBadInput(subcommand: 'run' | 'screen', missing: JsonObject): void {
  const out = timedLines(subcommand, ['{not json', missing]).lines;
  for (const [i, line] of out.entries()) {
    expect(line, `${SHOW_NAME} ${subcommand}: line ${i + 1} answers bad_input`).toEqual({ ok: false, code: 'bad_input' });
  }
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and their replies

export interface Run { replies: JsonObject[]; ms: number; out: JsonObject }

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(scenario: JsonObject): Run {
  const { lines, ms } = timedLines('run', [scenario]);
  const out = obj(lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies, ms, out };
}

/** How long a run of one trivial call takes: process start-up, as the timing bounds subtract it. */
export function trivialMs(evidence: string): number {
  const times = [0, 1, 2].map(() => run({ evidence, docs: { [DOC.a]: { panel: 'main' } }, panels: PANELS, calls: [{ call: 'revisions', doc: DOC.a }] }).ms);
  return Math.min(...times);
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-393-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The bytes of one piece of evidence, read by its hash through the evidence store's public entry. */
export async function readEvidence(root: string, sha256: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha256));
}

/** Puts a PNG into the evidence store as you would drop one in; returns its hash. */
export async function putPng(root: string, png: Buffer): Promise<string> {
  const store = await openEvidenceStore({ root });
  const put = await store.connect({ role: 'you', via: 'drop' }).put({
    bytes: png, declares: 'png', kind: 'image', source: 'tests/acceptance/393', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] },
  });
  if (put.status !== 'stored') throw Error(`the evidence store refused the test's PNG: ${put.reason}`);
  return put.evidence.sha256;
}

/** The files the store holds, by hash: its `<2 hex>/<62 hex>` layout. */
export function evidenceHashes(root: string): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const file of readdirSync(join(root, dir))) if (/^[0-9a-f]{62}$/.test(file)) out.push(dir + file);
  }
  return out;
}

export interface Issue { check?: string; code: string; severity: string; ids: string[]; path?: string; actual?: JsonValue; what?: string }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), ids: strs(o['ids'], `${what}: issues[${i}].ids`) } as Issue;
  });
}

export interface Snapshot { sha256: string; w: number; h: number }
export function snapshots(reply: JsonObject, what = 'the reply'): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const o = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(o['sha256'], `${what}: snapshots[${i}].sha256`), w: num(o['w'], 'w'), h: num(o['h'], 'h') };
  });
}

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Revision { rev: number; base_rev: number | null; writer: JsonObject; hash: string; state: string }
export function revisions(reply: JsonObject): Revision[] {
  return arr(reply['revisions'], 'revisions').map((v, i) => {
    const o = obj(v, `revisions[${i}]`);
    return { rev: num(o['rev'], `revisions[${i}].rev`), base_rev: o['base_rev'] as number | null, writer: obj(o['writer'], `revisions[${i}].writer`), hash: str(o['hash'], `revisions[${i}].hash`), state: str(o['state'], `revisions[${i}].state`) };
  });
}

/** The one revision of a document in the state `current`. */
export function current(reply: JsonObject): Revision {
  const now = revisions(reply).filter((r) => r.state === 'current');
  expect(now.length, `exactly one revision is current: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return now[0]!;
}

export interface Band { layer: JsonValue; owner: JsonObject; band: string; outline: boolean; name: string | null }
export function bands(reply: JsonObject): Band[] {
  return arr(reply['bands'], 'screen: bands').map((v, i) => {
    const o = obj(v, `screen: bands[${i}]`);
    const owner = isObject(o['owner']) ? o['owner'] : {};
    return { layer: o['layer'] ?? null, owner, band: str(o['band'], `screen: bands[${i}].band`), outline: o['outline'] === true, name: typeof o['name'] === 'string' ? o['name'] : null };
  });
}

/** The diff lists of a whole revision's reply, each sorted. */
export function diff(reply: JsonObject): { changed: string[]; unchanged: string[]; created: string[]; removed: string[] } {
  const list = (k: string) => sorted(strs(reply[k], `the reply's ${k}`));
  return { changed: list('changed'), unchanged: list('unchanged'), created: list('created'), removed: list('removed') };
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: agents' sessions, the process table, panels and the window.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
/** Two agents' sessions. `process` is the agent's process, the parent its hooks came from. */
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: login fix', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: release notes', process: { pid: 5200, start: 2_000 } };
/** A session whose agent process has ended; its PID now belongs to another process of yours. */
export const CHARLIE: SessionFixture = { id: 'sess-charlie', thread: 'thread-charlie', name: 'Claude Code: old run', process: { pid: 6100, start: 500 } };

export const sessionsOf = (...list: SessionFixture[]): JsonObject =>
  Object.fromEntries(list.map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
export const SESSIONS = sessionsOf(ALPHA, BRAVO, CHARLIE);

/** The OS process table the peer check reads: `deep` run in each agent's tree, and in yours. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, // launchd
  { pid: 3000, ppid: 1, start: 100 }, // your terminal
  { pid: 3001, ppid: 3000, start: 110 }, // your shell
  { pid: 3002, ppid: 3001, start: 3_000 }, // `deep show` you ran: outside every agent's tree
  { pid: 4100, ppid: 3001, start: 1_000 }, // agent alpha
  { pid: 4101, ppid: 4100, start: 1_100 }, // alpha's tool shell
  { pid: 4102, ppid: 4101, start: 1_200 }, // `deep show` alpha ran
  { pid: 5200, ppid: 3001, start: 2_000 }, // agent bravo
  { pid: 5201, ppid: 5200, start: 2_100 }, // bravo's tool shell
  { pid: 5202, ppid: 5201, start: 2_200 }, // `deep show` bravo ran
  { pid: 6100, ppid: 3001, start: 7_000 }, // a process of yours that reuses charlie's old PID
  { pid: 6101, ppid: 6100, start: 7_100 }, // `deep show` under it
];
export const peerOf = (pid: number): JsonObject => {
  const row = PROCESSES.find((p) => p['pid'] === pid);
  if (!row) throw Error(`no process ${pid} in the fixture table`);
  return { pid, start: row['start']! };
};
export const IN_ALPHA = peerOf(4102);
export const IN_BRAVO = peerOf(5202);
export const IN_YOURS = peerOf(3002);
export const UNDER_REUSED_PID = peerOf(6101);

/** The window, one panel over all of it, and one hidden panel. */
export const WINDOW: [number, number] = [800, 600];
export const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] }, tucked: { rect: [0, 0, 800, 600], visible: false } };

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted (doc IDs), each named by the scenario's `docs` with its panel. */
export const DOC = { a: ulid('01JB7D', 1), b: ulid('01JB7D', 2), c: ulid('01JB7D', 3), d: ulid('01JB7D', 4) } as const;
export const ask = (n: number): string => `ask:${ulid('01JB7A', n)}`;
export const reading = (n: number): string => `reading:${ulid('01JB7R', n)}`;
export const claim = (n: number): string => `claim:${ulid('01JB7C', n)}`;

/** The shell's question card, presented in a slot inside the main panel, away from its edges. */
export const CARD_RECT: [number, number, number, number] = [440, 180, 300, 200];
export const CARD: JsonObject = {
  ask: ask(900),
  question: 'Ship the login fix now?',
  options: [{ id: 'ship', label: 'Ship it' }, { id: 'hold', label: 'Not yet' }],
  rect: CARD_RECT,
};

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them: no `id` (the hub minted it), no `layers`, no item `layer`.

export const rect = (id: string, name: string, box: number[], order: string, role = 'muted'): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
export const label = (id: string, name: string, text: string, pos: [number, number], order: string): JsonObject =>
  ({ id, kind: 'text@1', name, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });

export function board(title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1,
    profile: 'board',
    title,
    description: `${title}, drawn by a test agent through deep_show.`,
    size,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    ...extra,
  };
}

/** Three plain items: what the writer-layer tests send. */
export const SMALL = board('Login fix status', [320, 200], [
  rect('panel-back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  rect('bar', 'Progress bar', [16, 120, 200, 16], 'a1'),
  label('caption', 'Caption', 'Ready for review', [16, 24], 'a2'),
]);

/** A 32 × 32 opaque magenta PNG: the asset whose decode a settled frame waits for. */
export const MAGENTA: [number, number, number] = [255, 0, 255];

// ---------------------------------------------------------------------------------------------------
// PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

/** An 8-bit RGB PNG of one color. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([r, g, b], y * (1 + width * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export type Rgb = [number, number, number];
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
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

export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

export const near = (a: Rgb, b: Rgb, tolerance: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

// ---------------------------------------------------------------------------------------------------
// The checks the criteria's planted programs must fail. Each returns its failures as sentences;
// an empty list is a pass.

/**
 * Criterion 7: a whole revision that leaves out IDs it doesn't name in `removes` is refused with
 * unintended_removal naming exactly those IDs. Each failure names the IDs.
 */
export function removalFailures(reply: JsonObject, missing: readonly string[]): string[] {
  const named = missing.join(', ');
  if (outcome(reply) !== 'refused') {
    return [`deep_show answered ${outcome(reply)} to a whole revision that dropped ${named} without naming them in removes`];
  }
  const ids = new Set(issues(reply).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids));
  const failures: string[] = [];
  const unnamed = missing.filter((id) => !ids.has(id));
  if (unnamed.length > 0) failures.push(`the refusal's unintended_removal issues don't name ${unnamed.join(', ')}`);
  const extra = [...ids].filter((id) => !missing.includes(id));
  if (extra.length > 0) failures.push(`the refusal's unintended_removal issues name ${extra.join(', ')}, which the revision kept`);
  return failures;
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, notice: 2 };
/** Errors first, then by code, then by IDs, all by code point. */
export function issueOrder(a: Issue, b: Issue): number {
  const s = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
  if (s !== 0) return s;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  for (let i = 0; i < Math.min(a.ids.length, b.ids.length); i++) {
    if (a.ids[i] !== b.ids[i]) return a.ids[i]! < b.ids[i]! ? -1 : 1;
  }
  return a.ids.length - b.ids.length;
}

/**
 * Criterion 9: a reply inlines its issues up to the read cap, as the longest prefix of the full
 * list that fits, errors first and then by code and ID, and adds `truncated` with `shown`, `total`
 * and `by_code` when it cuts. `full` is the list read back from the evidence. Each failure names
 * the reply's size or the missing field.
 */
export function capFailures(reply: JsonObject, full: Issue[]): string[] {
  const failures: string[] = [];
  const inline = arr(reply['issues'], 'the reply\'s issues');
  const size = chars(JSON.stringify(inline));
  if (size > READ_CAP) failures.push(`the reply inlines ${size} characters of issues (${inline.length} of ${full.length}), over the read cap of ${READ_CAP}`);
  const prefix = full.slice(0, inline.length);
  if (JSON.stringify(sortKeys(inline)) !== JSON.stringify(sortKeys(prefix as unknown as JsonValue[]))) failures.push('the inlined issues are not the first issues of the full list, issue for issue');
  if (inline.length < full.length) {
    const next = size + 1 + chars(JSON.stringify(full[inline.length]));
    if (next <= READ_CAP) failures.push(`the reply stops at ${inline.length} issues (${size} characters) though the next one fits under ${READ_CAP}`);
    const truncated = reply['truncated'];
    if (!isObject(truncated)) {
      failures.push(`the reply cuts its issues (${inline.length} of ${full.length} inline) with no truncated field`);
    } else {
      if (truncated['shown'] !== inline.length) failures.push(`truncated.shown is ${JSON.stringify(truncated['shown'])}, not the ${inline.length} issues inlined`);
      if (truncated['total'] !== full.length) failures.push(`truncated.total is ${JSON.stringify(truncated['total'])}, not ${full.length}`);
      const counts: Record<string, number> = {};
      for (const i of full) counts[i.code] = (counts[i.code] ?? 0) + 1;
      if (JSON.stringify(sortKeys(truncated['by_code'] ?? null)) !== JSON.stringify(sortKeys(counts))) {
        failures.push(`truncated.by_code is ${JSON.stringify(truncated['by_code'])}, not the count of each code ${JSON.stringify(counts)}`);
      }
    }
  }
  return failures;
}

/** A JSON value with every object's keys sorted, so two parses compare by content. */
export function sortKeys(value: JsonValue | Record<string, number>): JsonValue {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as JsonObject)[k]!)]));
  }
  return value;
}

/** Inline issues as the full list's issues, for comparison. */
export function asIssues(list: JsonValue[], what: string): Issue[] {
  return list.map((v, i) => {
    const o = obj(v, `${what}[${i}]`);
    return { ...o, code: str(o['code'], `${what}[${i}].code`), severity: str(o['severity'], `${what}[${i}].severity`), ids: strs(o['ids'], `${what}[${i}].ids`) } as Issue;
  });
}

// ---------------------------------------------------------------------------------------------------
// The screen (macOS): GPUI's offscreen Metal renderer draws the window.

/** Fails with an INCONCLUSIVE message off macOS: the window is drawn with GPUI's offscreen Metal renderer. */
export function requireMacos(): void {
  expect(process.platform, 'INCONCLUSIVE: the window is drawn with GPUI\'s offscreen Metal renderer, macOS only; this is not a pass').toBe('darwin');
}

export interface Screen { image: Image; replies: JsonObject[]; items: { id: string; layer: JsonValue; box: [number, number, number, number] }[] }

/** `deep-show screen`: the scenario run, then the window drawn to a PNG and read back. */
export function screen(scenario: JsonObject, out: string): Screen {
  requireMacos();
  const answer = obj(timedLines('screen', [{ ...scenario, out }]).lines[0], `${SHOW_NAME} screen: the answer`);
  if (answer['ok'] !== true && answer['code'] === 'unsupported_platform') {
    expect.fail(`INCONCLUSIVE: ${SHOW_NAME} screen reports unsupported_platform; this is not a pass`);
  }
  expect(answer['ok'], `${SHOW_NAME} screen refused: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const image = decodePng(readFileSync(out));
  expect([image.width, image.height], 'the window is drawn at its size').toEqual([num(answer['width'], 'width'), num(answer['height'], 'height')]);
  const items = arr(answer['items'], 'screen: items').map((v, i) => {
    const o = obj(v, `screen: items[${i}]`);
    const box = arr(o['box'], `screen: items[${i}].box`).map((n) => num(n, 'a box number')) as [number, number, number, number];
    return { id: str(o['id'], `screen: items[${i}].id`), layer: o['layer'] ?? null, box };
  });
  return { image, replies: arr(answer['replies'], 'screen: replies').map((r, i) => obj(r, `screen: replies[${i}]`)), items };
}

/**
 * Criterion 8: inside the card, at least `inset` px from its edge, every pixel of the window equals
 * the card's isolated render. A failure names the items whose box meets the card.
 */
export function cardFailures(full: Screen, isolated: Screen, card: [number, number, number, number], inset: number): string[] {
  let differ = 0;
  let total = 0;
  for (let y = card[1] + inset; y < card[1] + card[3] - inset; y++) {
    for (let x = card[0] + inset; x < card[0] + card[2] - inset; x++) {
      total++;
      const a = pixel(full.image, x, y);
      const b = pixel(isolated.image, x, y);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) differ++;
    }
  }
  if (differ === 0) return [];
  const meets = full.items.filter(({ box }) => box[0] < card[0] + card[2] && card[0] < box[0] + box[2] && box[1] < card[1] + card[3] && card[1] < box[1] + box[3]);
  return [`${meets.map((i) => i.id).join(', ') || 'an item'} draws above the question card: ${differ} of ${total} interior pixels differ from the card's isolated render`];
}
