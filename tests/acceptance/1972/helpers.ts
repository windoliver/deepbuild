// Test-side tools for the #1972 acceptance tests: the full build of `deep-show` (built once per file), its `deep_kinds`
// calls and patches through `deep-show run` (one scenario per input line, one reply per call), the patch schema's ops
// as `deep_kinds op: field` answers them, the patches guide read in pages, the patches it holds, the two documents its
// examples apply to (the gallery's product reveal, and for break_out #306's chart board with its pack, as the criterion
// was amended on Nov 14), and the criteria's checks. Nothing here stands in for deep_kinds, the guide or the patch apply: every answer
// read here is the binary's own. Each `...Failures` function is a criterion's check: it returns sentences naming what
// failed, so a test runs it on the right program (no failures) and on the criterion's planted program (a failure
// naming what the criterion says). This suite starts no long-lived process; every temporary folder is removed.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1972 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The guide the issue names: `deep_kinds read guide: patches`. */
export const GUIDE = 'patches';
/** The ops the issue's parent names for the patch: `ops: [{op: set, id, path, value} | create | unset | delete | move | reorder]`. */
export const NAMED_OPS = ['set', 'create', 'unset', 'delete', 'move', 'reorder'] as const;
/** The envelope's fields, as the issue's parent names them: `{patch: ULID, doc, base: rev, reason, ops}`. */
export const ENVELOPE = ['patch', 'doc', 'base', 'reason', 'ops'] as const;
/** The other fields a patch takes at the base (its refusal of an unknown field lists them): fields, never ops. */
const OTHER_PATCH_FIELDS = ['coalesce_key', 'dry_run'];

/** The planted wrong programs (README: Plants), each `deep-show run --planted <name>`. */
export const PLANTS = {
  guideWithoutReorder: 'patches_guide_without_reorder',
  pathFixWithoutId: 'patch_fix_path_without_id',
  envelopeFixWithoutReason: 'patch_fix_envelope_without_reason',
} as const;

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

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** How many times `name` stands as a word of `text`: not inside a longer word (`doc` in `document`, `base` in `based`). */
export const timesNamed = (text: string, name: string): number =>
  (text.match(new RegExp(`(?<![A-Za-z0-9_'’])${escape(name)}(?![A-Za-z0-9_'’])`, 'g')) ?? []).length;

