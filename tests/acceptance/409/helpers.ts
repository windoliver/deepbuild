// Test-side tools for the #409 acceptance tests: the films every craft@1 check is held to, generated here so each file
// judges the same documents; a `deep-show run` scenario in which the working agent presents each film (`deep_show` from
// its session) and a claim of its, whose brief names the craft checks, gets a `verdict`; reading the craft rows; and the
// checks each criterion's wrong programs must fail, each returning its failures as sentences naming what failed.
// Nothing here stands in for a craft check or the evaluation: every value a test compares comes from the binary, every
// expected value from the issue's text and the design (canvas primitives: Film audit: craft@1). The build, the JSON
// readers, `run`, the verdict's rows and the looks are #407's helpers; the WAV writer and the evidence store are #501's.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import {
  ALPHA, FLICKS, FULL, TIMEOUT, YOU_PEER, arr, brief as show, field, isObject, lookOf, mentions, none, obj, run, secondsOf, useBuilds,
  verdictOf, type JsonObject, type JsonValue, type Row, type Verdict,
} from '../407/helpers.ts';
import { putEvidence, wav16 } from '../501/helpers.ts';

export { FLICKS, FULL, TIMEOUT, arr, isObject, none, obj, run, show, useBuilds, type JsonObject, type JsonValue, type Row, type Verdict };

/**
 * Each criterion's number and ID, which start its tests' names: `AC<n> #409.` and the first 8 hex digits of SHA-256 of
 * its checkbox text after `- [ ] `, trimmed, white space collapsed (scripts/proof-change.mjs, `criterionId`).
 */
export const AC = {
  1: 'AC1 #409.1b284d72', 2: 'AC2 #409.c9b3929c', 3: 'AC3 #409.b866029a', 4: 'AC4 #409.063c7b10', 5: 'AC5 #409.0dc34e08', 6: 'AC6 #409.c2d0c9cf',
} as const;

/** Every craft@1 check, as the issue's Fields list them (README: The checks). */
export const CHECKS = [
  'shot_length', 'camera_grammar', 'ends', 'text_led', 'look_lock', 'recipes', 'numbers_in_script', 'caption_band', 'motion_share', 'accents',
  'not_example', 'silences', 'sound_coverage', 'sound_bridges', 'mix.balance', 'sound_lock',
] as const;
export type Check = (typeof CHECKS)[number];
/** The code each check fails with (README: The codes); camera_grammar's jump cut and line each have their own. */
export const code = (check: Check): string => `craft.${check}`;
export const JUMP_CUT = 'craft.camera_grammar.jump_cut';
export const LINE = 'craft.camera_grammar.line';
/** The planted programs (README: Planted programs), each reachable only through the scenario's `planted`. */
export type Planted = 'craft_threshold_from_agent' | 'craft_runs_every_check' | 'craft_camera_by_label' | 'craft_jump_cut_angle_only';

/** A precondition that isn't the criterion: when it doesn't hold, the test fails as BLOCKED, naming it. */
export function blockedUnless(ok: boolean, why: string): void {
  expect(ok, `BLOCKED: ${why}`).toBe(true);
}

/** Time as the time grammar writes it: `<n>s`. */
export const sec = (s: number): string => `${Number(s.toFixed(6))}s`;

/** Fresh folders for a test (evidence stores, exports, packs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-409-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: The films). 2D films are 320 × 180 u at 24 frames a second, so 1 u is 1 px, on a 2D camera `cam`;
// a shot frames the whole page unless it says otherwise. The agent's payload carries no layers: the hub stamps its own.

export const SIZE: [number, number] = [320, 180];
export const order = (k: number): string => `b${String(k).padStart(4, '0')}`;

/** The looks: `lk-a`, every film's own, and `lk-b`, another one a shot can name (built by #407's `lookOf`). */
export const LOOK_A = (): ReturnType<typeof lookOf> => lookOf('lk-a', { ground: 255, muted: 124, accent: 160, raised: 245 });
export const LOOK_B = (): ReturnType<typeof lookOf> => lookOf('lk-b', { ground: 240, muted: 90, accent: 200, raised: 230 });
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the #409 acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };

/** A 2D camera@1 over a page, y down. */
export const camera2d = (size: [number, number] = SIZE): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a00cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } });
/** A shot `[start, end)` on `cam`, framing the whole page (or `target` and `view_width`), with the rest of its fields. */
export function shot(start: number, end: number, fields: JsonObject = {}, size: [number, number] = SIZE): JsonObject {
  return { start: sec(start), end: sec(end), camera: 'cam', move: 'hold', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0], ...fields };
}
/** Consecutive shots `shot-1`, `shot-2`, … of the given lengths, from 0 s, each with its own fields. */
export function shotsOf(lengths: number[], fields: (k: number) => JsonObject = () => ({})): JsonObject {
  const out: JsonObject = {};
  let t = 0;
  lengths.forEach((len, i) => { out[`shot-${i + 1}`] = shot(t, t + len, fields(i + 1)); t += len; });
  return out;
}
/** A filled rect@1 in `role`, its box [x, y, w, h] in u. */
export const rect = (id: string, box: [number, number, number, number], role: string, k: number): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role } } } });
/** A text@1: `words` at `size` u in a box `w` × `h` u whose top left is (x, y). */
export const text = (id: string, words: string, k: number, at: [number, number], o: { size?: number; w?: number; h?: number } = {}): JsonObject =>
  ({ id, kind: 'text@1', name: `Text ${id}`, order: order(k), params: { text: words, font: 'body', size: o.size ?? 14, box: { w: o.w ?? 280, h: o.h ?? 40 }, align: 'start' }, at: { pos: [at[0], at[1], 0] } });
