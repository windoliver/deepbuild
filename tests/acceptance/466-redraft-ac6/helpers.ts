// Test-side tools for the blind redraft of #466's AC6: `deep-show run` (#393's scenarios, with #501's and #502's
// `export` of a film with a script, its captions receipt and `.srt` sidecar, and #403's claims and `verdict` with
// #1938's render.contrast), built once per file; the caption films the tests send and the looks they name. Nothing here
// stands in for the canvas: every value a test compares comes from the binary, every expected value from the issue's
// text and the design's caption layout rule, worked out by hand in the README.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/466-redraft-ac6 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = 'deep-show';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout (30 min): a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC6 = 'AC6 #466.84cc08bc';

// ---------------------------------------------------------------------------------------------------
// Time

export const FLICKS = 705_600_000;
export const FPS = 24;
/** One frame at 24 fps, in flicks. */
export const FRAME = FLICKS / FPS;
/** Flicks to the .srt's milliseconds, rounded down. */
export const ms = (flicks: number): number => Math.floor((flicks * 1000) / FLICKS);

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
/** A check that must fail on a wrong document: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong document passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build and the run

export function useShow(): () => string {
  let dir = ''; let bin = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-466-ac6-bin-'));
    const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    else { bin = join(dir, `${SHOW}-full`); copyFileSync(join(TARGET, 'debug', SHOW), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${SHOW} --no-default-features --features full`).toBe(''); return bin; };
}

/** Fresh folders for a test (evidence stores, export outputs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-466-ac6-')); made.push(d); return d; };
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

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
function putStore(evidence: string, bytes: Buffer): void {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
}

// ---------------------------------------------------------------------------------------------------
// The looks (README: The fixtures)

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };
/** The look's caption design, exactly as the tests write it on look@1 (README: Choices). */
export const CAPTIONS_DESIGN: JsonObject = { plate: 'card', entrance: 'unfold', text_after: 0.5, anchor: [0.5, 1], stage: 'after_finish' };
export interface Look { id: string; sha: string; bytes: Buffer }

/**
 * A look@1 on a drawing basis with flat roles (a white ground, a dark graphite ink, a light `raised`, a mid-grey
 * `muted`), with the caption design when `designed`, without any `captions` field otherwise. Its bytes go into the
 * evidence store.
 */
export function lookOf(designed: boolean): Look {
  const id = designed ? 'caption-look' : 'plain-look';
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0',
    description: designed ? 'A flat look that designs its captions as cards that unfold.' : 'A flat look that leaves its captions undesigned.',
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
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish: [],
    ...(designed ? { captions: CAPTIONS_DESIGN } : {}),
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: sha256(bytes), bytes };
}

// ---------------------------------------------------------------------------------------------------
// The films (README: The fixtures). 640 × 360 u at 24 fps; 1 u = 1 px; a mid-grey field over half the frame so no
// frame is one flat luma (the export refuses that as film.blank).

export const SIZE: [number, number] = [640, 360];
const LAYER = 'you-main';
/** The caption profile every film names (the design's profile for English). */
export const PROFILE = 'netflix-en-adult';

/** The designed caption's line: a `caption` line (no sound), 71 characters, so it wraps onto two lines. */
export const HARBOUR = { id: 'harbour', t: 0.5, text: 'A small lamp glows over the quiet harbour while the fishing boats sleep' } as const;
/** Its one caption by the layout rule (README: The expected captions): 24 fps frames 12 to 98. */
export const HARBOUR_CUE = {
  name: 'harbour.1', line: 'harbour', lines: ['A small lamp glows over the quiet harbour', 'while the fishing boats sleep'],
  in: 12 * FRAME, out: 98 * FRAME,
} as const;
/** The intertitle's words, and the line pointing at it with `shown_by`. */
export const INTERTITLE = 'intertitle';
export const SLEEPS = { id: 'sleeps', t: 0.5, text: 'The harbour sleeps' } as const;
/** Its one caption by the layout rule: frames 12 to 34. */
export const SLEEPS_CUE = { name: 'sleeps.1', line: 'sleeps', lines: ['The harbour sleeps'], in: 12 * FRAME, out: 34 * FRAME } as const;

/** The script's narrator, as #502's suite writes one: no speech job, a license that allows sharing, so an export may
 * carry the script's lines. */
