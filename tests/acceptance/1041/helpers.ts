// Test-side tools for the #1041 acceptance tests (README: The surface under test): `deep-show` built once per file and
// driven by `deep-show run` scenarios, as #172's suite drives it (its helpers copied and cut down; nothing is imported
// from another suite); the dungeon and the cellar, two pieces whose logic declares saves, with their recorded input
// tracks; the app's own replay of each (the `logic` call) for the full-state hash at every checkpoint; the web export;
// a folder served over HTTP by a child process; and Google Chrome, headless with WebGPU on, driven over its DevTools
// protocol by this file alone (no browser-automation library): pages in a kept or a fresh profile, the player's own
// controls by their names, the file a page exports and the file an import control is handed, the origin's storage
// quota, and the test shim over the browser's storage. Nothing here stands in for the export, the bundle, the player
// or the app: every value a test compares comes from `deep-show`, the browser or the file the player exported, and
// every expected value from the issue's text and the design.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1041 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** cargo on PATH: the pinned toolchain's folder first when it is there (as #172's helpers put it). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;

/** Every `it` and every hook passes this: a first build of `deep-show` takes many minutes on a loaded machine, and a
 * browser's cleanup outlasts vitest's own hook default there. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#1041.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1041.0f4a9de0',
  2: 'AC2 #1041.be83fe52',
  3: 'AC3 #1041.4e56c211',
  4: 'AC4 #1041.479f46e5',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and the failure rules

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
/** A full-state hash: 16 lower-case hex digits, as the app's checkpoints carry it. */
export function hash16(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{16}$/.test(s), `${what} is a full-state hash (16 lower-case hex digits), got ${s}`).toBe(true);
  return s;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own check fails on it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the check fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names "${named}"; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// The build, temp folders and `deep-show run` (one scenario line in, one answer line out, exit 0)

/** `deep-show` with the full set, built once in the file's beforeAll as #172's suite builds it, copied out of the
 * target folder; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let bin = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1041-bin-'));
    bin = join(dir, 'deep-show');
    const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
    else { copyFileSync(join(TARGET, 'debug', 'deep-show'), bin); error = ''; }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; }, TIMEOUT);
  return (): string => {
    expect(error, 'the binary builds: deep-show with features full').toBe('');
    return bin;
  };
}
/** Fresh folders for a test (evidence stores, bundles, exported saves), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1041-')); made.push(d); return d; };
}

export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${what}: the answer line is not JSON: ${lines[0]!.slice(0, 500)}`); }
  const answer = obj(out, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** The scenario's world, as #169's and #172's: an agent's session, the process table, one panel and the document on it;
 * `planted` is the scenario's own key for a wrong program (never an environment variable). */
const SESSION = { id: 'sess-1041', thread: 'thread-1041', name: 'Test agent: saves in the web player', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
function scenario(evidence: string, doc: string, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: { ...SESSION.process } } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } }, ...(planted ? { planted } : {}), calls,
  };
}
/** `deep show` of a whole revision from your shell, with its issues. */
const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}
/** Keeps bytes in the scenario's evidence store under their SHA-256 (`<2 hex>/<62 hex>`), where a document's asset is
 * read from. */
function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The pieces (README: Fixtures). The dungeon is #534's: one logic item `dungeon` at 60 Hz whose program keeps its
// floor, its health and the state of its seeded generator (xorshift64, seeded by `init`) in mutable globals and its
// inventory (8 slots) in memory at 8192. Each entry of the `move` control a step reads adds (its index in the step + 1)
// to the inventory slot its value names; each step moves health by the generator's next value (-3 to +4) and goes down
// a floor when its bits 20 to 27 are zero. It declares saves (one slot, `request` its request array) and writes 1 into
// `request` at the ends of steps 599, 1,199 and 1,799: saves of slot 1 at steps 600, 1,200 and 1,800. The cellar is
// another piece, another document with another ID, title, seed and recorded track, whose logic runs the same program.

/** The logic item's ID in both pieces, the one slot each declares, and the steps of its saves (a save made when step
 * k ends holds the state before step k + 1, and its step is k + 1, as #534's saves are numbered). */
export const DUNGEON = 'dungeon';
export const SLOT = 1;
export const SAVES_AT = [600, 1200, 1800] as const;
export const FIRST_SAVE = 600;
export const SAVED_AT = 1800;
/** The piece's last step: 40 s at 60 steps a second, 600 steps past the save at 1,800. */
export const END = 2400;
/** A checkpoint every 60 steps (Logic `logic@1`: `checkpoint.every`, written out in the fixture). */
export const EVERY = 60;
/** The step of every piece here: 1/60 s, 11,760,000 flicks. */
const FLICKS = 705_600_000;
const STEP = FLICKS / 60;
/** The step whose 40 moves arrive at once: at most 16 a control a step, so 8 still wait when step 1,799 ends and the
 * save at 1,800 holds an input position with entries unread (#534's track). */
