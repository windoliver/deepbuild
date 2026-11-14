// Test-side tools for the #1974 acceptance tests: the full build of `deep-show` (built once per file), the canonical
// dump `deep kinds --dump` writes (`deep-show kinds --dump`), the line `op: field` prints for a field (deep_kinds on
// `deep-show run`, one scenario per batch of calls), the defaults run (`deep-show kinds --defaults [--planted <name>]`,
// one JSON object: this suite's reading of the surface the issue leaves open, README: The surfaces under test), and
// the criteria's checks over its report. Nothing here stands in for the run, the dump or deep_kinds: every answer read
// here is the binary's own. Each `...Failures` function is a criterion's check: it returns sentences naming what
// failed, so a test runs it on the right program (no failures) and on the criterion's planted program (a failure
// naming what the criterion says).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1974 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** AC2's fixture kind. */
export const FIXTURE = 'test.defaults@1';
/** AC1's planted reader: the field whose reader falls back to 2 where its line says 1 (README: Plants). */
export const READER_KIND = 'puff@1';
export const READER_FIELD = 'radius';
export const READER_PATH = `${READER_KIND}.${READER_FIELD}`;
/** The planted twins (README: Plants). */
export const PLANT_READER_2 = 'defaults_reader_falls_back_to_2';
export const PLANT_DUMP_ONLY = 'defaults_compared_with_dump_only';
export const PLANT_SKIP_JSON = 'defaults_skip_json';

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
/** A JSON value's text with every object's keys sorted, so two values compare by content (10.0 and 10 are one number). */
export function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

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
// The full build: `deep-show` with its default features (`full`), in the checkout's own target folder.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
function cargo(args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...CARGO_ENV };
  delete env['CARGO_TARGET_DIR'];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

/**
 * Builds the full `deep-show` once for the file (`cargo build --locked --bin deep-show`, default features: full); the
 * getter fails a test, naming the build, when it didn't build, and gives the newer of target/release and target/debug.
 */
export function useFullBuild(): () => string {
  let error = 'not built';
  beforeAll(() => { error = cargo(['build', '--locked', '--bin', 'deep-show']); }, 7_200_000);
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, 60_000);
  return () => {
    expect(error, 'the full build of deep-show compiles').toBe('');
    const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-show')).filter((p) => existsSync(p));
    expect(built.length, `no deep-show is built under ${join(REPO, 'target')}`).toBeGreaterThan(0);
    return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
  };
}

/** Folders under /tmp/dh1974-*, each removed after the file. */
const made: string[] = [];
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join('/tmp', `dh1974-${tag}-`)));
  made.push(d);
  return d;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show`: JSON lines in, one JSON line out per line in.

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** `op: field` with `path: <kind>@<major>.<field>`. */
export const fieldCall = (path: string): JsonObject => ({ call: 'deep_kinds', op: 'field', path });

/** `deep-show run` with one scenario holding `calls`: one reply per call. */
export function run(bin: string, calls: JsonObject[]): JsonObject[] {
  const s = start(bin, ['run'], [{ evidence: tempDir('ev'), calls }]);
  expect(s.timedOut, 'deep-show run finished within its timeout').toBe(false);
  expect(s.status, `deep-show run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = s.lines[0];
  expect(isObject(out) && out['ok'] === true, `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies, 600)}`).toBe(true);
  return (replies as JsonValue[]).map((r) => (isObject(r) ? r : { reply: r }));
}

// ---------------------------------------------------------------------------------------------------
// The dump (`deep kinds --dump`, which runs `deep-show kinds --dump <dir>`): every entry's fields, in order.

export interface DumpField { kind: string; field: string; path: string; type: JsonValue | undefined; default: JsonValue | undefined }

