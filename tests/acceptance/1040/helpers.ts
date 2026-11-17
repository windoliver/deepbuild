// Test-side tools for the #1040 acceptance tests (README: The surface under test): `deep-show` built per feature set and
// driven by #393's `deep-show run` scenarios, as #169's and #172's suites drive it; the pieces the criteria describe,
// written here so every file judges the same documents; the web export's receipt, its bundle and the fallback page the
// receipt marks inside it; the page export (#169) and its manifest; the app's own record of a piece (png_seq stills and
// frames, the `logic` call's step and full-state hashes, `physics_bake`'s step hashes, the `track` call's hash, the
// decode worker's `media_decode`); a bundle served over HTTP by a child process that logs every response; and Google
// Chrome, headless, with WebGPU switched on or off, driven over its DevTools protocol by this file alone (no
// browser-automation library), with a test shim over the browser's WebGPU adapter that offers the features a test
// names and logs every device request and every texture a device creates. Nothing here stands in for the export, the
// bundle, its index page, the player, the fallback page or the app: every value a test compares comes from `deep-show`,
// the files the export wrote or the browser, and every expected value from the issue's text and the design.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  FLICKS, FULL, LICENSE, REPO, TIMEOUT, arr, filesUnder, hex64, int, isObject, mentions, obj, pageExport, present, putEvidence, referenceMacProblem,
  scenarioOf, sha256, show, solidPng, stillHash, str, useShow, useTemp, type JsonObject, type JsonValue, type Size,
} from '../169/helpers.ts';
import { decodePng, pngFrames } from '../501/helpers.ts';
import { entryAt, layoutFor, type Program } from '../533/helpers.ts';
import { requestFailures, webExport, world60, type GpuNeeds, type LoggedRequest } from '../172/helpers.ts';
import { ktx2Uastc } from '../423/helpers.ts';
import { decodedOf, mediaDecode } from '../498/decode/helpers.ts';
// Builds, the scenario, `deep show` and the JSON rules are #169's; the web export's call and the device-request rule
// are #172's; the layout probe is #533's; UASTC KTX2 files are #423's; the decode worker's call is #498's.

export {
  FULL, REPO, TIMEOUT, isObject, mentions, sha256, show, stillHash, useShow, useTemp,
};
export type { GpuNeeds, JsonObject, JsonValue };

