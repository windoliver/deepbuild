// Test-side tools for the #2777 acceptance tests: `deep-show` built per Cargo feature set (the full set, alone or with
// this suite's test canvas module), its startup refusal, `deep-show run` (the agent's deep_show and deep_kinds), the
// sealed listing `deep-show kinds --dump` writes, the field lists the listing's forms offer (the form language, read
// from deep_kinds' field lines), the closure lane and the drift lane of scripts/canvas-closures.mjs on listings and
// scratch trees, the generated table in the canvas reference, the lane as scripts/lanes.mjs lists it, a Seatbelt
// profile with no network, and the reference-Mac gate with the design's judge (as tests/acceptance/412). Nothing here
// stands in for the seal, the listing, the lane, the drift lane, the document check or deep_kinds: every verdict read
// here is the binary's or the script's own. Each `...Failures` function is a criterion's check: it returns sentences
// naming what failed, so a test runs it on the right program (no failures) and on the criterion's planted program (a
// failure naming what the criterion says). Processes are stopped by PID only, never by name or port.

import { execFileSync, spawnSync } from 'node:child_process';
import { constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { availableParallelism, homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2777 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';

// ---------------------------------------------------------------------------------------------------
// Names the issue gives, and names this suite chooses (README: The surface under test).

/** The issue's list: the camera's projection, and a word it lacks (AC5). */
export const PROJECTION = 'camera@1.projection';
export const BAD_PROJECTION = 'fisheye';
export const ISSUE_PATH = 'items/cam/params/projection';
/** The rows AC4 plants on: one dropped, one naming another reason. */
export const DROPPED = PROJECTION;
export const REASON_SWAPPED = 'material@1.translucency.kind';
/** The seven reasons the closure rule has (canvas primitives: Registry and seal: registries). */
export const REASONS = ['ring', 'record', 'determinism', 'card', 'budget', 'interval_forms', 'draw_path'];
/** This suite's test canvas module (AC1, AC7): test.tone's kind test.tint@1, whose field tone takes three words. */
export const TINT = 'test.tint@1';
export const TONE = 'tone';
export const TONE_LIST = `${TINT}.${TONE}`;
export const TONE_WORDS = ['warm', 'cool', 'neutral'];
/** The seal's refusal reason for a field list with no closure (AC1). */
const UNCLOSED = 'list_unclosed';
/** AC5's planted refusal: the issue for a value outside a closed list carries only the bad value. */
export const PLANT_BAD_VALUE_ONLY = 'refusal_bad_value_only';
/** The listing's key for its field lists, and the deep_kinds op that answers one list (AC6). */
export const LISTS_KEY = 'field_lists';
const CLOSURE_OP = 'closure';
/** The closure lane and its script (AC2, AC4, AC7, AC8). */
const LANE_SCRIPT = 'scripts/canvas-closures.mjs';
export const LANE = 'fields';
/** AC8: the lane's budget in the local preflight, seconds. */
export const LANE_BUDGET_S = 5;
/** The generated table (AC3, AC4): under this heading, between these markers, with this header. */
export const REFERENCE = 'docs/canvas-primitives.md';
const SECTION = '### Registries and closed lists';
const HAND_HEADER = '| List | Where | Closure |';
const BLOCK_START = '<!-- field lists:';
const BLOCK_END = '<!-- /field lists -->';
const GENERATED_HEADER = '| Field list | Words | Closure | Reopens if | Instead |';

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sorted = (xs: readonly string[]): string[] => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names every one of `names` together: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Folders: each removed after the file.

const made: string[] = [];
function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `deep-2777-${tag}-`)));
  made.push(d);
  return d;
}
function cleanup(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file in the checkout's target folder with the pinned
// toolchain first on PATH, and cloned out under its own name, as #200's and #412's suites keep theirs.

type TestFeature = 'test-tone-unclosed' | 'test-tone-closed';
interface Build { with?: TestFeature[] }
export const FULL: Build = {};
export const TONE_UNCLOSED: Build = { with: ['test-tone-unclosed'] };
export const TONE_CLOSED: Build = { with: ['test-tone-closed'] };
const featuresOf = (b: Build): string[] => ['full', ...(b.with ?? [])];
const buildName = (b: Build): string => featuresOf(b).join('+');

const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
/** The environment every build gets: the pinned toolchain first on PATH, no incremental cache, no debug info (the caller's settings win). */
const buildEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: [TOOLCHAIN, process.env['PATH'] ?? ''].join(delimiter),
  RUSTUP_HOME: process.env['RUSTUP_HOME'] ?? join(homedir(), '.rustup'),
  CARGO_HOME: process.env['CARGO_HOME'] ?? join(homedir(), '.cargo'),
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
});
const targetDir = (): string => {
  const t = process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};
const quiet = (stderr: string): string => stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-4000);