/** A channel whose keys hold: each value from its time until the next key's. */
export function holdKeys(target: string, type: string, keys: [number, JsonValue][]): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map(([t, value], i) => [`k${String(i).padStart(3, '0')}`, { t: sec(t), value, interp: 'hold' }])) };
}
/** A channel whose keys interpolate linearly. */
export function linearKeys(target: string, type: string, keys: [number, JsonValue][]): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map(([t, value], i) => [`k${String(i).padStart(3, '0')}`, { t: sec(t), value, interp: 'linear' }])) };
}
/** Shown only over `[from, to)`: its `adjust.opacity` held at 0, then 1 from `from`, then 0 from `to`. */
export const shownOver = (id: string, from: number, to: number): JsonObject =>
  holdKeys(`items/${id}/adjust/opacity`, 'f32', [[0, from <= 0 ? 1 : 0], ...(from > 0 ? [[from, 1] as [number, JsonValue]] : []), [to, 0]]);
/** Markers `[id, kind, t s, span s, tags]`. */
export function markers(list: [string, string, number, number, string[]?][]): JsonObject {
  return Object.fromEntries(list.map(([id, kind, t, span, tags]) => [id, { kind, name: `${kind} ${id}`, t: sec(t), ...(span ? { span: sec(span) } : {}), ...(tags ? { tags } : {}) }]));
}
/** A tempo map of one segment at `bpm` in 4/4, `beats` long. */
export const tempoMap = (bpm: number, beats: number): JsonObject => ({ segments: [{ at: '0s', bpm, meter: [4, 4], span: beats, ramp: 'none' }] });

export interface FilmOptions {
  span: number; fps?: number; size?: [number, number]; shots: JsonObject; camera?: JsonObject; transitions?: JsonObject; markers?: JsonObject;
  channels?: JsonObject; extra?: JsonObject; assets?: JsonObject;
  /** A 3D film: no look of ours (a drawing look), and scene3d among the modules it requires. */
  threeD?: boolean;
}
/** A film under the look `lk-a` (and `lk-b` among its assets), the camera first among its items. */
export function film(doc: string, title: string, items: JsonObject[], o: FilmOptions): JsonObject {
  const size = o.size ?? SIZE;
  const all = [o.camera ?? camera2d(size), ...items];
  return {
    format: 1, id: doc, profile: 'film', title, description: `${title}: a film the #409 acceptance tests judge.`.slice(0, 400),
    size, safe: 8, camera: 'cam', locale: 'en',
    transport: { frame_rate: `${o.fps ?? 24}/1`, span: sec(o.span), reduced_motion: 'hold', ...(o.extra?.['strips'] ? { sample_rate: 48_000 } : {}) },
    ...(o.threeD ? { requires: { modules: { scene3d: '^1' } } } : { look: { asset: 'lk-a@1', theme: 'light' } }),
    assets: { ...(o.threeD ? {} : { 'lk-a': { sha256: LOOK_A().sha, license: LICENSE }, 'lk-b': { sha256: LOOK_B().sha, license: LICENSE } }), ...(o.assets ?? {}) },
    items: Object.fromEntries(all.map((i) => [String(i['id']), i])),
    shots: o.shots,
    ...(o.transitions ? { transitions: o.transitions } : {}),
    ...(o.markers ? { markers: o.markers } : {}),
    ...(o.channels ? { channels: o.channels } : {}),
    ...(o.extra ?? {}),
  };
}
/** The looks' bytes, which every film's evidence store holds. */
export const LOOKS = (): Buffer[] => [LOOK_A().bytes, LOOK_B().bytes];

/** The subject every plain shot shows: a shape, never text. */
export const subject = (k = 0): JsonObject => rect('subject', [40, 40, 80, 60], 'muted', k);
/** A text-led card: 14 words over most of the frame (more than `words`, 8, and most of its area). */
export const CARD_WORDS = 'Every kettle in this town sings a little louder when the morning frost arrives early';
export const card = (k: number): JsonObject => text('card', CARD_WORDS, k, [12, 20], { size: 22, w: 296, h: 130 });

// ---------------------------------------------------------------------------------------------------
// The scenario: the claim's agent and your shell, a panel per film, the films the agent presents, the fixture films you
// present, the exports, and one verdict per claim.

export const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB409D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB409C', n)}`;

/** A film a test judges: a name for messages, its document ID, the document the agent presents, its claim's brief. */
export interface Film { name: string; doc: string; document: JsonObject; brief: JsonObject; exported?: boolean }
/** A film the hub holds only as a fixture (not_example's), presented by you. */
export interface Fixture { doc: string; document: JsonObject }
export interface Extra {
  planted?: Planted; packs?: { id: string; dir: string }[]; fixtures?: Fixture[];
  /** The folder the exports go to, each `<film name>.mp4`; `silent`: the films have no sound, so the export asks for none. */
  out?: string; silent?: boolean;
}

/** The agent's `deep_show` of a whole document (#393): no layers in the payload. */
export function agentShow(doc: string, document: JsonObject): JsonObject {
  return { call: 'deep_show', session: ALPHA.id, doc, document: payload(document), include: ['issues'] };
}
/** `deep show` of a whole document from your shell. */
export function youShow(doc: string, document: JsonObject): JsonObject {
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload(document), include: ['issues'] };
}
function payload(document: JsonObject): JsonObject {
  const p = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete p['layers'];
  for (const item of Object.values(isObject(p['items']) ? p['items'] : {})) if (isObject(item)) delete item['layer'];
  return p;
}
/** An export of a film to an MP4 (#501's `export`, #502's audio): what a sound check reads its bakes from. */
export const exportCall = (doc: string, out: string, silent = false): JsonObject =>
  ({ call: 'export', doc, out, video: { codec: 'h264' }, ...(silent ? {} : { audio: { codec: 'aac' } }) });

