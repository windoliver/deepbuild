// Test-side tools for the #1973 acceptance tests: the full build of `deep-show` (built once per file), its `deep_kinds`
// calls and the agent's `deep_show` (`deep-show run`, one scenario per batch of calls, as the hub's canvas core plays
// them), the canonical dump `deep kinds --dump` writes (`deep-show kinds --dump`), the forms an `op: field` line gives,
// a printed form fed back as a value with every number set to 1, the one-slab scene, and the criteria's checks.
// Nothing here stands in for deep_kinds, the dump or the document check: every answer read here is the binary's own.
// Each `...Failures` function is a criterion's check: it returns sentences naming what failed, so a test runs it on
// the right program (no failures) and on the criterion's planted program (a failure naming what the criterion says).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1973 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The issue's field, its kind, and the item the scene holds it in (AC1, AC2). */
export const SLAB = 'slab@1';
export const SIZE = 'size';
export const SIZE_PATH = `${SLAB}.${SIZE}`;
export const ITEM = 'box';
/** The issue's refused value and the path its one issue is at (AC2). */
export const REFUSED_SIZE: JsonValue = [20, 20];
export const ISSUE_PATH = `items/${ITEM}/params/${SIZE}`;
/** The ten kinds the parent issue's dry run found listed with no example (AC3). */
export const TEN = ['image@1', 'marks@1', 'axis@1', 'scale@1', 'mask@1', 'group@1', 'star@1', 'frame@1', 'matte@1', 'overlay.frame@1'];
/** AC1's planted twin: the line op: field prints for slab@1.size gives type json and no form (README: Plants). */
export const PLANT_JSON_ALONE = 'field_size_json_alone';

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

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

/** Folders under /tmp/dh1973-*, each removed after the file. */
const made: string[] = [];
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join('/tmp', `dh1973-${tag}-`)));
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

/** One deep_kinds call. */
export const kinds = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
/** `op: field` with `path: <kind>@<major>.<field>`. */
export const fieldCall = (path: string): JsonObject => kinds('field', { path });

/** `deep-show run [--planted <name>]` with one scenario (`calls` and `world`, the scenario's other fields): one reply per call. */
export function run(bin: string, calls: JsonObject[], planted?: string, world: JsonObject = {}): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tempDir('ev'), ...world, calls }]);
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
// The dump (`deep kinds --dump`, which runs `deep-show kinds --dump <dir>`): every entry's fields, in order.

export interface DumpField { kind: string; field: string; path: string; type: JsonValue | undefined }

/** `deep-show kinds --dump <dir>` of the build: every field of every entry, read back from the file it writes. */
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
        out.push({ kind, field: String(f['name']), path: `${kind}.${String(f['name'])}`, type: f['type'] });
      }
    }
  }
  return out;
}
/** The dump's fields typed `json` (AC1). */
export const jsonFields = (fields: readonly DumpField[]): DumpField[] => fields.filter((f) => f.type === 'json');

// ---------------------------------------------------------------------------------------------------
// The forms an `op: field` line gives (README: Readings). The answer's line is the one element of `lines` (an object,
// or a string holding one JSON object's text), as #1971 answers; its forms are the strings under `forms`, `form` or
// `shape` (a string, or a list whose elements are strings or objects holding a string `form`), each non-empty and not
// the bare type name `json`.

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
  return `its line is not one JSON object, so its forms can't be read: ${show(l, 300)}`;
}
/** The forms a line gives. */
export function formsOf(line: JsonObject): string[] {
  const out: string[] = [];
  const take = (v: JsonValue | undefined): void => {
    if (typeof v === 'string') out.push(v);
    else if (isObject(v) && typeof v['form'] === 'string') out.push(v['form']);
  };
  for (const key of ['forms', 'form', 'shape']) {
    const v = line[key];
    if (Array.isArray(v)) v.forEach(take);
    else take(v);
  }
  return out.filter((f) => f.trim() !== '' && f.trim().toLowerCase() !== 'json');
}

/**
 * AC1's first check: for every dumped field typed json, `op: field` with its path answers one line giving at least
 * one form. Each failure starts with the field's path, so it names the field.
 */