const NARRATOR: JsonObject = { name: 'Captions only', license: LICENSE, synthetic: false };
function filmOf(doc: string, title: string, description: string, look: Look, span: number, items: JsonObject[], script: JsonObject): JsonObject {
  return {
    format: 1, id: doc, profile: 'film', title, description, size: SIZE, safe: 24, locale: 'en',
    transport: { frame_rate: `${FPS}/1`, span: `${span}s`, reduced_motion: 'hold' },
    look: { asset: `${look.id}@1`, theme: 'light' }, assets: { [look.id]: { sha256: look.sha, license: LICENSE } },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: LAYER }])),
    script: { narrator: NARRATOR, ...script },
  };
}
const field = (box: [number, number, number, number]): JsonObject => ({ id: 'field', kind: 'rect@1', name: 'Field', order: 'a0001', params: { box, paint: { fill: { role: 'muted' } } } });

/**
 * The harbour film: 5 s, a mid-grey field over the top half, and the one caption line `harbour` in a captions block
 * with the profile, the body font at 24 u and a plate in `plate` (`raised` for the film, `muted` for its contrast twin).
 */
export function harbourFilm(doc: string, look: Look, plate: 'raised' | 'muted'): JsonObject {
  return filmOf(doc, 'A harbour at night', 'A caption-only line the look designs, over a still field.', look, 5, [field([0, 0, 640, 180])], {
    lines: { [HARBOUR.id]: { t: `${HARBOUR.t}s`, text: HARBOUR.text, kind: 'caption' } },
    captions: { profile: PROFILE, font: 'body', size: 24, plate },
  });
}
/**
 * The intertitle film: 3 s, an intertitle (a text@1 of the caption's words, at 40 u in the text's default ink, centred on the white top
 * half, shown the whole film) over a mid-grey bottom half, and the caption line `sleeps` of the same words. With
 * `pointing`, the captions block names the intertitle as `shown_by`; without it, the control.
 */
export function intertitleFilm(doc: string, look: Look, pointing: boolean): JsonObject {
  const title: JsonObject = {
    id: INTERTITLE, kind: 'text@1', name: 'Intertitle', order: 'a0002',
    params: { text: SLEEPS.text, font: 'body', size: 40, box: { w: 560, h: 60 }, align: 'center' }, at: { pos: [40, 60, 0] },
  };
  return filmOf(doc, 'An intertitle', 'An intertitle whose words a caption line also carries.', look, 3, [field([0, 180, 640, 180]), title], {
    lines: { [SLEEPS.id]: { t: `${SLEEPS.t}s`, text: SLEEPS.text, kind: 'caption' } },
    captions: { profile: PROFILE, font: 'body', size: 24, plate: 'raised', ...(pointing ? { shown_by: INTERTITLE } : {}) },
  });
}

// ---------------------------------------------------------------------------------------------------
// Scenarios

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB466F', 1);
const CLAIM = `claim:${ulid('01JB466G', 1)}`;
const REQ = `req:${ulid('01JB466R', 1)}`;
const AGENT = { id: 'sess-alpha', thread: 'thread-alpha', name: 'An agent making films', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };

/** The export call: the whole film as a png_seq at 24 fps into `out`, its captions under the profile, the .srt beside. */
export const exportCall = (out: string, mode: 'open' | 'closed'): JsonObject => ({
  call: 'export', doc: DOC, out, frame_rate: [FPS, 1], video: { codec: 'png_seq' }, captions: { profile: PROFILE, files: ['srt'], mode },
});
/** The export scenario: `deep show` of the film from your shell (no `layers`, no item `layer`), then `calls`. */
export function exportScenario(evidence: string, film: JsonObject, looks: Look[], calls: JsonObject[]): JsonObject {
  for (const l of looks) putStore(evidence, l.bytes);
  const payload = JSON.parse(JSON.stringify(film)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(payload['items'] as JsonObject)) if (isObject(item)) delete item['layer'];
  return {
    evidence, sessions: {}, processes: PROCESSES, panels: PANELS, docs: { [DOC]: { panel: 'main' } },
    calls: [{ call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document: payload, include: ['issues'] }, ...calls],
  };
}
/** The judging scenario: the film stored as revision 0 (yours), one claim of the agent's on it with one requirement. */
export function judgeScenario(evidence: string, film: JsonObject, looks: Look[], check: JsonObject): JsonObject {
  for (const l of looks) putStore(evidence, l.bytes);
  return {
    evidence, processes: PROCESSES, panels: PANELS,
    sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } },
    docs: { [DOC]: { panel: 'main', document: film } },
    claims: { [CLAIM]: { session: AGENT.id, deliverables: [DOC], requirements: [{ id: REQ, check }] } },
    calls: [{ call: 'verdict', claim: CLAIM }],
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading an export