/**
 * The scenario: a panel per document; your fixtures, then each film presented by the agent; then each exported film's
 * export (into `extra.out`); then one `verdict` per film, each on a claim of the agent's whose one deliverable is the
 * film, with no requirement but the film's brief.
 */
export function scenarioOf(evidence: string, films: readonly Film[], extra: Extra = {}): JsonObject {
  const fixtures = extra.fixtures ?? [];
  const docs: JsonObject = {};
  const panels: JsonObject = {};
  [...fixtures.map((f) => f.doc), ...films.map((f) => f.doc)].forEach((d, i) => {
    panels[`p${i}`] = { rect: [0, 0, 640, 360] };
    docs[d] = { panel: `p${i}` };
  });
  const claims: JsonObject = {};
  films.forEach((f, i) => { claims[claimId(i + 1)] = { session: ALPHA.id, deliverables: [f.doc], requirements: [], brief: f.brief }; });
  const exported = films.filter((f) => f.exported);
  if (exported.length) expect(extra.out, 'a scenario with exports names their folder').toBeTruthy();
  const calls: JsonObject[] = [
    ...fixtures.map((f) => youShow(f.doc, f.document)),
    ...films.map((f) => agentShow(f.doc, f.document)),
    ...exported.map((f) => exportCall(f.doc, join(extra.out ?? '', `${f.name.replace(/[^a-z0-9]+/gi, '-')}.mp4`), extra.silent)),
    ...films.map((_, i) => ({ call: 'verdict', claim: claimId(i + 1) })),
  ];
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs, claims,
    ...(extra.packs ? { packs: extra.packs as unknown as JsonValue } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}

/** One judged film: its claim's verdict and every craft row, by check. */
export interface Judged { verdict: Verdict; craft: Map<string, Row[]> }
/** The rows a brief's craft checks add (README: The rows): those whose `from` names a craft check, by that check. */
export function craftRows(v: Verdict): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of v.rows) {
    const from = r.raw['from'];
    if (!isObject(from) || typeof from['craft'] !== 'string') continue;
    out.set(from['craft'], [...(out.get(from['craft']) ?? []), r]);
  }
  return out;
}

/**
 * Runs the scenario on this machine and reads it: every presentation must be presented and every export written
 * (BLOCKED otherwise, naming the film); then each film's verdict and craft rows, by name.
 */
export function judge(bin: string, evidence: string, films: readonly Film[], extra: Extra = {}): { judged: Record<string, Judged>; replies: JsonObject[] } {
  storeLooks(evidence);
  const replies = run(bin, scenarioOf(evidence, films, extra));
  const fixtures = extra.fixtures ?? [];
  fixtures.forEach((f, i) => {
    const r = replies[i]!;
    blockedUnless(r['outcome'] === 'presented', `the fixture film ${f.doc} is presented by your deep show: ${show(r, 1500)}`);
  });
  films.forEach((f, i) => {
    const r = replies[fixtures.length + i]!;
    blockedUnless(r['outcome'] === 'presented', `${f.name} is presented by the agent's deep_show: ${show(r['issues'] ?? r, 1500)}`);
  });
  let k = fixtures.length + films.length;
  for (const f of films.filter((x) => x.exported)) {
    const r = replies[k++]!;
    blockedUnless(r['outcome'] === 'exported', `${f.name} is exported to an MP4 before its verdict: ${show(r, 1500)}`);
  }
  const judged: Record<string, Judged> = {};
  films.forEach((f, i) => {
    const verdict = verdictOf(obj(replies[k + i], `the verdict on ${f.name}`), `the verdict on ${f.name}`);
    judged[f.name] = { verdict, craft: craftRows(verdict) };
  });
  return { judged, replies };
}

// ---------------------------------------------------------------------------------------------------
// Reading craft rows and their issues (README: The rows, The codes)