/** cargo on PATH: the pinned toolchain's folder first when it is there (as #172's helpers do). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;

/** Each criterion's ID: `#1040.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1040.62c32a87',
  2: 'AC2 #1040.082d5019',
  3: 'AC3 #1040.d2344cb1',
  4: 'AC4 #1040.d641d88e',
  5: 'AC5 #1040.3d1179a9',
  6: 'AC6 #1040.a023b5eb',
  7: 'AC7 #1040.6bb03885',
  8: 'AC8 #1040.fc164908',
  9: 'AC9 #1040.055bc0b1',
  10: 'AC10 #1040.67ee1fab',
} as const;

// ---------------------------------------------------------------------------------------------------
// The failure rules (the four invariants: nothing missing or unrun passes)

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A wrong program's run: this suite's own judgement fails it, and some failure names `named`. */
export function failsNaming(failures: readonly string[], named: string, what: string): void {
  expect(failures.length, `${what}: the judgement fails the wrong program, but it found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(named)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** A platform need is missing here: never a pass. */
function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** The criterion stays open, whatever the reason: never a pass. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): one scenario line in, one answer line out. A copy of #169's, so an unknown `planted` name at
// the base (`{"ok": false, "code": "bad_input"}`) fails here, in this folder.

export function run(bin: string, sc: JsonObject, what: string): JsonObject[] {
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
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
export function shown(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const notes = [...(Array.isArray(r['notices']) ? r['notices'] : []), ...(Array.isArray(r['issues']) ? r['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => show(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(r['outcome'], `${what} is presented: ${show(r, 3000)}`).toBe('presented');
}
/** One `deep-show run` of `calls` after the document is shown; the replies to `calls`. */
function withDoc(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, planted?: string): JsonObject[] {
  const doc = String(document['id']);
  const r = run(bin, scenarioOf({ evidence, docs: [doc], calls: [present(doc, document), ...calls], ...(planted ? { planted } : {}) }), what);
  shown(r[0], `${what}: the document`);
  return r.slice(1);
}

// ---------------------------------------------------------------------------------------------------
// Time

/** The logic and world step of every piece here: 1/60 s, 11,760,000 flicks. */
const STEP = FLICKS / 60;
const fl = (s: number): number => Math.round(s * FLICKS);
/** An input track entry (Input track; #504's form): `{t: flicks, seq, control, value, writer, player}`. */
export const entry = (seconds: number, control: string, value: JsonValue, seq = 0): JsonObject =>
  ({ t: fl(seconds), seq, control, value, writer: 'you', player: 1 });
const stepEntry = (k: number, control: string, value: JsonValue): JsonObject => ({ t: k * STEP, seq: 0, control, value, writer: 'you', player: 1 });

// ---------------------------------------------------------------------------------------------------
// Logic programs, written in test code as #172's lab program is (Logic `logic@1`: one memory of one page whose maximum
// is its minimum, immutable i32 globals `reads_at` 0 and `writes_at` 4096, `init(seed: i64)` doing nothing and
// `step(k: i64)` running the given instructions; no imports), each assembled against the layout deep-logic's `check`
// reports for its reads and writes (#533's layout probe).

const uleb = (n: number): number[] => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
function sleb(n: number): number[] {
  const o: number[] = [];
  for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
}
const i32 = (n: number): number[] => [0x41, ...sleb(n)];
const f64 = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [0x44, ...b]; };
const LOAD_I32 = [0x28, 0x02, 0x00];
const LOAD_F64 = [0x2b, 0x03, 0x00];
const STORE_I32 = [0x36, 0x02, 0x00];
const STORE_F64 = [0x39, 0x03, 0x00];
const IF = [0x04, 0x40];
const END = [0x0b];
/** Where the region map puts the writes, past the reads; a program's own memory starts past both. */
const WRITES_AT = 4096;
/** The memory flag's address (AC8): inside the program's one page, in no read or write region. */
const FLAG_AT = 8192;

function logicModule(step: number[]): Program {
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
  const body = (code: number[]): number[] => { const b = [0x00, ...code, 0x0b]; return [...uleb(b.length), ...b]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...i32(0), 0x0b], [0x7f, 0x00, ...i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([]), body(step)])),
  ]);
  return { name: `logic_${sha256(bytes).slice(0, 8)}`, bytes, b64: bytes.toString('base64'), sha: sha256(bytes) };
}
type Writes = Record<string, { type: 'f64' }>;
function layoutOf(reads: string[], writes: Writes): { read: (c: string) => number; write: (w: string) => number } {
  const l = layoutFor({ program: logicModule([]), reads, writes }, { controls: reads });
  return { read: (c) => entryAt(l, 'reads', c).offset, write: (w) => WRITES_AT + entryAt(l, 'writes', w).offset };
}
/** A slot's first entry's value: past the slot's u32 count and 4 zero bytes, and the entry's u32 player and 4 zero bytes. */
const FIRST_VALUE = 16;

const programs = new Map<string, Program>();
/** The quiz's `scorer` (AC1, AC7, AC10): reads q1, q2 and q3; each step, for each question whose slot holds an entry
 * whose value is the right option's index (README: Readings, a choice in a logic item's read region), adds 1 to its
 * f64 `score`. */
function quizProgram(): Program {
  const known = programs.get('quiz');
  if (known) return known;
  const l = layoutOf([...QUIZ.questions], { score: { type: 'f64' } });
  const score = l.write('score');
  const code: number[] = [];
  for (const q of QUIZ.questions) {
    const at = l.read(q);
    const right = QUIZ.options.indexOf(QUIZ.right[q]!);
    code.push(...i32(at), ...LOAD_I32, ...IF,
      ...i32(at + FIRST_VALUE), ...LOAD_F64, ...f64(right), 0x61, ...IF,
      ...i32(score), ...i32(score), ...LOAD_F64, ...f64(1), 0xa0, ...STORE_F64,
      ...END, ...END);
  }
  const p = logicModule(code);
  programs.set('quiz', p);
  return p;
}
/** A counter (AC2's `tally`, AC4's `rules`): reads `control`; each step adds the number of its entries the step read
 * (the u32 at the start of its slot) to the f64 `write`. */
function countProgram(control: string, write: string): Program {
  const key = `count:${control}:${write}`;
  const known = programs.get(key);
  if (known) return known;
  const l = layoutOf([control], { [write]: { type: 'f64' } });
  const at = l.read(control); const w = l.write(write);
  // i32.const w; i32.const w; f64.load; i32.const at; i32.load; f64.convert_i32_u; f64.add; f64.store
  const p = logicModule([...i32(w), ...i32(w), ...LOAD_F64, ...i32(at), ...LOAD_I32, 0xb8, 0xa0, ...STORE_F64]);
  programs.set(key, p);
  return p;
}
/** AC8's `mem`: reads btn_a, btn_b and reveal. An entry of btn_a sets the i32 at FLAG_AT to 1, one of btn_b to 2, and neither writes
 * anything; an entry of reveal writes the flag to its f64 `shown`. */
function memoryProgram(): Program {
  const known = programs.get('memory');
  if (known) return known;
  const l = layoutOf(['btn_a', 'btn_b', 'reveal'], { shown: { type: 'f64' } });
  const shownAt = l.write('shown');
  const setFlag = (control: string, v: number): number[] => [...i32(l.read(control)), ...LOAD_I32, ...IF, ...i32(FLAG_AT), ...i32(v), ...STORE_I32, ...END];
  const p = logicModule([
    ...setFlag('btn_a', 1), ...setFlag('btn_b', 2),
    // if reveal: shown = f64(i32 at FLAG_AT)
    ...i32(l.read('reveal')), ...LOAD_I32, ...IF, ...i32(shownAt), ...i32(FLAG_AT), ...LOAD_I32, 0xb7, ...STORE_F64, ...END,
  ]);
  programs.set('memory', p);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope as you send it). IDs are 26 Crockford characters. 2D: u = px, y down; 3D: metres, +Y up.
// 2D pieces carry an ink band over their lower third, so no frame is flat under export's film.blank guard (#169's).

const ulid = (k: number): string => `01JB1040D${String(k).padStart(17, '0')}`;
const DOC = { quiz: ulid(1), flips: ulid(2), lab: ulid(3), game: ulid(4), maps: ulid(5), small: ulid(6), memory: ulid(7), drop: ulid(8) } as const;
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
type V3 = [number, number, number];
type Box = [number, number, number, number];
type Rate = [number, number];

const rect2d = (id: string, box: Box, role: string, k: number, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order: order(k), params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra });
const text2d = (id: string, words: string, k: number, pos: [number, number], size = 14): JsonObject =>
  ({ id, kind: 'text@1', name: id, order: order(k), params: { text: words, font: 'body', size, box: { w: 280, h: 28 }, align: 'start' }, at: { pos: [pos[0], pos[1], 0] } });
/** A 2D document: a camera over the page, the ground and an ink band over its lower third under its own items. */
function doc2d(id: string, title: string, profile: string, size: Size, items: JsonObject[], extra: JsonObject): JsonObject {
  const [w, h] = size;
  const base = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [w / 2, h / 2, 0], view_width: w } },
    rect2d('back', [0, 0, w, h], 'ground', 1, { role: 'decoration' }),
    rect2d('band', [0, (2 * h) / 3, w, h / 3], 'ink', 2, { role: 'decoration' }),
  ];
  return {
    format: 1, id, profile, title, description: `${title}: a piece the #1040 acceptance tests export.`, size, camera: 'cam',
    items: Object.fromEntries([...base, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}
/** Shown only over [from, to): opacity held at 0, 1 from `from`, 0 again from `to` (null: to the end). */
const shownOver = (id: string, from: number, to: number | null): JsonObject => ({
  target: `items/${id}/adjust/opacity`, type: 'f32',
  keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: `${from}s`, value: 1, interp: 'hold' }, ...(to === null ? {} : { k2: { t: `${to}s`, value: 0, interp: 'hold' } }) },
});
const logicItem = (id: string, program: Program, reads: string[], writes: Writes, k: number): JsonObject =>
  ({ id, kind: 'logic@1', name: id, order: order(k), params: { program: program.sha, step_rate: 60, reads, writes } });
const press = (label: string, key: string): JsonObject => ({ kind: 'press', class: 'document', label, role: 'button', keys: { [key]: 1 } });
const programAsset = (p: Program): JsonObject => ({ sha256: p.sha, license: LICENSE });

// The quiz (criteria 1, 7 and 10): #169's quiz, its score kept by a logic item. A 2D film, 320 × 180 at 10 fps, 4.1 s:
// stage markers ask1, ask2 and ask3 at 1, 2 and 3 s wait for the choices q1, q2 and q3 (options a, b and c, no default;
// right answers b, c and a), each question's words and its three option marks shown while the timeline is at it, each
// mark a target of its option; the stage marker `end` at 4 s, where a counter shows the score. The logic item `scorer`
// reads the three choices and keeps the score in its f64 array `score`; a driver puts it in the story constant `right`
// the counter reads. 40 states: 1 + 3 + 9 + 27, 27 of them at `end`.

export const QUIZ = {
  size: [320, 180] as Size, rate: [10, 1] as Rate, questions: ['q1', 'q2', 'q3'], options: ['a', 'b', 'c'], right: { q1: 'b', q2: 'c', q3: 'a' } as Record<string, string>,
  logic: 'scorer',
};
const OPTION_ROLES: Record<string, string> = { a: 'accent', b: 'session_readout', c: 'raised' };
export function quizDoc(evidence: string): JsonObject {
  const program = quizProgram();
  putEvidence(evidence, program.bytes);
  const words = ['Pick the warm color', 'Pick the cool color', 'Pick the dark color'];
  const items: JsonObject[] = [];
  const channels: JsonObject = {};
  const controls: JsonObject = {};
  let k = 3;
  QUIZ.questions.forEach((q, n) => {
    items.push(text2d(`t${n + 1}`, words[n]!, k++, [16, 16]));
    channels[`show_t${n + 1}`] = shownOver(`t${n + 1}`, n + 1, n + 2);
    const targets: JsonObject = {};
    QUIZ.options.forEach((o, i) => {
      const id = `${q}_${o}`;
      items.push(rect2d(id, [40 + 90 * i, 60, 60, 36], OPTION_ROLES[o]!, k++, { role: 'part' }));
      channels[`show_${id}`] = shownOver(id, n + 1, n + 2);
      targets[o] = id;
    });
    controls[q] = { kind: 'choice', class: 'document', label: words[n]!, role: 'radiogroup', options: [...QUIZ.options], targets };
  });
  items.push({ id: 'score', kind: 'text@1', name: 'Score', order: order(k++), params: { text: { counter: { source: 'right', tabular: true, format: { group: 'none' } } }, font: 'body', size: 40, box: { w: 120, h: 56 }, widest: '8' }, at: { pos: [24, 40, 0] } });
  channels['show_score'] = shownOver('score', 3.5, null);
  items.push(logicItem(QUIZ.logic, program, [...QUIZ.questions], { score: { type: 'f64' } }, k++));
  return doc2d(DOC.quiz, 'A quiz of three questions', 'film', QUIZ.size, items, {
    requires: { modules: { logic: '^1' } },
    transport: { span: '4.1s', frame_rate: QUIZ.rate, sample_rate: 48_000 },
    controls,
    markers: {
      ask1: { kind: 'stage', name: 'First question', t: '1s', waits_for: 'q1' },
      ask2: { kind: 'stage', name: 'Second question', t: '2s', waits_for: 'q2' },
      ask3: { kind: 'stage', name: 'Last question', t: '3s', waits_for: 'q3' },
      end: { kind: 'stage', name: 'The score', t: '4s' },
    },
    data: { right: { value: 0, source: 'quiz' } },
    drivers: { right: { target: 'data/right', expr: 's', vars: { s: `${QUIZ.logic}.score` } } },
    channels,
    assets: { scorer_program: programAsset(program) },
  });
}
/** The answers' input track: each question answered 0.5 s after the timeline reaches it (on the clock: 1.5, 3.0, 4.5 s;
 * #169's). */
export const answersTrack = (a: readonly string[]): JsonObject[] => [entry(1.5, 'q1', a[0]!), entry(3.0, 'q2', a[1]!), entry(4.5, 'q3', a[2]!)];
export const QUIZ_PATHS: string[][] = QUIZ.options.flatMap((a) => QUIZ.options.flatMap((b) => QUIZ.options.map((c) => [a, b, c])));
export const pathName = (a: readonly string[]): string => `q1=${a[0]} q2=${a[1]} q3=${a[2]}`;

// The flip counter (criteria 2 and 7): a 2D figure, 320 × 180 at 30 fps, 10.5 s. A toggle `lever` (a switch, default
// off, key f) whose lamp fades in or out over 0.5 s as it flips; the logic item `tally` reads the lever and counts its
// entries in its f64 array `count`; a bar a driver moves 2.8 px right per flip. Its tour flips the lever five times
// (on, off, on, off, on), once, with no pointer. Every flip makes a new state, so the piece is past the page's caps.

export const FLIPS = { size: [320, 180] as Size, rate: [30, 1] as Rate, logic: 'tally', control: 'lever', tourFlips: 5, scripted: 100, span: 10.5 };
export function flipsDoc(evidence: string): JsonObject {
  const program = countProgram(FLIPS.control, 'count');
  putEvidence(evidence, program.bytes);
  const keys = Array.from({ length: FLIPS.tourFlips }, (_, i) => [0.5 + i, i % 2 === 0, 'hold']);
  return doc2d(DOC.flips, 'A lever that counts its flips', 'figure', FLIPS.size, [
    rect2d('lamp', [140, 24, 40, 40], 'accent', 3, { role: 'part' }),
    rect2d('bar', [0, 80, 10, 24], 'session_readout', 4, { role: 'part' }),
    logicItem(FLIPS.logic, program, [FLIPS.control], { count: { type: 'f64' } }, 5),
  ], {
    requires: { modules: { logic: '^1' } },
    transport: { span: `${FLIPS.span}s`, frame_rate: FLIPS.rate },
    controls: { [FLIPS.control]: { kind: 'toggle', class: 'document', label: 'Lever', role: 'switch', default: false, keys: { f: 'toggle' } } },
    channels: { fade: { target: 'items/lamp/adjust/opacity', type: 'f32', mode: 'follow', follow: { source: `controls/${FLIPS.control}/value`, model: { transition: { span: '0.5s', interp: 'linear' } } } } },
    drivers: { slide: { target: 'items/bar/at/pos/0', expr: '20 + 2.8 * c', vars: { c: `${FLIPS.logic}.count` } } },
    tour: { keys: { [FLIPS.control]: keys }, loop: false, pointer: { show: false } },
    assets: { tally_program: programAsset(program) },
  });
}
/** The app's path to k flips (README: The app's side): flips at 0.5 s apart from 0.5 s, on, off, on …; its still at 4 s,
 * where every fade has ended. */
export const flipsTrack = (k: number): JsonObject[] => Array.from({ length: k }, (_, i) => entry(0.5 + 0.5 * i, FLIPS.control, i % 2 === 0, 0));
/** The scripted track of 100 flips: one every 6 steps, at steps 6, 12, … 600. */
export const FLIP_STEP = 6;
export const scriptedFlips = (): JsonObject[] => Array.from({ length: FLIPS.scripted }, (_, i) => stepEntry(FLIP_STEP * (i + 1), FLIPS.control, i % 2 === 0));

// The game (criteria 4 and 10): a tapping game. A 2D figure, 320 × 180 at 30 fps, 6 s: a press `tap` (key t); the logic
// item `rules` counts the taps in its f64 `score`; a bar a driver moves 40 px a tap toward a goal line, and a win lamp
// that lights from the third tap. Its tour taps three times. Every tap makes a new state: past the page's caps.

export const GAME = { size: [320, 180] as Size, rate: [30, 1] as Rate, logic: 'rules', control: 'tap', tourTaps: 3, span: 6 };
export function gameDoc(evidence: string): JsonObject {
  const program = countProgram(GAME.control, 'score');
  putEvidence(evidence, program.bytes);
  return doc2d(DOC.game, 'Tap to the line', 'figure', GAME.size, [
    rect2d('line', [150, 40, 4, 60], 'ink', 3, { role: 'part' }),
    rect2d('runner', [0, 60, 16, 20], 'accent', 4, { role: 'part' }),
    rect2d('win', [250, 20, 40, 40], 'session_readout', 5, { role: 'part' }),
    logicItem(GAME.logic, program, [GAME.control], { score: { type: 'f64' } }, 6),
  ], {
    requires: { modules: { input: '^1', logic: '^1' } },
    transport: { span: `${GAME.span}s`, frame_rate: GAME.rate },
    controls: { [GAME.control]: press('Tap', 't') },
    drivers: {
      run: { target: 'items/runner/at/pos/0', expr: '20 + 40 * s', vars: { s: `${GAME.logic}.score` } },
      lit: { target: 'items/win/adjust/opacity', expr: 'clamp(s - 2, 0, 1)', vars: { s: `${GAME.logic}.score` } },
    },
    tour: { keys: { [GAME.control]: Array.from({ length: GAME.tourTaps }, (_, i) => [0.5 + i, 1, 'hold']) }, loop: false, pointer: { show: false } },
    assets: { rules_program: programAsset(program) },
  });
}
/** The game's recorded track: taps at 0.5, 1.5, 2.5 and 3.5 s. */
export const gameTrack = (): JsonObject[] => [0.5, 1.5, 2.5, 3.5].map((s) => entry(s, GAME.control, 1));

// AC8's piece: a 2D figure, 320 × 180 at 30 fps, 3 s. Momentary buttons A and B (`btn_a`, `btn_b`) and `reveal`, each a press (keys a,
// b, r); the logic item `mem` (memoryProgram) keeps a private flag and writes only `shown`; two marks show which: `say_a`
// at the left while shown is 1, `say_b` at the right while it is 2.

export const MEMORY = { size: [320, 180] as Size, rate: [30, 1] as Rate, logic: 'mem' };
export function memoryDoc(evidence: string): JsonObject {
  const program = memoryProgram();
  putEvidence(evidence, program.bytes);
  const shownAs = (v: number): JsonObject => ({ expr: `max(0, 1 - abs(s - ${v}))`, vars: { s: `${MEMORY.logic}.shown` } });
  return doc2d(DOC.memory, 'A flag kept in memory', 'figure', MEMORY.size, [
    rect2d('say_a', [40, 40, 60, 60], 'accent', 3, { role: 'part' }),
    rect2d('say_b', [220, 40, 60, 60], 'session_readout', 4, { role: 'part' }),
    logicItem(MEMORY.logic, program, ['btn_a', 'btn_b', 'reveal'], { shown: { type: 'f64' } }, 5),
  ], {
    requires: { modules: { input: '^1', logic: '^1' } },
    transport: { span: '3s', frame_rate: MEMORY.rate },
    controls: { btn_a: press('A', 'a'), btn_b: press('B', 'b'), reveal: press('Reveal', 'r') },
    drivers: { a_shown: { target: 'items/say_a/adjust/opacity', ...shownAs(1) }, b_shown: { target: 'items/say_b/adjust/opacity', ...shownAs(2) } },
    assets: { mem_program: programAsset(program) },
  });
}
/** The app's paths (README: The app's side): a button pressed at 0.5 s and released at 1.0 s, reveal pressed at 1.5 s;
 * the stills at 2.5 s. */
export const pressAndRelease = (b: string): JsonObject[] => [entry(0.5, b, 1), entry(1.0, b, 0)];
export const REVEAL = entry(1.5, 'reveal', 1);

/** A scene document (172's sceneDoc with this suite's IDs): items by ID, each given its `id`, `name` and `order`. */
function scene(id: string, title: string, profile: string, span: string, rate: Rate, size: Size, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile, title, description: `${title}: a piece the #1040 acceptance tests export.`, size, camera: 'cam', seed: 1040,
    transport: { span, frame_rate: rate }, ...extra, items: withIds,
  };
}
const perspective = (position: V3, target: V3, fov = 40): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov } });
const box3 = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });

