// Test-side tools for the #297 acceptance tests (README: The surface under test). They build `deep-show` once a file
// (the default `full` set), drive `deep-show run` (#393's scenario: one JSON line in, one answer line out) with the
// calls the earlier suites use (`deep_show`, `input`, `see`, `track`, `eval`, `logic`, `match`) and read their replies,
// write this suite's two logic programs as WebAssembly bytes, and keep the evidence store. PNG reading and writing come
// from ../467/helpers.ts by import (read only). Nothing here stands in for the text module, the text control, the net
// module or a check: every shown string, notice, refusal, issue, hash and pixel digest a test reads is the
// implementation's own, and every expected value comes from the issue, the design and fixtures.ts.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeRgbaPng, type Image } from '../467/helpers.ts';

export { decodePng, encodeRgbaPng, type Image };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/297 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** cargo on PATH: the pinned toolchain's folder first when it is there (as #549's helpers do). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const CARGO_ENV: NodeJS.ProcessEnv = {
  NO_COLOR: '1',
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(TOOLCHAIN) ? { PATH: `${TOOLCHAIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** A first build of `deep-show` takes many minutes on a loaded machine; each test passes its own timeout. */
export const BUILD_TIMEOUT = 7_200_000;
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#297.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #297.688a1e6a',
  2: 'AC2 #297.3618602e',
  3: 'AC3 #297.d2e288d8',
  4: 'AC4 #297.ee30ab4e',
  5: 'AC5 #297.50f2c738',
  6: 'AC6 #297.cd44d20a',
  7: 'AC7 #297.855382ad',
  8: 'AC8 #297.8d736efc',
  9: 'AC9 #297.a18ed59e',
  10: 'AC10 #297.597888a6',
  11: 'AC11 #297.5d8a3e72',
} as const;

/** A tool this machine lacks: the test fails with this, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object: ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array: ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number: ${show(v, 200)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string: ${show(v, 200)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** The criterion's judge found nothing wrong. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** The judge fails a planted twin, and its failures name each of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the judge fails the planted program`).toBeGreaterThan(0);
  const all = failures.join('\n');
  for (const re of named) expect(re.test(all), `${what}: a failure names ${String(re)}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
}
export function once<T>(make: () => T): () => T {
  let made: { v: T } | null = null;
  return () => (made ??= { v: make() }).v;
}
/** A string's code points as U+XXXX, for messages. */
export const cps = (s: string): string => [...s].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
/** A string for messages: quoted, each mark, control, format and separator character as a `\u{…}` escape (so nothing
 * reorders or hides the message), and its code points. */
export const named = (s: string): string => `"${s.replace(/[\p{C}\p{M}\p{Zl}\p{Zp}"\\]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, '0')}}`)}" (${cps(s)})`;
export const hexOf = (b: Uint8Array | string): string => [...(typeof b === 'string' ? Buffer.from(b, 'utf8') : b)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
/** A string's graphemes by the platform's own segmenter (an independent UAX #29 implementation). */
export const graphemes = (s: string): string[] => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` once a file, copied out of target/debug.

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|^\s*Compiling|^\s*Finished|Download|^\s*Locking|^\s*Updating/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let built: { bin: string; error: string } | null = null;
let binDir = '';
/** Builds `deep-show` in `beforeAll` and removes the copy after the file. */
export function useShow(): () => string {
  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), 'deep-297-bin-'));
    const bin = join(binDir, 'deep-show');
    const error = cargo(['build', '--locked', '--bin', 'deep-show']);
    if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
    built = { bin, error };
  }, BUILD_TIMEOUT);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; });
  return () => {
    if (!built) throw Error('deep-show was not built: useShow() runs in beforeAll');
    if (/cargo could not run/.test(built.error)) blocked(`${built.error}: this machine lacks the Rust toolchain`);
    expect(built.error, 'deep-show builds').toBe('');
    return built.bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256) and temporary folders.

export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  return readFileSync(path);
}
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-297-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second. Every fixture steps at 60 Hz, its logic and its match alike, so step k is at
// k × 11,760,000 flicks and the frame at that time shows every entry stamped at or before it.

export const FLICKS = 705_600_000;
export const RATE = 60;
export const STEP = FLICKS / RATE;
export const MS = FLICKS / 1000;
/** The flick time of step k. */
export const at = (k: number): number => k * STEP;

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#542's form: the agent's session, a process table, one 480 × 240 px panel a document,
// the scope's virtual clock and a display), the calls in order, one answer line `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted =
  | 'entry_any_player' | 'entry_own_viewer_only' | 'fit_skips_entries' | 'entry_takes_missing_glyph' | 'entry_falls_back_to_player_1'
  | 'entry_normalizes_track' | 'control_takes_hidden' | 'control_no_mark_limit' | 'entry_compare_code_points';
export const SESSION = 'sess-297';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-297', name: 'Claude Code: typed names', process: { pid: 4297, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4297, ppid: 1, start: 1_000 }];
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: [number, number] = [1600, 900];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB297D${String(n).padStart(18, '0')}`;

export function scenario(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 480, 240] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, clock: CLOCK, display: DISPLAY, ...(planted ? { planted } : {}), calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!.slice(0, 500); }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok${typeof sc['planted'] === 'string' ? ` (it takes the planted ${sc['planted']})` : ''}; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}

/** A track entry as a match's record gives it (#549): `writer` "you" for this copy's player, "peer" for another's. */
export interface TrackEntry { t: number; control: string; value: string; writer: 'you' | 'peer'; player: number }
/** One player's commit to `control` at step `step`, written as copy 1's record writes it. */
export const commit = (step: number, player: number, value: string, control = 'name'): TrackEntry =>
  ({ t: at(step), control, value, writer: player === 1 ? 'you' : 'peer', player });
/** A recorded track in the track's own order: by time, then player. */
export const trackOf = (entries: TrackEntry[]): JsonObject[] =>
  [...entries].sort((a, b) => a.t - b.t || a.player - b.player).map((e, seq) => ({ t: e.t, seq, control: e.control, value: e.value, writer: e.writer, player: e.player }));

/** A scripted entry of `match` (#549's `plays`): that player's copy commits `value` when match step `step` is the first
 * it hasn't run, so it lands `delay` steps later. A script entry is what that copy commits, with no typing in it: a
 * modified copy's commit is one of these holding what the control would refuse as typed. */
export interface Play { step: number; control: string; value: string }
export type Plays = Record<string, Play[]>;
export interface RenderAsk { player: number; t: number }

/**
 * The calls of one run on the scope's virtual clock, each at its own `at`, in order; each method gives the index of its
 * call, so a test reads that call's reply. Inputs go to the panel `p1`.
 */
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  constructor(public panel = 'p1') {}
  /** The time of the last call, in flicks. */
  get now(): number { return this.t; }
  private add(c: JsonObject, gapMs: number): number {
    this.t += Math.round(gapMs * MS);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  /** The agent's `deep_show` of a whole document (#393), with its issues. */
  present(doc: string, document: JsonObject): number { return this.add({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] }, 1); }
  input(event: JsonObject, gapMs = 100): number { return this.add({ call: 'input', panel: this.panel, event }, gapMs); }
  /** A key press (#383's `key`). */
  key(key: string): number { return this.input({ type: 'key', key }); }
  /** Text typed into the focused field (#383's `text`): one event. */
  text(text: string): number { return this.input({ type: 'text', text }); }
  /** `see` (#376): the panel's accessibility tree and every announcement so far, notices among them. */
  see(): number { return this.add({ call: 'see', panel: this.panel }, 50); }
  /** `track` (#1164): the document's input track and its hash; with `load`, the track becomes exactly those entries. */
  track(doc: string, load?: JsonObject[]): number { return this.add({ call: 'track', doc, ...(load ? { load } : {}) }, 50); }
  /** `eval` (#387) at `t` flicks, asking for README's `shown`; `pixels` adds the snapshot; `track` is the call's own. */
  eval(doc: string, t: number, o: { pixels?: boolean; track?: JsonObject[] } = {}): number {
    return this.add({ call: 'eval', doc, t, shown: true, ...(o.pixels ? { pixels: true } : {}), ...(o.track ? { track: o.track } : {}) }, 50);
  }
  /** #539's `logic`: the document's logic items stepped 0 to `steps` − 1 on its input track. */
  logic(doc: string, steps: number): number { return this.add({ call: 'logic', doc, steps }, 50); }
  /** #549's `match`: every copy of the document's match in this process over the test relay. */
  match(doc: string, steps: number, plays: Plays, renderBack: RenderAsk[] = []): number {
    return this.add({ call: 'match', doc, steps, plays: plays as unknown as JsonObject, ...(renderBack.length ? { render_back: renderBack as unknown as JsonValue[] } : {}) }, 50);
  }
  /** Moves the clock on by `ms`. */
  wait(ms: number): void { this.t += Math.round(ms * MS); }
}

// ---------------------------------------------------------------------------------------------------
// Reading replies

/** Every issue of a reply, as objects, with an issue's `actual` fields lifted beside its own (a field may sit either
 * way, README). */
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return (Array.isArray(list) ? list.filter(isObject) : []).map((i) => (isObject(i['actual']) ? { ...(i['actual'] as JsonObject), ...i } : i));
}
export const errorsOf = (reply: JsonObject): JsonObject[] => issuesOf(reply).filter((i) => i['severity'] === 'error');
/** An issue's own fields as text, without its prose (`what`, `fix`): what it names. */
export const namedIn = (issue: JsonObject): string => { const { what: _w, fix: _f, close: _c, ...rest } = issue; return JSON.stringify(rest); };
/** A `deep_show` reply that presented its document with no error. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  expect(errorsOf(reply).map(namedIn), `${what} is presented with no error`).toEqual([]);
}
/** Whether an issue names item `id`: in its `ids`, its `item`, `set` or `reader`, or its path's item segment. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'] : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || [issue['item'], issue['set'], issue['reader']].includes(id) || path.split('/').includes(id);
}
/** Whether an issue names the field `field`: a segment of its path, or its `field`. */
export function namesField(issue: JsonObject, field: string): boolean {
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return path.split('/').includes(field) || issue['field'] === field;
}

/** README: `eval`'s `shown`, the string each entry text shows at t: by item ID, and `<set>#<key>` for a mark set's row. */
export function shownOf(reply: JsonObject, what: string): Record<string, string> {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1500)}`).toBe('evaluated');
  const s = obj(reply['shown'], `${what}: eval's shown (README), the string each entry text shows (${show(reply['shown'] ?? null, 300)})`);
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, str(v, `${what}: shown[${k}]`)]));
}
/** An `eval` reply's snapshot's SHA-256 (a PNG in the evidence store). */
export function snapshotOf(reply: JsonObject, what: string): string {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1500)}`).toBe('evaluated');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
  return str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
}
/** The Tab stop with focus (#539's `state.focus`): a control's own ID, or null. */
export function focusOf(reply: JsonObject, what: string): string | null {
  const state = obj(reply['state'], `${what}: state (${show(reply, 600)})`);
  const f = state['focus'];
  return f === null || f === undefined ? null : str(f, `${what}: state.focus`);
}
/** The entries an input appended to the document's input track (`input`'s `appended`, #504). */
export function appendedOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['appended'], `${what}: appended (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** The string values of entries of `control`. */
export const valuesOf = (entries: JsonObject[], control = 'name'): string[] => entries.filter((e) => e['control'] === control && typeof e['value'] === 'string').map((e) => e['value'] as string);

/** `see` (#376) announcements; a notice of a refused grapheme carries README's `reason` and `grapheme`. */
export interface Announcement { t: number | null; id: string; text: string; reason: string | null; grapheme: string | null }
export function announcementsOf(reply: JsonObject, what: string): Announcement[] {
  return arr(reply['announcements'], `${what}: see.announcements (${show(reply, 600)})`).map((a, i) => {
    const o = obj(a, `${what}: announcements[${i}]`);
    return {
      t: typeof o['t'] === 'number' ? o['t'] : null, id: String(o['id'] ?? ''), text: String(o['text'] ?? ''),
      reason: typeof o['reason'] === 'string' ? o['reason'] : null, grapheme: typeof o['grapheme'] === 'string' ? o['grapheme'] : null,
    };
  });
}
/** The control's notices at or after flick `from`. */
export const noticesOf = (list: Announcement[], control: string, from: number): Announcement[] => list.filter((a) => a.id === control && (a.t === null || a.t >= from));
/** Whether a notice names `grapheme`: README's `grapheme` field, or its text holding it or its code points as U+XXXX. */
export const noticeNames = (a: Announcement, grapheme: string): boolean =>
  a.grapheme === grapheme || a.text.includes(grapheme) || a.text.toUpperCase().includes(cps(grapheme).toUpperCase());

/** `track` (#1164): the entries and the hash. */
export interface Track { entries: JsonObject[]; hash: string }
export function trackOfReply(reply: JsonObject, what: string): Track {
  expect(reply['code'], `${what}: the track call answers: ${show(reply, 600)}`).toBeUndefined();
  const entries = arr(reply['track'], `${what}: track`).map((e, i) => obj(e, `${what}: track[${i}]`));
  const h = reply['hash'];
  expect(typeof h === 'string' || typeof h === 'number', `${what}: the track's hash: ${show(h ?? null)}`).toBe(true);
  return { entries, hash: String(h) };
}

/** `logic` (#539): each step's arrays per logic item. */
export interface LogicStep { step: number; arrays: Record<string, JsonValue[]> }
export function logicStepsOf(reply: JsonObject, what: string): LogicStep[] {
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  return arr(reply['steps'], `${what}: steps`).map((s, i): LogicStep => {
    const o = obj(s, `${what}: steps[${i}]`);
    const arrays = obj(o['arrays'], `${what}: steps[${i}].arrays`);
    return { step: num(o['step'], `${what}: steps[${i}].step`), arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, arr(v, `${what}: steps[${i}].arrays.${k}`)])) };
  });
}

