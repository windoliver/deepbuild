// Test-side tools for the #384 acceptance tests: `deep-show` built once per file and driven by JSON lines (`deep-show
// run` with point and ask: the `ask`, `messages` and `render_back` calls, the `playhead` control, shift-click
// selection and HTML panels; README: The surface under test); the shared test board at revision 14; the journey
// screenshot put into the evidence store; PNG decoding for pixel hashes; and the suite's own checks, which return
// failures as sentences naming the field or the handle that failed, so each planted program is shown failing on the
// same check the real program passes. Nothing here stands in for the hub, the interaction scope or the resolver.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/384 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

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
export const strs = (value: JsonValue | undefined, what: string): string[] => arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const show = (value: JsonValue | undefined): string => JSON.stringify(value ?? null).slice(0, 800);

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}
export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);

/** Every string anywhere in a JSON value. */
export function stringsIn(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isObject(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Builds: the binary built once per file with `cargo build --locked --bin deep-show`, copied out of target/debug under
// its own name, as #383's suite does; a test that uses a build that failed fails, naming it.

function cargoBuild(name: string): string {
  const args = ['build', '--locked', '--bin', name];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export function useShow(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-384-bins-'));
    error = cargoBuild(SHOW_BIN);
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh folder per test (the evidence store), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-384-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Pipes JSON lines into one run of `bin args…`: exit 0 and exactly one line out per line in, or the test fails. */
export function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 600_000): JsonObject[] {
  const label = `deep-show ${args.join(' ')}`;
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`));
}

// ---------------------------------------------------------------------------------------------------
// PNG: the journey screenshot this suite puts into the evidence store, and decoding render-back's snapshots so two
// frames compare by the hash of their pixels.

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

/**
 * A 160 × 90 8-bit RGB PNG standing in for a journey's captured screen: a light page, a dark header bar and a red
 * button near its bottom right.
 */
export function screenshotPng(): Buffer {
  const [w, h] = [160, 90];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = y < 14 ? [40, 44, 52] : x >= 104 && x < 148 && y >= 66 && y < 82 ? [220, 40, 40] : [242, 242, 238];
      raw.set(rgb, y * (1 + w * 3) + 1 + x * 3);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Puts a PNG into the evidence store as you would drop one in; returns its hash. */
export async function putPng(root: string, png: Buffer): Promise<string> {
  const store = await openEvidenceStore({ root });
  const put = await store.connect({ role: 'you', via: 'drop' }).put({
    bytes: png, declares: 'png', kind: 'image', source: 'tests/acceptance/384', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] },
  });
  if (put.status !== 'stored') throw Error(`the evidence store refused the test's PNG: ${put.reason}`);
  return put.evidence.sha256;
}

/** The bytes of one piece of evidence, read by its hash through the evidence store's public entry. */
export async function readEvidence(root: string, sha256: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha256));
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace into RGBA. */
export function decodePng(file: Buffer): { width: number; height: number; rgba: Uint8Array } {
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

/** The SHA-256 of a PNG's decoded pixels (its size, then RGBA row by row): two frames are equal by pixel hash. */
export function pixelHash(png: Buffer): string {
  const img = decodePng(png);
  const size = Buffer.alloc(8); size.writeUInt32BE(img.width, 0); size.writeUInt32BE(img.height, 4);
  return createHash('sha256').update(size).update(img.rgba).digest('hex');
}

// ---------------------------------------------------------------------------------------------------
// The scenario: the hub's canvas side as `deep-show run` plays it (#393, #96, #383), on the virtual display clock.

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const REFRESH_HZ = 120;
export const PERIOD = FLICKS / REFRESH_HZ; // 5,880,000 flicks
export const CLOCK: JsonObject = { refresh_hz: REFRESH_HZ, lead: 2 * MS, check: MS / 2 };
/** The issue's frame time: 4.2 s in flicks. */
export const T_POINTED = 2_963_520_000;
/** The issue's revisions: the one you saw, and the one the agent's delete makes. */
export const REV_SEEN = 14;
export const REV_DELETE = 15;
export const WORDS = 'too small';

export type Rect = [number, number, number, number];
export type Point = [number, number];
export const PANEL: Rect = [0, 0, 800, 450];
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: checkout review', process: { pid: 4100, start: 1_000 } };
export const ALPHA_WRITER: JsonObject = { kind: 'agent', id: ALPHA.thread };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB384D', 1);
/** An item's stable name: `doc:<doc ID>#<item ID>` (Handles). */
export const handleOf = (item: string): string => `doc:${DOC}#${item}`;
/** Handles compare with the doc ID's case folded (a ULID is case-insensitive) and the item ID exact. */
export function sameHandle(a: string, b: string): boolean {
  const [da, ...ia] = a.split('#'); const [db, ...ib] = b.split('#');
  return da!.toLowerCase() === db!.toLowerCase() && ia.join('#') === ib.join('#');
}

/** The wrong programs (README: Planted programs), each reachable only through the scenario's `planted`. */
export type Planted = 'box_folds_quote' | 'box_drops_t' | 'box_drops_doc_rev' | 'box_sends_every_id' | 'resolver_only_ref_unresolved' | 'resolver_closes_task';

/** The test board as stored, with the journey screenshot's hash in place and the asset it names. */
export function boardDoc(shot: string): JsonObject {
  const doc = fixture('board.json');
  const items = obj(doc['items'], 'board items');
  obj(obj(items['alpha.shot'], 'alpha.shot')['params'], 'alpha.shot params')['asset'] = shot;
  doc['assets'] = { 'alpha.shot-png': { sha256: shot, license: 'CC0-1.0' } };
  return doc;
}
export const itemOf = (doc: JsonObject, id: string): JsonObject => obj(obj(doc['items'], 'items')[id], `item ${id}`);
export const textOf = (doc: JsonObject, id: string): string => str(obj(itemOf(doc, id)['params'], `${id}.params`)['text'], `${id}.params.text`);
export const nameOf = (doc: JsonObject, id: string): string => str(itemOf(doc, id)['name'], `${id}.name`);
/** An item's box on the page, u: `at.pos` plus `params.box` (`[x, y, w, h]`, or a text's `{w, h}` from `at.pos`). */
export function boxOf(doc: JsonObject, id: string): Rect {
  const item = itemOf(doc, id);
  const pos = isObject(item['at']) ? arr(item['at']['pos'], `${id}.at.pos`).map((v) => num(v, 'pos')) : [0, 0, 0];
  const b = obj(item['params'], `${id}.params`)['box'];
  if (Array.isArray(b)) return [pos[0]! + num(b[0], 'box'), pos[1]! + num(b[1], 'box'), num(b[2], 'box'), num(b[3], 'box')];
  const o = obj(b, `${id}.params.box`);
  return [pos[0]!, pos[1]!, num(o['w'], 'w'), num(o['h'], 'h')];
}
export const center = (r: Rect): Point => [r[0] + r[2] / 2, r[1] + r[3] / 2];

/**
 * Times on the virtual clock. The board is revision 0 from the start; the agent's 14 patches arrive 4 frames apart from
 * frame 20, so revision 14 is current and presented by frame 80; the playhead pauses at 4.2 s at frame 100; every later
 * call takes its own slot 10 frames apart from frame 120, so each patch has long since become current at a latch.
 */
export const patchAt = (k: number): number => (20 + 4 * k) * PERIOD;
export const PLAYHEAD_AT = 100 * PERIOD;
export const slot = (n: number): number => (120 + 10 * n) * PERIOD;

/** Alpha's patch k (1 … 14): moves the progress dot 20 u right, on base k − 1, so it makes revision k. */
export function dotPatch(k: number): JsonObject {
  return {
    call: 'deep_show', session: ALPHA.id, doc: DOC, at: patchAt(k),
    patch: { patch: ulid('01JB384P', k), doc: DOC, base: k - 1, reason: 'move the progress dot', ops: [{ op: 'set', id: 'alpha.dot', path: 'items/alpha.dot/at/pos/0', value: 40 + 20 * k }] },
  };
}
/** Alpha's patch that deletes an item, on base 14: revision 15. */
export const deletePatch = (at: number, id: string): JsonObject => ({
  call: 'deep_show', session: ALPHA.id, doc: DOC, at,
  patch: { patch: ulid('01JB384X', 1), doc: DOC, base: REV_SEEN, reason: 'drop the caption', ops: [{ op: 'delete', id, cascade: false }] },
});

export const input = (at: number, panel: string, event: JsonObject): JsonObject => ({ call: 'input', at, panel, event });
/** The board's transport paused at `t` flicks (README: the `playhead` control). */
export const playhead = (at: number, t: number): JsonObject => input(at, 'main', { type: 'control', control: 'playhead', value: t });
/** A click, its press and release 60 ms apart; with `shift`, it toggles the item into the selection. */
export function click(at: number, p: Point, shift = false): JsonObject[] {
  const mods = shift ? { mods: ['shift'] } : {};
  return [input(at, 'main', { type: 'down', pos: p, ...mods }), input(at + 60 * MS, 'main', { type: 'up', pos: p, ...mods })];
}
/** You type `words` into the panel's ask box and send it, with the pointer at `pointer` (window px), or about the selection. */
export const ask = (at: number, panel: string, words: string, pointer?: Point): JsonObject => ({ call: 'ask', at, panel, session: ALPHA.id, words, ...(pointer ? { pointer } : {}) });
/** The agent reads its session's messages. */
export const messagesCall = (at: number): JsonObject => ({ call: 'messages', at, session: ALPHA.id });
/** The agent's render-back of the board at `t` flicks as of revision `rev`. */
export const renderBack = (at: number, t: number, rev: number): JsonObject => ({ call: 'render_back', at, session: ALPHA.id, doc: DOC, t, rev });

const SURFACE = 'point and ask: the `ask`, `messages` and `render_back` calls, the `playhead` control, shift-click selection and `panels[…].html` (README: The surface under test)';

/** The board's scenario: the board stored at revision 0 on panel `main`, the agent's 14 patches, the playhead at 4.2 s, then `calls`. */
export function boardScenario(evidence: string, shot: string, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    panels: { main: { rect: PANEL } },
    docs: { [DOC]: { panel: 'main', document: boardDoc(shot) } },
    calls: [...Array.from({ length: REV_SEEN }, (_, i) => dotPatch(i + 1)), playhead(PLAYHEAD_AT, T_POINTED), ...calls],
    ...(planted ? { planted } : {}),
  };
}
/** The HTML deliverable's scenario: the page on panel `page`, no document, then `calls`. */
export function pageScenario(evidence: string, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    panels: { page: { rect: PANEL, html: fixturePath('deliverable.html') } },
    calls, ...(planted ? { planted } : {}),
  };
}

/** `deep-show run`: one scenario, answered ok with one reply per call, and every patch of the agent's applied at its revision. */
export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [scenario]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${scenario['planted'] ? `, and planted ${String(scenario['planted'])}` : ''}); got ${show(answer)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(scenario['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (!isObject(c) || !isObject(c['patch'])) return;
    const base = num(c['patch']['base'], 'base');
    expect(replies[i]!['outcome'], `${what}: the agent's patch on base ${base} applies: ${show(replies[i])}`).toBe('applied');
    expect(replies[i]!['rev'], `${what}: the agent's patch on base ${base} makes revision ${base + 1}`).toBe(base + 1);
  });
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Replies (README: Calls added)

export interface Region { x: number; y: number; w: number; h: number }
export interface Attachment { handles: string[] | null; t: JsonValue | undefined; doc_rev: JsonValue | undefined; precision: JsonValue | undefined; region: JsonValue | undefined; quote: JsonValue | undefined; raw: JsonObject }
export interface Resolved { handle: string; raw: JsonObject }
export interface Message { words: JsonValue | undefined; attachment: Attachment; task: JsonObject | null; resolved: Resolved[]; raw: JsonObject }

export function attachmentOf(value: JsonValue | undefined, what: string): Attachment {
  const a = obj(value, what);
  const h = a['handles'];
  return {
    handles: Array.isArray(h) && h.every((x) => typeof x === 'string') ? (h as string[]) : null,
    t: a['t'], doc_rev: a['doc_rev'], precision: a['precision'], region: a['region'], quote: a['quote'], raw: a,
  };
}
export function messageOf(value: JsonValue | undefined, what: string): Message {
  const m = obj(value, what);
  const resolved = Array.isArray(m['resolved'])
    ? m['resolved'].filter(isObject).map((r) => ({ handle: typeof r['handle'] === 'string' ? r['handle'] : '', raw: r }))
    : [];
  return { words: m['words'], attachment: attachmentOf(m['attachment'], `${what}.attachment`), task: isObject(m['task']) ? m['task'] : null, resolved, raw: m };
}
/** The `messages` reply: the session's messages as the agent reads them, and the handles its session shows as context. */
export function inbox(reply: JsonObject, what: string): { messages: Message[]; context: JsonValue | undefined } {
  return { messages: arr(reply['messages'], `${what}: messages`).map((m, i) => messageOf(m, `${what}: messages[${i}]`)), context: reply['context'] };
}
/** The one snapshot of a `render_back` reply, its pixels hashed. */
export async function renderedHash(evidence: string, reply: JsonObject, what: string): Promise<string> {
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: render-back returns one snapshot: ${show(reply)}`).toBe(1);
  const sha = str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
  return pixelHash(await readEvidence(evidence, sha));
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #384 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// The suite's checks. Each returns failures as sentences; an empty list is a pass. Every sentence names the field (in
// backticks) or the handle it is about, so a planted program's failure can be read for the name the criterion asks.

export interface Expect {
  words: string;
  handles: string[];
  /** `t` in flicks, `doc_rev`, or `undefined` to leave the field unread. */
  t?: number;
  doc_rev?: number;
  precision: 'id' | 'geometry' | 'region';
  /** The quote byte for byte, `null` for none, `undefined` to leave it unread. */
  quote?: string | null;
  /** The region must lie inside `inside` and hold the point `holds` (page u or page px), within half a unit. */
  region?: { inside: Rect; holds: Point };
}
const KNOWN = ['handles', 't', 'doc_rev', 'precision', 'region', 'u', 'quote'];
const EPS = 0.5;

export function messageFailures(m: Message, e: Expect): string[] {
  const f: string[] = [];
  const a = m.attachment;
  if (m.words !== e.words) f.push(`\`words\` are ${show(m.words)}, not your words alone, ${JSON.stringify(e.words)}${typeof a.quote === 'string' && typeof m.words === 'string' && m.words.includes(a.quote) ? ': the `quote` is folded into them' : typeof e.quote === 'string' && typeof m.words === 'string' && m.words.includes(e.quote) ? ': the text under the pointer, which belongs in `quote`, is folded into them' : ''}`);
  const extra = Object.keys(a.raw).filter((k) => !KNOWN.includes(k));
  if (extra.length > 0) f.push(`the attachment holds fields the design doesn't give it: ${extra.map((k) => `\`${k}\``).join(', ')}`);
  if (a.handles === null) f.push(`\`handles\` is ${show(a.raw['handles'])}, not a list of doc handles`);
  else {
    const want = [...e.handles];
    const got = [...a.handles];
    const missing = want.filter((h) => !got.some((g) => sameHandle(g, h)));
    const stray = got.filter((g) => !want.some((h) => sameHandle(g, h)));
    if (missing.length > 0 || stray.length > 0 || got.length !== want.length) f.push(`\`handles\` are ${show(got)}, expected exactly ${show(want)}`);
  }
  if (e.t !== undefined && a.t !== e.t) f.push(`\`t\` is ${a.t === undefined ? 'missing' : show(a.t)}, expected the frame's time ${e.t} flicks`);
  if (e.doc_rev !== undefined && a.doc_rev !== e.doc_rev) f.push(`\`doc_rev\` is ${a.doc_rev === undefined ? 'missing' : show(a.doc_rev)}, expected the revision you saw, ${e.doc_rev}`);
  if (a.precision !== e.precision) f.push(`\`precision\` is ${show(a.precision)}, expected ${e.precision}`);
  if (e.quote === null && a.quote !== undefined && a.quote !== null) f.push(`\`quote\` is ${show(a.quote)}, expected none (no text item is under the pointer)`);
  if (typeof e.quote === 'string') {
    if (typeof a.quote !== 'string') f.push(`\`quote\` is ${a.quote === undefined ? 'missing' : show(a.quote)}, expected the text item's text`);
    else if (!Buffer.from(a.quote, 'utf8').equals(Buffer.from(e.quote, 'utf8'))) f.push(`\`quote\` is ${JSON.stringify(a.quote)}, not the text item's text byte for byte, ${JSON.stringify(e.quote)}`);
  }
  if (e.region) {
    const r = a.region;
    const ok = isObject(r) && ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
    if (!ok) f.push(`\`region\` is ${r === undefined ? 'missing' : show(r)}, expected {x, y, w, h}`);
    else {
      const g = r as unknown as Region;
      const [ix, iy, iw, ih] = e.region.inside;
      const [px, py] = e.region.holds;
      if (g.w < 0 || g.h < 0 || g.x < ix - EPS || g.y < iy - EPS || g.x + g.w > ix + iw + EPS || g.y + g.h > iy + ih + EPS) f.push(`\`region\` ${show(r)} doesn't lie inside ${show(e.region.inside)}`);
      if (px < g.x - EPS || py < g.y - EPS || px > g.x + g.w + EPS || py > g.y + g.h + EPS) f.push(`\`region\` ${show(r)} doesn't hold the point you pointed at, ${show(e.region.holds)}`);
    }
  }
  return f;
}