/** `cargo build --locked --bin deep-show --no-default-features --features <set>` in the checkout; '' or cargo's error. */
function cargoBuild(features: readonly string[]): string {
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features.join(',')];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: buildEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${quiet(r.stderr ?? '')}`;
  return '';
}

interface Builds { bin: (b: Build) => string }
/**
 * Builds every listed feature set once, before the file's tests, in list order, so the last one listed is the build
 * the checkout's target folder holds afterwards; a test that asks for a build that failed fails, naming the build.
 * Also removes the file's temporary folders after it.
 */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const done = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2777-bins-')));
    for (const b of builds) {
      const name = buildName(b);
      if (done.has(name)) continue;
      const bin = join(dir, `${SHOW}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      const error = cargoBuild(featuresOf(b));
      if (error === '') copyFileSync(join(targetDir(), 'debug', SHOW), bin, constants.COPYFILE_FICLONE);
      done.set(name, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
    cleanup();
  }, 120_000);
  return {
    bin(b: Build): string {
      const entry = done.get(buildName(b));
      if (!entry) throw Error(`the file didn't list the build ${buildName(b)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW} with features ${featuresOf(b).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show`: JSON lines in, one JSON line out per line in; or one refusal line and exit 2.

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: readonly string[], inputs: readonly JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => {
    try { return JSON.parse(l) as JsonValue; } catch { return l; }
  });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** `deep-show run [--planted <name>]` with one scenario holding `calls` and the scenario's other fields: one reply per call. */
export function run(bin: string, calls: readonly JsonObject[], options: { planted?: string; world?: JsonObject } = {}): JsonObject[] {
  const args = ['run', ...(options.planted ? ['--planted', options.planted] : [])];
  const s = start(bin, args, [{ evidence: tempDir('ev'), ...options.world, calls: [...calls] }]);
  expect(s.timedOut, `deep-show ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `deep-show ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `deep-show ${args.join(' ')}: one output line per input line`).toBe(1);
  const out = s.lines[0];
  expect(isObject(out) && out['ok'] === true, `deep-show ${args.join(' ')} took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies, 600)}`).toBe(true);
  return (replies as JsonValue[]).map((r) => (isObject(r) ? r : { reply: r }));
}

/** One startup with a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string): Started {
  const s = start(bin, ['run'], [{ evidence: tempDir('ev'), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, 'deep-show run finished within its timeout').toBe(false);
  return s;
}

/** The startup sealed: exit 0 and one answer, ok. */
export function sealFailures(s: Started, what: string): string[] {
  const line = s.lines[0];
  if (s.status === 0 && s.lines.length === 1 && isObject(line) && line['ok'] === true) return [];
  return [`${what} did not seal: exit ${s.status} (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1200)}; stderr: ${s.stderr.slice(-600)}`];
}

/**
 * AC1's check on the startup of the planted kind with no closure: the seal refuses it before any scenario (exit 2, one
 * line `{"ok": false, "code": "seal_refused", …}`) with the reason list_unclosed, naming the kind in `entries` and the
 * field in `field`. Each failure names the list.
 */
export function unclosedRefusalFailures(s: Started, want: { entry: string; field: string }): string[] {
  const at = `${want.entry}.${want.field}`;
  if (s.status !== 2) return [`${at}: the startup exited ${s.status} (${s.signal ?? 'no signal'}), not 2 with the seal's refusal; stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-400)}`];
  const line = s.lines[0];
  if (s.lines.length !== 1 || !isObject(line)) return [`${at}: the refusal is not one JSON line: ${s.stdout.slice(0, 800)}`];
  if (line['ok'] !== false || line['code'] !== 'seal_refused') return [`${at}: the line is not the seal's refusal: ${show(line, 800)}`];
  const failures: string[] = [];
  if (line['reason'] !== UNCLOSED) failures.push(`${at}: the seal refuses with the reason ${show(line['reason'] ?? null)}, not ${UNCLOSED}: ${show(line, 800)}`);
  const entries = Array.isArray(line['entries']) ? line['entries'] : [];
  if (!entries.includes(want.entry)) failures.push(`${at}: the refusal's entries ${show(entries)} don't name the kind ${want.entry}: ${show(line, 800)}`);
  if (line['field'] !== want.field) failures.push(`${at}: the refusal's field is ${show(line['field'] ?? null)}, not ${want.field}: ${show(line, 800)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The sealed listing: `deep-show kinds --dump <dir>` (#412), and its field lists.

interface Dump { path: string; value: JsonObject }
/** `deep-show kinds --dump <dir>` of the build: the file it writes, read back. */
export function dumpOf(bin: string): Dump {
  const dir = tempDir('dump');
  const s = start(bin, ['kinds', '--dump', dir], [], 900_000);
  expect(s.status, `deep-show kinds --dump exits 0: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-800)}`).toBe(0);
  const line = s.lines[0];
  expect(isObject(line) && line['ok'] === true && typeof line['path'] === 'string', `deep-show kinds --dump answers ok with its path: ${show(line)}`).toBe(true);
  const path = (line as JsonObject)['path'] as string;
  const value = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  expect(isObject(value) && Array.isArray(value['registries']), `the dump holds its registries: ${show(value, 600)}`).toBe(true);
  return { path, value: value as JsonObject };
}
/** A listing written to a file of its own (a planted listing for the lane). */
export function writeListing(value: JsonObject, tag: string): string {
  const path = join(tempDir(tag), 'listing.json');
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

interface Field { name: string; type: string }
interface Entry { name: string; registry: string; fields: Field[] }
/** Every entry of the listing, every registry walked, with its fields in order. */
function entriesOf(dump: JsonObject): Entry[] {
  const out: Entry[] = [];
  for (const r of (Array.isArray(dump['registries']) ? dump['registries'] : []).filter(isObject)) {
    for (const e of (Array.isArray(r['entries']) ? r['entries'] : []).filter(isObject)) {
      const fields = (Array.isArray(e['fields']) ? e['fields'] : []).filter(isObject).map((f) => ({ name: String(f['name']), type: String(f['type']) }));
      out.push({ name: String(e['name']), registry: String(r['name']), fields });
    }
  }
  return out;
}
export const registryNames = (dump: JsonObject): Set<string> =>
  new Set((Array.isArray(dump['registries']) ? dump['registries'] : []).filter(isObject).map((r) => String(r['name'])));

interface FieldList { list: string; entry: string; field: string; words: string[]; closure: JsonValue | undefined; raw: JsonObject }
/** The listing's field lists: `field_lists`, each `{list, entry, field, words, closure}`. */
export function fieldListsOf(dump: JsonObject): FieldList[] {
  const lists = dump[LISTS_KEY];
  expect(Array.isArray(lists), `the sealed listing (deep-show kinds --dump) carries its field lists under ${LISTS_KEY}; its top-level keys are ${Object.keys(dump).join(', ')}`).toBe(true);
  return (lists as JsonValue[]).map((v, i) => {
    const o = isObject(v) ? v : {};
    const ok = typeof o['list'] === 'string' && typeof o['entry'] === 'string' && typeof o['field'] === 'string'
      && Array.isArray(o['words']) && o['words'].every((w) => typeof w === 'string' && w !== '');
    expect(ok, `${LISTS_KEY}[${i}] is {list, entry, field, words, closure}: ${show(v, 400)}`).toBe(true);
    return { list: o['list'] as string, entry: o['entry'] as string, field: o['field'] as string, words: (o['words'] as string[]).slice(), closure: o['closure'], raw: o };
  });
}
/** The one field list of the listing named `name`. */
export function theList(lists: readonly FieldList[], name: string): FieldList {
  const found = lists.filter((l) => l.list === name);
  expect(found.length, `the sealed listing holds one field list ${name}; it holds ${found.length}`).toBe(1);
  return found[0]!;
}

interface Closed { reason: string; reopens_if: string; instead: string }
/** A closed closure `{closed: <reason>, reopens_if, instead}`, each a non-empty string; undefined otherwise. */
export function closedOf(c: JsonValue | undefined): Closed | undefined {
  if (!isObject(c)) return undefined;
  const [reason, reopens, instead] = [c['closed'], c['reopens_if'], c['instead']];
  if (typeof reason !== 'string' || typeof reopens !== 'string' || typeof instead !== 'string') return undefined;
  if (!reason.trim() || !reopens.trim() || !instead.trim()) return undefined;
  return { reason, reopens_if: reopens, instead };
}
/** Which closure a list carries: registry, closed or open; '' when it carries none of them. */
export function closureKind(c: JsonValue | undefined): 'registry' | 'closed' | 'open' | '' {
  if (!isObject(c)) return '';
  const kinds = (['registry', 'closed', 'open'] as const).filter((k) => k in c);
  return kinds.length === 1 ? kinds[0]! : '';
}
/** Why a list's closure breaks the closure rule, or ''. */
function closureProblem(l: FieldList, registries: ReadonlySet<string>): string {
  const c = l.closure;
  switch (closureKind(c)) {
    case 'registry': {
      const name = (c as JsonObject)['registry'];
      return typeof name === 'string' && registries.has(name) ? '' : `it names the registry ${show(name ?? null)}, which the sealed listing doesn't hold`;
    }
    case 'open': {
      const by = (c as JsonObject)['open'];
      return by === 'item' || by === 'pack' ? '' : `open ${show(by ?? null)}, not declared per item or per pack`;
    }
    case 'closed': {
      const o = c as JsonObject;
      if (typeof o['closed'] !== 'string' || !/^[a-z][a-z_]*$/.test(o['closed'])) return `closed with ${show(o['closed'] ?? null)}, not a reason`;
      if (typeof o['reopens_if'] !== 'string' || !o['reopens_if'].trim()) return 'closed with no reopens_if';
      if (typeof o['instead'] !== 'string' || !o['instead'].trim()) return 'closed with no instead (a text, or nothing)';
      return '';
    }
    default:
      return c === undefined ? 'no closure' : `a closure is {registry}, {closed, reopens_if, instead} or {open}, not ${show(c, 300)}`;
  }
}
/** Every list of the listing named once, with words, and with a closure of the rule's shape. Each failure starts with the list. */
export function listingFailures(lists: readonly FieldList[], registries: ReadonlySet<string>): string[] {
  const failures: string[] = [];
  const seen = new Map<string, number>();
  for (const l of lists) seen.set(l.list, (seen.get(l.list) ?? 0) + 1);
  for (const [name, n] of seen) if (n > 1) failures.push(`${name}: the sealed listing names ${n} field lists so`);
  for (const l of lists) {
    if (!l.words.length) failures.push(`${l.list}: the sealed listing gives it no words`);
    const why = closureProblem(l, registries);
    if (why) failures.push(`${l.list}: ${why}`);
  }
  return failures;
}
/** The closed lists whose instead is nothing. */
export const saysNothing = (lists: readonly FieldList[]): string[] => lists.filter((l) => closedOf(l.closure)?.instead === 'nothing').map((l) => l.list);

