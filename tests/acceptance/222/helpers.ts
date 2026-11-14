// Test-side tools for the #222 acceptance tests: `deep-show` built once per file and driven by JSON lines (#393's
// `deep-show run`, with `deep show`, `eval`, `install_pack`, `packs`, `registries`, `schedule` and #403's claims and
// `verdict`); the documents the criteria describe, generated here; reading a cue list's expansion off a `deep show`
// reply, a frame's values off an `eval` reply, the `cue.kind@1` row off `registries`; and the rules the criteria
// judge by. Nothing here stands in for the expander, the verbs or the evaluation: every value a test compares comes
// from a binary, and every expected value from the issue's text or the design. Parts are copied from #408's, #494's
// and #200's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/222 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID: `#222.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #222.88afab32',
  2: 'AC2 #222.98d07f32',
  3: 'AC3 #222.f801fafc',
  4: 'AC4 #222.d9fdb65d',
  5: 'AC5 #222.f1e8b886',
  6: 'AC6 #222.46f1db03',
  7: 'AC7 #222.21cc8a35',
  8: 'AC8 #222.3e28e7f1',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string', `${what} is a string, got ${brief(v)}`).toBe(true);
  return v as string;
}
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): replies carry times as integer flicks or as the time grammar's "<decimal>s".

export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A time field as the time grammar's text. */
export const secs = (s: number): string => `${s}s`;
/** A time as a reply writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds; else null. */
export function flicksOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const f = Number(scaled / den);
  return m[1] === '-' ? -f : f;
}
export const showTime = (f: number): string => `${f / FLICKS} s (${f} flicks)`;

/** A seeded generator in [0, 1) (mulberry32), seeded from a text by FNV-1a, so every run draws the same times. */
export function random(seedText: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` whole-flick times drawn from [from, to] by `seedText`'s generator, ascending. */
export function randomTimes(seedText: string, n: number, from: number, to: number): number[] {
  const next = random(seedText);
  return Array.from({ length: n }, () => from + Math.floor(next() * (to - from + 1))).sort((x, y) => x - y);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the `full` set, debug once per file, release only for the budget's timing.

const nameOf = (release: boolean): string => `${SHOW}-full${release ? '-release' : ''}`;
const cargoArgs = (release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` (`full`) and copies it into `dir`: the binary, or cargo's error. */
export function buildInto(release: boolean, dir: string): { bin: string; error: string } {
  const args = cargoArgs(release);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, nameOf(release));
  copyFileSync(join(TARGET, release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '' };
}

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, in beforeAll. */
export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-222-bin-'));
    built = buildInto(false, dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, `the binary builds: cargo ${cargoArgs(false).join(' ')}`).toBe(''); return built.bin; };
}

/** Fresh folders for a test (evidence stores, packs, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-222-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${SHOW} run started`).toBe('');
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((x, i) => obj(x, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

/** A pack folder offered to the scenario's store (#306) and the version a document names. */
export interface Pack { id: string; version: string; dir: string }
export const packAt = (p: Pack): string => `${p.id}@${p.version}`;
/** The first-party pack of verbs (README: The first-party verbs). */
export const VERBS_PACK: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const VERBS_AT = packAt(VERBS_PACK);

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: cue lists', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB222D', n);

export interface Extra { packs?: readonly Pack[]; planted?: string; stored?: JsonObject; claims?: JsonObject }
/**
 * A scenario: your shell's process tree, alpha's session, one panel, every document a call names on it (a `stored`
 * document opened as revision 0), the packs offered before the first call, the scenario's planted program, the claims.
 */
export function scenario(evidence: string, calls: JsonObject[], extra: Extra = {}): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  for (const [id, document] of Object.entries(extra.stored ?? {})) docs[id] = { panel: 'main', document };
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    ...(extra.packs ? { packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    ...(extra.claims ? { claims: extra.claims } : {}),
    calls,
  };
}

/** `deep show` of a whole document from your shell, with the parts of the reply `include` names. */
export const present = (doc: string, document: JsonObject, include: string[] = ['issues']): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document, include });
/** The reply's error issues. */
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** The document was presented, with no error issue. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  expect(errors(reply), `${what} raises no error`).toEqual([]);
}