const BURST_STEP = 1798;
const BURST = 40;

const ulid = (k: number): string => `01JB1041D${String(k).padStart(17, '0')}`;
export type PieceName = 'dungeon' | 'cellar';
export const PIECES: Record<PieceName, { id: string; title: string; seed: number; track: number }> = {
  dungeon: { id: ulid(1), title: 'The dungeon', seed: 104_101, track: 104_111 },
  cellar: { id: ulid(2), title: 'The cellar', seed: 104_102, track: 104_112 },
};
const WRITES: JsonObject = { floor: { type: 'i32' }, health: { type: 'i32' }, inv: { type: 'i32', count: 8 }, request: { type: 'i32' } };
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #1041 acceptance tests at test time.' };

/** mulberry32: a fixed-seed generator of u32 words. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** The piece's recorded input track (Input track entries `{t: flicks, seq, control, value, writer, player}`): moves of
 * yours at seeded steps (about one in 30, values 0 to 7) and the burst at BURST_STEP. */
export function pieceTrack(piece: PieceName): JsonObject[] {
  const next = rng(PIECES[piece].track);
  const entry = (k: number, value: number, seq = 0): JsonObject => ({ t: k * STEP, seq, control: 'move', value, writer: 'you', player: 1 });
  const out: JsonObject[] = [];
  for (let k = 1; k < END; k++) {
    if (k === BURST_STEP) for (let j = 0; j < BURST; j++) out.push(entry(k, j % 8, j));
    else if (next() % 30 === 0) out.push(entry(k, next() % 8));
  }
  return out;
}

/** Where the item's regions sit (Logic `logic@1`: Region map): the `move` control's entries in the read region and
 * each write in the write region, by offset. */
interface Offsets { move: number; floor: number; health: number; inv: number; request: number }
const uleb = (n: number): number[] => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
function sleb(n: number): number[] {
  const o: number[] = [];
  for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
}
/** The dungeon's program as WebAssembly bytes, written here (no assembler is built): one memory of one page whose
 * maximum is its minimum, the immutable i32 globals `reads_at` 0 and `writes_at` 4096, the mutable globals floor (i32),
 * health (i32) and the generator's state (i64), `init(seed: i64)` and `step(k: i64)`, no imports. Without `at` it is
 * the layout probe: the same module with an empty `step`. */
function dungeonBytes(at: Offsets | null): Buffer {
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
  const body = (locals: number[], code: number[]): number[] => { const b = [...locals, ...code, 0x0b]; return [...uleb(b.length), ...b]; };
  const i32 = (n: number): number[] => [0x41, ...sleb(n)];
  const i64 = (n: number): number[] => [0x42, ...sleb(n)];
  const get = (i: number): number[] => [0x20, i];
  const set = (i: number): number[] => [0x21, i];
  const gget = (i: number): number[] => [0x23, i];
  const gset = (i: number): number[] => [0x24, i];
  const W = 4096;
  const [FLOOR, HEALTH, RNG] = [2, 3, 4];
  const [K, N, J, P, R] = [0, 1, 2, 3, 4];
  // init: rng = seed | 1; floor = 1; health = 100
  const init = [...get(0), ...i64(1), 0x84, ...gset(RNG), ...i32(1), ...gset(FLOOR), ...i32(100), ...gset(HEALTH)];
  const xorshift = (by: number, shift: number): number[] => [...gget(RNG), ...gget(RNG), ...i64(by), shift, 0x85, ...gset(RNG)];
  const step = at === null ? [] : [
    // n = the count of `move` entries this step read
    ...i32(at.move), 0x28, 0x02, 0x00, ...set(N),
    // for j in 0 .. n: inventory[value_j & 7] += j + 1 (an entry is 16 bytes after the count's 8, its f64 value at +8)
    0x02, 0x40, 0x03, 0x40,
    ...get(J), ...get(N), 0x4f, 0x0d, 0x01,
    ...i32(8192), ...i32(at.move + 16), ...get(J), ...i32(4), 0x74, 0x6a, 0x2b, 0x03, 0x00, 0xaa, ...i32(7), 0x71, ...i32(2), 0x74, 0x6a, ...set(P),
    ...get(P), ...get(P), 0x28, 0x02, 0x00, ...get(J), ...i32(1), 0x6a, 0x6a, 0x36, 0x02, 0x00,
    ...get(J), ...i32(1), 0x6a, ...set(J),
    0x0c, 0x00, 0x0b, 0x0b,
    // r = the generator's next value (xorshift64: 13 left, 7 right, 17 left)
    ...xorshift(13, 0x86), ...xorshift(7, 0x88), ...xorshift(17, 0x86), ...gget(RNG), ...set(R),
    // health += (r & 7) - 3; floor += 1 when r's bits 20 to 27 are zero
    ...gget(HEALTH), ...get(R), ...i64(7), 0x83, 0xa7, ...i32(3), 0x6b, 0x6a, ...gset(HEALTH),
    ...get(R), ...i64(20), 0x88, ...i64(255), 0x83, 0x50, 0x04, 0x40, ...gget(FLOOR), ...i32(1), 0x6a, ...gset(FLOOR), 0x0b,
    // request = 1 at the end of each step before a save's, else 0; then floor, health and the inventory
    ...i32(W + at.request), ...SAVES_AT.flatMap((s, i) => [...get(K), ...i64(s - 1), 0x51, ...(i ? [0x72] : [])]), 0x36, 0x02, 0x00,
    ...i32(W + at.floor), ...gget(FLOOR), 0x36, 0x02, 0x00,
    ...i32(W + at.health), ...gget(HEALTH), 0x36, 0x02, 0x00,
    ...i32(W + at.inv), ...i32(8192), ...i32(32), 0xfc, 0x0a, 0x00, 0x00,
  ];
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...i32(0), 0x0b], [0x7f, 0x00, ...i32(W), 0x0b], [0x7f, 0x01, ...i32(0), 0x0b], [0x7f, 0x01, ...i32(0), 0x0b], [0x7e, 0x01, ...i64(0), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([0x00], init), body([0x02, 0x03, 0x7f, 0x01, 0x7e], step)])),
  ]);
}