// ---------------------------------------------------------------------------------------------------
// The form language (crates/deep-canvas/src/form.rs, #1973), read from the forms deep_kinds prints for a field. A port
// of its grammar, used to find where a field's form offers words: `a | b` either form; `[x, y]` slots, a slot named by
// a word that is no type being a number, `name: form` a slot's form; `[form]` a list of it; `{a, b: form, c?}` an
// object; `{key → form}` a map; `word {fields}` a tagged word; `form ≤ n` and `form (note)`. A name is a type when the
// language reads it as one (the names below, copied from it at the base), else a word, as is any name in backticks.

const NUMBERS = ['m', 'mm', 'cm', 'nm', 'km', 'deg', 'rad', 's', 'ms', 'px', 'u', 'pt', 'em', 'f32', 'f64', 'number', 'integer', 'u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64', 'K', 'lux', 'lm', 'lumens', 'EV100', 'ratio', 'seed', '1/m', 'Hz', 'dB', 'st', 'fraction', 'flick', 'frame', 'bytes', 'fps', 'px/s', 'm/s', 'deg/s', 'index', 'edge index', 'count'];
const TEXTS = ['text', 'string', 'name', 'role', 'sha256', 'channel', 'collection', 'grapheme', 'path', 'occurrence list', 'material name', 'named part', 'font', 'locale', 'table', 'column', 'key', 'time', 'span', 'hash', 'url', 'language', 'expr', 'glyph', 'blend', 'ease', 'binding'];
const ALIASES: Record<string, string> = { vec2: '[x, y]', vec3: '[x, y, z]', vec4: '[x, y, z, w]', quat: '[x, y, z, w]', 'linear RGB': '[r, g, b]', polygon: '[[x, y]]' };