/** `deep-show kinds --dump <dir>` of the build: every field of every entry, in the dump's order, read back from its file. */
export function dumpFields(bin: string): DumpField[] {
  const dir = tempDir('dump');
  const s = start(bin, ['kinds', '--dump', dir], [], 600_000);
  expect(s.status, `deep-show kinds --dump exits 0: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-800)}`).toBe(0);
  const line = s.lines[0];
  expect(isObject(line) && line['ok'] === true && typeof line['path'] === 'string', `deep-show kinds --dump answers ok with its path: ${show(line)}`).toBe(true);
  const value = JSON.parse(readFileSync((line as JsonObject)['path'] as string, 'utf8')) as JsonValue;
  expect(isObject(value) && Array.isArray(value['registries']), `the dump holds its registries: ${show(value, 600)}`).toBe(true);
  const out: DumpField[] = [];
  for (const r of ((value as JsonObject)['registries'] as JsonValue[]).filter(isObject)) {
    for (const e of (Array.isArray(r['entries']) ? r['entries'] : []).filter(isObject)) {
      const kind = String(e['name']);
      for (const f of (Array.isArray(e['fields']) ? e['fields'] : []).filter(isObject)) {
        out.push({ kind, field: String(f['name']), path: `${kind}.${String(f['name'])}`, type: f['type'], default: f['default'] });
      }
    }
  }
  return out;
}
/** A field with a default: its `default` is there and not null (README: Readings). */
export const hasDefault = (f: DumpField): boolean => f.default !== undefined && f.default !== null;

// ---------------------------------------------------------------------------------------------------
// The line `op: field` prints: the one element of the answer's `lines` (an object, or a string holding one JSON
// object's text), as #1971 answers.

/** The one line of a one-field answer, or why there is none to read. */
export function lineOf(reply: JsonObject): JsonObject | string {
  const e = reply['error'];
  if (isObject(e)) return `refused: ${String(e['code'])} at ${String(e['path'])}: ${String(e['remediation'] ?? '')}`;
  const lines = reply['lines'];
  if (!Array.isArray(lines)) return `the answer holds no lines: ${show(reply, 600)}`;
  if (lines.length !== 1) return `the answer holds ${lines.length} lines, not one: ${show(lines, 600)}`;
  const l = lines[0];
  if (isObject(l)) return l;
  if (typeof l === 'string') { try { const v = JSON.parse(l) as JsonValue; if (isObject(v)) return v; } catch { /* below */ } }
  return `its line is not one JSON object: ${show(l, 300)}`;
}
/** The line `op: field` prints for each of `fields`, by path, from one `deep-show run`. */
export function linesFor(bin: string, fields: readonly DumpField[]): Map<string, JsonObject | string> {
  const replies = fields.length ? run(bin, fields.map((f) => fieldCall(f.path))) : [];
  return new Map(fields.map((f, i) => [f.path, lineOf(replies[i] ?? {})]));
}

// ---------------------------------------------------------------------------------------------------
// The defaults run: `deep-show kinds --defaults [--planted <name>]`, next to `--dump` and `--diff`, answering one JSON
// object, its report (README: The surfaces under test). The tests read its `verdict`, its `count`, its fields by kind
// under `kinds`, and what it names outside `kinds`.