/** #387's `eval` at `t` flicks, reading `paths` (#1918) and, with `hash`, the evaluated-data hash (README). */
export const evalAt = (doc: string, t: number, o: { paths?: string[]; hash?: boolean } = {}): JsonObject =>
  ({ call: 'eval', doc, t, ...(o.paths ? { paths: o.paths } : {}), ...(o.hash ? { data_hash: true } : {}) });
function evaluated(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
}
/** Each path's evaluated value in an `eval` reply. */
export function valuesOf(reply: JsonObject, what: string): JsonObject {
  evaluated(reply, what);
  return obj(reply['values'], `${what}: values`);
}
/** The evaluated-data hash in an `eval` reply (README: The evaluated-data hash). */
export function dataHashOf(reply: JsonObject, what: string): string {
  evaluated(reply, what);
  const h = reply['data_hash'];
  expect(typeof h === 'string' && /^[0-9a-f]{32,}$/.test(h), `${what}: data_hash is a hex digest, got ${brief(h)}`).toBe(true);
  return h as string;
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents). Every film is 640 × 360 u, as your shell sends it: no id, no layers.

export const LIST = 'list';
/** A film of the items given, its span in seconds, the packs it names and its other maps. */
export function film(title: string, items: JsonObject[], o: { span: number; packs?: string[]; extra?: JsonObject }): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the #222 acceptance suite.`, size: [640, 360], transport: { span: secs(o.span) },
    ...(o.packs?.length ? { packs: o.packs } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...(o.extra ?? {}),
  };
}
/** A 40 u square centred on its position. */
export const square = (id: string, pos: [number, number] = [0, 0]): JsonObject =>
  ({ id, kind: 'rect@1', name: `Square ${id}`, order: `c${id}`, params: { box: [-20, -20, 40, 40], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] } });
/** The cue list item `cues@1` holding `cues`, in order. */
export const cueList = (cues: JsonObject[], id = LIST): JsonObject => ({ id, kind: 'cues@1', name: 'Cue list', order: 'z0', params: { cues } });
export const SIGMOID: JsonObject = { ease: { name: 'sigmoid', params: 10 } };
/** A hand-written channel: keys `[seconds, value]` in order, each segment on `interp` (sigmoid(10), a cue's default ease). */
export function channel(target: string, type: string, keys: [number, JsonValue][], interp: JsonValue = SIGMOID): JsonObject {
  return { target, type, keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: secs(t), value, interp }])) };
}

// ---------------------------------------------------------------------------------------------------
// A cue list's expansion (README: The expansion), off the `deep show` reply's `expansions`.

export interface Channel { id: string; target: string; cue: string; times: number[] }
export interface Marker { t: number; span: number }
export interface Expansion { channels: Channel[]; markers: Record<string, Marker>; derived: string[]; raw: JsonObject }