type Form =
  | { k: 'number'; unit: string }
  | { k: 'bool' }
  | { k: 'text' }
  | { k: 'word'; word: string }
  | { k: 'tagged'; word: string; body: Form }
  | { k: 'tuple'; slots: [string | null, Form][] }
  | { k: 'list'; of: Form }
  | { k: 'object'; fields: { name: string; form: Form | null }[] }
  | { k: 'map'; value: Form }
  | { k: 'oneof'; alts: Form[] }
  | { k: 'wrapped'; of: Form };
type Tok = { t: 'open' | 'close'; c: string } | { t: 'comma' | 'bar' | 'colon' | 'q' | 'arrow' | 'atmost' } | { t: 'note' | 'word' | 'lit'; v: string };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  let word = '';
  const flush = (): void => { if (word) { out.push({ t: 'word', v: word }); word = ''; } };
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === '[' || c === '{') { flush(); out.push({ t: 'open', c }); }
    else if (c === ']' || c === '}') { flush(); out.push({ t: 'close', c }); }
    else if (c === ',') { flush(); out.push({ t: 'comma' }); }
    else if (c === '|') { flush(); out.push({ t: 'bar' }); }
    else if (c === ':') { flush(); out.push({ t: 'colon' }); }
    else if (c === '?') { flush(); out.push({ t: 'q' }); }
    else if (c === '→') { flush(); out.push({ t: 'arrow' }); }
    else if (c === '≤') { flush(); out.push({ t: 'atmost' }); }
    else if (c === '<' && chars[i + 1] === '=') { i++; flush(); out.push({ t: 'atmost' }); }
    else if (c === '(') {
      flush();
      let depth = 1;
      let note = '';
      for (i++; i < chars.length; i++) {
        if (chars[i] === '(') depth++;
        if (chars[i] === ')') depth--;
        if (depth === 0) break;
        note += chars[i];
      }
      if (depth !== 0) throw Error('a note\'s ( is never closed');
      out.push({ t: 'note', v: note.trim() });
    } else if (c === '`') {
      flush();
      let lit = '';
      for (i++; i < chars.length && chars[i] !== '`'; i++) lit += chars[i];
      out.push({ t: 'lit', v: lit });
    } else if (/\s/.test(c)) flush();
    else word += c;
  }
  flush();
  return out;
}
const isNumberName = (n: string): boolean => NUMBERS.includes(n) || /^[0-9-]/.test(n);
const isTextName = (n: string): boolean => TEXTS.includes(n) || n === 'ID' || n.endsWith(' ID') || n.includes('<');
function typed(name: string): Form | null {
  const alias = ALIASES[name];
  if (alias !== undefined) return parseForm(alias);
  if (name === 'bool') return { k: 'bool' };
  if (isNumberName(name)) return { k: 'number', unit: name };
  if (isTextName(name)) return { k: 'text' };
  return null;
}
function wordForm(name: string): Form {
  const t = typed(name);
  if (t) return t;
  if (name.includes(' ')) throw Error(`\`${name}\` is no type the form language names`);
  return { k: 'word', word: name };
}
const slotNumber = (named: string | null, f: Form): boolean => named !== null && f.k === 'number' && f.unit === '';

/** Parses a declaration in the form language. */
function parseForm(text: string): Form {
  const toks = tokens(text);
  let at = 0;
  const peek = (): Tok | undefined => toks[at];
  const eat = (t: Tok['t'], c?: string): boolean => {
    const x = toks[at];
    if (x && x.t === t && (c === undefined || ('c' in x && x.c === c))) { at++; return true; }
    return false;
  };
  const name = (): string | null => {
    const words: string[] = [];
    for (let x = peek(); x && x.t === 'word'; x = peek()) { words.push(x.v); at++; }
    return words.length ? words.join(' ') : null;
  };
  const opens = (c: string): boolean => { const x = peek(); return x !== undefined && x.t === 'open' && x.c === c; };
  function form(slot: boolean): [string | null, Form] {
    const alts: [string | null, Form][] = [suffixed(slot)];
    while (eat('bar')) alts.push(suffixed(false));
    if (alts.length === 1) return alts[0]!;
    return [null, { k: 'oneof', alts: alts.map(([n, f]) => (slotNumber(n, f) ? wordForm(n!) : f)) }];
  }
  function suffixed(slot: boolean): [string | null, Form] {
    let [n, f] = primary(slot);
    if (eat('atmost')) {
      const bound = name();
      if (bound === null || !/^\d+$/.test(bound)) throw Error('≤ takes a whole number');
      f = f.k === 'list' ? f : { k: 'wrapped', of: f };
    }
    const x = peek();
    if (x && x.t === 'note') { at++; f = { k: 'wrapped', of: f }; }
    return [n, f];
  }
  function primary(slot: boolean): [string | null, Form] {
    if (eat('open', '[')) {
      const items: [string | null, Form][] = [form(true)];
      while (eat('comma')) items.push(form(true));
      if (!eat('close', ']')) throw Error(`expected ] at token ${at + 1}`);
      if (items.length === 1) {
        const [n, f] = items[0]!;
        return [null, { k: 'list', of: slotNumber(n, f) ? wordForm(n!) : f }];
      }
      return [null, { k: 'tuple', slots: items }];
    }
    if (opens('{')) return [null, object()];
    const x = peek();
    if (x && x.t === 'lit') { at++; return [null, { k: 'word', word: x.v }]; }
    const n = name();
    if (n === null) throw Error(`expected a form at token ${at + 1}`);
    if (opens('{') && !n.includes(' ') && typed(n) === null) return [null, { k: 'tagged', word: n, body: object() }];
    if (slot && !n.includes(' ') && typed(n) === null) {
      if (eat('colon')) return [n, form(false)[1]];
      return [n, { k: 'number', unit: '' }];
    }
    return [null, wordForm(n)];
  }
  function object(): Form {
    if (!eat('open', '{')) throw Error(`expected { at token ${at + 1}`);
    const fields: { name: string; form: Form | null }[] = [];
    for (;;) {
      const first = name();
      if (first === null) throw Error('an object\'s field needs a name');
      const names = [first];
      while (eat('bar')) {
        const next = name();
        if (next === null) throw Error('an object\'s field needs a name');
        names.push(next);
      }
      if (eat('arrow')) {
        const value = form(false)[1];
        if (!eat('close', '}')) throw Error('expected } after a map\'s key → form');
        return { k: 'map', value };
      }
      eat('q');
      const f = eat('colon') ? form(false)[1] : null;
      for (const n of names) fields.push({ name: n, form: f });
      if (eat('close', '}')) return { k: 'object', fields };
      if (!eat('comma')) throw Error(`expected , or } in an object at token ${at + 1}`);
    }
  }
  const [, f] = form(false);
  if (at !== toks.length) throw Error(`unread text from token ${at + 1}`);
  return f;
}

