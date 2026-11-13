// Test-side tools for the #1971 acceptance tests: the full build of `deep-show` (built once per file), its
// `deep_kinds` call (`deep-show run`, one scenario per batch of calls), the canonical dump `deep kinds --dump` writes
// (`deep-show kinds --dump`, which `deep kinds --dump` runs), the lines an `op: field` answer holds, the criteria's
// checks, the shared error shape read from the contracts' published schemas, a `deep-show run` kept open for timings
// with #412's reference-Mac gate and judge, and a real hub with `deep mcp` in a temporary home for the deep_kinds tool.
// Nothing here stands in for deep_kinds, the dump, the hub or `deep mcp`: every answer read here is the binary's own.
// Each `...Failures` function is a criterion's check: it returns sentences naming what failed, so a test runs it on
// the right program (no failures) and on the criterion's planted program (a failure naming what the criterion says).
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1971 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;

/** AC1: each line is under this many bytes. */
export const LINE_CAP = 512;
/** AC3: a one-field reply is under 1 KB. */
export const ONE_FIELD_REPLY_CAP = 1024;
/** AC3: #412's budget, p95 in ms. */
export const BUDGET_MS = 100;

/** The kind and the names the issue gives (AC4), and the base's test.slab@3 in the full build. */
export const SLAB = 'test.slab@3';
export const SLAB_RENAMED_IN = 'test.slab@2';

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const bytesOf = (v: JsonValue | undefined): number => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
/** Two JSON values alike, as their JSON text after parsing (so 10.0 and 10 are one number). */
export const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

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
// The full build: `deep-show` with its default features (`full`), in the checkout's own target folder, since the hub
// runs its canvas core from there (packages/hub/src/canvas.ts, canvasCore); and deep-hook, which the hub needs to start.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
function cargo(args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...CARGO_ENV };
  // The hub looks for its canvas core and deep-hook under the checkout's own target folder, so both are built there.
  delete env['CARGO_TARGET_DIR'];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** A checkout's build as the hub finds it: the newer of target/release and target/debug. */
function checkoutBuild(name: string): string {
  const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, name)).filter((p) => existsSync(p));
  expect(built.length, `no ${name} is built under ${join(REPO, 'target')}`).toBeGreaterThan(0);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

/**
 * Builds the full `deep-show` once for the file (`cargo build --locked --bin deep-show`, default features: full) and,
 * with `hook`, deep-hook in a separate run (`cargo build --locked -p deep-hook --bin deep-hook`); the getter fails a
 * test, naming the build, when one didn't build, and gives the binary the hub would run as its canvas core.
 */
export function useFullBuild(options: { hook?: boolean } = {}): () => string {
  let error = 'not built';
  beforeAll(() => {
    error = cargo(['build', '--locked', '--bin', 'deep-show']);
    if (!error && options.hook) error = cargo(['build', '--locked', '-p', 'deep-hook', '--bin', 'deep-hook']);
  }, 7_200_000);
  return () => {
    expect(error, `the full build of deep-show${options.hook ? ' and deep-hook' : ''} compiles`).toBe('');
    return checkoutBuild('deep-show');
  };
}

// ---------------------------------------------------------------------------------------------------
// Folders: each removed after the file.