function timesOfChannel(c: JsonObject, what: string): number[] {
  const out: number[] = [];
  const keys = c['keys'];
  const list = Array.isArray(keys) ? keys : isObject(keys) ? Object.values(keys) : [];
  for (const k of list) {
    const t = flicksOf(isObject(k) ? k['t'] : undefined);
    expect(t, `${what}: every key's t is a whole number of flicks, got ${brief(k)}`).not.toBeNull();
    out.push(t!);
  }
  for (const m of Array.isArray(c['modifiers']) ? c['modifiers'] : []) {
    if (!isObject(m)) continue;
    const body = m['kind'] === 'pulse' ? m : isObject(m['pulse']) ? m['pulse'] : null;
    if (!body) continue;
    const at = flicksOf(body['at']); const span = flicksOf(body['span']);
    expect(at !== null && span !== null, `${what}: a pulse's at and span are whole flicks, got ${brief(body)}`).toBe(true);
    out.push(at!, at! + span!);
  }
  return out.sort((a, b) => a - b);
}
/** The cue list `list`'s expansion in a `deep show` reply. */
export function expansionOf(reply: JsonObject, what: string, list = LIST): Expansion {
  const all = arr(reply['expansions'], `${what}: the deep show reply's expansions`).filter(isObject);
  const found = all.filter((e) => e['instance'] === list);
  expect(found.length, `${what}: the reply's expansions hold one for the cue list ${list}; instances: ${brief(all.map((e) => e['instance'] ?? null))}`).toBe(1);
  const raw = found[0]!;
  expect(raw['kind'], `${what}: the expansion of ${list} is the cue list's`).toBe('cues@1');
  const markers: Record<string, Marker> = {};
  for (const [name, m] of Object.entries(obj(raw['markers'], `${what}: the expansion's markers`))) {
    const mo = obj(m, `${what}: markers.${name}`);
    const t = flicksOf(mo['t']); const span = flicksOf(mo['span'] ?? 0);
    expect(t !== null && span !== null, `${what}: markers.${name} has t and span in whole flicks, got ${brief(mo)}`).toBe(true);
    markers[name] = { t: t!, span: span! };
  }
  const channels = Object.entries(obj(raw['channels'], `${what}: the expansion's channels`)).map(([id, c]): Channel => {
    const co = obj(c, `${what}: channels.${id}`);
    expect(id.startsWith(`${list}.`), `${what}: channel ${id} is named <cue list>.<cue>[.<k>]`).toBe(true);
    return { id, target: str(co['target'], `${what}: channels.${id}.target`), cue: id.slice(list.length + 1).split('.')[0]!, times: timesOfChannel(co, `${what}: channels.${id}`) };
  });
  const derived = isObject(raw['derived']) ? Object.keys(raw['derived']) : Array.isArray(raw['derived']) ? raw['derived'].map(String) : [];
  return { channels, markers, derived, raw };
}
/** A cue's marker `cues.<id>`, which must be there. */
export function markerOf(e: Expansion, cue: string, what: string): Marker {
  const m = e.markers[`cues.${cue}`];
  expect(m, `${what}: the expansion writes the marker cues.${cue}; it writes ${Object.keys(e.markers).join(', ') || 'none'}`).toBeDefined();
  return m!;
}
/** The item an `items/<id>/<field…>` path names. */
export const itemOf = (path: string): string => path.split('/')[1] ?? '';

// ---------------------------------------------------------------------------------------------------
// Values: two evaluated values equal within a tolerance, number by number.