/** A field list as the forms offer it (README: Readings): its name, its entry and field, and its words. */
interface Place { list: string; entry: string; field: string; words: string[] }
const unwrap = (f: Form): Form => (f.k === 'wrapped' ? unwrap(f.of) : f);
function placesIn(f: Form | null, path: readonly string[], out: { path: string[]; words: string[] }[]): void {
  if (!f) return;
  switch (f.k) {
    case 'oneof': {
      const alts = f.alts.map(unwrap);
      const words = alts.flatMap((a) => (a.k === 'word' || a.k === 'tagged' ? [a.word] : []));
      if (words.length) out.push({ path: [...path], words });
      for (const a of alts) {
        if (a.k === 'tagged') placesIn(a.body, [...path, a.word], out);
        else if (a.k !== 'word') placesIn(a, path, out);
      }
      return;
    }
    case 'word': out.push({ path: [...path], words: [f.word] }); return;
    case 'tagged': out.push({ path: [...path], words: [f.word] }); placesIn(f.body, [...path, f.word], out); return;
    case 'object': for (const x of f.fields) placesIn(x.form, [...path, x.name], out); return;
    case 'map': placesIn(f.value, path, out); return;
    case 'list': placesIn(f.of, path, out); return;
    case 'tuple': for (const [n, s] of f.slots) placesIn(s, n === null || slotNumber(n, s) ? path : [...path, n], out); return;
    case 'wrapped': placesIn(f.of, path, out); return;
    default: return;
  }
}
/** The field lists one field's printed forms offer: a choice with a word among its alternatives, or a lone word. */
function placesOf(entry: string, field: string, forms: readonly string[]): Place[] {
  const parsed: Form = forms.length === 1 ? parseForm(forms[0]!) : { k: 'oneof', alts: forms.map((f) => parseForm(f)) };
  const out: { path: string[]; words: string[] }[] = [];
  placesIn(parsed, [], out);
  return out.map((p) => ({ list: [`${entry}.${field}`, ...p.path].join('.'), entry, field, words: p.words }));
}

/**
 * Every field list the listing's forms offer: deep_kinds `op: field` with the object path of each entry that has a json
 * field (#1971; one line per field, `forms` the alternatives its reader declares, #1973), each json field's forms read
 * as the form language. Each refusal or unreadable form fails, naming the field.
 */