const rowLine = (row: Row): string => `${row.result} ${show(row.issues.map((i) => i.raw), 1200)}${row.blocked.length ? ` blocked ${show(row.blocked, 400)}` : ''}`;
/** The one row from `check` on a judged film, or a failure saying how many there were. */
function oneRow(j: Judged | undefined, check: string, what: string): { row?: Row; failure?: string } {
  if (!j) return { failure: `${what} has no verdict` };
  const rows = j.craft.get(check) ?? [];
  if (rows.length !== 1) return { failure: `${what}: ${rows.length} rows come from the brief's craft check ${check}, not one: ${show(j.verdict.rows.map((r) => r.raw), 1200)}` };
  return { row: rows[0]! };
}
/** The check's row PASSes, raising no error and no warning. */
export function passes(j: Judged | undefined, check: string, what: string): string[] {
  const { row, failure } = oneRow(j, check, what);
  if (!row) return [failure!];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what}: ${check} is ${row.result}, not PASS: ${rowLine(row)}`);
  const raised = row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  if (raised.length) failures.push(`${what}: ${check} raises ${raised.map((i) => i.code).join(', ')}: ${show(raised.map((i) => i.raw))}`);
  return failures;
}
/** The frame an issue names, in seconds; null when it names none. */
export const timeOf = (issue: JsonObject): number | null => secondsOf(field(issue, 't'));
/** What a failing issue must show: the shots it names (all, or any one of `anyOf`) and its frame. */
export interface Expect { shots?: string[]; anyOf?: string[]; t?: number; within?: number; tIn?: [number, number] }
/**
 * The check's row FAILs with an error of `code` that names the shot(s) and the frame, as criterion 1's "fails with its
 * code, the shot and the frame". A shot is named when its ID is a value of the issue other than its prose (`shot`,
 * `shots`, `ids` or a field of `actual`); the frame is `t`, within half a frame at 24 fps unless said otherwise.
 */
export function failsWith(j: Judged | undefined, check: string, wanted: string, e: Expect, what: string): string[] {
  const { row, failure } = oneRow(j, check, what);
  if (!row) return [failure!];
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what}: ${check} is ${row.result}, not FAIL: ${rowLine(row)}`);
  const errors = row.issues.filter((i) => i.code === wanted && i.severity === 'error').map((i) => i.raw);
  const subject = e.shots ? e.shots.join(' and ') : `one of ${(e.anyOf ?? []).join(', ')}`;
  if (!errors.length) return [...failures, `${what}: no ${wanted} error names ${subject} on ${check}'s row: ${show(row.issues.map((i) => i.raw))}`];
  const names = (i: JsonObject): boolean => (e.shots ? e.shots.every((s) => mentions(i, s)) : (e.anyOf ?? []).some((s) => mentions(i, s)));
  const atT = (i: JsonObject): boolean => {
    const t = timeOf(i);
    if (t === null) return false;
    if (e.t !== undefined && Math.abs(t - e.t) > (e.within ?? 1 / 48) + 1e-9) return false;
    return !(e.tIn && (t < e.tIn[0] - 1e-9 || t > e.tIn[1] + 1e-9));
  };
  if (!errors.some((i) => names(i) && atT(i))) {
    const i = errors.find(names) ?? errors[0]!;
    if (!names(i)) failures.push(`${what}: the ${wanted} error doesn't name the shot ${subject}: ${show(i)}`);
    else failures.push(`${what}: the ${wanted} error naming ${subject} names the frame t = ${show(field(i, 't'))}, not ${e.t !== undefined ? `${e.t} s` : `one in [${e.tIn![0]}, ${e.tIn![1]}] s`}`);
  }
  return failures;
}
/** No error of `wanted` on any row of the verdict names `shot`. */
export function noErrorNaming(j: Judged | undefined, wanted: string, shot: string, what: string): string[] {
  if (!j) return [`${what} has no verdict`];
  const hits = j.verdict.rows.flatMap((r) => r.issues).filter((i) => i.code === wanted && i.severity === 'error' && mentions(i.raw, shot));
  return hits.length ? [`${what}: a ${wanted} error names ${shot}: ${show(hits.map((i) => i.raw))}`] : [];
}
/** A craft row's measure (README: The rows: `measure`). */
export function measureOf(j: Judged | undefined, check: string, what: string): JsonObject {
  const { row, failure } = oneRow(j, check, what);
  expect(failure, failure ?? '').toBeUndefined();
  return obj(row!.raw['measure'], `${what}: ${check}'s row's measure`);
}

// ---------------------------------------------------------------------------------------------------
// The brief (README: The brief): `craft: [{check, …its fields}]` beside #407's goal, moments, holds, cues and sources.

export const GOAL = 'A short film about a kettle that reads as a film, not a slide deck';
export const briefOf = (...checks: JsonObject[]): JsonObject => ({ goal: GOAL, craft: checks });
export const named = (check: Check, fields: JsonObject = {}): JsonObject => ({ check, ...fields });

// ---------------------------------------------------------------------------------------------------
// Sound (Strip and track, Bus): tones and clicks as 16-bit stereo WAVs at 48 kHz in the evidence store, each a strip on
// its own track and a bus of the three the films hold: ambience, foley and music.

export const RATE = 48_000;
/** A sine of `hz` at `amp` (peak, linear) for `seconds`, with 5 ms ramps. */
export function tone(hz: number, amp: number, seconds: number): Float32Array {
  const n = Math.round(seconds * RATE);
  const ramp = Math.round(0.005 * RATE);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.min(1, i / ramp, (n - 1 - i) / ramp) * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
}
/** A click: 30 ms of 3 kHz at 0.5 that starts at full level and dies away. */
export function click(): Float32Array {
  const n = Math.round(0.03 * RATE);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * (1 - i / n) * Math.sin((2 * Math.PI * 3000 * i) / RATE);
  return x;
}
/** A strip: an asset (its samples) from `start` s on `bus`. */
export interface StripSpec { id: string; samples: Float32Array; start: number; bus: 'ambience' | 'foley' | 'music' }
/** The sound fields of a film: its assets (stored now), strips and buses. */
export function sound(evidence: string, strips: StripSpec[]): { assets: JsonObject; extra: JsonObject } {
  const assets: JsonObject = {};
  const out: JsonObject = {};
  strips.forEach((s, i) => {
    const sha = putEvidence(evidence, wav16([s.samples, Float32Array.from(s.samples)], RATE));
    assets[s.id] = { sha256: sha, license: LICENSE };
    out[s.id] = { track: i + 1, src: sha, start: sec(s.start), in: 0, out: s.samples.length * (FLICKS / RATE), rate: 1, bus: s.bus };
  });
  return { assets, extra: { strips: out, buses: { ambience: {}, foley: {}, music: {} } } };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's films: per check, its parity fixture and its planted-fault twin (README: Criterion 1's table).