export function differences(a: JsonValue | undefined, b: JsonValue | undefined, tol: number, at: string): string[] {
  if (a === undefined || a === null || b === undefined || b === null) return [`${at}: reads ${brief(a ?? null, 200)} against ${brief(b ?? null, 200)}`];
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol ? [] : [`${at}: ${a} against ${b}, off by ${Math.abs(a - b)}`];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${at}: ${a.length} values against ${b.length}`];
    return a.flatMap((x, i) => differences(x, b[i], tol, `${at}[${i}]`));
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => differences(a[k], b[k], tol, `${at}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${at}: ${brief(a, 200)} against ${brief(b, 200)}`];
}

// ---------------------------------------------------------------------------------------------------
// The verbs (the issue's Fields), their fixtures and the cue kit (README: The first-party verbs; The cue kit).

export const ENTER = ['create', 'write', 'draw_then_fill', 'fade_in', 'grow', 'spin_in', 'spiral_in', 'by_letter', 'by_word', 'in_turn'] as const;
export const EXIT = ['uncreate', 'unwrite', 'fade_out', 'shrink'] as const;
export const EMPHASIS = ['indicate', 'flash', 'circumscribe', 'passing_flash', 'wiggle', 'blink', 'focus', 'broadcast'] as const;
export const MOVE = ['move_along', 'rotate', 'swap', 'cycle'] as const;
export const CHANGE = ['morph', 'match', 'count_to'] as const;
/** The 29 first-party verbs this issue ships (`warp` joins with #223, `type` with #168). */
export const VERBS: readonly string[] = [...ENTER, ...EXIT, ...EMPHASIS, ...MOVE, ...CHANGE];
export const CUE_KINDS = 'cue.kind@1';
/** The cue kit's rules, one per clause of the issue's cue kit (README: The cue kit). */
export const KIT_RULES = ['same_bytes', 'targets_only', 'inside_span', 'end_state', 'back_to_base'] as const;
/** The kit's planted entries the issue names: each entry's name and the one rule it breaks. */
export const PLANTED_ENTRIES = [
  { name: 'indicate', rule: 'back_to_base', what: 'an indicate that ends at scale 1.0000001' },
  { name: 'fade_in', rule: 'inside_span', what: 'a fade_in whose last key lands one flick past its span' },
  { name: 'nudge', rule: 'targets_only', what: 'a verb that writes a non-target\'s path' },
] as const;
/** The scenario's planted program for a verb's planted twin (README: Planted programs). */
export const twinPlant = (verb: string): string => `cue_twin:${verb}`;
/** The planted expander of criterion 1: a `with` cue starts at the previous cue's end. */
export const WITH_AT_END = 'cue_with_at_previous_end';

/** A verb's fixture (README: Fixtures): a film playing the verb, the same film written by hand, the paths compared. */
export interface Fixture { verb: string; document: JsonObject; reference: JsonObject; paths: string[] }
export const fixturePath = (verb: string): string => join(VERBS_PACK.dir, 'fixtures', `${verb}.json`);
/** The fixture, or the reasons it can't be used. */
export function fixtureOf(verb: string): Fixture | string[] {
  const path = fixturePath(verb);
  if (!existsSync(path)) return [`${verb}: no fixture at ${relative(REPO, path)}`];
  let f: JsonValue;
  try { f = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return [`${verb}: the fixture is not JSON: ${(e as Error).message}`]; }
  if (!isObject(f)) return [`${verb}: the fixture is not an object`];
  const failures: string[] = [];
  if (f['verb'] !== verb) failures.push(`${verb}: the fixture names the verb ${brief(f['verb'])}`);
  const doc = f['document']; const ref = f['reference']; const paths = f['paths'];
  if (!isObject(doc) || !isObject(ref)) return [...failures, `${verb}: the fixture lacks its document or its reference`];
  const items = (d: JsonObject): JsonObject[] => (isObject(d['items']) ? Object.values(d['items']).filter(isObject) : []);
  const lists = items(doc).filter((i) => i['kind'] === 'cues@1');
  const plays = lists.some((l) => isObject(l['params']) && Array.isArray(l['params']['cues']) && l['params']['cues'].some((c) => isObject(c) && c['kind'] === verb));
  if (lists.length !== 1 || lists[0]!['id'] !== LIST || !plays) failures.push(`${verb}: the fixture's document holds no cue list \`${LIST}\` with a cue of kind ${verb}`);
  if (items(ref).some((i) => i['kind'] === 'cues@1')) failures.push(`${verb}: the fixture's reference holds a cue list; it must be written by hand`);
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string' && p.startsWith('items/'))) failures.push(`${verb}: the fixture's paths are not a list of item paths`);
  return failures.length ? failures : { verb, document: doc, reference: ref, paths: paths as string[] };
}
/** The cue of kind `verb` in a fixture's cue list. */
export function verbCue(document: JsonObject, verb: string): string {
  const items = isObject(document['items']) ? document['items'] : {};
  const list = obj(items[LIST], 'the cue list');
  const cue = arr(obj(list['params'], 'the cue list params')['cues'], 'cues').filter(isObject).find((c) => c['kind'] === verb);
  return String(cue?.['id']);
}

/** One registry row of `registries` (deep://registries, #200): its kit, planted entries and entries. */
export interface KitResult { verdict: string; rules: { rule: string; verdict: string; message: string; raw: JsonObject }[]; raw: JsonObject }
export function kitOf(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = (Array.isArray(o['rules']) ? o['rules'] : []).filter(isObject).map((r) => ({ rule: String(r['rule']), verdict: String(r['verdict']), message: typeof r['message'] === 'string' ? r['message'] : '', raw: r }));
  return { verdict: String(o['verdict']), rules, raw: o };
}
export function registryRow(reply: JsonObject, name: string): JsonObject {
  const rows = arr(reply['registries'], 'registries: registries').filter(isObject).filter((r) => r['name'] === name && r['kind'] !== 'slot');
  expect(rows.length, `deep://registries lists the registry ${name}`).toBe(1);
  return rows[0]!;
}