export function placesOfListing(bin: string, dump: JsonObject): { places: Place[]; fields: number } {
  const entries = entriesOf(dump).filter((e) => e.fields.some((f) => f.type === 'json'));
  const replies = run(bin, entries.map((e) => ({ call: 'deep_kinds', op: 'field', path: e.name })));
  const places: Place[] = [];
  const problems: string[] = [];
  let fields = 0;
  entries.forEach((e, i) => {
    const reply = replies[i] ?? {};
    const lines = reply['lines'];
    if (!Array.isArray(lines)) { problems.push(`${e.name}: deep_kinds op: field answers no lines: ${show(reply, 400)}`); return; }
    for (const f of e.fields.filter((x) => x.type === 'json')) {
      fields++;
      const line = lines.find((l) => isObject(l) && l['name'] === f.name);
      const forms = isObject(line) && Array.isArray(line['forms']) ? line['forms'].filter((x): x is string => typeof x === 'string') : [];
      if (!forms.length) { problems.push(`${e.name}.${f.name}: deep_kinds prints no forms for it: ${show(line ?? null, 300)}`); continue; }
      try { places.push(...placesOf(e.name, f.name, forms)); } catch (err) { problems.push(`${e.name}.${f.name}: its forms don't read in the form language (${(err as Error).message}): ${show(forms, 300)}`); }
    }
  });
  none(problems, 'the forms deep_kinds prints for the listing\'s structured fields');
  return { places, fields };
}
/** AC2: every field list the forms offer is a field list of the listing, under its name, of its entry and field, with at least its words. */
export function coverageFailures(places: readonly Place[], lists: readonly FieldList[]): string[] {
  const byName = new Map(lists.map((l) => [l.list, l]));
  const failures: string[] = [];
  for (const p of places) {
    const l = byName.get(p.list);
    if (!l) { failures.push(`${p.list}: the forms of ${p.entry}.${p.field} offer ${p.words.join(' | ')} there, and the sealed listing holds no such field list`); continue; }
    if (l.entry !== p.entry || l.field !== p.field) failures.push(`${p.list}: the sealed listing gives its entry and field as ${l.entry} and ${l.field}, not ${p.entry} and ${p.field}`);
    const missing = p.words.filter((w) => !l.words.includes(w));
    if (missing.length) failures.push(`${p.list}: the sealed listing's words ${l.words.join(', ')} leave out ${missing.join(', ')}, which the forms offer`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The closure lane and the drift lane: `node scripts/canvas-closures.mjs <command> …`.

export interface ScriptRun { code: number | null; out: string; ms: number }
/** Runs `command` from the checkout (or inside a Seatbelt profile with no network); its exit, its output and its wall time. */
export function runCommand(command: readonly string[], options: { sandbox?: boolean } = {}): ScriptRun {
  const [head, ...rest] = options.sandbox ? ['/usr/bin/sandbox-exec', '-p', NO_NETWORK, ...command] : command;
  const t0 = performance.now();
  const r = spawnSync(head!, rest, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - t0;
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`${command.join(' ')}: ${r.error.message}`);
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms };
}
/** `node scripts/canvas-closures.mjs <args>`. */
export const closures = (args: readonly string[]): ScriptRun => runCommand([process.execPath, join(REPO, LANE_SCRIPT), ...args]);
export const linesStarting = (r: ScriptRun, prefix: string): string[] => r.out.split('\n').filter((l) => l.startsWith(prefix));
const shown = (r: ScriptRun): string => `exit ${r.code}\n${r.out.slice(0, 4000)}`;

/** The command passed: exit 0, no FAIL line, a PASS line. */
export function passes(r: ScriptRun, sub: string, what: string): void {
  expect(linesStarting(r, `FAIL ${sub}:`), `${what}: no FAIL ${sub} line\n${shown(r)}`).toEqual([]);
  expect(r.code, `${what}: exit 0\n${shown(r)}`).toBe(0);
  expect(linesStarting(r, `PASS ${sub}:`).length, `${what}: a PASS ${sub} line\n${shown(r)}`).toBeGreaterThan(0);
}
/** The command failed: exit 1, and one FAIL line naming each of `names`. */
export function failsWithLine(r: ScriptRun, sub: string, names: readonly string[], what: string): void {
  expect(r.code, `${what}: exit 1\n${shown(r)}`).toBe(1);
  const fails = linesStarting(r, `FAIL ${sub}:`);
  expect(fails.some((l) => names.every((n) => l.includes(n))), `${what}: one FAIL ${sub} line names ${names.join(' and ')}\n${shown(r)}`).toBe(true);
}

interface Counts { n: number; registry: number; closed: number; open: number }
/** The lane's PASS line: `PASS fields: <n> field lists …: <r> registry, <c> closed, <o> open`. */
export function countsOf(r: ScriptRun): Counts | string {
  const lines = linesStarting(r, `PASS ${LANE}:`);
  if (lines.length !== 1) return `the lane prints ${lines.length} PASS ${LANE} lines, not one`;
  const line = lines[0]!;
  const n = /^PASS fields: (\d+) field lists?\b/.exec(line);
  const by = /(\d+) registry, (\d+) closed, (\d+) open\b/.exec(line);
  if (!n || !by) return `the PASS line doesn't read "PASS fields: <n> field lists …: <r> registry, <c> closed, <o> open": ${line}`;
  return { n: Number(n[1]), registry: Number(by[1]), closed: Number(by[2]), open: Number(by[3]) };
}
export interface Reading { count: number; nothing: string[]; added: string[]; line: string }
const namesIn = (text: string): string[] => text.split(',').map((x) => x.trim()).filter((x) => x !== '' && x !== 'none');
/** The lane's one reading: `NOTE fields: <k> closed lists say instead: nothing: <lists>; added by this change: <lists>`. */
export function readingOf(r: ScriptRun): Reading | string {
  const lines = linesStarting(r, `NOTE ${LANE}:`);
  if (lines.length !== 1) return `the lane prints ${lines.length} NOTE ${LANE} lines, not one reading`;
  const line = lines[0]!;
  const m = /^NOTE fields: (\d+) closed lists? says? instead: nothing: (.*?); added by this change: (.*)$/.exec(line);
  if (!m) return `the reading doesn't read "NOTE fields: <k> closed lists say instead: nothing: <lists>; added by this change: <lists>": ${line}`;
  return { count: Number(m[1]), nothing: namesIn(m[2]!), added: namesIn(m[3]!), line };
}

// ---------------------------------------------------------------------------------------------------
// The generated table: under "### Registries and closed lists", after the hand-written table, between the block's
// markers, `| Field list | Words | Closure | Reopens if | Instead |`, one row per field list.

interface Row { at: number; cells: string[]; list: string; words: string[]; closure: string }
export interface Table { lines: string[]; start: number; end: number; rows: Row[] }
const unquote = (s: string): string => s.trim().replace(/^`|`$/g, '').trim();
/** A table row's cells: split on unescaped pipes. */
export const cellsOf = (line: string): string[] => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
export const rowText = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
/** The generated table in the reference's text, or why there is none to read. */
export function tableOf(text: string): Table | string {
  const lines = text.split('\n');
  const section = lines.findIndex((l) => l.trim() === SECTION);
  if (section < 0) return `${REFERENCE} has no heading ${SECTION}`;
  let sectionEnd = lines.length;
  for (let i = section + 1; i < lines.length; i++) if (/^#{1,3} /.test(lines[i]!)) { sectionEnd = i; break; }
  const hand = lines.findIndex((l, i) => i > section && i < sectionEnd && l.startsWith(HAND_HEADER));
  if (hand < 0) return `the section ${SECTION} keeps no hand-written table (${HAND_HEADER} …)`;
  const start = lines.findIndex((l, i) => i > hand && i < sectionEnd && l.trim().startsWith(BLOCK_START));
  if (start < 0) return `the section ${SECTION} holds no generated block after its hand-written table (a line starting ${BLOCK_START})`;
  const end = lines.findIndex((l, i) => i > start && i < sectionEnd && l.trim() === BLOCK_END);
  if (end < 0) return `the generated block in ${SECTION} has no end line ${BLOCK_END}`;
  const header = lines.findIndex((l, i) => i > start && i < end && l.startsWith('| '));
  if (header < 0 || lines[header]!.trim() !== GENERATED_HEADER) return `the generated block's table doesn't start with the header ${GENERATED_HEADER}: ${header < 0 ? 'no table' : lines[header]}`;
  const rows: Row[] = [];
  for (let i = header + 1; i < end; i++) {
    const l = lines[i]!;
    if (!l.startsWith('| ') || /^\|\s*-/.test(l)) continue;
    const cells = cellsOf(l);
    rows.push({ at: i, cells, list: unquote(cells[0] ?? ''), words: (cells[1] ?? '').split(',').map(unquote).filter(Boolean), closure: cells[2] ?? '' });
  }
  return { lines, start, end, rows };
}
/** The one row of the generated table for `list`. */
export function rowOf(t: Table, list: string): Row {
  const found = t.rows.filter((r) => r.list === list);
  expect(found.length, `the generated table has one row for ${list}; it has ${found.length}`).toBe(1);
  return found[0]!;
}

/** A word as a list's words write it, for matching: without a major (`@1`) or a module's prefix (`light.`, `mod.`). */
const bareWord = (w: string): string => w.replace(/@\d+$/, '').replace(/^.*\./, '');
/** Whether a row's words hold every one of `words`, each as the bare word, with or without a prefix and a major. */
export const holds = (row: Row, words: readonly string[]): boolean => {
  const have = new Set(row.words.map(bareWord));
  return words.every((w) => have.has(w));
};

/** AC3: the ten lists the issue names, each a row of the generated table (README: Readings). */
const TEN: { what: string; list?: string; prefix?: string; words: string[] }[] = [
  { what: 'the camera\'s projection', list: PROJECTION, words: ['perspective', 'orthographic', 'isometric'] },
  { what: 'translucency kinds', list: 'material@1.translucency.kind', words: ['thin', 'wrap'] },
  { what: 'a material\'s shadow modes', list: 'material@1.shadow', words: ['auto', 'cast', 'none'] },
  { what: 'the water material\'s terms', prefix: 'material@1.water.', words: [] },
  { what: 'foley\'s materials', words: ['paper', 'wood', 'metal', 'glass', 'plastic', 'rubber', 'ink', 'cloth', 'stone', 'electronic'] },
  { what: 'foley\'s actions', words: ['tap', 'hit', 'scrape', 'slide', 'whoosh', 'pop', 'tear', 'drip', 'click'] },
  { what: 'an emitter\'s distance models', words: ['inverse', 'linear', 'exponential'] },
  { what: 'tone maps', list: 'look.finish@1.tone_map', words: ['none', 'filmic', 'agx', 'neutral'] },
  { what: 'GPU deforms', words: ['bob', 'sway', 'wave', 'spin'] },
  { what: 'light kinds', words: ['point', 'spot', 'sun', 'area'] },
  { what: 'the lens\'s fields', list: 'camera@1.lens.fit', words: ['horizontal', 'vertical', 'wider'] },
];
/** AC3's check: each of the ten has its row. Each failure names the list. */
export function tenRowFailures(t: Table): string[] {
  const failures: string[] = [];
  for (const want of TEN) {
    if (want.list) {
      const rows = t.rows.filter((r) => r.list === want.list);
      if (rows.length !== 1) failures.push(`${want.what} (${want.list}): the generated table has ${rows.length} rows for it, not one`);
      else if (!holds(rows[0]!, want.words)) failures.push(`${want.what} (${want.list}): its row's words ${rows[0]!.words.join(', ')} leave out some of ${want.words.join(', ')}`);
    } else if (want.prefix) {
      if (!t.rows.some((r) => r.list.startsWith(want.prefix!))) failures.push(`${want.what}: the generated table has no row for a list in ${want.prefix.slice(0, -1)}`);
    } else if (!t.rows.some((r) => holds(r, want.words))) {
      failures.push(`${want.what}: no row of the generated table offers all of ${want.words.join(', ')}`);
    }
  }
  return failures;
}

/** A scratch tree for `--root`: the checkout's canvas reference and its contracts' data (packages/contracts but its built output). */
export function scratchTree(tag: string): string {
  const root = tempDir(tag);
  mkdirSync(join(root, 'docs'), { recursive: true });
  copyFileSync(join(REPO, REFERENCE), join(root, REFERENCE));
  const from = join(REPO, 'packages/contracts');
  cpSync(from, join(root, 'packages/contracts'), { recursive: true, filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(src.slice(from.length)) });
  return root;
}

// ---------------------------------------------------------------------------------------------------
// The document check: the agent's `deep_show` of a whole revision with its issues (#393), on `deep-show run`, as the
// hub's deep_show tool has `deep-show canvas` play it (as #1973's suite drives it). The scene is a camera over a slab
// under a sun.

const SESSION = { id: 'sess-2777', thread: 'thread-2777', name: 'An agent framing a slab', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted: a ULID. */
export const docId = (n: number): string => `01JD2777D${String(n).padStart(17, '0')}`;
/** The scenario's world for `docs`: the agent's session, its process tree, one panel per document. */
export function showWorld(docs: readonly string[]): JsonObject {
  const panels: JsonObject = {};
  const out: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; out[d] = { panel: `p${i + 1}` }; });
  return { sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } }, processes: PROCESSES, panels, docs: out };
}
/** The agent's deep_show of `document` as a revision of `doc`, with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc, document, include: ['issues'] });
/** A camera `cam` with the projection given, over a slab under a sun. */
export function cameraScene(projection: string): JsonObject {
  const item = (id: string, order: string, kind: string, params: JsonObject): JsonObject => ({ id, name: id, order, kind, params });
  return {
    format: 1, profile: 'scene', title: 'A framed slab', description: 'A camera over a slab under a sun, for the #2777 acceptance suite.', size: [480, 360],
    camera: 'cam', requires: { modules: { scene3d: '^1' } },
    items: {
      cam: item('cam', 'a0', 'camera@1', { projection, position: [6, 5, 8], target: [0, 0.5, 0], fov: 40 }),
      sun: item('sun', 'a1', 'light.sun@1', {}),
      box: item('box', 'a2', 'slab@1', { size: [1, 1, 1] }),
    },
  };
}
interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function issuesOf(reply: JsonObject): Issue[] {
  const list = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return list.map((o) => ({ code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o }));
}
/** The document passes the check: presented, with no error issue. */
export function presentedFailures(reply: JsonObject, what: string): string[] {
  const failures = issuesOf(reply).filter((i) => i.severity === 'error').map((i) => `${what}: the document check gives the error ${i.code} at ${i.path}: ${show(i.raw, 800)}`);
  if (reply['outcome'] !== 'presented') failures.push(`${what}: the revision is ${show(reply['outcome'] ?? null)}, not presented: ${show(reply, 1200)}`);
  return failures;
}
/**
 * AC5's check: the revision is refused, and an error at the projection's path names the list (`list`), what would
 * reopen it (`reopens_if`) and `instead`, each as the listing gives them. Each failure about an issue starts with its
 * code, so a refusal that carries only the bad value fails, naming the code.
 */