// The lab (criteria 3 and 5): a 3D scene, 640 × 360 at 30 fps, 6 s. The world `field` (60 Hz, 4 substeps): a puck, a
// 0.2 m block of 0.43 kg, on turf, sliding off at 3 m/s along x on each entry of the press `kick` (a launch derived from
// the control, #522's form), its pose an output to the scene's `puck`, a checkpoint every 60 steps. A goal behind it,
// cut by the cutaway `cut` (cutaway@1, class document: past x = 3 m nothing of it draws); a poster behind everything,
// a slab whose material's base color map is a PNG (the texture); a 3D label in the body face (so the bundle holds a
// font). Its tour kicks twice; its recorded track kicks at 0.5 and 2.5 s. Every kick moves the puck on, so the piece is
// past the page's caps and its fallback is a page of its tour.

export const LAB = { size: [640, 360] as Size, rate: [30, 1] as Rate, world: 'field', steps: 360, span: 6, textured: 'poster' };
export function labDoc(evidence: string): { doc: JsonObject; texture: string } {
  const texture = putEvidence(evidence, solidPng(256, 256, [180, 120, 60]));
  const field = world60({
    seed: 1040,
    contact_materials: { turf: { friction: 0.8, restitution: 0, density: 1000 }, rubber: { friction: 0.8, restitution: 0, density: 1000 } },
    shapes: { floor: { kind: 'box', half: [30, 0.1, 30] }, puck: { kind: 'box', half: [0.1, 0.1, 0.1] } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'turf' }], pose: { pos: [0, -0.1, 0] } },
      puck: { kind: 'dynamic', shapes: [{ shape: 'puck', contact_material: 'rubber' }], pose: { pos: [0, 0.1, 0] }, mass: 0.43 },
    },
    checkpoint: { every: 60 },
    inputs: { kick: { kind: 'launch', targets: ['puck'], on: { control: 'kick', each: 'entry' }, data: { linear: [3, 0, 0] } } },
    outputs: { puck: { from: 'puck', read: 'pose', to: 'items/puck/at' } },
  });
  const doc = scene(DOC.lab, 'A lab with a cutaway', 'scene', `${LAB.span}s`, LAB.rate, LAB.size, {
    cam: perspective([1.5, 2, 6], [1.5, 0.4, 0]),
    puck: box3([0.2, 0.2, 0.2], [0, 0.1, 0]),
    goal: box3([0.4, 1.2, 1.6], [3, 0.6, 0]),
    cut: { kind: 'cutaway@1', params: { planes: [{ normal: [1, 0, 0], offset: 3 }], class: 'document' } },
    poster_mat: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], maps: { base_color: texture } } },
    [LAB.textured]: { kind: 'slab@1', params: { size: [6, 3, 0.05], uv0: { planar: { axis: 'z' } }, uv_scale: 1 }, material: 'poster_mat', at: { pos: [1.5, 0, -1.5], rot: [90, 0, 0] } },
    label: { kind: 'mark.text@1', params: { text: 'Goal', size: 16, font: 'body', paint: { fill: { role: 'ink' } } }, at: { pos: [3, 1.5, 0] } },
  }, {
    requires: { modules: { scene3d: '^1' } },
    controls: { kick: press('Kick', 'k') },
    worlds: { [LAB.world]: field },
    tour: { keys: { kick: [[0.5, 1, 'hold'], [2.5, 1, 'hold']] }, loop: false, pointer: { show: false } },
    assets: { poster_map: { sha256: texture, license: LICENSE } },
  });
  return { doc, texture };
}
/** The lab's recorded input track: kicks at 0.5 and 2.5 s. */
export const labTrack = (): JsonObject[] => [entry(0.5, 'kick', 1), entry(2.5, 'kick', 1)];

// The maps pieces (criterion 6): a 3D scene, 480 × 270 at 30 fps, 2 s: a slab under a material of four UASTC KTX2 maps
// of `size` px, each with its full mip chain (#423's writer): base color and emission tagged sRGB, metallic-roughness
// and a normal map linear. Four 2,048 px maps take about 89.5 MB decoded and 22.4 MB in block bytes, against the 64 MB
// decoded-image cap; four 1,024 px maps take about 22.4 MB decoded.

const MAP_ROLES = ['base_color', 'emission', 'metallic_roughness', 'normal'] as const;
const MAP_COLORS: Record<(typeof MAP_ROLES)[number], [number, number, number, number]> = {
  base_color: [200, 120, 60, 255], emission: [40, 40, 10, 255], metallic_roughness: [255, 140, 30, 255], normal: [140, 120, 250, 255],
};
export function mapsDoc(evidence: string, size: 2048 | 1024): JsonObject {
  const sha: Record<string, string> = {};
  for (const role of MAP_ROLES) sha[role] = putEvidence(evidence, ktx2Uastc(size, MAP_COLORS[role], role === 'base_color' || role === 'emission' ? 'srgb' : 'linear'));
  const assets: JsonObject = {};
  for (const role of MAP_ROLES) assets[`${role}_map`] = { sha256: sha[role]!, license: LICENSE };
  return scene(size === 2048 ? DOC.maps : DOC.small, `Four ${size} px maps`, 'scene', '2s', [30, 1], [480, 270], {
    cam: perspective([0, 1, 4], [0, 1, 0]),
    tile_mat: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], maps: { base_color: sha['base_color']!, metallic_roughness: sha['metallic_roughness']!, emission: sha['emission']! }, normal_map: sha['normal']! } },
    tile: { kind: 'slab@1', params: { size: [3, 2, 0.05], uv0: { planar: { axis: 'z' } }, uv_scale: 1 }, material: 'tile_mat', at: { pos: [0, 0, 0], rot: [90, 0, 0] } },
    floor: box3([8, 0.1, 8], [0, -0.05, 0]),
  }, { requires: { modules: { scene3d: '^1' } }, assets });
}

// AC9's piece: a 3D film, 480 × 360 at 30 fps, 1.4 s, in present mode. The world `drop_world` (60 Hz): a ball (0.11 m, 0.43 kg)
// at rest on the floor inside a chimney, an opaque box 1 × 4 × 1 m that hides it until it rises past 3.9 m; the launch
// `throw` on each entry of the choice `pick` sends it up at 1 + 10 × pick m/s (Control: a choice reads as its option's
// index: soft 1 m/s, hard 11 m/s). Stage `aim` (0.1 s) waits for pick, `look` (0.45 s) for the choice `go`, `after`
// (1.0 s) ends it. At `look` the soft ball has landed and rests, the hard one still rises inside the chimney: the same
// picture at the same step; at `after` the hard ball shows above the chimney.