// ---------------------------------------------------------------------------------------------------
// The test pack `acme/acme` (README: The test pack): one verb, `acme.stamp`, written at test time.

export const ACME_STAMP = 'acme.stamp';
export function writeAcme(root: string): Pack {
  const dir = join(root, 'acme-1.0.0');
  mkdirSync(dir, { recursive: true });
  const pack = {
    name: 'acme', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #222 acceptance suite: one cue verb, acme.stamp, an entry of cue.kind@1.',
    requires: { core: '>=0.0.0', modules: { motion: '>=0.0.0' } },
    recipes: { 'acme.stamp@1': 'acme.stamp@1.json' },
    entries: { [CUE_KINDS]: [{ name: ACME_STAMP, class: 'emphasis', recipe: 'acme.stamp@1' }] },
  };
  const recipe = {
    id: ACME_STAMP, version: '1.0', title: 'Stamp', license: 'MIT', author: 'the #222 acceptance suite',
    description: 'An emphasis: each target\'s scale swells by amount at the middle of its window and settles back, as a pulse.',
    inputs: { amount: { type: 'number', default: 0.25, min: 0, max: 1, about: 'how much each target\'s scale grows at the middle of its window' } },
    steps: { press: { op: 'cue', params: { set: { 'at/scale': { pulse: { amount: ['amount', 'amount', 0] } } } } } },
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(dir, 'acme.stamp@1.json'), `${JSON.stringify(recipe, null, 2)}\n`);
  return { id: 'acme/acme', version: '1.0.0', dir };
}

/** Rust sources under crates/ that hold `needle` (criterion 4: a pack's verb is no canvas module's change). */
export function rustNaming(needle: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'target' || name === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.rs') && readFileSync(p, 'utf8').includes(needle)) found.push(relative(REPO, p));
    }
  };
  walk(join(REPO, 'crates'));
  return found;
}

// ---------------------------------------------------------------------------------------------------
// film.layout through a claim's verdict (#403, #408), for criterion 6.

const LAYER = 'you-main';
/** A stored film (#408's form: `id`, one layer of yours), 1920 × 1080 u with `safe: 24`, so 1 u is 1 px at 1080p. */
export function storedFilm(doc: string, title: string, items: JsonObject[], o: { span: number; markers?: JsonObject }): JsonObject {
  return {
    format: 1, id: doc, profile: 'film', title, description: `${title}: a film the #222 acceptance tests judge with film.layout.`,
    size: [1920, 1080], safe: 24, transport: { span: secs(o.span) },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: LAYER }])),
    ...(o.markers ? { markers: o.markers } : {}),
  };
}
export const CLAIM = `claim:${ulid('01JB222C', 1)}`;
export const REQ = `req:${ulid('01JB222Q', 1)}`;
/** One claim of alpha's on `doc`, its one requirement the check input `{kind: "film.layout"}` at its defaults. */
export const layoutClaim = (doc: string): JsonObject =>
  ({ [CLAIM]: { session: ALPHA.id, deliverables: [doc], requirements: [{ id: REQ, check: { kind: 'film.layout' } }] } });
/** film.layout's requirement row in a verdict (#403's `{id, kind, result, issues}`). */
export function layoutRow(verdict: JsonObject): JsonObject {
  const rows = (Array.isArray(verdict['requirements']) ? verdict['requirements'] : []).filter(isObject);
  const row = rows.find((r) => r['id'] === REQ);
  expect(row, `the verdict has film.layout's requirement row: ${brief(verdict)}`).toBeDefined();
  return row!;
}
/** A code's field: on the issue itself, else in its `actual` (#408's reading). */
export function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
/** Whether a field names item `id`: its ID, or a sub-address `<id>#<part>` of it. */
export const namesItem = (v: JsonValue | undefined, id: string): boolean => typeof v === 'string' && (v === id || v.startsWith(`${id}#`));

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied.

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