/** A piece's document with its logic item's program by hash: a 2D film of 40 s at 60 frames a second, a figure a
 * driver walks along x with time, the slider `move` (0 to 7) and the logic item `dungeon`, which reads `move`. */
function pieceDoc(piece: PieceName, program: string): JsonObject {
  const p = PIECES[piece];
  const rect = (id: string, box: number[], role: string, k: number, part: string): JsonObject =>
    ({ id, kind: 'rect@1', name: id, order: `a${String(k).padStart(4, '0')}`, role: part, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    rect('back', [0, 0, 320, 180], 'ground', 1, 'decoration'),
    rect('wall', [0, 120, 320, 60], 'ink', 2, 'decoration'),
    rect('hero', [0, 100, 12, 12], 'accent', 3, 'part'),
    { id: DUNGEON, kind: 'logic@1', name: 'The rules', order: 'a0004', params: { program, step_rate: 60, reads: ['move'], writes: WRITES, saves: { slots: 1, request: 'request' }, checkpoint: { every: EVERY } } },
  ];
  return {
    format: 1, id: p.id, profile: 'film', title: p.title, description: `${p.title}: a piece whose logic declares saves, for the #1041 acceptance tests.`, size: [320, 180], camera: 'cam', seed: p.seed,
    transport: { span: `${END / 60}s`, frame_rate: [60, 1] }, requires: { modules: { logic: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    controls: { move: { kind: 'slider', class: 'document', label: 'Move', role: 'slider', range: [0, 7], default: 0, increment: 1 } },
    drivers: { walk: { target: 'items/hero/at/pos/0', expr: '10 + 7 * t', vars: { t: 'time' } } },
    assets: { rules: { sha256: program, license: LICENSE } },
  };
}

/** The item's region map as `deep_query`'s logic read reports it for the layout probe (Logic `logic@1`: Region map,
 * "its digest is the item's layout digest, which `deep_query` returns"), once per file. */
let offsets: Offsets | undefined;
function offsetsOf(bin: string): Offsets {
  if (offsets) return offsets;
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1041-layout-'));
  try {
    const document = pieceDoc('dungeon', putEvidence(evidence, dungeonBytes(null)));
    const doc = PIECES.dungeon.id;
    const r = runShow(bin, scenario(evidence, doc, [
      { call: 'deep_show', session: SESSION.id, doc, document, include: ['issues'] },
      { call: 'deep_query', session: SESSION.id, doc, what: 'logic', items: [DUNGEON], steps: [] },
    ]), 'the layout probe');
    presented(r[0], 'the dungeon with the layout probe as its program');
    const read = obj(obj(obj(r[1], 'deep_query')['logic'], `deep_query's logic read: ${show(r[1], 800)}`)[DUNGEON], `deep_query: logic.${DUNGEON}`);
    const entries = arr(obj(read['region_map'], 'the region map')['entries'], 'the region map\'s entries').map((e, i) => obj(e, `the region map's entry ${i}`));
    const at = (region: string, name: string): number => {
      const e = entries.find((x) => x['region'] === region && x['name'] === name);
      expect(e, `the region map has the ${region} entry ${name}: ${show(entries, 800)}`).toBeTruthy();
      return int(e!['offset'], `the ${region} entry ${name}'s offset`);
    };
    offsets = { move: at('reads', 'move'), floor: at('writes', 'floor'), health: at('writes', 'health'), inv: at('writes', 'inv'), request: at('writes', 'request') };
    return offsets;
  } finally { rmSync(evidence, { recursive: true, force: true }); }
}
/** The piece's document, its program built against the item's layout and kept in `evidence`. */
function documentOf(bin: string, evidence: string, piece: PieceName): JsonObject {
  return pieceDoc(piece, putEvidence(evidence, dungeonBytes(offsetsOf(bin))));
}

// ---------------------------------------------------------------------------------------------------
// The app's record of a piece (README: The app's side): deep-show's `logic` call replays the document's logic on the
// recorded track, each step's arrays and every checkpoint with its full-state hash (`deep_hash`).

export interface AppRun {
  /** The logic item's full-state hash at each checkpoint, by step. */
  checkpoints: Map<number, string>;
}
/** The app's replay of `piece` over its 2,400 steps. The fixture is held to what the tests lean on: the logic asks for
 * slot 1 at the ends of steps 599, 1,199 and 1,799 only, and a checkpoint is taken every 60 steps to 2,400. */
export function appRun(bin: string, evidence: string, piece: PieceName): AppRun {
  const what = `the app's replay of ${PIECES[piece].title}`;
  const document = documentOf(bin, evidence, piece);
  const doc = PIECES[piece].id;
  const r = runShow(bin, scenario(evidence, doc, [present(doc, document), { call: 'logic', doc, steps: END, track: pieceTrack(piece) }]), what);
  presented(r[0], PIECES[piece].title);
  const logic = obj(r[1], `${what}: logic`);
  expect(logic['code'], `${what}: the logic call answers, not refuses: ${show(logic)}`).toBeUndefined();
  const rows = arr(logic['steps'], `${what}: logic.steps`).map((v, i) => obj(v, `${what}: logic.steps[${i}]`));
  expect(rows.length, `${what} runs ${END} steps`).toBe(END);
  const asked = rows.filter((row) => arr(obj(row['arrays'], `${what}: a step's arrays`)[`${DUNGEON}.request`], `${what}: ${DUNGEON}.request`)[0] === SLOT).map((row) => int(row['step'], `${what}: a step`));
  expect(asked, `${what}: the logic asks for slot ${SLOT} at the ends of the steps before its saves`).toEqual(SAVES_AT.map((s) => s - 1));
  const checkpoints = new Map(arr(obj(logic['checkpoints'], `${what}: logic.checkpoints`)[DUNGEON], `${what}: logic.checkpoints.${DUNGEON}`).map((v, i) => {
    const c = obj(v, `${what}: logic.checkpoints.${DUNGEON}[${i}]`);
    return [int(c['step'], `${what}: a checkpoint's step`), hash16(c['deep_hash'], `${what}: a checkpoint's deep_hash`)] as const;
  }));
  const missing = checkpointSteps(0).filter((k) => !checkpoints.has(k));
  expect(missing, `${what} takes a checkpoint every ${EVERY} steps to ${END}`).toEqual([]);
  return { checkpoints };
}
/** The checkpoint steps from `from` to the piece's end. */
export const checkpointSteps = (from: number): number[] => Array.from({ length: (END - from) / EVERY + 1 }, (_, i) => from + i * EVERY);

// ---------------------------------------------------------------------------------------------------
// The web export (Export: web player): `{call: "export", doc, out, video: {codec: "web"}, track}`, as #172's suite
// asks for it; `out` is the bundle's folder, written whole.

/** One `deep-show run`: the piece shown, then its web export on its recorded track into `out` (`planted` the
 * scenario's key for a wrong player). */
export function exportPiece(bin: string, evidence: string, piece: PieceName, out: string, planted?: string): void {
  const what = `${PIECES[piece].title} exported to the web${planted ? ` (planted ${planted})` : ''}`;
  const document = documentOf(bin, evidence, piece);
  const doc = PIECES[piece].id;
  const r = runShow(bin, scenario(evidence, doc, [present(doc, document), { call: 'export', doc, out, video: { codec: 'web' }, track: pieceTrack(piece) }], planted), what);
  presented(r[0], PIECES[piece].title);
  expect(obj(r[1], what)['outcome'], `${what} is exported: ${show(r[1], 3000)}`).toBe('exported');
  expect(existsSync(join(out, 'index.html')), `${what}: the bundle has its index page`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// A folder served over HTTP (README: The server). A child process of its own, since `deep-show run` under spawnSync
// blocks this process's event loop. Every index page is sent with `no-cache`, every other file with a max-age of a
// year, WebAssembly as `application/wasm`, as a static host does; no cross-origin isolation headers.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path');
const [root] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const s = http.createServer((q, r) => {
  let rel = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]).replace(/^\\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', path.basename(file) === 'index.html' ? 'no-cache' : 'max-age=31536000');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

export class Server {
  private child: ChildProcess | null = null;
  origin = '';
  /** Serves `root`; resolves with the origin once it listens. */
  async start(root: string): Promise<string> {
    const child = spawn(process.execPath, ['-e', SERVER, root], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    this.origin = `http://127.0.0.1:${port}`;
    return this.origin;
  }
  /** Stops the listener this object started, by its PID. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
  }
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on (README: The browser), over its DevTools protocol in flat sessions. Chrome
// runs in a process group of its own and is stopped by that PID; its profile and its download folder are fresh
// folders, removed after.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];

type Params = Record<string, unknown>;
type Message = { id?: number; method?: string; params?: Params; result?: Params; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Params) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Params) => void }[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Params = {}, session = '', timeoutMs = 60_000): Promise<Params> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Params) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** The test shim over the browser's storage (README: The shim over the browser's storage), installed before the
 * page's scripts: the browser's own ask to keep the origin's storage persistent (`navigator.storage.persist()`) is
 * answered by the test, granted when `grants`, refused when not, and counted; `persisted()` answers what was granted.
 * `granted` carries a grant made by an earlier page of the same profile. */
export interface Shim { grants: boolean; granted?: boolean }
const shimSource = (s: Shim): string => `(() => {
  const state = { asked: 0, granted: ${s.granted === true} };
  Object.defineProperty(window, '__deep1041', { value: state });
  const manager = navigator.storage && Object.getPrototypeOf(navigator.storage);
  if (!manager) return;
  manager.persist = async function () { state.asked += 1; if (${s.grants}) state.granted = true; return state.granted; };
  manager.persisted = async function () { return state.granted; };
})();`;
/** What the shim saw in a page: how often the player asked, and whether the origin's storage is persistent. */
export interface Asked { asked: number; granted: boolean }

/** One checkpoint: the step it was taken at and its full-state hash. */
export interface Checkpoint { step: number; hash: string }
/** A save the browser's storage holds (README: probe()'s `saves`). */
export interface StoredSave { slot: number; step: number; hash: string }
/** What the tests read of probe(): the step, the logic item's checkpoints and the saves the storage holds. */
export interface Probe { step: number; checkpoints: Checkpoint[]; saves: StoredSave[]; backend: string }
/** A notice the page shows: its kind (the value of `data-deep-notice`) and its text. */
export interface Notice { kind: string; text: string }

/** Page-side: every element of the document and of the open shadow roots under it; a control by its name. */
const FIND = `const all = (root, out = []) => { for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) all(e.shadowRoot, out); } return out; };
  const named = (e) => (e.getAttribute('aria-label') ?? (e.tagName === 'INPUT' ? e.value : e.textContent) ?? '').replace(/\\s+/g, ' ').trim();
  const control = (name) => all(document).find((e) => e.matches('button, [role="button"], input, label, a') && named(e) === name);`;
/** The player's own controls, by the names the page shows (README: The player's own controls). */
export const OPEN_SAVE = 'Open save';
export const EXPORT_SAVE = 'Export save';
export const IMPORT_SAVE = 'Import save';
/** The kinds of the two notices the criteria name (README: Notices). */
export const SAVE_FAILED = 'save_failed';
export const NOT_PERSISTENT = 'saves_not_persistent';

/** One page in the browser (a target in a flat session). */
export class Page {
  readonly errors: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, private readonly target: string, private readonly browser: Browser) {}
  /** A script's value in the page (its own JavaScript, as text), awaited; with `gesture`, as a user's. */
  async evaluate<T>(expression: string, timeoutMs = 60_000, gesture = false): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, this.session, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** The notices the page shows: every element marked `data-deep-notice`, in document order. */
  notices(): Promise<Notice[]> {
    return this.evaluate<Notice[]>(`(() => { ${FIND} return all(document).filter((e) => e.hasAttribute('data-deep-notice')).map((e) => ({ kind: e.getAttribute('data-deep-notice') || '', text: (e.textContent || '').trim() })); })()`);
  }
  /** `ready` within `ms`, or the test fails naming the notices; BLOCKED when the browser offers no WebGPU adapter here. */
  async mustBeReady(what: string, ms = 300_000): Promise<void> {
    const until = Date.now() + ms;
    let s = { ready: false, player: false };
    while (Date.now() < until && !s.ready) {
      s = await this.evaluate<typeof s>(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true) }; })()`).catch(() => s);
      if (!s.ready) await sleep(100);
    }
    if (!s.ready) {
      const gpu = await this.evaluate<string>(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e: Error) => e.message);
      if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the dungeon plays live on WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    }
    const notices = s.ready ? [] : await this.notices().catch(() => []);
    expect(s.ready, `${what}: the player (<deep-player>) is ready within ${ms} ms; it shows ${s.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(notices)}, page errors ${JSON.stringify(this.errors.slice(0, 5))}`).toBe(true);
  }
  /** probe(), read: the step, the logic item's checkpoints with their full-state hashes, and the saves the storage
   * holds (each slot's save as the viewer's open would open it, with the full-state hash recorded when it was written). */
  async probe(what: string): Promise<Probe> {
    const p = obj(await this.evaluate<JsonValue>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v ?? null)); })()`), `${what}: probe()`);
    const saves = arr(p['saves'], `${what}: probe().saves`).map((v, i) => {
      const s = obj(v, `${what}: probe().saves[${i}]`);
      return { slot: int(s['slot'], `${what}: probe().saves[${i}].slot`), step: int(s['step'], `${what}: probe().saves[${i}].step`), hash: hash16(obj(s['deep_hash'], `${what}: probe().saves[${i}].deep_hash`)[DUNGEON], `${what}: probe().saves[${i}].deep_hash.${DUNGEON}`) };
    });
    const checkpoints = arr(obj(p['checkpoint_hashes'], `${what}: probe().checkpoint_hashes`)[DUNGEON], `${what}: probe().checkpoint_hashes.${DUNGEON}`).map((v, i) => {
      const c = obj(v, `${what}: probe().checkpoint_hashes.${DUNGEON}[${i}]`);
      return { step: int(c['step'], `${what}: a checkpoint's step`), hash: str(c['hash'], `${what}: a checkpoint's hash`) };
    });
    return { step: int(p['step'], `${what}: probe().step`), checkpoints, saves, backend: str(p['backend'], `${what}: probe().backend`) };
  }
  /** A click on the player's own control named `name`, as a user's gesture. */
  async click(name: string, what: string): Promise<void> {
    const r = await this.evaluate<string>(`(() => { ${FIND} const e = control(${JSON.stringify(name)}); if (!e) return 'the page shows no control named "' + ${JSON.stringify(name)} + '"'; if (e.disabled) return 'the control "' + ${JSON.stringify(name)} + '" is disabled'; e.click(); return ''; })()`, 60_000, true);
    expect(r, `${what}: a click on the player's own control "${name}"`).toBe('');
  }
  /** play() as a user's gesture, when the player is paused; pause(). */
  async play(): Promise<void> { await this.evaluate(`(() => { const p = document.querySelector('deep-player'); if (p.paused) p.play(); })()`, 60_000, true); }
  async pause(): Promise<void> { await this.evaluate(`(() => { document.querySelector('deep-player').pause(); })()`); }
  /** Waits, at most `ms`, until probe() reads a step at or past `step`; that probe. */
  async reached(step: number, what: string, ms: number): Promise<Probe> {
    const until = Date.now() + ms;
    let p = await this.probe(what);
    while (p.step < step && Date.now() < until) { await sleep(100); p = await this.probe(what); }
    expect(p.step >= step, `${what}: the player reaches step ${step} within ${ms} ms; probe().step is ${p.step}, notices ${JSON.stringify(await this.notices())}`).toBe(true);
    return p;
  }
  /** Waits, while the player plays, until the storage holds slot 1's save at `step` with the full-state hash `hash`
   * recorded (the app's at that checkpoint), at most `ms` and at most a minute after the player passed `step`; that
   * save. A save is listed once it is written whole. */
  async saved(step: number, hash: string, what: string, ms: number): Promise<StoredSave> {
    const until = Date.now() + ms;
    const is = (s: StoredSave | undefined): boolean => s?.step === step && s.hash === hash;
    let passed = 0;
    let p = await this.probe(what);
    while (!is(slotOf(p)) && Date.now() < until && !(passed && Date.now() > passed + 60_000)) {
      if (p.step >= step && !passed) passed = Date.now();
      await sleep(100);
      p = await this.probe(what);
    }
    expect(is(slotOf(p)), `${what}: the storage holds slot ${SLOT}'s save at step ${step}, recording the app's full-state hash ${hash} there; the player is at step ${p.step}, probe().saves is ${JSON.stringify(p.saves)}, notices ${JSON.stringify(await this.notices())}`).toBe(true);
    return slotOf(p)!;
  }
  /** The notices of `kind` the page shows, waiting at most `ms` for the first. */
  async noticed(kind: string, ms: number): Promise<Notice[]> {
    const until = Date.now() + ms;
    let found = (await this.notices()).filter((n) => n.kind === kind);
    while (!found.length && Date.now() < until) { await sleep(100); found = (await this.notices()).filter((n) => n.kind === kind); }
    return found;
  }
  /** A click on "Export save": the file the browser saves, written into `dir` under the name the browser was given;
   * its path. */
  async exportSave(dir: string, what: string): Promise<string> {
    const before = this.browser.downloadCount();
    await this.click(EXPORT_SAVE, what);
    const { name, bytes } = await this.browser.download(before, `${what}: "${EXPORT_SAVE}"`);
    expect(bytes.length, `${what}: the file "${EXPORT_SAVE}" gives holds the save`).toBeGreaterThan(0);
    const file = join(dir, basename(name) || 'slot.save');
    writeFileSync(file, bytes);
    return file;
  }
  /** A click on "Import save", and `file` handed to the file chooser it opens. */
  async importSave(file: string, what: string): Promise<void> {
    const opened = new Promise<Params | null>((done) => { const t = setTimeout(() => done(null), 30_000); this.cdp.on(this.session, 'Page.fileChooserOpened', (p) => { clearTimeout(t); done(p); }); });
    await this.click(IMPORT_SAVE, what);
    const chooser = await opened;
    expect(chooser !== null, `${what}: "${IMPORT_SAVE}" opens the browser's file chooser within 30 s`).toBe(true);
    const node = chooser!['backendNodeId'];
    expect(typeof node, `${what}: "${IMPORT_SAVE}" takes its file from a file input's chooser (README: The player's own controls)`).toBe('number');
    await this.cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: node }, this.session);
  }
  /** What the shim saw in this page. */
  async asked(what: string): Promise<Asked> {
    const a = await this.evaluate<Asked | null>(`window.__deep1041 ? { asked: window.__deep1041.asked, granted: window.__deep1041.granted } : null`);
    expect(a, `${what}: the page runs under the shim over the browser's storage`).toBeTruthy();
    return a!;
  }
  /** Closes the page. */
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}
/** Slot 1's save in a probe, if the storage holds one. */
export const slotOf = (p: Probe): StoredSave | undefined => p.saves.find((s) => s.slot === SLOT);
/** The logic item's full-state hash at checkpoint `step` in a probe, if it holds one. */
export const checkpointAt = (p: Probe, step: number): string | undefined => p.checkpoints.find((c) => c.step === step)?.hash;

/** One browser with one profile, a fresh folder. `useBrowsers` closes it after the test. */
export class Browser {
  private readonly downloads: { guid: string; name: string; state: string }[] = [];
  private closed = false;
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string, private readonly files: string, private readonly control: string) {}
  /** A browser with a fresh profile. */
  static async open(): Promise<Browser> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-1041-chrome-'));
    const files = mkdtempSync(join(tmpdir(), 'deep-1041-downloads-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const stopNow = (): Promise<void> => stop(chrome, [profile, files], 0);
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 180_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { await stopNow(); blocked(`${CHROME} opened no DevTools port within 180 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts, on a machine with room for it`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { await stopNow(); return blocked((e as Error).message); }
    try {
      // The blank page Chrome starts with is kept: the origin's quota and its clearing are asked through its session.
      const { targetInfos } = await cdp.send('Target.getTargets') as { targetInfos: { targetId: string; type: string }[] };
      const blank = targetInfos.find((t) => t.type === 'page') ?? (await cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: blank.targetId, flatten: true }) as { sessionId: string };
      const browser = new Browser(chrome, cdp, profile, files, sessionId);
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: files, eventsEnabled: true });
      cdp.on('', 'Browser.downloadWillBegin', (p) => { browser.downloads.push({ guid: String(p['guid']), name: String(p['suggestedFilename'] ?? ''), state: 'inProgress' }); });
      cdp.on('', 'Browser.downloadProgress', (p) => { const d = browser.downloads.find((x) => x.guid === p['guid']); if (d) d.state = String(p['state']); });
      return browser;
    } catch (e) { cdp.close(); await stopNow(); throw e; }
  }
  /** Opens `url` in a new page of this profile, 1280 x 720 at device scale 1, the shim installed first when given. */
  async page(url: string, shim?: Shim): Promise<Page> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const page = new Page(this.cdp, sessionId, targetId, this);
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => page.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
    if (shim) await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shimSource(shim) }, sessionId);
    await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => undefined);
    return page;
  }
  /** The origin's storage quota set to `bytes`, or the browser's own again with null. */
  async quota(origin: string, bytes: number | null): Promise<void> {
    await this.cdp.send('Storage.overrideQuotaForOrigin', { origin, ...(bytes === null ? {} : { quotaSize: bytes }) }, this.control);
  }
  /** The shim's journey: the origin's storage is cleared, every kind of it, unless it was made persistent. With no
   * page of the origin open. */
  async clearNonPersistent(origin: string, persistent: boolean): Promise<void> {
    if (!persistent) await this.cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }, this.control);
  }
  downloadCount(): number { return this.downloads.length; }
  /** The first download begun after `before` others, once the browser has saved it whole: the name the page gave it
   * and its bytes. */
  async download(before: number, what: string): Promise<{ name: string; bytes: Buffer }> {
    const until = Date.now() + 60_000;
    while (Date.now() < until && this.downloads[before]?.state !== 'completed' && this.downloads[before]?.state !== 'canceled') await sleep(100);
    const d = this.downloads[before];
    expect(d?.state, `${what} gives the browser a file to save within 60 s (a download, README: The player's own controls)`).toBe('completed');
    return { name: d!.name, bytes: readFileSync(join(this.files, d!.guid)) };
  }
  /** Closes the browser this object started and removes its folders; a second call does nothing. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    await stop(this.chrome, [this.profile, this.files], 5_000);
  }
}
/** Whether `child` has ended, waiting at most `ms` for it. */
function ended(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((done) => { const t = setTimeout(() => done(false), ms); child.once('exit', () => { clearTimeout(t); done(true); }); });
}
/** Stops the Chrome this file started and removes its folders. A Chrome still running after `grace` ms is stopped by
 * its own process group's PID; one that has ended is never signalled, so no other process can be. */