/** The handle's resolution as the agent reads it after the delete, and the ask-task it came with. */
export function detachedFailures(m: Message, handle: string, e: { name: string; writer: JsonObject; rev: number }): string[] {
  const f: string[] = [];
  const r = m.resolved.find((x) => sameHandle(x.handle, handle));
  if (!r) f.push(`handle ${handle}: the message the agent reads lists no resolution for it in \`resolved\` (${show(m.raw['resolved'])})`);
  else {
    const o = r.raw;
    if (o['state'] !== 'detached') f.push(`handle ${handle} comes back ${show(o)}, not \`state: detached\``);
    if (o['name'] !== e.name) f.push(`handle ${handle}: its \`name\` is ${show(o['name'])}, expected the item's last name, ${JSON.stringify(e.name)}`);
    const removed = isObject(o['removed']) ? o['removed'] : null;
    const w = removed && isObject(removed['writer']) ? removed['writer'] : null;
    if (!w || w['kind'] !== e.writer['kind'] || w['id'] !== e.writer['id']) f.push(`handle ${handle}: \`removed.writer\` is ${show(removed?.['writer'])}, expected the deleting writer ${show(e.writer)}`);
    if (!removed || removed['rev'] !== e.rev) f.push(`handle ${handle}: \`removed.rev\` is ${show(removed?.['rev'])}, expected the revision that removed it, ${e.rev}`);
  }
  if (!m.task) f.push(`handle ${handle}: the message carries no \`task\` (its ask-task)`);
  else if (m.task['open'] !== true) f.push(`handle ${handle}: its ask-task ${show(m.task)} isn't open (\`task.open\` must stay true)`);
  return f;
}