/** Every surface is unlit (Material: `unlit`), each its own flat color: at the base a hidden ball that moves still changed
 * the lit frame around it (572 pixels at `look`, by up to 11 code values), and an unlit surface takes no light. */
const DROP_COLORS: Record<string, V3> = { ground: [0.25, 0.3, 0.2], left: [0.5, 0.35, 0.2], right: [0.2, 0.35, 0.5], chimney: [0.45, 0.45, 0.5], ball: [0.9, 0.2, 0.1] };
export const DROP = { size: [480, 360] as Size, rate: [30, 1] as Rate, world: 'drop_world' };
export function dropDoc(): JsonObject {
  const world = world60({
    seed: 1040,
    contact_materials: { clay: { friction: 0.9, restitution: 0, density: 1000 } },
    shapes: { floor: { kind: 'box', half: [10, 0.1, 10] }, ball: { kind: 'sphere', radius: 0.11 } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'clay' }], pose: { pos: [0, -0.1, 0] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'clay' }], pose: { pos: [0, 0.11, 0] }, mass: 0.43 },
    },
    checkpoint: { every: 6 },
    inputs: { throw: { kind: 'launch', targets: ['ball'], on: { control: 'pick', each: 'entry' }, data: { linear: 'vec3(0, 1 + 10 * pick, 0)' } } },
    outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } },
  });
  return scene(DOC.drop, 'Two launches up a chimney', 'film', '1.4s', DROP.rate, DROP.size, {
    cam: perspective([0, 3.5, 10], [0, 3.5, 0], 45),
    ...Object.fromEntries(Object.entries(DROP_COLORS).map(([id, c]) => [`${id}_mat`, { kind: 'material@1', params: { base_color: [...c, 1], unlit: true } }])),
    ground: box3([12, 0.1, 12], [0, -0.05, 0], { material: 'ground_mat' }),
    left: box3([1, 6, 1], [-3, 3, -2], { material: 'left_mat' }),
    right: box3([1, 2, 1], [3, 1, -2], { material: 'right_mat' }),
    chimney: box3([1, 4, 1], [0, 2, 0], { material: 'chimney_mat' }),
    ball: { kind: 'mark.sphere@1', params: { size: [0.22, 0.22, 0.22] }, at: { pos: [0, 0.11, 0] }, material: 'ball_mat' },
  }, {
    requires: { modules: { scene3d: '^1' } },
    controls: {
      pick: { kind: 'choice', class: 'document', label: 'Launch', role: 'radiogroup', options: ['soft', 'hard'] },
      go: { kind: 'choice', class: 'document', label: 'Go on', role: 'radiogroup', options: ['on'] },
    },
    markers: {
      aim: { kind: 'stage', name: 'Aim', t: '0.1s', waits_for: 'pick' },
      look: { kind: 'stage', name: 'Look', t: '0.45s', waits_for: 'go' },
      after: { kind: 'stage', name: 'After', t: '1s' },
    },
    worlds: { [DROP.world]: world },
  });
}

// ---------------------------------------------------------------------------------------------------
// The web export (#172's call; README: The receipt) and the bundle

interface WebReceipt {
  fallback: JsonValue; gpu_needs: GpuNeeds; player: string; files: { path: string; sha256: string; raw: JsonObject }[]; raw: JsonObject;
}
const strings = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
/** A delivered bundle's receipt; any other outcome fails here, naming it. */
export function webReceipt(reply: JsonObject | undefined, what: string): WebReceipt {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is exported: ${show(r, 3000)}`).toBe('exported');
  const receipt = obj(r['receipt'], `${what}: receipt`);
  const needs = obj(receipt['gpu_needs'], `${what}: receipt.gpu_needs`);
  const limits = obj(needs['limits'], `${what}: receipt.gpu_needs.limits`);
  const files = arr(receipt['files'], `${what}: receipt.files`).map((v, i) => {
    const f = obj(v, `${what}: receipt.files[${i}]`);
    return { path: str(f['path'], `${what}: receipt.files[${i}].path`), sha256: hex64(f['sha256'], `${what}: receipt.files[${i}].sha256`), raw: f };
  });
  return {
    fallback: receipt['fallback'] ?? null,
    gpu_needs: {
      features: strings(needs['features'], `${what}: receipt.gpu_needs.features`),
      any_of: arr(needs['any_of'], `${what}: receipt.gpu_needs.any_of`).map((s, i) => strings(s, `${what}: receipt.gpu_needs.any_of[${i}]`)),
      limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, int(v, `${what}: receipt.gpu_needs.limits.${k}`)])),
    },
    player: hex64(obj(receipt['player'], `${what}: receipt.player`)['hash'], `${what}: receipt.player.hash`),
    files, raw: receipt,
  };
}
/** One `deep-show run`: the document shown, then its web export into `out` (`planted` the scenario's key). */
export function exportWeb(bin: string, evidence: string, document: JsonObject, out: string, what: string, o: { track?: JsonObject[]; planted?: string } = {}): JsonObject {
  const doc = String(document['id']);
  const [reply] = withDoc(bin, evidence, document, [webExport(doc, out, o.track ? { track: o.track } : {})], what, o.planted);
  return reply!;
}
/** The bundle against its receipt: every file the receipt names is there with its SHA-256, every file there is named,
 * the index page is there, and the player is one of the files. Each failure names the file. */
export function bundleFailures(out: string, receipt: WebReceipt, what: string): string[] {
  const f: string[] = [];
  const disk = filesUnder(out);
  const named = new Map(receipt.files.map((x) => [x.path, x.sha256]));
  for (const [path, want] of named) {
    const bytes = disk.get(path);
    if (!bytes) f.push(`${what}: ${path} is named by the receipt but not in the bundle`);
    else if (sha256(bytes) !== want) f.push(`${what}: ${path} hashes to ${sha256(bytes)}, the receipt names ${want}`);
  }
  for (const path of disk.keys()) if (!named.has(path)) f.push(`${what}: ${path} is in the bundle but the receipt doesn't name it`);
  if (!disk.has('index.html')) f.push(`${what}: the bundle has no index.html`);
  if (!receipt.files.some((x) => x.sha256 === receipt.player)) f.push(`${what}: the player ${receipt.player} is not one of the receipt's files`);
  return f;
}
/** Every bundle file the bundle's index page names (a quoted relative path whose file name is a SHA-256 and an
 * extension, as every bundle file but the index page is stored; a face's own file name in its font list is no path) is a
 * receipt file, there with its hash. Each failure names the file. */