export function formFailures(fields: readonly DumpField[], replies: readonly JsonObject[]): string[] {
  const failures: string[] = [];
  fields.forEach((f, i) => {
    const line = lineOf(replies[i] ?? {});
    if (typeof line === 'string') { failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): ${line}`); return; }
    if (formsOf(line).length === 0) failures.push(`${f.path} (kind ${f.kind}, field ${f.field}): its line gives no accepted form, only type ${show(line['type'] ?? null)}: ${show(line, 400)}`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// A printed form fed back as the field's value with every number set to 1 (README: Readings). The form's value is
// its first list `[…]` or object `{…}`, read with every placeholder set to 1: each element of a list, and each
// member's value in an object (a member is `name` or `name: …`), is a number unless it is itself a list or object,
// which is read the same way. A form with no list or object is one number: 1.

/** Splits `inner` at its top-level commas. */
function topLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if ('[{('.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(from, i)); from = i + 1; }
  }
  parts.push(inner.slice(from));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}
/** The balanced list or object at `text[open]`, or undefined when it never closes. */
function balanced(text: string, open: number): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ('[{('.includes(text[i]!)) depth++;
    else if (')}]'.includes(text[i]!)) { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return undefined;
}
function shapeValue(text: string): JsonValue | undefined {
  const t = text.trim();
  const nested = (s: string): JsonValue | undefined => {
    const at = s.search(/[[{]/);
    if (at !== 0) return 1;
    const b = balanced(s, 0);
    return b === undefined ? undefined : shapeValue(b);
  };
  if (t.startsWith('[')) {
    const out: JsonValue[] = [];
    for (const p of topLevel(t.slice(1, -1))) { const v = nested(p); if (v === undefined) return undefined; out.push(v); }
    return out;
  }
  if (t.startsWith('{')) {
    const out: JsonObject = {};
    for (const p of topLevel(t.slice(1, -1))) {
      const colon = p.indexOf(':');
      const key = (colon < 0 ? p : p.slice(0, colon)).trim().replace(/^["']|["']$/g, '');
      const v = colon < 0 ? 1 : nested(p.slice(colon + 1).trim());
      if (v === undefined || key === '') return undefined;
      out[key] = v;
    }
    return out;
  }
  return 1;
}
/** The value a printed form stands for with every number set to 1, or why it can't be read. */
export function fedBack(form: string): JsonValue | string {
  const open = form.search(/[[{]/);
  if (open < 0) return 1;
  const b = balanced(form, open);
  const v = b === undefined ? undefined : shapeValue(b);
  return v === undefined ? `the form ${show(form)} doesn't close its list or object` : v;
}

// ---------------------------------------------------------------------------------------------------
// The document check: the agent's `deep_show` of a whole revision with its issues (#393), on `deep-show run`, as the
// hub's deep_show tool has `deep-show canvas` play it. The scene is one slab under a camera and a sun, so both
// scene3d.build and scene3d.lights (which runs on a document with a light) read the slab's size.

const SESSION = { id: 'sess-1973', thread: 'thread-1973', name: 'An agent building a one-slab scene', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted: a ULID. */
export const docId = (n: number): string => `01JD1973D${String(n).padStart(17, '0')}`;

/** The scenario's world for `docs`: the agent's session, its process tree, one panel per document. */
export function showWorld(docs: readonly string[]): JsonObject {
  const panels: JsonObject = {};
  const out: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; out[d] = { panel: `p${i + 1}` }; });
  return { sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } }, processes: PROCESSES, panels, docs: out };
}
/** The agent's deep_show of `document` as revision of `doc`, with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION.id, doc, document, include: ['issues'] });

/** A one-slab scene: a camera, a sun, and the slab `box` with its size set to `size`. */
export function slabScene(size: JsonValue): JsonObject {
  const item = (id: string, order: string, kind: string, params: JsonObject): JsonObject => ({ id, name: id, order, kind, params });
  return {
    format: 1, profile: 'scene', title: 'One slab', description: 'One slab under a camera and a sun, for the #1973 acceptance suite.', size: [480, 360],
    camera: 'cam', requires: { modules: { scene3d: '^1' } },
    items: {
      cam: item('cam', 'a0', 'camera@1', { projection: 'perspective', position: [6, 5, 8], target: [0, 0.5, 0], fov: 40 }),
      sun: item('sun', 'a1', 'light.sun@1', {}),
      [ITEM]: item(ITEM, 'a2', SLAB, { [SIZE]: size }),
    },
  };
}

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function issuesOf(reply: JsonObject): Issue[] {
  const list = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return list.map((o) => ({ code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o }));
}
const errorsOf = (reply: JsonObject): Issue[] => issuesOf(reply).filter((i) => i.severity === 'error');