const THREE = [3, 3, 3];
/** A film of plain shots of `lengths` showing the subject, plus `items` and `channels`. */
function plain(doc: string, title: string, lengths: number[], items: JsonObject[] = [], o: Partial<FilmOptions> = {}): JsonObject {
  return film(doc, title, [subject(0), ...items], { span: lengths.reduce((a, b) => a + b, 0), shots: shotsOf(lengths), ...o });
}

/** shot_length: three 3 s shots; the twin's second shot is 1 s, under `min` (2 s). */
export const shotLengthFilm = (doc: string, twin: boolean): JsonObject => plain(doc, twin ? 'A 1 s shot' : 'Three 3 s shots', twin ? [3, 1, 3] : THREE);
/** ends: three plain shots; the twin's last shot is led by text (the card over it). */
export const endsFilm = (doc: string, twin: boolean): JsonObject =>
  plain(doc, twin ? 'Ends on a text card' : 'Ends on a shape', THREE, twin ? [card(1)] : [], twin ? { channels: { card: shownOver('card', 6, 9) } } : {});
/** text_led: one text-led shot, the second: of four shots (0.25 ≤ 0.30), or of three in the twin (0.33 > 0.30). */
export const textLedFilm = (doc: string, twin: boolean): JsonObject =>
  plain(doc, twin ? 'One text-led shot of three' : 'One text-led shot of four', twin ? THREE : [3, 3, 3, 3], [card(1)], { channels: { card: shownOver('card', 3, 6) } });
/** look_lock: three shots on the film's look; the twin's third shot names the look lk-b. */
export function lookLockFilm(doc: string, twin: boolean): JsonObject {
  return film(doc, twin ? 'A second look in the third shot' : 'One look', [subject(0)], { span: 9, shots: shotsOf(THREE, (k) => (twin && k === 3 ? { look: 'lk-b' } : {})) });
}
/**
 * numbers_in_script: "42 cups" on screen over the second shot (a story number through a template, so honest numbers
 * passes it); the script's caption line says 42, or, in the twin, says no number.
 */
export function numbersFilm(doc: string, twin: boolean): JsonObject {
  const line = twin ? 'We pour the cups for everyone.' : 'We pour 42 cups for everyone.';
  const count = { id: 'count', kind: 'text@1', name: 'Text count', order: order(1), params: { template: '{data/cups} cups', font: 'body', size: 20, box: { w: 120, h: 30 }, align: 'start' }, at: { pos: [140, 60, 0] } };
  return plain(doc, twin ? 'A number the script never says' : 'A number the script says', THREE, [count], {
    channels: { count: shownOver('count', 3, 6) },
    extra: {
      data: { cups: { value: 42, source: 'story' } },
      script: { lines: { l1: { t: '3s', text: line, kind: 'caption' } }, captions: { profile: 'netflix-en-adult', font: 'body', size: 10 } },
    },
  });
}
/** caption_band: a caption over the second shot, and a label above the band (y 100) or, in the twin, in it (y 154). */
export function captionBandFilm(doc: string, twin: boolean): JsonObject {
  return plain(doc, twin ? 'A label in the caption band' : 'A label above the caption band', THREE, [text('label', 'Look here', 1, [200, twin ? 154 : 100], { size: 12, w: 100, h: 16 })], {
    channels: { label: shownOver('label', 3, 6) },
    extra: { script: { lines: { l1: { t: '3s', text: 'The kettle sings.', kind: 'caption' } }, captions: { profile: 'netflix-en-adult', font: 'body', size: 10 } } },
  });
}

// ---- recipes: a pack of three recipes written at test time, each one rect; the page holds three regions side by side.

export const REEL = { id: 'acme/reel', version: '1.0.0', recipes: ['reel.title@1', 'reel.badge@1', 'reel.chart@1'] } as const;
/** Writes the pack acme/reel@1.0.0 into `root`: three recipes, each a 2D rect (Pack; packs written at test time). */
export function writeReel(root: string): { id: string; dir: string } {
  const dir = join(root, 'reel-1.0.0');
  mkdirSync(dir, { recursive: true });
  const recipes: JsonObject = {};
  REEL.recipes.forEach((name, i) => {
    const file = `${name}.json`;
    recipes[name] = file;
    const id = name.replace(/@\d+$/, '');
    writeFileSync(join(dir, file), `${JSON.stringify({
      id, version: '1.0', title: id, license: 'MIT', author: 'the #409 acceptance tests',
      description: `A recipe of the #409 acceptance tests' pack: one rect, ${60 + 10 * i} u square.`,
      inputs: {}, steps: { block: { op: 'mark', kind: 'rect@1', params: { box: [0, 0, 60 + 10 * i, 60 + 10 * i], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } } },
      outputs: { parts: ['block'] },
    }, null, 2)}\n`);
  });
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    name: 'reel', version: REEL.version, license: 'MIT', description: 'A test pack of the #409 acceptance suite: three recipes a film can use.',
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' } }, recipes,
  }, null, 2)}\n`);
  return { id: REEL.id, dir };
}
/** recipes: shot k frames region k of a 960 × 180 page; two recipes' instances (regions 1, 2), or three in the twin. */
export function recipesFilm(doc: string, twin: boolean): JsonObject {
  const at = (k: number): JsonObject => ({ target: [160 + 320 * (k - 1), 90, 0], view_width: 320 });
  const inst = (id: string, kind: string, k: number, region: number): JsonObject =>
    ({ id, kind, name: `Instance ${id}`, order: order(k), params: {}, at: { pos: [320 * region + 120, 50, 0] } });
  const items = [inst('r1', REEL.recipes[0], 1, 0), inst('r2', REEL.recipes[1], 2, 1), twin ? inst('r3', REEL.recipes[2], 3, 2) : rect('plain-3', [760, 50, 60, 60], 'muted', 3)];
  return { ...film(doc, twin ? 'Three recipes' : 'Two recipes', items, { span: 9, shots: shotsOf(THREE, at) }), packs: [`${REEL.id}@${REEL.version}`] };
}