const made: string[] = [];
export function tempDir(tag: string, root = tmpdir()): string {
  const d = realpathSync(mkdtempSync(join(root, `${root === '/tmp' ? 'dh1971' : 'deep-1971'}-${tag}-`)));
  made.push(d);
  return d;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show`: JSON lines in, one JSON line out per line in.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** One deep_kinds call. */
export const kinds = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
/** The issue's call: `op: field` with `path: <kind>@<major>.<field>`, or an object path `<kind>@<major>`. */
export const fieldCall = (path: string): JsonObject => kinds('field', { path });

/** `deep-show run [--planted <name>]` with one scenario holding `calls`: one reply per call. */
export function run(bin: string, calls: JsonObject[], planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tempDir('ev'), calls }]);
  expect(s.timedOut, `deep-show ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `deep-show ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `deep-show ${args.join(' ')}: one output line per input line`).toBe(1);
  const out = s.lines[0];
  expect(isObject(out) && out['ok'] === true, `deep-show ${args.join(' ')} took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies, 600)}`).toBe(true);
  return (replies as JsonValue[]).map((r) => (isObject(r) ? r : { reply: r }));
}

// ---------------------------------------------------------------------------------------------------
// The dump (`deep kinds --dump`, which runs `deep-show kinds --dump <dir>`): every entry with its fields in order.

export interface DumpField { kind: string; field: string; path: string; raw: JsonObject }
export interface DumpEntry { name: string; registry: string; fields: DumpField[] }
export interface Dump { path: string; moduleSet: string; entries: DumpEntry[]; fields: DumpField[] }

/** `deep-show kinds --dump <dir>` of the build: the file it writes, read back. */
export function dumpOf(bin: string): Dump {
  const dir = tempDir('dump');
  const s = start(bin, ['kinds', '--dump', dir], [], 600_000);
  expect(s.status, `deep-show kinds --dump exits 0: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-800)}`).toBe(0);
  const line = s.lines[0];
  expect(isObject(line) && line['ok'] === true && typeof line['path'] === 'string', `deep-show kinds --dump answers ok with its path: ${show(line)}`).toBe(true);
  const path = (line as JsonObject)['path'] as string;
  const value = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  expect(isObject(value) && Array.isArray(value['registries']), `the dump holds its registries: ${show(value, 600)}`).toBe(true);
  const entries: DumpEntry[] = [];
  for (const r of ((value as JsonObject)['registries'] as JsonValue[]).filter(isObject)) {
    for (const e of (Array.isArray(r['entries']) ? r['entries'] : []).filter(isObject)) {
      const name = String(e['name']);
      const raw = Array.isArray(e['fields']) ? e['fields'].filter(isObject) : [];
      entries.push({ name, registry: String(e['registry'] ?? r['name']), fields: raw.map((f) => ({ kind: name, field: String(f['name']), path: `${name}.${String(f['name'])}`, raw: f })) });
    }
  }
  return { path, moduleSet: String((line as JsonObject)['module_set']), entries, fields: entries.flatMap((e) => e.fields) };
}
/** The dump's entries that list at least one field: the kinds an object path answers. */
export const kindsWithFields = (d: Dump): DumpEntry[] => d.entries.filter((e) => e.fields.length > 0);
/** One entry of the dump by name. */
export function entryIn(d: Dump, name: string): DumpEntry {
  const found = d.entries.filter((e) => e.name === name);
  expect(found.length, `the dump lists one entry ${name}; it lists ${found.length}`).toBe(1);
  return found[0]!;
}

// ---------------------------------------------------------------------------------------------------
// The lines an `op: field` answer holds (README: Readings): `lines`, each a string (one line of text, which may be a
// JSON object's text) or an object (its line is its JSON text); else `text`, split on newlines. A line's values are the
// JSON object it is or holds; it names its field by `name` (the field's name or its whole path) or by `path`.

export interface Line { text: string; bytes: number; value: JsonObject | undefined }
const splitText = (t: string): string[] => { const parts = t.split('\n'); if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); return parts; };
function lineOf(text: string, value?: JsonObject): Line {
  let v = value;
  if (!v) { try { const p = JSON.parse(text) as JsonValue; v = isObject(p) ? p : undefined; } catch { v = undefined; } }
  return { text, bytes: Buffer.byteLength(text, 'utf8'), value: v };
}
/** The lines of an answer, or why there are none to read (a refusal, or no lines at all). */
export function linesOf(reply: JsonObject): Line[] | string {
  const e = reply['error'];
  if (isObject(e)) return `refused: ${String(e['code'])} at ${String(e['path'])}: ${String(e['remediation'] ?? '')}`;
  if (Array.isArray(reply['lines'])) {
    const out: Line[] = [];
    for (const l of reply['lines']) {
      if (typeof l === 'string') out.push(...splitText(l).map((t) => lineOf(t)));
      else if (isObject(l)) out.push(lineOf(JSON.stringify(l), l));
      else return `a line is neither text nor an object: ${show(l, 300)}`;
    }
    return out;
  }
  if (typeof reply['text'] === 'string') return splitText(reply['text']).map((t) => lineOf(t));
  return `the answer holds no lines: ${show(reply, 600)}`;
}
/** The field of `kind` a line names, by `name` (the field or its path) or `path`; undefined when it names none of `fields`. */
export function fieldNamed(line: Line, kind: string, fields: readonly string[]): string | undefined {
  const v = line.value;
  if (!v) return undefined;
  for (const key of ['name', 'path']) {
    const n = v[key];
    if (typeof n !== 'string') continue;
    const f = n.startsWith(`${kind}.`) ? n.slice(kind.length + 1) : n;
    if (fields.includes(f)) return f;
  }
  return undefined;
}

/** The dump's values the one-field line must equal (AC1). */
export const COMPARED = ['type', 'unit', 'range', 'default'] as const;

/**
 * AC1's check: for every dumped field, the answer to `op: field` with its path holds exactly one line, under 512 bytes,
 * whose type, unit, range and default equal the dump's. Each failure starts with the field's path, so it names the
 * kind and the field.
 */
export function oneFieldFailures(fields: readonly DumpField[], replies: readonly JsonObject[]): string[] {
  const failures: string[] = [];
  fields.forEach((f, i) => {
    const lines = linesOf(replies[i] ?? {});
    if (typeof lines === 'string') { failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): ${lines}`); return; }
    if (lines.length !== 1) { failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): answers ${lines.length} lines, not exactly one: ${show(lines.map((l) => l.text), 600)}`); return; }
    const line = lines[0]!;
    if (line.bytes >= LINE_CAP) failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): its line is ${line.bytes} bytes, not under ${LINE_CAP}`);
    if (!line.value) { failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): its line is not one JSON object, so its type, unit, range and default can't be read: ${line.text.slice(0, 300)}`); return; }
    for (const k of COMPARED) {
      if (!same(line.value[k], f.raw[k])) failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): ${k} is ${show(line.value[k] ?? null, 200)}, the dump's is ${show(f.raw[k] ?? null, 200)}`);
    }
  });
  return failures;
}