/** The run's report. It must be one JSON object holding a verdict word; at the base it is a refusal. */
export function defaultsRun(bin: string, planted?: string): JsonObject {
  const args = ['kinds', '--defaults', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [], 1_800_000);
  const what = `deep-show ${args.join(' ')}`;
  expect(s.timedOut, `${what} finished within its timeout`).toBe(false);
  const report = s.lines.find(isObject);
  expect(report !== undefined && typeof report['verdict'] === 'string', `${what} answers one report holding its verdict word (exit ${String(s.status)}, ${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(true);
  return report as JsonObject;
}

/** A report's verdict word. */
export const verdictOf = (report: JsonObject): JsonValue | undefined => report['verdict'];

/** The two builds of a field and the three things each gives (README: Readings). */
export const SIDES = ['left_out', 'set'] as const;
export const PARTS = ['check', 'hash', 'values'] as const;

/** Each field the report lists under `kind`, by path: its entry (an object, or a bare name). */
export function listed(report: JsonObject): Map<string, JsonValue> | string {
  const k = report['kinds'];
  let groups: { kind: string; fields: JsonValue[] }[];
  if (Array.isArray(k)) {
    groups = k.filter(isObject).map((g) => ({ kind: String(g['kind'] ?? g['name']), fields: Array.isArray(g['fields']) ? g['fields'] : [] }));
  } else if (isObject(k)) {
    groups = Object.entries(k).map(([kind, v]) => ({ kind, fields: Array.isArray(v) ? v : isObject(v) && Array.isArray(v['fields']) ? v['fields'] : [] }));
  } else {
    return `the report lists no fields by kind (its kinds is ${show(k ?? null, 200)})`;
  }
  const out = new Map<string, JsonValue>();
  for (const g of groups) {
    for (const e of g.fields) {
      const n = typeof e === 'string' ? e : isObject(e) ? e['field'] ?? e['name'] : undefined;
      if (typeof n !== 'string') continue;
      const field = n.startsWith(`${g.kind}.`) ? n.slice(g.kind.length + 1) : n;
      const path = `${g.kind}.${field}`;
      if (!out.has(path)) out.set(path, e);
    }
  }
  return out;
}

/** What an entry shows built for `side` and `part`: `entry[side][part]`, or `entry[part][side]`. */
function builtPart(entry: JsonObject, side: string, part: string): JsonValue | undefined {
  const a = entry[side];
  if (isObject(a) && a[part] !== undefined) return a[part];
  const b = entry[part];
  if (isObject(b) && b[side] !== undefined) return b[side];
  return undefined;
}

/**
 * AC1's check: the run's verdict is PASS, and for each of `fields` (each with a default), the report lists it under its
 * kind with an entry that shows the kind's example built with the field left out and set to its default, each build's
 * check result, built output hash and evaluated values, the two the same; and the default it set is the one `op: field`
 * prints. Each failure about a field starts with its path and a colon, so it names the kind and the field; a failure
 * about the whole run starts with "the run:".
 */
export function comparisonFailures(fields: readonly DumpField[], lines: ReadonlyMap<string, JsonObject | string>, report: JsonObject): string[] {
  const failures: string[] = [];
  if (verdictOf(report) !== 'PASS') failures.push(`the run: its verdict is ${show(verdictOf(report) ?? null)}, not PASS`);
  const byPath = listed(report);
  if (typeof byPath === 'string') failures.push(`the run: ${byPath}`);
  for (const f of fields) {
    const entry = typeof byPath === 'string' ? undefined : byPath.get(f.path);
    if (entry === undefined) { failures.push(`${f.path}: the run lists no comparison for it under ${f.kind}`); continue; }
    if (!isObject(entry)) { failures.push(`${f.path}: its entry shows nothing built: ${show(entry, 300)}`); continue; }
    const missing = SIDES.flatMap((s) => PARTS.filter((p) => { const v = builtPart(entry, s, p); return v === undefined || v === null; }).map((p) => `${s} ${p}`));
    if (missing.length) {
      failures.push(`${f.path}: its entry shows no ${missing.join(', ')}, so the example is not shown built with the field left out and set to its default: ${show(entry, 600)}`);
      continue;
    }
    for (const s of SIDES) {
      const h = builtPart(entry, s, 'hash');
      if (typeof h !== 'string' || h.trim() === '') failures.push(`${f.path}: its ${s} build's output hash is not a hash: ${show(h ?? null, 200)}`);
    }
    for (const p of PARTS) {
      const [a, b] = SIDES.map((s) => builtPart(entry, s, p));
      if (canon(a) !== canon(b)) failures.push(`${f.path}: left out and set to its default give different ${p}: left out ${show(a, 400)}, set ${show(b, 400)}`);
    }
    const line = lines.get(f.path);
    if (line === undefined || typeof line === 'string') { failures.push(`${f.path}: op: field gives no line to read its default from: ${line ?? 'not asked'}`); continue; }
    if (entry['default'] === undefined) failures.push(`${f.path}: its entry doesn't show the default it set (op: field prints ${show(line['default'] ?? null, 200)})`);
    else if (canon(entry['default']) !== canon(line['default'])) failures.push(`${f.path}: set to ${show(entry['default'], 200)}, but op: field prints the default ${show(line['default'] ?? null, 200)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC2's fixture kind, as the dump lists it (README: Readings).

/** The forms a line prints: the strings under `forms` (a list) or `form`. */
function formsOf(line: JsonObject | string | undefined): string[] {
  if (line === undefined || typeof line === 'string') return [];
  const f = line['forms'] ?? line['form'];
  return (Array.isArray(f) ? f : [f]).filter((x): x is string => typeof x === 'string');
}
/**
 * AC2's fixture: the dump lists `test.defaults@1` with four fields, one each defaulting to a number (typed number), a
 * choice (typed json, its default one of at least two forms its line prints), a list of 3 numbers (typed json) and an
 * object (typed json). Each failure starts with the kind's name.
 */
export function fixtureFailures(fields: readonly DumpField[], lines: ReadonlyMap<string, JsonObject | string>): string[] {
  const failures: string[] = [];
  const seen = show(fields.map((f) => ({ field: f.field, type: f.type ?? null, default: f.default ?? null })), 1200);
  if (fields.length !== 4) failures.push(`${FIXTURE}: the full build's dump lists ${fields.length} fields for it, not four: ${seen}`);
  const shapes: [string, (f: DumpField) => boolean][] = [
    ['a number (typed number)', (f) => f.type === 'number' && typeof f.default === 'number'],
    ['a choice (typed json, one of the forms its line prints)', (f) => {
      const forms = formsOf(lines.get(f.path));
      return f.type === 'json' && typeof f.default === 'string' && forms.length >= 2 && forms.includes(f.default);
    }],
    ['a list of 3 numbers (typed json)', (f) => f.type === 'json' && Array.isArray(f.default) && f.default.length === 3 && f.default.every((x) => typeof x === 'number')],
    ['an object (typed json)', (f) => f.type === 'json' && isObject(f.default)],
  ];
  for (const [what, is] of shapes) {
    const n = fields.filter(is).length;
    if (n !== 1) failures.push(`${FIXTURE}: ${n} of its fields default to ${what}, not one: ${seen}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Naming: what a report names outside `kinds`, its per-kind list of compared fields, where every field is named.

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asWord = (text: string, w: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(w)}(?![\\p{L}\\p{N}_])`, 'u').test(text);

/**
 * Whether the report, outside `kinds`, names the field `field` of `kind`: one of its strings, or the string members of
 * one of its objects taken together, holds the path `<kind>.<field>`, or holds the kind and, apart from it, the
 * field's name as a word.
 */
export function namesField(report: JsonObject, kind: string, field: string): boolean {
  const units: string[] = [];
  const walk = (v: JsonValue, top: boolean): void => {
    if (typeof v === 'string') units.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, false));
    else if (isObject(v)) {
      const entries = Object.entries(v).filter(([k]) => !(top && k === 'kinds'));
      const strings = entries.map(([, x]) => x).filter((x): x is string => typeof x === 'string');
      if (strings.length) units.push(strings.join(' | '));
      for (const [, x] of entries) walk(x, false);
    }
  };
  walk(report, true);
  return units.some((u) => u.includes(`${kind}.${field}`) || (u.includes(kind) && asWord(u.split(kind).join(' '), field)));
}
/** The report with `kinds` left out, for a message. */
export const outsideKinds = (report: JsonObject, n = 2000): string => show(Object.fromEntries(Object.entries(report).filter(([k]) => k !== 'kinds')), n);