// ---- motion share: the lane's films (README: The motion films), 640 × 360 at 12 frames a second.

export const MOTION_SIZE: [number, number] = [640, 360];
/** A region's camera pose: region k (0, 1, 2) of a 1920 × 360 page. */
const region = (k: number): JsonObject => ({ target: [320 + 640 * k, 180, 0], view_width: 640 });
/** The regions' still shapes: A white with two ink bars, B a muted panel with two white bars, C a raised panel with six ink blocks. */
function regions(k0: number): JsonObject[] {
  return [
    rect('a-bar-1', [20, 8, 120, 24], 'ink', k0), rect('a-bar-2', [500, 8, 120, 24], 'ink', k0 + 1),
    rect('b-panel', [640, 0, 640, 360], 'muted', k0 + 2), rect('b-bar-1', [660, 8, 120, 24], 'ground', k0 + 3), rect('b-bar-2', [1140, 8, 120, 24], 'ground', k0 + 4),
    rect('c-panel', [1280, 0, 640, 360], 'raised', k0 + 5),
    ...[0, 1, 2, 3, 4, 5].map((i) => rect(`c-block-${i + 1}`, [1310 + 100 * i, 60 + 40 * (i % 3), 60, 60], 'ink', k0 + 6 + i)),
  ];
}
/**
 * The lively film, 12 s: shot-a (region A, 0-4 s), a cut at 4 s, shot-b (region B, 4-8 s), a 2 s cross-fade centred on
 * 8 s (7-9 s), shot-c (region C, 8-12 s). A 60 × 240 bar sweeps across A from 1 s to 2 s and across B from 5 s to 6 s,
 * 48 u a twelfth of a second, so 24 of the film's pairs at 12 fps move far more than 9 levels and every other pair
 * barely moves. With `blank`, a muted cover hides all of region B from 6 s to 6.75 s.
 */
export function livelyFilm(doc: string, blank = false): JsonObject {
  const sweep = (id: string, x0: number, from: number): JsonObject => linearKeys(`items/${id}/at/pos`, 'vec3', [[0, [x0, 0, 0]], [from, [x0, 0, 0]], [from + 1, [x0 + 576, 0, 0]], [12, [x0 + 576, 0, 0]]]);
  const items = [
    ...regions(1),
    { ...rect('sweep-a', [0, 40, 60, 240], 'ink', 20), at: { pos: [2, 0, 0] } },
    { ...rect('sweep-b', [0, 40, 60, 240], 'ground', 21), at: { pos: [642, 0, 0] } },
    ...(blank ? [rect('cover', [640, 0, 640, 360], 'muted', 30)] : []),
  ];
  return film(doc, blank ? 'The lively film with a blank stretch' : 'The lively film', items, {
    span: 12, fps: 12, size: MOTION_SIZE, camera: camera2d(MOTION_SIZE),
    shots: { 'shot-a': shot(0, 4, region(0), MOTION_SIZE), 'shot-b': shot(4, 8, region(1), MOTION_SIZE), 'shot-c': shot(8, 12, region(2), MOTION_SIZE) },
    transitions: { 'fade-bc': { from: 'shot-b', to: 'shot-c', kind: 'cross_fade', span: '2s', align: 'center' } },
    channels: { 'sweep-a': sweep('sweep-a', 2, 1), 'sweep-b': sweep('sweep-b', 642, 5), ...(blank ? { cover: shownOver('cover', 6, 6.75) } : {}) },
  });
}
/** The slow film, 9 s: three 3 s shots of regions A, B and C, each a slow push of 7.5%, joined by cuts. */
export function slowFilm(doc: string): JsonObject {
  return film(doc, 'The slow film', regions(1), {
    span: 9, fps: 12, size: MOTION_SIZE, camera: camera2d(MOTION_SIZE),
    shots: Object.fromEntries([0, 1, 2].map((k) => [`slow-${k + 1}`, shot(3 * k, 3 * k + 3, { ...region(k), move: 'push', by: 0.075 }, MOTION_SIZE)])),
  });
}

// ---- accents: a slam at 3 s, marked as an accent, on the beat; its click on time, or 6 frames late in the twin.

export function accentsFilm(doc: string, evidence: string, twin: boolean): JsonObject {
  const s = sound(evidence, [{ id: 'hit', samples: click(), start: twin ? 3.25 : 3, bus: 'foley' }]);
  return plain(doc, twin ? 'A slam whose click lands late' : 'A slam with its click', THREE, [], {
    shots: shotsOf(THREE, (k) => (k === 2 ? { move: 'slam' } : {})), assets: s.assets,
    markers: markers([['accent-1', 'moment', 3, 0, ['accent']]]),
    extra: { ...s.extra, tempo_map: tempoMap(120, 18) },
  });
}

// ---- the sound films (Sound and video on the picture's clock), each exported before its verdict.