/** AC3's structure: each one-field answer holds one line and its reply is under 1 KB. Each failure names the path. */
export function replySizeFailures(fields: readonly DumpField[], replies: readonly JsonObject[]): string[] {
  const failures: string[] = [];
  fields.forEach((f, i) => {
    const reply = replies[i] ?? {};
    const lines = linesOf(reply);
    if (typeof lines === 'string') failures.push(`${f.path}: ${lines}`);
    else if (lines.length !== 1) failures.push(`${f.path}: answers ${lines.length} lines, not a one-field reply`);
    const n = bytesOf(reply);
    if (n >= ONE_FIELD_REPLY_CAP) failures.push(`${f.path}: the one-field reply is ${n} bytes, not under ${ONE_FIELD_REPLY_CAP}`);
  });
  return failures;
}

/**
 * AC2's check: the object path of each kind answers as many lines as the dump lists params for it, each naming one
 * of its fields, in the dump's order. An order failure says "out of place" and names the first line out of place.
 */
export function objectFailures(entries: readonly DumpEntry[], replies: readonly JsonObject[]): string[] {
  const failures: string[] = [];
  entries.forEach((e, i) => {
    const want = e.fields.map((f) => f.field);
    const lines = linesOf(replies[i] ?? {});
    if (typeof lines === 'string') { failures.push(`${e.name}: ${lines}`); return; }
    if (lines.length !== want.length) { failures.push(`${e.name}: answers ${lines.length} lines, where the dump lists ${want.length} params (${want.join(', ')}): ${show(lines.map((l) => l.text), 800)}`); return; }
    const got = lines.map((l) => fieldNamed(l, e.name, want));
    const unnamed = got.findIndex((g) => g === undefined);
    if (unnamed >= 0) { failures.push(`${e.name}: line ${unnamed + 1} names none of its fields (${want.join(', ')}) by name or path: ${lines[unnamed]!.text.slice(0, 300)}`); return; }
    const at = got.findIndex((g, k) => g !== want[k]);
    if (at >= 0) failures.push(`${e.name}: out of place: line ${at + 1} is ${got[at]}, where the dump lists ${want[at]}; the answer's order is ${got.join(', ')}, the dump's ${want.join(', ')}`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The shared error shape (AC4): the contracts' published error@N schemas, read as they stand.

const SCHEMAS = join(REPO, 'packages/contracts/schemas');
/** Every published error@N schema, by major, newest first. */
export function errorSchemas(): { name: string; schema: JsonObject }[] {
  return readdirSync(SCHEMAS)
    .map((f) => /^error@(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map((m) => ({ name: `error@${m[1]}`, schema: JSON.parse(readFileSync(join(SCHEMAS, m[0]), 'utf8')) as JsonObject }));
}
/** What keeps `v` out of `schema`, for the node kinds the error schemas use: object, string, boolean, array. */
function shapeProblems(schema: JsonObject, v: JsonValue | undefined, at: string): string[] {
  const out: string[] = [];
  switch (schema['type']) {
    case 'object': {
      if (!isObject(v)) return [`${at || '/'}: not an object`];
      const props = isObject(schema['properties']) ? schema['properties'] : {};
      for (const k of Array.isArray(schema['required']) ? schema['required'] : []) if (!(String(k) in v)) out.push(`${at}/${String(k)}: missing`);
      if (schema['additionalProperties'] === false) for (const k of Object.keys(v)) if (!(k in props)) out.push(`${at}/${k}: not a field of the shape`);
      for (const [k, s] of Object.entries(props)) if (k in v && isObject(s)) out.push(...shapeProblems(s, v[k], `${at}/${k}`));
      break;
    }
    case 'string': {
      if (typeof v !== 'string') return [`${at}: not a string`];
      if (Array.isArray(schema['enum']) && !schema['enum'].includes(v)) out.push(`${at}: ${v} is not one of its closed set`);
      if (typeof schema['minLength'] === 'number' && [...v].length < schema['minLength']) out.push(`${at}: shorter than ${schema['minLength']}`);
      if (typeof schema['maxLength'] === 'number' && [...v].length > schema['maxLength']) out.push(`${at}: longer than ${schema['maxLength']}`);
      if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern'], 'u').test(v)) out.push(`${at}: doesn't match ${schema['pattern']}`);
      break;
    }
    case 'boolean':
      if (typeof v !== 'boolean') out.push(`${at}: not a boolean`);
      break;
    case 'array':
      if (!Array.isArray(v)) return [`${at}: not an array`];
      if (isObject(schema['items'])) v.forEach((x, i) => out.push(...shapeProblems(schema['items'] as JsonObject, x, `${at}/${i}`)));
      break;
    default:
      break;
  }
  return out;
}
/** The error is in the shared shape: it validates against one of the published error@N schemas. Each failure names `what`. */
export function sharedShapeFailures(e: JsonValue | undefined, what: string): string[] {
  const schemas = errorSchemas();
  const results = schemas.map((s) => ({ name: s.name, problems: shapeProblems(s.schema, e, '') }));
  if (results.some((r) => r.problems.length === 0)) return [];
  return [`${what}: the error is in none of the published shapes (${results.map((r) => `${r.name}: ${r.problems.join('; ')}`).join(' | ')}): ${show(e, 800)}`];
}

// ---------------------------------------------------------------------------------------------------
// Names in a remediation (AC4), as #1970's suite reads them.

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (name: string): RegExp => new RegExp(`(?<![A-Za-z0-9_'’])${escape(name)}(?![A-Za-z0-9_'’])`, 'g');
/** How many times `name` stands as a word of `text`: not inside a longer name, a later major or a contraction. */
export const timesNamed = (text: string, name: string): number => (text.match(word(name)) ?? []).length;
/** Whether `text` singles `name` out among `choices`: names it more often than some other choice. */
export function singlesOut(text: string, name: string, choices: readonly string[]): boolean {
  const others = choices.filter((c) => c !== name).map((c) => timesNamed(text, c));
  return others.length > 0 && timesNamed(text, name) > Math.min(...others);
}
/**
 * The first close name `text` names: the earliest of `fields` named as a word, or of any other kind (`name@major`)
 * but a major of `ownKind`'s family, which the refusal names as the kind it reads.
 */
export function firstNamed(text: string, fields: readonly string[], ownKind: string): string | undefined {
  const family = ownKind.replace(/@\d+$/, '');
  const hits: { at: number; name: string }[] = [];
  for (const f of fields) { const m = word(f).exec(text); if (m) hits.push({ at: m.index, name: f }); }
  for (const m of text.matchAll(/(?<![\w./-])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*@\d+)(?![\w])/g)) {
    if (m[1]!.replace(/@\d+$/, '') !== family) hits.push({ at: m.index!, name: m[1]! });
  }
  hits.sort((a, b) => a.at - b.at);
  return hits[0]?.name;
}

/** What AC4 asks of one miss's reply (an error@N value and the reply it came in). */
export interface Miss { path: string; first?: string; names: string; renamedIn?: string }
/**
 * AC4's check on one refused miss: one error in the shared shape, code `unknown_field`; its remediation singles out
 * `names` among the kind's fields, names it first (with `first`) and names the version that renamed it (with
 * `renamedIn`); a `close` list the error carries, if any, agrees. Each failure starts with the path.
 */
export function missFailures(e: JsonValue | undefined, want: Miss, fields: readonly string[]): string[] {
  const at = want.path;
  if (!isObject(e)) return [`${at}: no error: ${show(e ?? null, 800)}`];
  const failures = sharedShapeFailures(e, at);
  if (e['code'] !== 'unknown_field') failures.push(`${at}: refused with ${show(e['code'] ?? null)}, not unknown_field: ${show(e, 800)}`);
  const text = typeof e['remediation'] === 'string' ? e['remediation'] : '';
  if (!singlesOut(text, want.names, fields)) failures.push(`${at}: the remediation doesn't name ${want.names} as the close name (it names ${fields.map((f) => `${f} ×${timesNamed(text, f)}`).join(', ')}): ${show(text)}`);
  if (want.first) {
    const first = firstNamed(text, fields, SLAB);
    if (first !== want.first) failures.push(`${at}: the remediation names ${first ?? 'no close name'} first, not ${want.first}: ${show(text)}`);
  }
  if (want.renamedIn && timesNamed(text, want.renamedIn) === 0) failures.push(`${at}: the remediation names ${want.names} without renamed_in ${want.renamedIn}: ${show(text)}`);
  if (Array.isArray(e['close'])) {
    const close = e['close'].filter(isObject);
    if (want.first && close[0]?.['name'] !== want.first) failures.push(`${at}: its close names put ${show(close[0]?.['name'] ?? null)} first, not ${want.first}: ${show(close)}`);
    if (want.renamedIn && !close.some((c) => c['name'] === want.names && c['renamed_in'] === want.renamedIn)) failures.push(`${at}: its close names hold no ${want.names} with renamed_in ${want.renamedIn}: ${show(close)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// A `deep-show run` kept open, one scenario line at a time, for timings (each line gets one reply line), as #412's.

export class Streamed {
  private child: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => void)[] = [];
  private constructor(bin: string) {
    this.child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.waiting.shift()?.(line));
    this.child.stderr.resume();
  }
  static open(bin: string): Streamed { return new Streamed(bin); }
  /** One scenario: its replies, and the wall time from writing the line to reading its answer, in ms. */
  async send(evidence: string, calls: JsonObject[]): Promise<{ replies: JsonObject[]; ms: number }> {
    const line = new Promise<string>((resolve) => this.waiting.push(resolve));
    const t0 = process.hrtime.bigint();
    this.child.stdin.write(`${JSON.stringify({ evidence, calls })}\n`);
    const text = await line;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const out = JSON.parse(text) as JsonValue;
    expect(isObject(out) && out['ok'] === true, `deep-show run answers the scenario: ${text.slice(0, 1500)}`).toBe(true);
    const replies = (out as JsonObject)['replies'];
    return { replies: Array.isArray(replies) ? replies.filter(isObject) : [], ms };
  }
  /** Stops the process this test started, by its PID. */
  close(): void {
    this.child.stdin.end();
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}
export const p95 = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;
export const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// The reference-Mac gate and the design's judge for timing results, as #412's budgets read them.
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
export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** Five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
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

// ---------------------------------------------------------------------------------------------------
// A hub and a `deep mcp`, each a child of this test process, in a temporary home (AC4's deep_kinds tool).

const owned = new Set<number>();
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Stops every process this file started, by PID (SIGTERM, then SIGKILL after 5 s), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}
export function useCleanup(): void { afterAll(cleanup, 60_000); }

/** A short folder under /tmp (a socket path must fit in 104 bytes on macOS) with a home in it. */
export function makeHome(): { tmp: string; home: string } {
  const tmp = tempDir('h', '/tmp');
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}
/** This environment with HOME moved to the test's home and none of the hub's or an agent's settings. */
function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|TMUX|CLAUDE|CODEX)/.test(key) || key === 'NODE_OPTIONS' || key === 'CARGO_TARGET_DIR') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C' };
}
const parse = (raw: string): JsonValue | undefined => { try { return JSON.parse(raw) as JsonValue; } catch { return undefined; } };

/** `deep hub run` in `home`, once it says it is ready. */
export async function startHub(home: string): Promise<void> {
  expect(existsSync(CLI), `the CLI is built at ${CLI} (npm run build --workspaces)`).toBe(true);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-4000); });
  const ready = await new Promise<boolean>((done) => {
    let first = '';
    const timer = setTimeout(() => done(false), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); const line = parse(first.split('\n')[0]!); done(isObject(line) && line['ready'] === true); }
    });
    child.on('exit', () => { clearTimeout(timer); done(false); });
  });
  expect(ready, `BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`).toBe(true);
}

/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; protocolError: boolean; value: JsonValue | undefined; reply: JsonObject }

/** A `deep mcp` started by hand from this test process, in `cwd`, under `home`. */
export class Mcp {
  private readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private err = '';
  private constructor(private readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (raw) => { this.lines.push(raw); for (const w of [...this.wakers]) w(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('close', () => { for (const w of [...this.wakers]) w(); });
  }
  static start(home: string, cwd: string): Mcp {
    const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    return new Mcp(child);
  }
  notify(method: string, params: JsonObject = {}): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  request(method: string, params: JsonObject = {}, timeoutMs = 300_000): Promise<JsonObject> {
    const id = `t1971#${++this.ids}`;
    return new Promise((done, fail) => {
      const finish = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); fail(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms: ${this.err}`)); }, timeoutMs);
      const check = () => {
        for (const raw of this.lines) {
          const json = parse(raw);
          if (isObject(json) && json['id'] === id) { finish(); done(json); return; }
        }
        if (this.child.exitCode !== null) { finish(); fail(Error(`deep mcp exited ${this.child.exitCode}: ${this.err}`)); }
      };
      this.wakers.add(check);
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      check();
    });
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1971', version: '0' } });
    expect(isObject(reply['result']), `BLOCKED: deep mcp refused initialize: ${show(reply)}`).toBe(true);
    this.notify('notifications/initialized');
  }
  async call(tool: string, args: JsonObject): Promise<Outcome> {
    const reply = await this.request('tools/call', { name: tool, arguments: args });
    if (reply['error'] !== undefined) return { isError: true, protocolError: true, value: reply['error'], reply };
    const result = isObject(reply['result']) ? reply['result'] : {};
    const content = Array.isArray(result['content']) ? result['content'].filter(isObject) : [];
    const text = content.find((c) => c['type'] === 'text')?.['text'];
    const value = result['structuredContent'] ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: result['isError'] === true, protocolError: false, value, reply };
  }
}