/** README: a copy's `refused` row, one entry that copy refused. */
export interface Refusal { step: number; player: number; control: string; reason: string | null; grapheme: string | null }
/** README: a `match` copy, with the rows this suite reads. */
export interface Copy { player: number; refused: Refusal[]; track: JsonObject[]; raw: JsonObject }
export function copiesOf(reply: JsonObject, what: string): Copy[] {
  expect(reply['code'], `${what}: match answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const list = arr(reply['copies'], `${what}: copies`).map((c, i) => obj(c, `${what}: copies[${i}]`));
  expect(list.length, `${what}: one copy a player`).toBe(2);
  return list.map((c, i) => {
    const w = `${what}: copies[${i}]`;
    const record = obj(c['record'], `${w}.record`);
    const refused = arr(c['refused'], `${w}.refused (README: a copy's refused entries)`).map((r, k) => {
      const o = obj(r, `${w}.refused[${k}]`);
      return {
        step: num(o['step'], `${w}.refused[${k}].step`), player: num(o['player'], `${w}.refused[${k}].player`), control: str(o['control'], `${w}.refused[${k}].control`),
        reason: typeof o['reason'] === 'string' ? o['reason'] : null, grapheme: typeof o['grapheme'] === 'string' ? o['grapheme'] : null,
      };
    });
    return { player: num(c['player'], `${w}.player`), refused, track: arr(record['track'], `${w}.record.track`).map((e, k) => obj(e, `${w}.record.track[${k}]`)), raw: c };
  });
}
/** README: a `render_back` row of `match`: that copy's own frame at t, its pixels' digest and what its entry texts show. */
export interface Render { player: number; t: number; step: number; sha256: string; shown: Record<string, string> }
export function rendersOf(reply: JsonObject, count: number, what: string): Render[] {
  const list = arr(reply['renders'], `${what}: renders (${show(reply['renders'] ?? reply, 600)})`).map((r, i) => obj(r, `${what}: renders[${i}]`));
  expect(list.length, `${what}: one render a row asked`).toBe(count);
  return list.map((r, i) => {
    const w = `${what}: renders[${i}]`;
    const shown = obj(r['shown'], `${w}.shown (README: what that copy's entry texts show)`);
    return {
      player: num(r['player'], `${w}.player`), t: num(r['t'], `${w}.t`), step: num(r['step'], `${w}.step`), sha256: str(r['sha256'], `${w}.sha256`),
      shown: Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, str(v, `${w}.shown[${k}]`)])),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Pictures (the taste call only)

export const pngOf = (evidence: string, h: string, what: string): Image => decodePng(getEvidence(evidence, h, what));
/** Re-encodes a decoded picture so the same pixels always give the same bytes. */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});
/** Two pictures side by side on a neutral strip, a 16 px gap between them, nothing drawn over either. */
export function sideBySide(a: Image, b: Image): Buffer {
  const gap = 16; const width = a.width + gap + b.width; const height = Math.max(a.height, b.height);
  return encodeRgbaPng(width, height, (x, y) => {
    const from = (im: Image, ix: number): [number, number, number, number] => {
      if (y >= im.height) return [128, 128, 128, 255];
      const o = (y * im.width + ix) * 4;
      return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
    };
    if (x < a.width) return from(a, x);
    if (x < a.width + gap) return [128, 128, 128, 255];
    return from(b, x - a.width - gap);
  });
}