// ---------------------------------------------------------------------------------------------------
// The full build: `deep-show` with its default features (`full`). The binary is the one cargo reports it built, so a
// CARGO_TARGET_DIR in the environment is honoured.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** Builds the full `deep-show` once for the file; the getter fails a test, naming the build, when it didn't build. */
export function useFullBuild(): () => string {
  let error = 'not built';
  let bin = '';
  beforeAll(() => {
    const args = ['build', '--locked', '--bin', 'deep-show', '--message-format=json-render-diagnostics'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { error = `cargo could not run: ${r.error.message}`; return; }
    if (r.status !== 0) {
      error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-4000)}`;
      return;
    }
    for (const line of (r.stdout ?? '').split('\n')) {
      let m: JsonValue;
      try { m = JSON.parse(line) as JsonValue; } catch { continue; }
      if (isObject(m) && m['reason'] === 'compiler-artifact' && isObject(m['target']) && m['target']['name'] === 'deep-show' && typeof m['executable'] === 'string') bin = m['executable'];
    }
    error = bin ? '' : 'cargo built deep-show but named no executable for it';
  }, 7_200_000);
  return () => {
    expect(error, 'the full build of deep-show compiles').toBe('');
    return bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// Folders: each removed after the file.

const made: string[] = [];
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `deep-1972-${tag}-`)));
  made.push(d);
  return d;
}
export function useCleanup(): void {
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, 60_000);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <name>]`: one scenario per input line, one output line per scenario.

/** Each scenario's replies, one per call; a scenario the binary didn't take answers its output line as the one reply. */
export function runScenarios(bin: string, scenarios: JsonObject[], planted?: string): JsonObject[][] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${scenarios.map((s) => JSON.stringify(s)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  expect(r.error, `deep-show ${args.join(' ')} runs within its timeout: ${r.error?.message ?? ''}`).toBeUndefined();
  const stdout = r.stdout ?? '';
  expect(r.status, `deep-show ${args.join(' ')} starts and exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-show ${args.join(' ')}: one output line per scenario`).toBe(scenarios.length);
  return lines.map((line, i) => {
    let out: JsonValue;
    try { out = JSON.parse(line) as JsonValue; } catch { return [{ unreadable: line.slice(0, 1500) }]; }
    const replies = isObject(out) ? out['replies'] : undefined;
    const calls = scenarios[i]!['calls'];
    if (!isObject(out) || out['ok'] !== true || !Array.isArray(replies) || !Array.isArray(calls) || replies.length !== calls.length) return [{ scenario_not_taken: out }];
    return replies.map((x) => (isObject(x) ? x : { reply: x }));
  });
}

/** One deep_kinds call. */
export const kinds = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
/** `deep_kinds op: field` with `path`. */
export const fieldCall = (path: string): JsonObject => kinds('field', { path });

/** deep_kinds calls in one scenario: one reply per call. */
export function kindsReplies(bin: string, calls: JsonObject[], planted?: string): JsonObject[] {
  const [replies] = runScenarios(bin, [{ evidence: tempDir('ev'), calls }], planted);
  expect(replies!.length === calls.length, `deep-show run took the deep_kinds scenario: ${show(replies, 1500)}`).toBe(true);
  return replies!;
}

/** Whether an `op: field` answer holds lines, as #1971's are read: `lines`, else `text`; a refusal holds none. */
export function answersLines(reply: JsonObject | undefined): boolean {
  if (!reply || reply['error'] !== undefined) return false;
  if (Array.isArray(reply['lines'])) return reply['lines'].length > 0;
  return typeof reply['text'] === 'string' && reply['text'].trim() !== '';
}

// ---------------------------------------------------------------------------------------------------
// The patch schema's ops, as `deep_kinds op: field` answers them (README: Readings).

export interface SchemaOps { ops: string[]; answer: JsonObject; failures: string[] }

/**
 * The ops the patch schema lists: of the words the answer to `op: field, path: patch` holds, with the ops the issue's
 * parent names, every one but the patch's own fields whose `op: field, path: patch.<word>` answers lines. `failures`
 * says when `patch` itself is refused, or when an op the issue's parent names isn't one of them.
 */
export function schemaOps(bin: string, planted?: string): SchemaOps {
  const [answer] = kindsReplies(bin, [fieldCall('patch')], planted);
  const failures: string[] = [];
  if (!answersLines(answer)) failures.push(`deep_kinds op: field, path: patch answers no lines: ${show(answer, 800)}`);
  const words = new Set<string>(NAMED_OPS);
  for (const m of JSON.stringify(answer).matchAll(/(?<![A-Za-z0-9_])[a-z][a-z0-9_]*(?![A-Za-z0-9_])/g)) words.add(m[0]);
  for (const f of [...ENVELOPE, ...OTHER_PATCH_FIELDS]) words.delete(f);
  const candidates = [...words];
  const replies = kindsReplies(bin, candidates.map((w) => fieldCall(`patch.${w}`)), planted);
  const ops = candidates.filter((_, i) => answersLines(replies[i]));
  const missing = NAMED_OPS.filter((o) => !ops.includes(o));
  if (missing.length) {
    const said = missing.map((o) => `patch.${o}: ${show(replies[candidates.indexOf(o)] ?? null, 300)}`).join('; ');
    failures.push(`the patch schema, as deep_kinds op: field answers it, doesn't list ${missing.join(', ')}: ${said}`);
  }
  return { ops, answer: answer!, failures };
}

// ---------------------------------------------------------------------------------------------------
// The patches guide and the patches it holds.

/** `deep_kinds read guide: patches`, every page joined; `failure` when a page is refused or holds no text. */
export function guideText(bin: string, planted?: string): { text: string; failure?: string } {
  let text = '';
  let offset = 0;
  for (let page = 0; page < 64; page++) {
    const [reply] = kindsReplies(bin, [kinds('read', { guide: GUIDE, ...(offset ? { offset } : {}) })], planted);
    if (!reply || reply['error'] !== undefined || typeof reply['text'] !== 'string') {
      return { text, failure: `deep_kinds read guide: ${GUIDE} at offset ${offset} answers no text: ${show(reply ?? null, 800)}` };
    }
    text += reply['text'];
    if (reply['truncated'] !== true) return { text };
    const next = reply['next'];
    if (typeof next !== 'number' || next <= offset) return { text, failure: `the guide's page at ${offset} is cut but names no later offset: ${show(next ?? null)}` };
    offset = next;
  }
  return { text, failure: 'the guide runs past 64 pages' };
}

/** The end of the JSON object or array opening at `start` (its closing bracket's index + 1), strings skipped; -1 if none. */
function closing(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Every patch a JSON value holds: an object with an `ops` list, found anywhere in it, or in a string that is JSON text. */
function patchesInValue(v: JsonValue, out: JsonObject[]): void {
  if (Array.isArray(v)) { for (const x of v) patchesInValue(x, out); return; }
  if (isObject(v)) {
    if (Array.isArray(v['ops'])) { out.push(v); return; }
    for (const x of Object.values(v)) patchesInValue(x, out);
    return;
  }
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { patchesInValue(JSON.parse(v) as JsonValue, out); } catch { /* not JSON text */ }
  }
}

/**
 * The patches the guide holds (README: Readings): every JSON object or array written in its text that parses, and
 * every patch envelope (an object with an `ops` list) inside one, in the guide's order, each once.
 */
export function patchesIn(text: string): JsonObject[] {
  const found: JsonObject[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const end = closing(text, i);
    if (end < 0) continue;
    let v: JsonValue;
    try { v = JSON.parse(text.slice(i, end)) as JsonValue; } catch { continue; }
    patchesInValue(v, found);
    i = end - 1;
  }
  const seen = new Set<string>();
  return found.filter((p) => { const k = JSON.stringify(p); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The op names a patch holds. */
export const opsOf = (p: JsonObject): string[] =>
  (Array.isArray(p['ops']) ? p['ops'] : []).filter(isObject).map((o) => o['op']).filter((o): o is string => typeof o === 'string');

/** AC1's first check: every op the patch schema lists has an example in the guide. Each failure starts with the op. */
export function exampleFailures(ops: readonly string[], patches: readonly JsonObject[]): string[] {
  return ops.filter((op) => !patches.some((p) => opsOf(p).includes(op))).map((op) => `${op}: the ${GUIDE} guide holds no example of it (no patch in it holds an op ${op})`);
}

// ---------------------------------------------------------------------------------------------------
// The gallery's product reveal, and patches applied to it through `deep-show run`, as you.

/** The gallery's product reveal, read through deep_kinds: its hash and its stored document. */
export function productReveal(bin: string): { hash: string; document: JsonObject } {
  const [gallery] = kindsReplies(bin, [kinds('gallery')]);
  const rows = Array.isArray(gallery!['examples']) ? gallery!['examples'].filter(isObject) : [];
  const row = rows.find((r) => typeof r['title'] === 'string' && /product reveal/i.test(r['title']));
  expect(row && typeof row['hash'] === 'string', `the gallery lists the product reveal: ${show(gallery, 800)}`).toBe(true);
  const hash = row!['hash'] as string;
  const [read] = kindsReplies(bin, [kinds('read', { example: hash })]);
  expect(typeof read!['text'], `deep_kinds read example: ${hash} serves the product reveal: ${show(read, 800)}`).toBe('string');
  const document = JSON.parse(read!['text'] as string) as JsonValue;
  expect(isObject(document) && isObject(document['items']), `the product reveal is a document with items: ${show(document, 800)}`).toBe(true);
  return { hash, document: document as JsonObject };
}

/** What a guide example is applied to: a stored document, and the packs installed in its scenario. */
export interface Target { name: string; document: JsonObject; packs: JsonObject[] }

/** The gallery's product reveal as a target: no pack. */
export function revealTarget(bin: string): Target {
  const { hash, document } = productReveal(bin);
  return { name: `the gallery's product reveal (${hash})`, document, packs: [] };
}

/** The op whose example the amended criterion (Nov 14) holds to #306's chart board instead of the product reveal. */
export const BREAK_OUT = 'break_out';
const FIXTURES_306 = join(REPO, 'tests/acceptance/306/fixtures');
/**
 * #306's chart board (`tests/acceptance/306/fixtures/chart-board.json`: c1 and c2, `chart.bars@1` instances with n = 5,
 * and a rect, all in layer `you-main` written by `you:you`), with its test pack `test/chart@1.0.0` installed from
 * `tests/acceptance/306/fixtures/packs/test-chart-1.0.0`, as #306's suite installs it (the scenario's `packs`).
 */
export function chartBoardTarget(): Target {
  const document = JSON.parse(readFileSync(join(FIXTURES_306, 'chart-board.json'), 'utf8')) as JsonValue;
  expect(isObject(document) && isObject(document['items']), `#306's chart board is a document with items: ${show(document, 600)}`).toBe(true);
  return { name: '#306\'s chart board with test/chart@1.0.0 installed', document: document as JsonObject, packs: [{ id: 'test/chart', dir: join(FIXTURES_306, 'packs', 'test-chart-1.0.0') }] };
}

/** The process table the peer check reads: `deep show` from your shell, in no agent's process tree, so it writes as you. */
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3002, ppid: 1, start: 3_000 }];
const YOU: JsonObject = { pid: 3002, start: 3_000 };
const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };

/** A scenario where `document` is stored as shared document `doc` at revision 0, with `packs` installed and `calls`. */
export const scenarioOn = (doc: string, document: JsonObject, calls: JsonObject[], packs: JsonObject[] = []): JsonObject =>
  ({ evidence: tempDir('ev'), processes: PROCESSES, panels: PANELS, docs: { [doc]: { panel: 'main', document } }, ...(packs.length ? { packs } : {}), calls });
/** Your patch to `doc`, as `deep show` sends it. */
export const patchCall = (doc: string, patch: JsonValue): JsonObject => ({ call: 'deep show', peer: YOU, doc, patch });

/** One patch's reply, or why it couldn't be sent. */
export type Applied = { reply: JsonObject } | { unsent: string };

/**
 * Each patch `send` picks, applied on its own to a fresh copy of the target, stored under the doc ID the patch names,
 * at revision 0, with the target's packs installed; a patch not picked answers `unsent`.
 */
export function applyEach(bin: string, target: Target, patches: readonly JsonObject[], send: (p: JsonObject) => boolean = () => true): Applied[] {
  const docOf = (p: JsonObject): string | undefined => (typeof p['doc'] === 'string' && p['doc'] !== '' ? p['doc'] : undefined);
  const scenarios: JsonObject[] = [];
  for (const p of patches) {
    const doc = docOf(p);
    if (doc && send(p)) scenarios.push(scenarioOn(doc, target.document, [patchCall(doc, p)], target.packs));
  }
  const replies = scenarios.length ? runScenarios(bin, scenarios) : [];
  let k = 0;
  return patches.map((p) => {
    if (!send(p)) return { unsent: `not sent to ${target.name}` };
    return docOf(p) ? { reply: replies[k++]![0]! } : { unsent: `its doc ${show(p['doc'] ?? null)} names no document to store ${target.name} under` };
  });
}

/** An applied patch's outcome, or a refusal's codes, paths and reasons, in a line. */
export function outcomeOf(a: Applied): string {
  if ('unsent' in a) return a.unsent;
  const r = a.reply;
  const issues = Array.isArray(r['issues']) ? r['issues'].filter(isObject) : [];
  const said = issues.map((x) => `${String(x['code'])} at ${String(x['path'])}: ${String(x['what'] ?? '')}`).join('; ');
  return `${show(r['outcome'] ?? r['scenario_not_taken'] ?? r['unreadable'] ?? null, 300)}${said ? ` (${said})` : ''}`;
}
export const applied = (a: Applied): boolean => 'reply' in a && a.reply['outcome'] === 'applied';

/** The outcomes of the guide's patches on one target, aligned with the patches. */
export interface Outcomes { target: Target; outcomes: readonly Applied[] }

/**
 * AC1's second check, as amended (Nov 14): for every op the patch schema lists, an example of it in the guide applies
 * with outcome `applied`: break_out's on #306's chart board (`board`), every other op's on the product reveal
 * (`reveal`). Each failure starts with the op and names the target and its examples' outcomes there.
 */
export function appliedFailures(ops: readonly string[], patches: readonly JsonObject[], reveal: Outcomes, board: Outcomes): string[] {
  const failures: string[] = [];
  for (const op of ops) {
    const on = op === BREAK_OUT ? board : reveal;
    const mine = patches.map((p, i) => ({ p, a: on.outcomes[i]! })).filter(({ p }) => opsOf(p).includes(op));
    if (!mine.length) failures.push(`${op}: the guide holds no example of it to apply`);
    else if (!mine.some(({ a }) => applied(a))) failures.push(`${op}: none of its ${mine.length} example(s) applies to ${on.target.name}: ${mine.map(({ p, a }) => `${show(p, 400)} → ${outcomeOf(a)}`).join(' | ')}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The refusal fixtures (AC2): the product reveal's `name`, moved, by a patch whose path is `at/pos`, by a bare op list,
// and by the same op with its full path (the control, which applies).

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** The doc ID the product reveal is stored under for the refusal fixtures. */
export const DOC = ulid('01JD1972D', 1);
/** The item the fixtures move: the product reveal's text item `name`, which has `at.pos`. */
export const ITEM = 'name';
const MOVE_TO = [400, 140, 0];
/** The op the fixtures send, with `path`. */
export const moveOp = (path: string): JsonObject => ({ op: 'set', id: ITEM, path, value: MOVE_TO });
/** A patch in its envelope, on base 0, holding the one op. */
export const envelope = (path: string): JsonObject => ({ patch: ulid('01JD1972P', 1), doc: DOC, base: 0, reason: 'move the name beside the product', ops: [moveOp(path)] });
/** The full path the fix must name. */
export const FULL_PATH = `items/${ITEM}/at/pos`;

/** Each patch sent on its own to a fresh product reveal stored as DOC: its reply. */
export function sendEach(bin: string, document: JsonObject, patches: JsonValue[], planted?: string): JsonObject[] {
  return runScenarios(bin, patches.map((p) => scenarioOn(DOC, document, [patchCall(DOC, p)])), planted).map((r) => r[0]!);
}

/** The fixes a refusal carries: each issue's `fix` with its `fix_ops` as JSON text, and the reply's own `fix`. */
export function fixesOf(reply: JsonObject): string[] {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const fixes = issues.map((x) => [typeof x['fix'] === 'string' ? x['fix'] : '', x['fix_ops'] !== undefined ? JSON.stringify(x['fix_ops']) : ''].filter(Boolean).join(' '));
  if (typeof reply['fix'] === 'string') fixes.push(reply['fix']);
  return fixes.filter((f) => f !== '');
}

/** Whether `fix` names the full path: `items/name/at/pos`, or `items/<id>/at/pos` as the issue writes it. */
export const namesFullPath = (fix: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])items/(?:${escape(ITEM)}|<id>)/at/pos(?![A-Za-z0-9_/])`).test(fix);

/** AC2's first check: the patch whose path is `at/pos` is refused, with a fix that names items/name/at/pos. */
export function fullPathFailures(reply: JsonObject): string[] {
  if (reply['outcome'] !== 'refused') return [`the patch whose path is at/pos is not refused: ${outcomeOf({ reply })}`];
  const fixes = fixesOf(reply);
  if (fixes.some(namesFullPath)) return [];
  return [`the patch whose path is at/pos is refused, but no fix names ${FULL_PATH}: the fixes were ${show(fixes, 1200)} (${outcomeOf({ reply })})`];
}

/** AC2's second check: the bare op list is refused, with a fix that names every field of the envelope. */
export function envelopeFailures(reply: JsonObject): string[] {
  if (reply['outcome'] !== 'refused') return [`the bare op list is not refused: ${outcomeOf({ reply })}`];
  const fixes = fixesOf(reply);
  if (!fixes.length) return [`the bare op list is refused with no fix: ${outcomeOf({ reply })}`];
  const missing = fixes.map((f) => ENVELOPE.filter((field) => timesNamed(f, field) === 0));
  if (missing.some((m) => m.length === 0)) return [];
  return fixes.map((f, i) => `the bare op list is refused, but its fix leaves out ${missing[i]!.join(', ')}: ${show(f, 600)}`);
}