/** silences: an ambience bed with gaps at 2-2.8 s and 5-5.8 s; the twin puts a cue marker inside the second gap. */
export function silencesFilm(doc: string, evidence: string, twin: boolean): JsonObject {
  const s = sound(evidence, [
    { id: 'amb-1', samples: tone(440, 0.1, 2), start: 0, bus: 'ambience' },
    { id: 'amb-2', samples: tone(440, 0.1, 2.2), start: 2.8, bus: 'ambience' },
    { id: 'amb-3', samples: tone(440, 0.1, 3.2), start: 5.8, bus: 'ambience' },
  ]);
  return plain(doc, twin ? 'A cue inside a silence' : 'Two clean silences', THREE, [], { assets: s.assets, extra: s.extra, ...(twin ? { markers: markers([['cue-1', 'cue', 5.4, 0]]) } : {}) });
}
/** sound_coverage: ambience, foley and music beds over the one section, and an action moment at 4 s with its hit at 4 s (or 4.25 s). */
export function coverageFilm(doc: string, evidence: string, twin: boolean): JsonObject {
  const s = sound(evidence, [
    { id: 'amb', samples: tone(200, 0.05, 9), start: 0, bus: 'ambience' },
    { id: 'mus', samples: tone(523.25, 0.05, 9), start: 0, bus: 'music' },
    { id: 'fol', samples: tone(1500, 0.03, 9), start: 0, bus: 'foley' },
    { id: 'hit', samples: click(), start: twin ? 4.25 : 4, bus: 'foley' },
  ]);
  return plain(doc, twin ? 'An action whose hit lands late' : 'Every bed and the action covered', THREE, [], {
    assets: s.assets, extra: s.extra, markers: markers([['sec-1', 'section', 0, 9], ['act-1', 'moment', 4, 0, ['action']]]),
  });
}
/** sound_bridges: strips that cross both cuts by 0.5 s; in the twin a 0.2 s hush sits over the cut at 3 s. */
export function bridgesFilm(doc: string, evidence: string, twin: boolean): JsonObject {
  const spans: [number, number][] = twin ? [[0, 2.9], [3.1, 6.5], [6.5, 9]] : [[0, 3.5], [3.5, 6.5], [6.5, 9]];
  const s = sound(evidence, spans.map(([a, b], i) => ({ id: `bed-${i + 1}`, samples: tone([330, 392, 494][i]!, 0.1, b - a), start: a, bus: 'ambience' as const })));
  return plain(doc, twin ? 'One cut with no sound across it' : 'Sound across both cuts', THREE, [], { assets: s.assets, extra: s.extra });
}
/** mix.balance: a music bus of 1 kHz; in the twin the second shot's music is 60 Hz at 0.5 under 1 kHz at 0.1 elsewhere. */
export function balanceFilm(doc: string, evidence: string, twin: boolean): JsonObject {
  const strips: StripSpec[] = twin
    ? [{ id: 'mus-1', samples: tone(1000, 0.1, 3), start: 0, bus: 'music' }, { id: 'mus-2', samples: tone(60, 0.5, 3), start: 3, bus: 'music' }, { id: 'mus-3', samples: tone(1000, 0.1, 3), start: 6, bus: 'music' }]
    : [{ id: 'mus', samples: tone(1000, 0.1, 9), start: 0, bus: 'music' }];
  const s = sound(evidence, strips);
  return plain(doc, twin ? 'Music heavy in the lows' : 'Balanced music', THREE, [], { assets: s.assets, extra: s.extra });
}
/** sound_lock: a score whose pad is in the palette; the twin adds a horn whose first note is at bar 2 beat 3 (3 s at 120 BPM). */
export const PALETTE = ['pad'];
export function lockFilm(doc: string, twin: boolean): JsonObject {
  const inst = (preset: string, stem: string): JsonObject => ({ source: { synth: { preset } }, stem });
  const instruments: JsonObject = { pad: inst('pad', 'pad'), ...(twin ? { horn: inst('saw', 'horn') } : {}) };
  const events: JsonObject = {
    e1: { at: '1:1', inst: 'pad', pitch: 60, dur: 4, vel: 0.6 }, e2: { at: '3:1', inst: 'pad', pitch: 64, dur: 4, vel: 0.6 }, e3: { at: '5:1', inst: 'pad', pitch: 67, dur: 2, vel: 0.6 },
    ...(twin ? { h1: { at: '2:3', inst: 'horn', pitch: 72, dur: 2, vel: 0.6 } } : {}),
  };
  const score = { id: 'score', kind: 'score.music@1', name: 'Score', order: order(5), params: { instruments, events } };
  return plain(doc, twin ? 'A horn off the palette' : 'A score in the palette', THREE, [score], { extra: { tempo_map: tempoMap(120, 18) } });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4's presenter films: a presenter and a chart in 3D (Marks in 3D), a perspective camera.

/** The presenter, 1.8 m tall at the origin, and the chart 3 m to its right: the line through them is the plane z = 0. */
export function stage(): JsonObject[] {
  const box = (id: string, pos: [number, number, number], size: [number, number, number], role: string, k: number): JsonObject =>
    ({ id, kind: 'mark.box@1', name: `Box ${id}`, order: order(k), params: { size, paint: { fill: { role } } }, at: { pos } });
  return [box('presenter', [0, 0.9, 0], [0.5, 1.8, 0.4], 'accent', 1), box('chart', [3, 1.2, 0], [1.6, 1.0, 0.1], 'muted', 2)];
}
export const camera3d = (params: JsonObject = {}): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a00cam', params: { projection: 'perspective', target: [0, 0.9, 0], orbit: { azimuth: 0, elevation: 0, distance: 6 }, fov: 40, ...params } });
/** A medium shot of the presenter from `azimuth` degrees (0 puts the eye on +z), kept in frame at `fill` of the frame's height. */
export const medium = (start: number, end: number, azimuth: number, fill = 0.6): JsonObject =>
  ({ start: sec(start), end: sec(end), camera: 'cam', move: 'hold', orbit: { azimuth, elevation: 0 }, frame: { keep: ['presenter'], fill } });
/** Two medium shots joined by a cut at 3 s: `medium-a` from 0°, `medium-b` from `azimuth` at `fill`. */
export function presenterCut(doc: string, azimuth: number, fill = 0.6): JsonObject {
  return film(doc, `A cut between medium shots ${azimuth}° apart${fill !== 0.6 ? `, the second ${fill / 0.6} times taller` : ''}`, stage(), {
    span: 6, size: [640, 360], threeD: true, camera: camera3d(), shots: { 'medium-a': medium(0, 3, 0), 'medium-b': medium(3, 6, azimuth, fill) },
  });
}
/**
 * Three shots of the presenter: side-1 from −40°, side-2 from 20°, and side-3 an orbit of 60° about `third`° (110°:
 * from 80° to 140°, across the plane z = 0 through presenter and chart at 90°, ending behind it; −30°: from −60° to 0°,
 * in front of it throughout). Every cut turns 60° or more.
 */
export function lineFilm(doc: string, third: number): JsonObject {
  return film(doc, `Three shots, the third orbiting about ${third}°`, stage(), {
    span: 9, size: [640, 360], threeD: true, camera: camera3d(),
    shots: { 'side-1': medium(0, 3, -40), 'side-2': medium(3, 6, 20), 'side-3': { ...medium(6, 9, third), move: 'orbit', by: 60 } },
  });
}
/** One keyed shot labelled hold whose camera's own channel brings it from 5 m to `to` m (4: 20% closer; 4.8: 4%). */
export function keyedFilm(doc: string, to: number): JsonObject {
  return film(doc, `A keyed shot whose camera comes from 5 m to ${to} m`, stage(), {
    span: 3, size: [640, 360], threeD: true, camera: camera3d({ orbit: { azimuth: 30, elevation: 10, distance: 5 } }),
    shots: { 'keyed-1': { start: '0s', end: '3s', camera: 'cam', move: 'hold', keyed: true } },
    channels: { dolly: linearKeys('items/cam/params/orbit/distance', 'f32', [[0, 5], [3, to]]) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5's films (README: not_example): a fixture film and two films that differ from it on 3 and on 4 measures.

/**
 * Four 3 s shots of a 320 × 180 page: a wide hold, a push and a pan onto the subject, a wide hold; a 0.5 s cross-fade at
 * 6 s, the film's one transition that isn't a cut; a 120 BPM tempo map with two 3-bar sections. `differ` changes, in
 * order: the first shot's look (lk-b), the transition (a wipe), the tempo map's section shape (90 BPM, three sections
 * of 2, 4 and 6 s) and, with `moves`, the middle shots' camera moves (a pull and a hold).
 */
export function exampleFilm(doc: string, differ: { first?: boolean; transition?: boolean; tempo?: boolean; moves?: boolean } = {}): JsonObject {
  const near = { target: [80, 70, 0], view_width: 200 };
  const shots: JsonObject = {
    'part-1': shot(0, 3, differ.first ? { look: 'lk-b' } : {}),
    'part-2': shot(3, 6, { ...near, move: differ.moves ? 'pull' : 'push' }),
    'part-3': shot(6, 9, { ...near, move: differ.moves ? 'hold' : 'pan' }),
    'part-4': shot(9, 12),
  };
  const sections: [string, string, number, number][] = differ.tempo
    ? [['sec-1', 'section', 0, 2], ['sec-2', 'section', 2, 4], ['sec-3', 'section', 6, 6]]
    : [['sec-1', 'section', 0, 6], ['sec-2', 'section', 6, 6]];
  const what = Object.entries(differ).filter(([, v]) => v).map(([k]) => k).join(', ');
  return film(doc, what ? `The example, changed: ${what}` : 'The fixture film', [subject(0), rect('ground-line', [0, 150, 320, 6], 'ink', 1)], {
    span: 12, shots, transitions: { join: { from: 'part-2', to: 'part-3', kind: differ.transition ? 'wipe' : 'cross_fade', span: '0.5s', align: 'center' } },
    markers: markers(sections), extra: { tempo_map: tempoMap(differ.tempo ? 90 : 120, differ.tempo ? 18 : 24) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6's films: 3 s shots around 18 s long takes.

/** Shots of `lengths` seconds, `take-<n>` for each 18 s one and `shot-<n>` for the rest. */
export function takesFilm(doc: string, lengths: number[]): JsonObject {
  const shots: JsonObject = {};
  let t = 0;
  lengths.forEach((len, i) => { shots[len > 8 ? `take-${i + 1}` : `shot-${i + 1}`] = shot(t, t + len); t += len; });
  return film(doc, `Shots of ${lengths.join(', ')} s`, [subject(0)], { span: t, shots });
}

/**
 * The agent's own attempt at a threshold (README: The agent's threshold): its film's own `checks` hold a film.audit
 * input whose craft entry lowers shot_length's minimum to 0.5 s.
 */
export const withOwnThreshold = (document: JsonObject): JsonObject =>
  ({ ...document, checks: [{ kind: 'film.audit', craft: [{ check: 'shot_length', min: '0.5s' }] }] });

/** The evidence store a film needs before its scenario runs: the looks, by hash. */
export function storeLooks(evidence: string): void {
  for (const b of LOOKS()) putEvidence(evidence, b);
}