export function indexFailures(out: string, receipt: WebReceipt, what: string): string[] {
  const index = readFileSync(join(out, 'index.html'), 'utf8');
  const byPath = new Map(receipt.files.map((f) => [f.path, f.sha256]));
  const f: string[] = [];
  const named = new Set([...index.matchAll(/["'](?:\.\/)?((?:[\w-]+\/)*[0-9a-f]{64}\.[a-z0-9]+)["']/g)].map(([, p]) => p!));
  for (const path of named) {
    const want = byPath.get(path);
    if (want === undefined) f.push(`${what}: the index page names ${path}, which the receipt doesn't list`);
    else if (!existsSync(join(out, path)) || sha256(readFileSync(join(out, path))) !== want) f.push(`${what}: ${path}, which the index page names, isn't in the bundle with its hash ${want}`);
  }
  if (!named.size) f.push(`${what}: the index page names no file`);
  return f;
}
/** The path of the bundle's player file (the receipt's player hash). */
function playerPath(receipt: WebReceipt): string | null {
  return receipt.files.find((x) => x.sha256 === receipt.player)?.path ?? null;
}
export const copyBundle = (out: string, to: string): string => { cpSync(out, to, { recursive: true }); return to; };

// The fallback page inside the bundle (README: The fallback page, chosen): the receipt marks its index page with
// `fallback: "index"` and its manifest, #169's, with `fallback: "manifest"`; each path its manifest or index page names
// is relative to the folder its index page sits in.

export interface PState { id: string; controls: JsonObject; marker: string | null; still: string; t: number | null; track: JsonValue[] | null; raw: JsonObject }
interface PEdge { id: string; from: string; to: string; control: string; value: JsonValue; clip: string | null; span: number | null; raw: JsonObject }
interface PManifest { start: string; states: PState[]; byId: Map<string, PState>; edges: PEdge[] }
/** #169's manifest at `file`, read strictly (`{start, states: [{id, controls, marker, still}], edges: [{from, to,
 * control, value}]}`), with the fields the base's page writes beside them read where present: a state's `t` and
 * `track`, an edge's `clip` and `span`. */
function manifestAt(file: string, what: string): PManifest {
  expect(existsSync(file), `${what}: the manifest ${file} is there`).toBe(true);
  let raw: JsonValue;
  try { raw = JSON.parse(readFileSync(file, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${what}: the manifest is not JSON: ${(e as Error).message}`); }
  const m = obj(raw, `${what}: manifest`);
  const states = arr(m['states'], `${what}: manifest.states`).map((v, i): PState => {
    const s = obj(v, `${what}: manifest.states[${i}]`);
    const marker = s['marker'];
    return {
      id: str(s['id'], `${what}: manifest.states[${i}].id`), controls: obj(s['controls'], `${what}: manifest.states[${i}].controls`),
      marker: typeof marker === 'string' ? marker : null, still: str(s['still'], `${what}: manifest.states[${i}].still`),
      t: typeof s['t'] === 'number' ? s['t'] : null, track: Array.isArray(s['track']) ? s['track'] : null, raw: s,
    };
  });
  const byId = new Map(states.map((s) => [s.id, s]));
  expect(byId.size, `${what}: each state's id is its own`).toBe(states.length);
  const start = str(m['start'], `${what}: manifest.start`);
  expect(byId.has(start), `${what}: manifest.start names a state`).toBe(true);
  const edges = arr(m['edges'], `${what}: manifest.edges`).map((v, i): PEdge => {
    const e = obj(v, `${what}: manifest.edges[${i}]`);
    const edge: PEdge = {
      id: typeof e['id'] === 'string' ? e['id'] : `edge ${i}`, from: str(e['from'], `${what}: manifest.edges[${i}].from`), to: str(e['to'], `${what}: manifest.edges[${i}].to`),
      control: str(e['control'], `${what}: manifest.edges[${i}].control`), value: e['value'] ?? null,
      clip: typeof e['clip'] === 'string' ? e['clip'] : null, span: typeof e['span'] === 'number' ? e['span'] : null, raw: e,
    };
    expect(byId.has(edge.from) && byId.has(edge.to), `${what}: manifest.edges[${i}] joins two of its states: ${show(e)}`).toBe(true);
    return edge;
  });
  return { start, states, byId, edges };
}
interface Fallback { index: string; dir: string; manifest: PManifest; manifestPath: string }
/** The fallback page the receipt marks in the bundle at `out`: its index page's path, the folder paths resolve in,
 * and its manifest. */
export function fallbackOf(out: string, receipt: WebReceipt, what: string): Fallback {
  const marked = (role: string): string => {
    const files = receipt.files.filter((f) => f.raw['fallback'] === role);
    expect(files.length, `${what}: the receipt marks exactly one file as the fallback page's ${role} (fallback: "${role}"); it marks ${files.map((f) => f.path).join(', ') || 'none'}`).toBe(1);
    return files[0]!.path;
  };
  const index = marked('index');
  const manifestPath = marked('manifest');
  return { index, dir: dirname(index) === '.' ? '' : dirname(index), manifest: manifestAt(join(out, manifestPath), `${what}: the fallback page's manifest`), manifestPath };
}
/** A path the fallback page names, as a bundle path. */
const inFallback = (fb: Fallback, path: string): string => (fb.dir ? `${fb.dir}/${path}` : path).split('/').filter((p) => p !== '.').join('/');
/** Every file the fallback page names: each state's still (and loop), each edge's clip, and every file its index page
 * names in a `src` or `href`; each must be a receipt file with its hash, in the bundle. */
export function fallbackFileFailures(out: string, receipt: WebReceipt, fb: Fallback, what: string): string[] {
  const named = new Set<string>();
  for (const s of fb.manifest.states) {
    named.add(s.still);
    if (typeof s.raw['loop'] === 'string') named.add(s.raw['loop']);
  }
  for (const e of fb.manifest.edges) if (e.clip) named.add(e.clip);
  const index = readFileSync(join(out, fb.index), 'utf8');
  for (const [, ref] of index.matchAll(/\b(?:src|href)\s*=\s*"([^"#?]+)"/g)) if (ref && !/^[a-z]+:/i.test(ref)) named.add(ref.replace(/^\.\//, ''));
  const byPath = new Map(receipt.files.map((f) => [f.path, f.sha256]));
  const f: string[] = [];
  for (const ref of named) {
    const path = inFallback(fb, ref);
    const want = byPath.get(path);
    if (want === undefined) { f.push(`${what}: the fallback page names ${ref}, which the receipt doesn't list`); continue; }
    const file = join(out, path);
    if (!existsSync(file)) f.push(`${what}: the fallback page names ${ref}, which the bundle doesn't hold`);
    else if (sha256(readFileSync(file)) !== want) f.push(`${what}: ${ref} in the bundle doesn't match its hash ${want}`);
  }
  return f;
}
/** A state's still, decoded, as the raw frame hash (BLAKE3 of BGRA8 rows top-down: Export's hash). */
export const fallbackStill = (out: string, fb: Fallback, s: PState, what: string): string => stillHash(join(out, fb.dir), s.still, what);

/** The chain a tour page holds (README: The tour page): from its start, each state's one edge to the next, in order. */
export function tourChain(m: PManifest, what: string): { states: PState[]; edges: PEdge[]; failures: string[] } {
  const failures: string[] = [];
  const states = [m.byId.get(m.start)!];
  const edges: PEdge[] = [];
  for (let guard = 0; guard <= m.states.length; guard++) {
    const out = m.edges.filter((e) => e.from === states[states.length - 1]!.id);
    if (out.length === 0) break;
    if (out.length > 1) { failures.push(`${what}: state ${states[states.length - 1]!.id} has ${out.length} edges; a tour page goes on one way`); break; }
    edges.push(out[0]!);
    const next = m.byId.get(out[0]!.to)!;
    if (states.includes(next)) { failures.push(`${what}: the tour comes back to ${next.id}`); break; }
    states.push(next);
  }
  if (states.length !== m.states.length) failures.push(`${what}: the manifest holds ${m.states.length} states, the tour's chain from ${m.start} reaches ${states.length}`);
  return { states, edges, failures };
}

// ---------------------------------------------------------------------------------------------------
// The page export (#169's call) and its manifest

export function exportPage(bin: string, evidence: string, document: JsonObject, out: string, o: { size: Size; rate: Rate }, what: string, planted?: string): JsonObject {
  const doc = String(document['id']);
  const [reply] = withDoc(bin, evidence, document, [pageExport(doc, out, { size: o.size, rate: o.rate })], what, planted);
  return reply!;
}
export function pageExported(reply: JsonObject, out: string, what: string): PManifest {
  expect(reply['outcome'], `${what} is exported: ${show(reply, 2000)}`).toBe('exported');
  return manifestAt(join(out, 'manifest.json'), what);
}
/** The state the edge on `control` (with `value`, or any) from `from` reaches, or null. */
export function follow(m: PManifest, from: string, control: string, value?: JsonValue): string | null {
  const e = m.edges.find((x) => x.from === from && x.control === control && (value === undefined || same(x.value, value)));
  return e ? e.to : null;
}
/** A momentary button's press then release from `from` (README: Momentary buttons): the edges on `control` followed
 * until the controls are `from`'s again, at most two; null when there is none. */
export function pressThenRelease(m: PManifest, from: string, control: string): { pressed: string; released: string } | null {
  const pressed = follow(m, from, control);
  if (pressed === null) return null;
  if (same(m.byId.get(pressed)!.controls, m.byId.get(from)!.controls)) return { pressed, released: pressed };
  const released = follow(m, pressed, control);
  return released === null ? null : { pressed, released };
}

// ---------------------------------------------------------------------------------------------------
// The app's side (README: The app's side)

/** The app's own still of each path: #501's png_seq still export on #544's input track, by its receipt's raw frame
 * hash (as #169's suite takes it), all in one run. */
export function appStills(bin: string, evidence: string, document: JsonObject, paths: { name: string; track: JsonObject[]; range: JsonValue }[], o: { size: Size; rate: Rate }, dir: string, what: string): Map<string, string> {
  const doc = String(document['id']);
  const calls = paths.map((p, i): JsonObject => ({ call: 'export', doc, out: join(dir, `app-${i}`), video: { codec: 'png_seq' }, size: o.size, frame_rate: o.rate, track: p.track, range: p.range }));
  const r = withDoc(bin, evidence, document, calls, `${what}: the app's stills`);
  return new Map(paths.map((p, i) => {
    const reply = obj(r[i], `${what}: the app's still of ${p.name}`);
    expect(reply['outcome'], `${what}: the app's still at the end of ${p.name} is exported: ${show(reply, 1500)}`).toBe('exported');
    const hashes = arr(obj(reply['receipt'], `${what}: receipt`)['frame_hashes'], `${what}: receipt.frame_hashes`);
    expect(hashes.length, `${what}: the app's still of ${p.name} is one frame`).toBe(1);
    return [p.name, hex64(hashes[0], `${what}: the app's still of ${p.name}: frame_hashes[0]`)];
  }));
}
interface Checkpoint { step: number; hash: string }
interface AppLogic { hashes: string[]; checkpoints: Checkpoint[] }
/** The app's run of a logic item: deep-show's `logic` call (#532's, #172's form) on `track` over `steps` steps: its step
 * hash after each step (index k: after step k) and its checkpoints with their full-state hashes (`deep_hash`). */
export function appLogic(bin: string, evidence: string, document: JsonObject, item: string, track: JsonObject[], steps: number, what: string): AppLogic {
  const doc = String(document['id']);
  const [reply] = withDoc(bin, evidence, document, [{ call: 'logic', doc, steps, track }], `${what}: the app's logic`);
  const logic = obj(reply, `${what}: logic`);
  expect(logic['code'], `${what}: the logic call answers, not refuses: ${show(logic)}`).toBeUndefined();
  const rows = arr(logic['steps'], `${what}: logic.steps`).map((v, i) => obj(v, `${what}: logic.steps[${i}]`));
  expect(rows.length, `${what}: the logic replay runs ${steps} steps`).toBe(steps);
  const hashes = rows.map((row, i) => str(obj(row['hash'], `${what}: logic.steps[${i}].hash`)[item], `${what}: logic.steps[${i}].hash.${item}`));
  const checkpoints = arr(obj(logic['checkpoints'], `${what}: logic.checkpoints`)[item], `${what}: logic.checkpoints.${item}`)
    .map((v, i) => { const c = obj(v, `${what}: logic.checkpoints.${item}[${i}]`); return { step: int(c['step'], `${what}: its step`), hash: str(c['deep_hash'], `${what}: its deep_hash`) }; });
  return { hashes, checkpoints };
}
/** The world's step hashes from deep-show's `physics_bake` (#522's form): index k the state after k steps. */
export function appWorld(bin: string, evidence: string, document: JsonObject, world: string, track: JsonObject[], what: string): string[] {
  const doc = String(document['id']);
  const [reply] = withDoc(bin, evidence, document, [{ call: 'physics_bake', doc, world, track }], `${what}: the app's world`);
  const baked = obj(reply, `${what}: physics_bake`);
  expect(baked['ok'], `${what}: physics_bake answers the world's bake: ${show(baked)}`).toBe(true);
  return strings(baked['step_hashes'], `${what}: physics_bake.step_hashes`);
}
/** The app's input track as the hub holds it, by its hash: the `track` call (#1164's) loading `entries` whole. */
export function appTrackHash(bin: string, evidence: string, document: JsonObject, entries: JsonObject[], what: string): string {
  const doc = String(document['id']);
  const [reply] = withDoc(bin, evidence, document, [{ call: 'track', doc, load: entries }], `${what}: the app's track`);
  return hex64(obj(reply, `${what}: track`)['hash'], `${what}: track.hash`);
}

/** BT.709 luma in 8-bit limited range of a pixel's coded R′G′B′ (the plane an H.264 delivery's luma holds). */
const luma = (r: number, g: number, b: number): number => 16 + (219 * (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
/** PSNR of two luma planes of equal size, in dB (Infinity when equal). */
function psnr(a: Float64Array | Uint8Array, b: Float64Array | Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; sum += d * d; }
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / a.length));
}
/** export.fidelity's floor at `video.quality: standard` (Export: PSNR-Y 35 dB). */
const FIDELITY_FLOOR_DB = 35;
/** One clip of a fallback page decoded from the bundle's bytes by the app's decode worker (#498's `media_decode`, I420),
 * against the app's own frames of its play (a png_seq export of the edge's span on the play's track): exactly its
 * frames and, where it has sound, exactly its sample frames per channel, and every frame's luma within export.fidelity's
 * floor of the app's frame. Each failure names the clip. */
export function clipFailures(bin: string, evidence: string, document: JsonObject, out: string, fb: Fallback, edge: PEdge, rate: Rate, sampleRate: number, dir: string, what: string): string[] {
  const where = `${what}: the clip ${edge.clip} of ${edge.from} → ${edge.to}`;
  const from = fb.manifest.byId.get(edge.from)!; const to = fb.manifest.byId.get(edge.to)!;
  if (from.t === null || to.t === null || to.track === null) return [`${where}: the manifest gives no clock (t) or track for its states, so the app's frames of its play can't be drawn`];
  const frame = (FLICKS * rate[1]) / rate[0];
  const first = Math.round(from.t / frame); const last = Math.round(to.t / frame);
  const frames = last - first;
  const decodedDir = join(dir, `decoded-${edge.id}`); const appDir = join(dir, `app-${edge.id}`);
  const doc = String(document['id']);
  const r = withDoc(bin, evidence, document, [
    mediaDecode(join(out, inFallback(fb, edge.clip!)), decodedDir, { format: 'yuv' }),
    { call: 'export', doc, out: appDir, video: { codec: 'png_seq' }, frame_rate: rate, track: to.track as JsonObject[], range: [`${first}f`, `${last}f`] },
  ], `${where}: decoded and redrawn`);
  const decoded = decodedOf(r[0]!, decodedDir, `${where}: media_decode`);
  const f: string[] = [];
  const video = decoded.video[0];
  if (!video) return [`${where}: decodes to no video stream`];
  if (video.frames.length !== frames) f.push(`${where}: decodes to ${video.frames.length} frames; its span from ${from.t} to ${to.t} flicks holds ${frames} at ${rate[0]}/${rate[1]} fps`);
  for (const a of decoded.audio) {
    const want = Math.round(((to.t - from.t) / FLICKS) * sampleRate);
    if (a.samples !== want) f.push(`${where}: decodes to ${a.samples} sample frames per channel, not ${want}`);
  }
  const app = obj(r[1], `${where}: the app's frames`);
  if (app['outcome'] !== 'exported') return [...f, `${where}: the app's frames of its play aren't drawn: ${show(app, 600)}`];
  const pngs = pngFrames(appDir, `${where}: the app's frames`);
  const [w, h] = video.size;
  for (let k = 0; k < Math.min(pngs.length, video.frames.length); k++) {
    const img = decodePng(pngs[k]!);
    if (img.width !== w || img.height !== h) { f.push(`${where}: frame ${k} is ${w} × ${h}, the app's ${img.width} × ${img.height}`); continue; }
    const y = readFileSync(video.frames[k]!.file).subarray(0, w * h);
    const ref = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) ref[i] = luma(img.rgba[4 * i]!, img.rgba[4 * i + 1]!, img.rgba[4 * i + 2]!);
    const db = psnr(new Float64Array(y), ref);
    if (db < FIDELITY_FLOOR_DB) f.push(`${where}: frame ${k}'s luma is ${db.toFixed(2)} dB from the app's frame, under export.fidelity's ${FIDELITY_FLOOR_DB} dB`);
  }
  if (pngs.length !== frames) f.push(`${where}: the app draws ${pngs.length} frames over the span, not ${frames}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// A bundle served over HTTP (README: The server), as #172's: a child process of its own, since `deep-show run` under
// spawnSync blocks this process's event loop; no cross-origin isolation headers; each response logged as
// `<status> <path> <sha256 of the body sent>`.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const [root, log] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ktx2': 'image/ktx2', '.txt': 'text/plain' };
const s = http.createServer((q, r) => {
  const url = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]);
  if (url === '/.canary') { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>canary</title>'); return; }
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { fs.appendFileSync(log, '404 /' + rel + ' -\\n'); r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  if (body.length >= 8 && body.toString('latin1', 4, 8) === 'ftyp') type = 'video/mp4';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
  r.setHeader('accept-ranges', 'none');
  fs.appendFileSync(log, '200 /' + rel + ' ' + crypto.createHash('sha256').update(body).digest('hex') + '\\n');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

interface Served { status: number; path: string; sha: string }
class Server {
  private child: ChildProcess | null = null;
  private dir = '';
  private log = '';
  origin = '';
  async start(root: string): Promise<string> {
    this.dir = mkdtempSync(join(tmpdir(), 'deep-1040-server-'));
    this.log = join(this.dir, 'served.log');
    const child = spawn(process.execPath, ['-e', SERVER, root, this.log], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    this.origin = `http://127.0.0.1:${port}`;
    return this.origin;
  }
  served(): Served[] {
    if (!this.log || !existsSync(this.log)) return [];
    return readFileSync(this.log, 'utf8').split('\n').filter(Boolean).map((l) => { const [status, path, sha] = l.split(' '); return { status: Number(status), path: path!.slice(1), sha: sha! }; });
  }
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = ''; this.log = '';
  }
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless, over its DevTools protocol in flat sessions (README: The browser). WebGPU on is #172's
// switches; WebGPU off is the browser's own switch for the API, proven off on a blank page before any test page opens.
// Chrome runs in a process group of its own and is stopped by that PID; its profile is a fresh folder, removed after.

const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--autoplay-policy=no-user-gesture-required',
];
const WEBGPU_ON = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
const WEBGPU_OFF = ['--disable-features=WebGPUService'];

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Record<string, unknown>) => void }[] = [];
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
  send(method: string, params: Record<string, unknown> = {}, session = '', timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Record<string, unknown>) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** The test shim over the browser's adapter (README: The shim adapter), as #172's: `navigator.gpu.requestAdapter`
 * answers the real adapter behind a proxy whose `features` are exactly those `features` names that the real one has,
 * and whose `limits` are WebGPU's spec defaults (a default device's) with `over` laid on; each `requestDevice`
 * descriptor is logged before it is passed on, and one past what the shim offers is refused as an adapter refuses it. */
interface Shim { features: string[]; over?: Record<string, number> }
/** What every page of a test records from its first script (README: The browser): `seen`, each change of `<html>`'s
 * `data-deep-state` and `data-deep-edge` as its mutation record (`{attr, old}`), so an edge that starts and lands
 * between two reads still counts; `textures`, every texture any device creates (format, size, mip count); with a shim,
 * `requests` and the spec `defaults` it read, and `real`, the real adapter's features. */
const initScript = (shim: Shim | null): string => `(() => {
  const shim = ${JSON.stringify(shim)};
  const state = { seen: [], requests: [], textures: [], defaults: null, real: null };
  Object.defineProperty(window, '__deep1040', { value: state });
  new MutationObserver((records) => { for (const r of records) if (r.target === document.documentElement) state.seen.push({ attr: r.attributeName, old: r.oldValue }); })
    .observe(document, { attributes: true, subtree: true, attributeOldValue: true, attributeFilter: ['data-deep-state', 'data-deep-edge'] });
  if (typeof GPUDevice !== 'undefined') {
    const create = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (d) {
      try {
        const z = d.size; const dims = Array.isArray(z) || (z && typeof z[Symbol.iterator] === 'function') ? [...z] : [z.width, z.height, z.depthOrArrayLayers];
        state.textures.push({ format: String(d.format), size: [dims[0] ?? 1, dims[1] ?? 1, dims[2] ?? 1], mips: d.mipLevelCount ?? 1 });
      } catch {}
      return create.call(this, d);
    };
  }
  if (!shim) return;
  const gpu = navigator.gpu; if (!gpu) return;
  const real = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (options) => {
    const spare = await real(options); if (!spare) return spare;
    const d = await spare.requestDevice(); const defaults = {}; for (const k in d.limits) defaults[k] = d.limits[k]; d.destroy();
    state.defaults = defaults;
    const a = await real(options); if (!a) return a;
    state.real = [...a.features].map(String);
    const limits = Object.freeze(Object.assign({}, defaults, shim.over || {}));
    const features = new Set(shim.features.filter((f) => a.features.has(f)));
    return new Proxy(a, { get(t, p) {
      if (p === 'limits') return limits;
      if (p === 'features') return features;
      if (p === 'requestDevice') return async (desc) => {
        const want = desc || {};
        const requiredLimits = {}; for (const k in (want.requiredLimits || {})) requiredLimits[k] = want.requiredLimits[k];
        state.requests.push({ requiredFeatures: [...(want.requiredFeatures || [])].map(String), requiredLimits });
        for (const f of want.requiredFeatures || []) if (!features.has(f)) throw new TypeError('the shim adapter offers no feature ' + f);
        for (const k in requiredLimits) if (!(k in limits) || (k.startsWith('min') ? requiredLimits[k] < limits[k] : requiredLimits[k] > limits[k])) throw new TypeError('the shim adapter offers ' + k + ' ' + limits[k] + ', not ' + requiredLimits[k]);
        return t.requestDevice(desc);
      };
      const v = Reflect.get(t, p); return typeof v === 'function' ? v.bind(t) : v;
    } });
  };
})();`;

export interface Texture { format: string; size: [number, number, number]; mips: number }
interface Recorded { seen: { attr: string; old: string | null }[]; requests: LoggedRequest[]; textures: Texture[]; defaults: Record<string, number> | null; real: string[] | null }
/** The states a page showed, in order, from its mutation records and the state it shows now, each with whether an
 * edge started since the state before it. */
function sequence(seen: Recorded['seen'], now: string | null): { states: string[]; edged: boolean[] } {
  const changes = seen.filter((r) => r.attr === 'data-deep-state');
  const states: string[] = []; const edged: boolean[] = [];
  let edge = false; let k = 0;
  for (const r of seen) {
    if (r.attr === 'data-deep-edge' && r.old === null) edge = true;
    if (r.attr !== 'data-deep-state') continue;
    k++;
    // A change's new value is the next change's old value, and the last's is the value shown now.
    const value = k < changes.length ? changes[k]!.old : now;
    if (value !== null && value !== states[states.length - 1]) { states.push(value); edged.push(edge); edge = false; }
  }
  return { states, edged };
}

/** One page in the browser (a target in a flat session), with every request it started. */
class Tab {
  readonly requests: string[] = [];
  readonly errors: string[] = [];
  constructor(private readonly cdp: Protocol, private readonly session: string, readonly target: string) {}
  /** A script's value in the page, awaited; with `gesture`, as a user's. */
  async evaluate<T>(expression: string, timeoutMs = 60_000, gesture = false): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, this.session, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** As evaluate, but `fallback` while the page is between documents. */
  async read<T>(expression: string, fallback: T): Promise<T> {
    try { return await this.evaluate<T>(expression, 30_000); } catch { return fallback; }
  }
  async navigate(url: string): Promise<void> { await this.cdp.send('Page.navigate', { url }, this.session).catch(() => undefined); }
  pathname(): Promise<string> { return this.read(`location.pathname`, ''); }
  /** What the init script recorded in the page now shown. */
  recorded(): Promise<Recorded> {
    return this.read(`JSON.parse(JSON.stringify(window.__deep1040 || { seen: [], requests: [], textures: [], defaults: null, real: null }))`, { seen: [], requests: [], textures: [], defaults: null, real: null });
  }
  /** The state the page shows and whether an edge is playing (#169's DOM marks). */
  now(): Promise<{ state: string | null; edge: boolean }> {
    return this.read(`(() => { const h = document.documentElement; return { state: h ? h.getAttribute('data-deep-state') : null, edge: !!h && h.hasAttribute('data-deep-edge') }; })()`, { state: null, edge: false });
  }
  /** Waits until the tab shows the bundle file `path` (a top-level document at `/<path>`) holding a state; what it
   * showed when the wait ended, and the first state that document showed. */
  async showsPage(path: string, ms = 60_000): Promise<{ ok: boolean; at: string; first: string | null }> {
    const until = Date.now() + ms;
    let at = ''; let first: string | null = null;
    while (Date.now() < until) {
      at = await this.pathname();
      const now = (await this.now()).state;
      first = sequence((await this.recorded()).seen, now).states[0] ?? null;
      if (at === `/${path}` && now !== null) return { ok: true, at, first };
      await sleep(200);
    }
    return { ok: false, at, first };
  }
  /** The states the page showed in order, watched until it rests in `last` or `ms` pass, and how many of the steps
   * between them played an edge. */
  async watch(last: string, ms = 120_000): Promise<{ states: string[]; edges: number }> {
    const until = Date.now() + ms;
    for (;;) {
      const now = await this.now();
      const { states, edged } = sequence((await this.recorded()).seen, now.state);
      if ((states[states.length - 1] === last && !now.edge) || Date.now() > until) return { states, edges: edged.slice(1).filter(Boolean).length };
      await sleep(200);
    }
  }
  /** The `<deep-player>` of the page shown: whether there is one, whether it is ready, and the notices shown. */
  player(): Promise<{ player: boolean; ready: boolean; notices: string[] }> {
    return this.read(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true),
      notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`, { player: false, ready: false, notices: [] });
  }
  /** Waits until the player says `ready`, at most `ms`. */
  async ready(ms = 120_000): Promise<{ ready: boolean; player: boolean; notices: string[] }> {
    const until = Date.now() + ms;
    let s = await this.player();
    while (!s.ready && Date.now() < until) { await sleep(200); s = await this.player(); }
    return s;
  }
  /** probe() of the page's player (#172's member), or null when it answers none. */
  async probe(): Promise<JsonObject | null> {
    const v = await this.read<JsonValue>(`(async () => { const p = document.querySelector('deep-player'); if (!p || typeof p.probe !== 'function') return null;
      const v = await p.probe(); return v === undefined ? null : JSON.parse(JSON.stringify(v)); })()`, null);
    return isObject(v) ? v : null;
  }
  /** A host's seek (setting `currentTime`, s) to step k at 60 Hz, waiting until probe() reads step k. */
  async seekStep(k: number): Promise<JsonObject | null> {
    await this.read(`void (document.querySelector('deep-player').currentTime = ${k / 60})`, null);
    const until = Date.now() + 60_000;
    let p = await this.probe();
    while ((p === null || p['step'] !== k) && Date.now() < until) { await sleep(20); p = await this.probe(); }
    return p;
  }
  /** play() from the start, resolving whether `ended` fired (a user's gesture, so sound can't hold it). */
  playToEnd(ms = 180_000): Promise<boolean> {
    return this.evaluate<boolean>(`new Promise((done) => { const p = document.querySelector('deep-player');
      const t = setTimeout(() => done(false), ${ms - 5_000}); p.addEventListener('ended', () => { clearTimeout(t); done(true); }, { once: true });
      p.currentTime = 0; p.play(); })`, ms, true).catch(() => false);
  }
  /** A left click at the centre of the target `[data-deep-target=…]`, as a pointer would (#169's): null, or why not. */
  async click(target: string): Promise<string | null> {
    const box = await this.read<{ x: number; y: number; w: number; h: number; hit: boolean } | null>(`(() => {
      const e = document.querySelector('[data-deep-target=' + ${JSON.stringify(JSON.stringify(target))} + ']'); if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y); return { x, y, w: r.width, h: r.height, hit: !!top && (top === e || e.contains(top)) }; })()`, null);
    if (!box) return `the page shows no target ${target}`;
    if (box.w <= 0 || box.h <= 0) return `the target ${target} has no size`;
    if (!box.hit) return `the target ${target} is covered at its centre`;
    const mouse = (type: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => this.cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, ...extra }, this.session);
    await mouse('mouseMoved');
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
    return null;
  }
  /** The targets the page shows now, by `<control>/<option>`. */
  targets(): Promise<string[]> {
    return this.read(`[...document.querySelectorAll('[data-deep-target]')].map((e) => e.getAttribute('data-deep-target') || '')`, []);
  }
  /** After an action: null when the page lands in `expected` having started an edge since `seenBefore` records; else
   * what it shows after 30 s (#169's rule: an edge plays when the controls change). */
  async land(expected: string, seenBefore: number): Promise<string | null> {
    const until = Date.now() + 30_000;
    for (;;) {
      const r = await this.recorded();
      const s = await this.now();
      const edge = r.seen.slice(seenBefore).some((x) => x.attr === 'data-deep-edge' && x.old === null);
      if (!s.edge && s.state === expected && edge) return null;
      if (Date.now() > until) return `shows ${String(s.state)} after 30 s (edge playing: ${s.edge}, an edge started: ${edge}), not ${expected} after playing an edge`;
      await sleep(50);
    }
  }
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}

/** One browser, WebGPU on or off. Close it in a `finally` or through `useBrowsers`. */
class Browser {
  private constructor(private readonly chrome: ChildProcess, private readonly cdp: Protocol, private readonly profile: string, readonly webgpu: boolean) {}
  static async open(webgpu: boolean): Promise<Browser> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the bundle is opened in headless Chrome. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-1040-chrome-'));
    const chrome = spawn(CHROME, [...CHROME_ARGS, ...(webgpu ? WEBGPU_ON : WEBGPU_OFF), `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 180_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { stop(chrome, profile); blocked(`${CHROME} opened no DevTools port within 180 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { stop(chrome, profile); return blocked((e as Error).message); }
    const b = new Browser(chrome, cdp, profile, webgpu);
    return b;
  }
  /** Opens `url` in a new page, 1280 × 720 at device scale 1, the init script (and shim) installed first. */
  async page(url: string, o: { shim?: Shim } = {}): Promise<Tab> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const tab = new Tab(this.cdp, sessionId, targetId);
    this.cdp.on(sessionId, 'Network.requestWillBeSent', (p) => tab.requests.push(String((p['request'] as { url?: string } | undefined)?.url ?? '')));
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => tab.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(o.shim ?? null) }, sessionId);
    if (url !== 'about:blank') await tab.navigate(url);
    return tab;
  }
  async close(): Promise<void> {
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    stop(this.chrome, this.profile);
  }
}
function stop(chrome: ChildProcess, profile: string): void {
  if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
  rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

/** A bundle served and its index page opened in a browser. */
export interface Opened { server: Server; browser: Browser; tab: Tab }
export async function openBundle(folder: string, o: { webgpu: boolean; shim?: Shim; path?: string }): Promise<Opened> {
  const server = new Server();
  const origin = await server.start(folder);
  let browser: Browser;
  try { browser = await Browser.open(o.webgpu); } catch (e) { await server.stop(); throw e; }
  if (!o.webgpu) {
    // WebGPU off, proven on a page of the bundle's own origin (a secure context, unlogged): no WebGPU, or no adapter.
    const canary = await browser.page(`${origin}/.canary`);
    const off = await canary.read<string>(`(async () => !navigator.gpu ? 'off' : (await navigator.gpu.requestAdapter()) === null ? 'off' : 'an adapter')()`, 'no answer');
    await canary.close();
    if (off !== 'off') { await browser.close(); await server.stop(); blocked(`Chrome at ${CHROME} still gives a page ${off} with WebGPU switched off (${WEBGPU_OFF.join(' ')}). Unblock: a Chrome this switch turns WebGPU off in`); }
  }
  const tab = await browser.page(`${origin}/${o.path ?? 'index.html'}`, o.shim ? { shim: o.shim } : {});
  return { server, browser, tab };
}
export async function closeBundle(p: Opened | undefined): Promise<void> {
  if (!p) return;
  await p.browser.close();
  await p.server.stop();
}
/** Opened bundles a failed test left, closed after the file. */
export function useBrowsers(): (p: Opened) => Opened {
  const open: Opened[] = [];
  afterAll(async () => { for (const p of open.splice(0)) await closeBundle(p); });
  return (p) => { open.push(p); return p; };
}
/** BLOCKED when the browser's real adapter lacks a feature the test must grant (it can't offer what it hasn't). */
export async function needsReal(tab: Tab, features: readonly string[]): Promise<void> {
  const real = await tab.read<string[] | string>(`(async () => { if (!navigator.gpu) return 'no navigator.gpu'; const a = await navigator.gpu.requestAdapter(); return a ? (window.__deep1040 && window.__deep1040.real) || [...a.features].map(String) : 'no adapter'; })()`, 'no answer');
  if (typeof real === 'string') blocked(`Chrome at ${CHROME} offers no WebGPU adapter here (${real}). Unblock: run on a reference Mac whose headless Chrome gives one`);
  const missing = features.filter((f) => !real.includes(f));
  if (missing.length) blocked(`Chrome's adapter here lacks ${missing.join(', ')}, which this leg grants through the shim. Unblock: run on a reference Mac whose Chrome adapter has them`);
}
/** BLOCKED off a reference Mac (the criterion names it: README, Legs that read BLOCKED or INCONCLUSIVE). */
export async function onReferenceMac(): Promise<void> {
  const problem = await referenceMacProblem(false);
  if (problem) blocked(`the criterion runs on the reference Mac, and this machine is ${problem}. Unblock: run on Mac15,7, Mac15,12 or Mac17,10`);
}

// ---------------------------------------------------------------------------------------------------
// Judgements

/** The index page opened the fallback page and never started the player (README: chosen, how a test sees each). Each
 * failure names what it saw, and `why` (the missing WebGPU, or the withheld feature) so a wrong index page's failure
 * names the feature. */
export async function fallbackFailures(o: Opened, receipt: WebReceipt, fb: Fallback, why: string, what: string): Promise<string[]> {
  const f: string[] = [];
  const shownAt = await o.tab.showsPage(fb.index);
  if (!shownAt.ok) f.push(`${what}: with ${why}, the index page doesn't open the fallback page /${fb.index} within 60 s; the tab shows ${shownAt.at || 'nothing'}`);
  else if (shownAt.first !== fb.manifest.start) f.push(`${what}: the fallback page opens in state ${String(shownAt.first)}, not its manifest's start ${fb.manifest.start}`);
  f.push(...await neverStartedFailures(o, receipt, why, what));
  return f;
}
/** The player never started: the page loaded no file of the player (the receipt's player hash) and asked no adapter
 * for a device. */
export async function neverStartedFailures(o: Opened, receipt: WebReceipt, why: string, what: string): Promise<string[]> {
  const f: string[] = [];
  const path = playerPath(receipt) ?? `<${receipt.player}>`;
  if (o.server.served().some((s) => s.status === 200 && s.sha === receipt.player)) f.push(`${what}: with ${why}, the index page started the player: the page loaded it (${path})`);
  const log = await o.tab.recorded();
  for (const r of log.requests) f.push(`${what}: with ${why}, the index page started the player: it asked the adapter for a device with features [${r.requiredFeatures.join(', ')}]`);
  const p = await o.tab.player();
  if (p.ready) f.push(`${what}: with ${why}, a <deep-player> on the page reports ready`);
  return f;
}
/** Every file the tab's pages asked for is the bundle's own (the server's origin, a file the receipt names, by hash). */
export function requestFailures1040(o: Opened, receipt: WebReceipt, what: string): string[] {
  const named = new Map(receipt.files.map((x) => [x.path, x.sha256]));
  const f: string[] = [];
  for (const u of o.tab.requests) if (!/^(data|blob|about):/.test(u) && !u.startsWith(`${o.server.origin}/`)) f.push(`${what}: the page asked for ${u}, outside the bundle`);
  for (const s of o.server.served()) {
    if (s.path === 'favicon.ico' && s.status === 404) continue;
    if (s.status !== 200) f.push(`${what}: the page asked for ${s.path}, which the bundle doesn't hold (${s.status})`);
    else if (named.get(s.path) !== s.sha) f.push(`${what}: the page loaded ${s.path} with SHA-256 ${s.sha}, the receipt names ${named.get(s.path) ?? 'no such file'}`);
  }
  return f;
}
/** The player runs live: it is ready, draws on WebGPU, plays to `ended`, and each device request equals gpu_needs
 * (#172's rule). `granted` is what the shim offers (null: the real adapter, no shim). An index page that opened the
 * fallback page instead fails naming each feature of gpu_needs it acted on as missing: a needed one the shim doesn't
 * offer, or the rest of an `any_of` set one of whose features the shim offers. */
export async function liveFailures(o: Opened, receipt: WebReceipt, fb: Fallback | null, granted: string[] | null, what: string): Promise<{ failures: string[]; end: JsonObject | null }> {
  const f: string[] = [];
  const offered = granted === null ? 'the real adapter' : `the shim offering [${granted.join(', ')}]`;
  const s = await o.tab.ready(120_000);
  if (!s.ready) {
    const at = await o.tab.pathname();
    if (fb && at === `/${fb.index}`) {
      const needs = receipt.gpu_needs;
      const required = granted === null ? [] : [
        ...needs.features.filter((x) => !granted.includes(x)),
        ...needs.any_of.filter((set) => set.some((x) => granted.includes(x))).flatMap((set) => set.filter((x) => !granted.includes(x)).map((x) => `${x} (one of [${set.join(', ')}] is enough, and the adapter has ${set.filter((y) => granted.includes(y)).join(', ')})`)),
      ];
      f.push(`${what}: with ${offered}, the index page opened the fallback page instead of starting the player${required.length ? `, acting as if it lacked ${required.join('; ')}` : ''}`);
    } else {
      if (!s.player) await needsReal(o.tab, []);
      f.push(`${what}: with ${offered}, the player isn't ready within 120 s: ${s.player ? 'a <deep-player>' : 'no <deep-player>'}, notices ${JSON.stringify(s.notices)}, page errors ${JSON.stringify(o.tab.errors.slice(0, 3))}`);
    }
    return { failures: f, end: null };
  }
  const start = await o.tab.probe();
  if (!start || typeof start['backend'] !== 'string' || !/webgpu/i.test(start['backend'])) f.push(`${what}: probe().backend is ${show(start?.['backend'] ?? null)}, not WebGPU`);
  if (!(await o.tab.playToEnd())) f.push(`${what}: with ${offered}, the player doesn't play to its end (no ended)`);
  const end = await o.tab.probe();
  const log = await o.tab.recorded();
  if (granted !== null && !log.requests.length) f.push(`${what}: the player made no device request through the shim`);
  for (const [i, r] of log.requests.entries()) f.push(...requestFailures(r, receipt.gpu_needs, log.defaults ?? {}, `${what}, device request ${i + 1}`));
  return { failures: f, end };
}
/** The shim of spec-default limits offering gpu_needs' features and `extra`, less `withheld` (#172's needsShim, with
 * each any_of set's features named by the test). */
export const shimOf = (needs: GpuNeeds, extra: readonly string[], withheld: readonly string[] = []): Shim =>
  ({ features: [...new Set([...needs.features, ...extra])].filter((x) => !withheld.includes(x)) });
/** A logic array's scalar, as probe() or eval reads it: a number, or an array of one. */
export function scalar(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'number') return v[0];
  return null;
}
/** probe()'s checkpoints of `item` against the app's, every one at or before the probe's step, by full-state hash. */
export function checkpointFailures(p: JsonObject, item: string, app: Checkpoint[], what: string): string[] {
  const step = typeof p['step'] === 'number' ? p['step'] : -1;
  const got = new Map((isObject(p['checkpoint_hashes']) && Array.isArray(p['checkpoint_hashes'][item]) ? p['checkpoint_hashes'][item] : [])
    .filter(isObject).map((c) => [Number(c['step']), String(c['hash'])]));
  const f: string[] = [];
  const want = app.filter((c) => c.step <= step);
  if (!want.length) f.push(`${what}: the app's run of ${item} took no checkpoint at or before step ${step}`);
  for (const c of want) {
    const h = got.get(c.step);
    if (h === undefined) f.push(`${what}: ${item} has no checkpoint at step ${c.step} in the player (the app's full-state hash there is ${c.hash})`);
    else if (h !== c.hash) f.push(`${what}: ${item}'s full-state hash at step ${c.step} is ${h} in the player, ${c.hash} in the app`);
  }
  return f;
}
/** The textures a device made at the maps' size with more than one mip level (README: chosen, a map's texture), and
 * their layers by format. */
function mapTextures(textures: Texture[], size: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of textures) if (t.size[0] === size && t.size[1] === size && t.mips > 1) out.set(t.format, (out.get(t.format) ?? 0) + t.size[2]);
  return out;
}
const family = (format: string): 'bc7' | 'bc5' | 'astc-4x4' | 'rgba8' | string =>
  format.startsWith('bc7-') ? 'bc7' : format.startsWith('bc5-') ? 'bc5' : format.startsWith('astc-4x4-') ? 'astc-4x4' : format.startsWith('rgba8unorm') ? 'rgba8' : format;
/** The maps' textures by format family against `want` (family → layers); each failure names the format. */
export function formatFailures(textures: Texture[], size: number, want: Record<string, number>, what: string): string[] {
  const byFamily = new Map<string, number>();
  for (const [format, n] of mapTextures(textures, size)) byFamily.set(family(format), (byFamily.get(family(format)) ?? 0) + n);
  const f: string[] = [];
  for (const [fam, n] of Object.entries(want)) if ((byFamily.get(fam) ?? 0) !== n) f.push(`${what}: the player made ${byFamily.get(fam) ?? 0} map textures (${size} px, mipmapped) in ${fam}, not ${n}`);
  for (const [fam, n] of byFamily) if (!(fam in want)) f.push(`${what}: the player made ${n} map textures (${size} px, mipmapped) in ${fam}, which this adapter's maps aren't`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Small reads

/** A refused export: not exported, and nothing at `out` or anywhere in its fresh folder. */
export function unwritten(reply: JsonObject, out: string, what: string): void {
  expect(reply['outcome'] === 'exported', `${what} isn't exported: ${show(reply, 2000)}`).toBe(false);
  expect(readdirSync(dirname(out)), `${what}: nothing is written in out's folder (no bundle, no temporary name)`).toEqual([]);
}