// ---------------------------------------------------------------------------------------------------
// WebAssembly, written as bytes (Logic `logic@1`: one memory whose maximum is its minimum, immutable i32 globals
// `reads_at` and `writes_at`, `init(seed: i64)`, `step(k: i64)`, no imports), as #549's fixtures write theirs.

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = n | 0;
  for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); }
};
const wname = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
export const I = {
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  f64: (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [0x44, ...b]; },
  load: (offset = 0): number[] => [0x28, 0x02, ...uleb(offset)],
  store: (offset = 0): number[] => [0x36, 0x02, ...uleb(offset)],
  f64store: (offset = 0): number[] => [0x39, 0x03, ...uleb(offset)],
} as const;
export interface Program { name: string; bytes: Buffer; sha: string }
/** A logic program whose `init` does nothing and whose `step` runs `step` (no locals). */
export function logicModule(label: string, readsAt: number, writesAt: number, step: number[]): Program {
  const body = (b: number[]): number[] => { const f = [0x00, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(readsAt), 0x0b], [0x7f, 0x00, ...I.i32(writesAt), 0x0b]])),
    ...section(7, vec([[...wname('memory'), 0x02, 0x00], [...wname('reads_at'), 0x03, 0x00], [...wname('writes_at'), 0x03, 0x01], [...wname('init'), 0x00, 0x00], [...wname('step'), 0x00, 0x01]])),
    ...section(10, vec([body([]), body(step)])),
  ]);
  return { name: label, bytes, sha: sha256(bytes) };
}