async function stop(chrome: ChildProcess, folders: string[], grace: number): Promise<void> {
  if (!(await ended(chrome, grace)) && chrome.pid) {
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
    await ended(chrome, 5_000);
  }
  for (const f of folders) rmSync(f, { recursive: true, force: true, maxRetries: 3 });
}

/** The servers and browsers a test opens, closed after it whether it passed or not. */
export function useBrowsers(): { serve: (root: string) => Promise<string>; browser: () => Promise<Browser> } {
  const servers: Server[] = [];
  const browsers: Browser[] = [];
  afterEach(async () => {
    for (const b of browsers.splice(0)) await b.close();
    for (const s of servers.splice(0)) await s.stop();
  }, TIMEOUT);
  return {
    serve: async (root) => { const s = new Server(); servers.push(s); return s.start(root); },
    browser: async () => { const b = await Browser.open(); browsers.push(b); return b; },
  };
}

// ---------------------------------------------------------------------------------------------------
// What the tests do with a page (README: The surface under test)

/** The time a play of `steps` steps may take: its own length at 60 steps a second and two minutes more. */
export const playMs = (steps: number): number => Math.ceil(steps / 60) * 1000 + 120_000;

/** A page of `url` in `browser`, ready, its probe() read once: the first thing every test asks of a page, so a player
 * without the surface fails here, before any play. */