export function listRefusalFailures(reply: JsonObject, want: { list: string; reopens_if: string; instead: string }): string[] {
  const failures: string[] = [];
  if (reply['outcome'] !== 'refused') failures.push(`${ISSUE_PATH}: the revision is ${show(reply['outcome'] ?? null)}, not refused: ${show(reply, 800)}`);
  const at = issuesOf(reply).filter((i) => i.path === ISSUE_PATH && i.severity === 'error');
  if (!at.length) failures.push(`${ISSUE_PATH}: the check gives no error at the path: ${show(issuesOf(reply).map((i) => i.raw), 1200)}`);
  const lacks = (i: Issue): string[] => {
    const out: string[] = [];
    if (i.raw['list'] !== want.list) out.push(`it names the list ${show(i.raw['list'] ?? null)}, not ${want.list}`);
    if (i.raw['reopens_if'] !== want.reopens_if) out.push(`it says it reopens if ${show(i.raw['reopens_if'] ?? null)}, where the listing says ${show(want.reopens_if)}`);
    if (i.raw['instead'] !== want.instead) out.push(`it says instead ${show(i.raw['instead'] ?? null)}, where the listing says ${show(want.instead)}`);
    return out;
  };
  if (at.length && !at.some((i) => lacks(i).length === 0)) {
    for (const i of at) failures.push(`${i.code} at ${i.path}: ${lacks(i).join('; ')} (the issue: ${show(i.raw, 600)})`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds on one list (AC6).

/** `{call: "deep_kinds", op: "closure", list}`: the list's row, as the listing carries it. */
export const closureCall = (list: string): JsonObject => ({ call: 'deep_kinds', op: CLOSURE_OP, list });
/** AC6's check: each closed list answers its reason, reopens_if and instead as the listing gives them. Each failure names the list. */
export function closureAnswerFailures(lists: readonly FieldList[], replies: readonly JsonObject[]): string[] {
  const failures: string[] = [];
  lists.forEach((l, i) => {
    const r = replies[i] ?? {};
    const e = r['error'];
    if (isObject(e)) { failures.push(`${l.list}: deep_kinds refuses it: ${String(e['code'])} at ${String(e['path'])}: ${String(e['remediation'] ?? '')}`); return; }
    const want = closedOf(l.closure);
    const got = closedOf(r['closure']);
    if (r['list'] !== l.list) failures.push(`${l.list}: deep_kinds answers for the list ${show(r['list'] ?? null)}: ${show(r, 400)}`);
    if (!want) { failures.push(`${l.list}: the listing gives it no closed closure: ${show(l.closure ?? null)}`); return; }
    if (!got) { failures.push(`${l.list}: deep_kinds answers no closed closure with its reason, reopens_if and instead: ${show(r, 400)}`); return; }
    for (const k of ['reason', 'reopens_if', 'instead'] as const) {
      if (got[k] !== want[k]) failures.push(`${l.list}: deep_kinds gives its ${k} as ${show(got[k])}, the listing as ${show(want[k])}`);
    }
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The local preflight (AC8): the lane as scripts/lanes.mjs lists it, and a Seatbelt profile with no network.

interface LaneCommand { lane: string; command: string[] }
/** Every command of the local preflight's lanes (scripts/lanes.mjs `checks`) that runs the closure lane. */
export async function laneCommands(): Promise<LaneCommand[]> {
  const mod = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { checks?: { name: string; commands: string[][] }[] };
  expect(Array.isArray(mod.checks), 'scripts/lanes.mjs exports checks, the local preflight\'s lanes').toBe(true);
  return mod.checks!.flatMap((l) => l.commands
    .filter((c) => c.some((a) => a === LANE_SCRIPT || a.endsWith(`/${LANE_SCRIPT}`)) && c.includes(LANE))
    .map((command) => ({ lane: l.name, command: [...command] })));
}
/** A Seatbelt profile that allows everything but the network. */
const NO_NETWORK = '(version 1)(allow default)(deny network*)';
/**
 * Why the profile can't stand for "reads no network" here, or null: a node child inside it must fail to reach a
 * listener on 127.0.0.1 that a child outside it reaches. The listener is this process's own and closes after.
 */
export async function sandboxProblem(): Promise<string | null> {
  if (!existsSync('/usr/bin/sandbox-exec')) return 'no /usr/bin/sandbox-exec on this machine';
  const server = createServer((s) => s.destroy());
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  try {
    const port = (server.address() as AddressInfo).port;
    const probe = `const s=require('node:net').connect(${port},'127.0.0.1');s.on('connect',()=>{console.log('connected');process.exit(0)});s.on('error',(e)=>{console.log('refused '+e.code);process.exit(3)});`;
    const outside = runCommand([process.execPath, '-e', probe]);
    const inside = runCommand([process.execPath, '-e', probe], { sandbox: true });
    if (outside.code !== 0) return `a child outside the profile can't reach 127.0.0.1:${port}: ${shown(outside)}`;
    if (inside.code === 0) return `a child inside the profile reaches 127.0.0.1:${port}, so the profile denies no network: ${shown(inside)}`;
    return null;
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/412).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. Mains power never gates. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** The design's rule on five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const text = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit.toFixed(4)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${text}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown: text };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: text };
  return { status: 'INCONCLUSIVE', shown: text };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