/** A caption cue as the receipt and the .srt give it. */
export interface Cue { name: string | null; lines: string[]; in: number; out: number }
export interface Exported { hashes: string[]; cues: Cue[]; srt: string | null }
/** A delivered export's frame hashes, its receipt's caption cues and its .srt beside `out`. */
export function exported(reply: JsonObject, out: string, what: string): Exported {
  expect(reply['outcome'], `${what} is exported: ${show(reply, 3000)}`).toBe('exported');
  const receipt = obj(reply['receipt'], `${what}: receipt`);
  const hashes = arr(receipt['frame_hashes'], `${what}: receipt.frame_hashes`).map(String);
  const captions = obj(receipt['captions'], `${what}: receipt.captions`);
  const cues = arr(captions['cues'], `${what}: receipt.captions.cues`).map((c, i) => {
    const o = obj(c, `${what}: cues[${i}]`);
    return { name: String(o['name']), lines: String(o['text']).split('\n'), in: Number(o['in']), out: Number(o['out']) };
  });
  const srtPath = `${out}.srt`;
  return { hashes, cues, srt: existsSync(srtPath) ? readFileSync(srtPath, 'utf8') : null };
}
/** A .srt's cues: numbered from 1, `HH:MM:SS,mmm --> HH:MM:SS,mmm` (in milliseconds here), then the caption's lines. */
export function srtCues(text: string): Cue[] {
  const toMs = (s: string): number => { const m = /^(\d+):(\d\d):(\d\d)[,.](\d\d\d)$/.exec(s.trim()); return m ? ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + +m[4]! : NaN; };
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => l !== '')).filter((b) => b.length >= 2).map((b) => {
    const [a, z] = b[1]!.split('-->');
    return { name: null, lines: b.slice(2), in: toMs(a ?? ''), out: toMs(z ?? '') };
  });
}
/** Where a cue list differs from the expected one, each failure naming the cue. */
export function cueFailures(got: Cue[], want: { name: string; lines: readonly string[]; in: number; out: number }[], unit: 'flicks' | 'ms', what: string): string[] {
  if (got.length !== want.length) return [`${what}: ${got.length} cues, not ${want.length}: ${JSON.stringify(got).slice(0, 600)}`];
  const failures: string[] = [];
  want.forEach((w, i) => {
    const g = got[i]!;
    const [wi, wo] = unit === 'ms' ? [ms(w.in), ms(w.out)] : [w.in, w.out];
    if (g.name !== null && g.name !== w.name) failures.push(`${what}: cue ${i + 1} is named ${g.name}, not ${w.name}`);
    if (JSON.stringify(g.lines) !== JSON.stringify(w.lines)) failures.push(`${what}: ${w.name} has the lines ${JSON.stringify(g.lines)}, not ${JSON.stringify(w.lines)}`);
    if (g.in !== wi || g.out !== wo) failures.push(`${what}: ${w.name} runs ${g.in} to ${g.out} ${unit}, not ${wi} to ${wo}`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Reading a verdict

export interface Row { result: string; issues: JsonObject[] }
export function rowOf(reply: JsonObject): Row | undefined {
  const raw = (Array.isArray(reply['requirements']) ? reply['requirements'] : []).filter(isObject).find((r) => r['id'] === REQ);
  return raw ? { result: String(raw['result']), issues: (Array.isArray(raw['issues']) ? raw['issues'] : []).filter(isObject) } : undefined;
}
const strings = (v: JsonValue | undefined): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : [];
/** Whether an issue names caption line `line` (its ID, or a caption `<line>.<n>`) anywhere but its prose. */
export function namesCaption(issue: JsonObject, line: string): boolean {
  const { what: _what, fix: _fix, ...rest } = issue;
  return strings(rest).some((s) => s === line || new RegExp(`^${line}\\.\\d+$`).test(s) || new RegExp(`(^|/)lines/${line}(/|$)`).test(s));
}
/**
 * The judge, the same for the film and its twin: the render.contrast row PASSes with no error or warning. Each failure
 * that comes from an issue naming caption line `line` says `names the caption <line>`.
 */
export function contrastFailures(row: Row | undefined, line: string, what: string): string[] {
  if (!row) return [`${what}: the verdict has no row for the render.contrast requirement`];
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what}: render.contrast is ${row.result}, not PASS: ${show(row.issues, 1200)}`);
  for (const i of row.issues.filter((x) => x['severity'] === 'error' || x['severity'] === 'warning')) {
    failures.push(`${what}: render.contrast raises ${String(i['code'])}${namesCaption(i, line) ? ` and names the caption ${line}` : ''}: ${show(i, 600)}`);
  }
  return failures;
}