export async function openPiece(browser: Browser, url: string, what: string, shim?: Shim): Promise<{ page: Page; start: Probe }> {
  const page = await browser.page(url, shim);
  await page.mustBeReady(what);
  const start = await page.probe(`${what}, once ready`);
  expect(/webgpu/i.test(start.backend), `${what}: the player runs on WebGPU: probe().backend is ${start.backend}`).toBe(true);
  return { page, start };
}
/** play() from where the player is until the storage holds slot 1's save at `step`, recording the app's full-state
 * hash at that checkpoint, then pause(): that save. A save is reached by playing, never by a seek. */
export async function playToSave(page: Page, step: number, app: AppRun, what: string): Promise<StoredSave> {
  await page.play();
  const save = await page.saved(step, app.checkpoints.get(step)!, what, playMs(step));
  await page.pause();
  return save;
}
/** A click on "Open save" in a page at its start: the failures of "opens at its recorded full-state hash", each naming
 * the slot. */
export async function openSave(page: Page, save: StoredSave, what: string): Promise<string[]> {
  await page.click(OPEN_SAVE, what);
  return opened(page, save, what);
}
/** The player after a save was opened or imported: within two minutes it reads the save's step or a later one, and
 * its checkpoint at the save's step has the full-state hash recorded when the save was written. The failures, each
 * naming the slot. */
export async function opened(page: Page, save: StoredSave, what: string): Promise<string[]> {
  const until = Date.now() + 120_000;
  let probe = await page.probe(what);
  while (probe.step < save.step && Date.now() < until) { await sleep(100); probe = await page.probe(what); }
  const got = checkpointAt(probe, save.step);
  if (probe.step < save.step) return [`${what}: slot ${save.slot}'s save at step ${save.step} doesn't open: the player is at step ${probe.step} two minutes after; notices ${JSON.stringify(await page.notices())}`];
  if (got !== save.hash) return [`${what}: slot ${save.slot}'s save opens at the full-state hash ${String(got)} at step ${save.step}, not the ${save.hash} recorded when it was written`];
  return [];
}