/** "Passes the document check": the revision is presented with no error issue. Each failure names `what`. */
export function checkFailures(reply: JsonObject, what: string): string[] {
  const errs = errorsOf(reply);
  const failures = errs.map((e) => `${what}: the document check gives the error ${e.code} at ${e.path}: ${show(e.raw, 800)}`);
  if (reply['outcome'] !== 'presented') failures.push(`${what}: the revision is ${show(reply['outcome'] ?? null)}, not presented: ${show(reply, 1200)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC2: one issue at items/<id>/params/size whose fix names the 3-number form (README: Readings).

/** The issue's fields the base's issues carry that are not its fix: what it is, where, and what it refused. */
const NOT_FIX = new Set(['check', 'code', 'severity', 'ids', 'path', 'actual', 'what', 'carried', 'close', 'step']);
/** An issue's fix: its `fix` text, its `fix_ops`, `forms` and any other field it carries beyond NOT_FIX, as text. */
export function fixText(raw: JsonObject): string {
  return Object.entries(raw).filter(([k]) => !NOT_FIX.has(k)).map(([, v]) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' | ');
}
/** Whether `text` names a form of three numbers: "3 numbers" or "three numbers", or a list `[…]` of three elements. */
export function namesThreeNumbers(text: string): boolean {
  if (/(?<![\w.])(3|three)\s+numbers?\b/i.test(text)) return true;
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    const b = balanced(text, i);
    if (b !== undefined && topLevel(b.slice(1, -1)).length === 3) return true;
  }
  return false;
}
/**
 * AC2's check on the revision of the slab with size [20, 20]: refused, with exactly one issue at items/<id>/params/size,
 * an error, whose fix names the 3-number form, and no other error. Each failure names the path.
 */
export function refusalFailures(reply: JsonObject): string[] {
  const failures: string[] = [];
  const all = issuesOf(reply);
  if (reply['outcome'] !== 'refused') failures.push(`${ISSUE_PATH}: the revision with size [20, 20] is ${show(reply['outcome'] ?? null)}, not refused`);
  const at = all.filter((i) => i.path === ISSUE_PATH);
  const elsewhere = all.filter((i) => i.path !== ISSUE_PATH && i.severity === 'error');
  if (at.length !== 1) failures.push(`${ISSUE_PATH}: the check gives ${at.length} issues at the path, not one: ${show(at.map((i) => i.raw), 2500)}`);
  if (elsewhere.length) failures.push(`${ISSUE_PATH}: the check also gives errors elsewhere: ${show(elsewhere.map((i) => i.raw), 1500)}`);
  for (const i of at) {
    if (i.severity !== 'error') failures.push(`${ISSUE_PATH}: its issue ${i.code} is a ${i.severity}, not an error`);
    const fix = fixText(i.raw);
    if (!namesThreeNumbers(fix)) failures.push(`${ISSUE_PATH}: the fix of ${i.code} (from ${show(i.raw['check'] ?? null)}, "${String(i.raw['what'] ?? '')}") names no 3-number form: ${show(fix, 600)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC3: the kinds `deep_kinds list` shows as available, and their examples as `read` serves them.

export interface Listed { name: string; available: boolean; example: JsonValue | undefined }
/** Every entry of kind@1 that `op: list` pages through, from the first page to the last. */
export function listedKinds(bin: string): Listed[] {
  const out: Listed[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const [reply] = run(bin, [kinds('list', { registry: 'kind@1', ...(cursor ? { cursor } : {}) })]);
    expect(isObject(reply!['error']), `deep_kinds list answers its page: ${show(reply, 800)}`).toBe(false);
    const rows = Array.isArray(reply!['registries']) ? reply!['registries'].filter(isObject) : [];
    for (const r of rows.filter((x) => x['name'] === 'kind@1')) {
      for (const e of (Array.isArray(r['entries']) ? r['entries'] : []).filter(isObject)) {
        out.push({ name: String(e['name']), available: e['available'] === true, example: e['example'] });
      }
    }
    if (typeof reply!['next'] !== 'string') return out;
    cursor = reply!['next'];
  }
  expect.fail('deep_kinds list pages past 100 pages');
  return out;
}
/** `op: read` of an example by its hash. */
export const readCall = (hash: string): JsonObject => kinds('read', { example: hash });

/**
 * AC3's check: each available kind lists an example hash, and `read` with it serves the example: a text whose SHA-256
 * is the hash and which names the kind. Each failure starts with the kind's name.
 */
export function exampleFailures(listed: readonly Listed[], replies: ReadonlyMap<string, JsonObject>): string[] {
  const failures: string[] = [];
  for (const k of listed.filter((x) => x.available)) {
    if (typeof k.example !== 'string' || k.example === '') { failures.push(`${k.name}: listed as available with no example hash (example: ${show(k.example ?? null)})`); continue; }
    const reply = replies.get(k.example) ?? {};
    const e = reply['error'];
    if (isObject(e)) { failures.push(`${k.name}: read refuses its example ${k.example}: ${String(e['code'])}: ${String(e['remediation'] ?? '')}`); continue; }
    const text = reply['text'];
    if (typeof text !== 'string') { failures.push(`${k.name}: read serves no text for its example ${k.example}: ${show(reply, 400)}`); continue; }
    const sha = createHash('sha256').update(text, 'utf8').digest('hex');
    if (sha !== k.example) failures.push(`${k.name}: the text read serves for ${k.example} hashes to ${sha}`);
    if (!text.includes(JSON.stringify(k.name))) failures.push(`${k.name}: the example read serves for ${k.example} never names the kind`);
  }
  return failures;
}
