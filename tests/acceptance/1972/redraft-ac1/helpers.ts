// Test-side tools for the blind redraft of #1972 AC1's applies clause: the `deep-show` build, one scenario through
// `deep-show run`, the deep_kinds calls the test makes (the gallery, an example, a guide's pages, `op: field` on the
// patch schema), the examples a markdown guide holds, and the patch each one sends. Nothing here stands in for
// deep_kinds, the guide, the gallery or a patch: every answer read is the binary's own. A run that hangs is stopped by
// spawnSync's own timeout, which signals only its child; nothing is stopped by name or port.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1972/redraft-ac1 is four levels down). */
const REPO = join(HERE, '..', '..', '..', '..');

/** The ops the design's Patch primitive lists, a closed list (docs/canvas-primitives.md, Patch: Ops). */
const DESIGN_OPS: readonly string[] = ['create', 'set', 'unset', 'delete', 'move', 'reorder', 'rows', 'break_out'];
/** The ops of the patch's shape as #1658's amendment of Nov 8 gives it; every patch schema lists at least these. */
const SHAPE_OPS: readonly string[] = ['set', 'create', 'unset', 'delete', 'move', 'reorder'];

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The build and its runs

/** Builds `deep-show` once for the file (default features); the getter fails the test, naming the build, when it didn't build. */
export function useBuild(): () => string {
  let error = 'not built';
  beforeAll(() => {
    const r = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else error = r.status === 0 ? '' : `cargo build --locked --bin deep-show failed:\n${(r.stderr ?? '').slice(-4000)}`;
  }, 7_200_000);
  return () => {
    expect(error, 'cargo build --locked --bin deep-show compiles').toBe('');
    return join(resolve(REPO, process.env['CARGO_TARGET_DIR'] ?? 'target'), 'debug', 'deep-show');
  };
}

const made: string[] = [];
/** Deletes every temporary folder the file made, after it. */
export function useCleanup(): void {
  afterAll(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
}
function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `deep-1972-ac1-${tag}-`)));
  made.push(d);
  return d;
}

/** `deep-show run` with one scenario: accepted, one reply per call. */
function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  expect(r.error?.message, 'deep-show run starts and ends within its timeout').toBeUndefined();
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-show run: one output line for the scenario: ${(r.stdout ?? '').slice(0, 1500)}`).toBe(1);
  let out: JsonValue;
  try { out = JSON.parse(lines[0]!) as JsonValue; } catch { out = lines[0]!; }
  expect(isObject(out) && out['ok'] === true, `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  const calls = scenario['calls'] as JsonValue[];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies)}`).toBe(true);
  return (replies as JsonValue[]).map((v) => (isObject(v) ? v : { reply: v }));
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds: calls of `deep-show run`, each scenario holding only them

const kinds = (op: string, fields: JsonObject = {}): JsonObject => ({ call: 'deep_kinds', op, ...fields });
const ask = (bin: string, calls: JsonObject[]): JsonObject[] => run(bin, { evidence: tempDir('ev'), calls });
/** Why a reply is a refusal (the shared error shape), or undefined. */
function refusal(reply: JsonObject): string | undefined {
  const e = reply['error'];
  return isObject(e) ? `refused ${String(e['code'])} at ${String(e['path'])}: ${String(e['remediation'] ?? '')}` : undefined;
}

/**
 * The ops the patch schema lists, read through `deep_kinds op: field` (Scope: it takes `patch.<op>` and answers from
 * the patch schema): each op of the design's closed list whose `patch.<op>` answers at least one line and no refusal,
 * with the six ops of the patch's shape, which every patch schema lists. In the design list's order.
 */
export function schemaOps(bin: string): string[] {
  const replies = ask(bin, DESIGN_OPS.map((op) => kinds('field', { path: `patch.${op}` })));
  const answers = (r: JsonObject): boolean => refusal(r) === undefined
    && ((Array.isArray(r['lines']) && r['lines'].length > 0) || (typeof r['text'] === 'string' && r['text'].trim() !== ''));
  return DESIGN_OPS.filter((op, i) => SHAPE_OPS.includes(op) || answers(replies[i]!));
}

/** A guide's whole text, `deep_kinds read guide: <name>` page by page from offset 0 to its last page. */
export function guideText(bin: string, name: string): string {
  let text = '';
  let offset = 0;
  for (let page = 0; page < 256; page += 1) {
    const [reply] = ask(bin, [kinds('read', { guide: name, offset })]);
    const why = refusal(reply!);
    expect(why, `deep_kinds read guide: ${name} at offset ${offset} is served`).toBeUndefined();
    expect(typeof reply!['text'], `deep_kinds read guide: ${name} at offset ${offset} answers its text: ${show(reply)}`).toBe('string');
    text += reply!['text'] as string;
    if (reply!['truncated'] !== true) return text;
    const next = reply!['next'];
    expect(typeof next === 'number' && next > offset, `a cut page of ${name} names the next offset: ${show(reply)}`).toBe(true);
    offset = next as number;
  }
  throw Error(`deep_kinds read guide: ${name} is still cut after 256 pages`);
}

/** The gallery's product reveal (the example whose title holds "product reveal"), parsed from the bytes `read example` serves. */
export function productReveal(bin: string): JsonObject {
  const rows: JsonObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 64; page += 1) {
    const [reply] = ask(bin, [kinds('gallery', cursor === undefined ? {} : { cursor })]);
    expect(refusal(reply!), 'deep_kinds gallery is served').toBeUndefined();
    const examples = reply!['examples'];
    expect(Array.isArray(examples), `deep_kinds gallery lists its examples: ${show(reply)}`).toBe(true);
    rows.push(...(examples as JsonValue[]).filter(isObject));
    if (reply!['next'] === undefined || reply!['next'] === null) break;
    cursor = String(reply!['next']);
  }
  const found = rows.filter((r) => typeof r['title'] === 'string' && /product reveal/i.test(r['title']));
  expect(found.length, `the gallery lists one product reveal; its titles: ${show(rows.map((r) => r['title']))}`).toBe(1);
  const hash = found[0]!['hash'];
  expect(typeof hash, `the product reveal's gallery row names its hash: ${show(found[0])}`).toBe('string');
  const [served] = ask(bin, [kinds('read', { example: hash as string })]);
  expect(refusal(served!), `deep_kinds read example: ${String(hash)} (the product reveal) is served`).toBeUndefined();
  expect(typeof served!['text'], `the product reveal's text is served: ${show(served)}`).toBe('string');
  const doc = JSON.parse(served!['text'] as string) as JsonValue;
  expect(isObject(doc) && isObject(doc['items']), `the product reveal is a document with items: ${show(doc, 600)}`).toBe(true);
  return doc as JsonObject;
}

// ---------------------------------------------------------------------------------------------------
// The examples a guide holds

/** One example: a patch, or a single op, from a JSON code block of the guide. */
interface Example { n: number; block: number; given: 'patch' | 'op'; ops: string[]; value: JsonObject }

/** The fenced code blocks of a markdown text (``` or ~~~), in order, each its lines between the fences. */
function codeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let open: { char: string; length: number; lines: string[] } | undefined;
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!open) {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) open = { char: m[1]![0]!, length: m[1]!.length, lines: [] };
      continue;
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1]![0] === open.char && close[1]!.length >= open.length) {
      blocks.push(open.lines.join('\n'));
      open = undefined;
    } else open.lines.push(line);
  }
  return blocks;
}

const parse = (text: string): JsonValue | undefined => {
  if (text.trim() === '') return undefined;
  try { return JSON.parse(text) as JsonValue; } catch { return undefined; }
};
/** The JSON a block holds: the block as one value, or with its comment lines (`//`, `#`) left out, or else each line that is one. */
function jsonIn(block: string): JsonValue[] {
  const whole = parse(block) ?? parse(block.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n'));
  if (whole !== undefined) return [whole];
  return block.split('\n').map(parse).filter((v): v is JsonValue => v !== undefined);
}
/** A patch: an object with an `ops` list, or a call carrying one as its `patch`. */
function patchIn(o: JsonObject): JsonObject | undefined {
  if (Array.isArray(o['ops'])) return o;
  const p = o['patch'];
  return isObject(p) && Array.isArray(p['ops']) ? p : undefined;
}
/** The examples in one JSON value: a patch, a list of patches, or one op named by the design. A bare list of ops is no example: it isn't a patch. */
function examplesOf(v: JsonValue): Array<{ given: 'patch' | 'op'; value: JsonObject }> {
  const asPatch = (o: JsonValue): Array<{ given: 'patch'; value: JsonObject }> => {
    const p = isObject(o) ? patchIn(o) : undefined;
    return p ? [{ given: 'patch', value: p }] : [];
  };
  if (Array.isArray(v)) return v.flatMap(asPatch);
  if (!isObject(v)) return [];
  const p = asPatch(v);
  if (p.length > 0) return p;
  return typeof v['op'] === 'string' && DESIGN_OPS.includes(v['op']) ? [{ given: 'op', value: v }] : [];
}
const opsOf = (given: 'patch' | 'op', value: JsonObject): string[] => (given === 'op'
  ? [String(value['op'])]
  : (value['ops'] as JsonValue[]).map((o) => (isObject(o) && typeof o['op'] === 'string' ? o['op'] : show(o, 80))));

/** Every example the guide's JSON code blocks hold, numbered from 1 in the order they appear. */
export function examplesIn(guide: string): Example[] {
  const out: Example[] = [];
  codeBlocks(guide).forEach((block, b) => {
    for (const v of jsonIn(block)) {
      for (const e of examplesOf(v)) out.push({ n: out.length + 1, block: b + 1, given: e.given, ops: opsOf(e.given, e.value), value: e.value });
    }
  });
  return out;
}

/** Each op of the list no example holds, named. */
export function coverageFailures(ops: readonly string[], examples: readonly Example[]): string[] {
  return ops.filter((op) => !examples.some((e) => e.ops.includes(op)))
    .map((op) => `${op}: the guide holds no example of it (no patch or op in a JSON code block holds the op)`);
}

// ---------------------------------------------------------------------------------------------------
// The product reveal as the agent's own document, and the patches the examples send

/** The agent that sends the examples through `deep_show`, and its writer as a layer names it (`<kind>:<id>`). */
const AGENT = { session: 'sess-guide', thread: 'thread-guide', name: 'Test agent: patches guide', pid: 4100, start: 1_000 } as const;
const LAYER = 'guide-main';

/** The product reveal as the agent's own document: one layer, the agent's, holding every item; no `id` (the hub fills it in). */
function asAgentsOwn(reveal: JsonObject): JsonObject {
  const doc = JSON.parse(JSON.stringify(reveal)) as JsonObject;
  delete doc['id'];
  doc['layers'] = { [LAYER]: { writer: `agent:${AGENT.thread}`, title: AGENT.name, order: 'a0' } };
  for (const item of Object.values(doc['items'] as JsonObject)) if (isObject(item)) item['layer'] = LAYER;
  return doc;
}

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Example n's document: its own copy of the product reveal. */
const docId = (n: number): string => ulid('01JB1972D', n);

/**
 * The patch example `e` sends to `doc`, at base 0, the stored product reveal: a patch as the guide gives it, with its
 * own `patch`, `doc` and `base` bound to this store (and a reason if it gives none); an op inside a patch of its own.
 */
function patchOf(e: Example, doc: string): JsonObject {
  const id = ulid('01JB1972P', e.n);
  const reason = `the patches guide's example ${e.n} (${e.ops.join(', ')})`;
  if (e.given === 'op') return { patch: id, doc, base: 0, reason, ops: [e.value] };
  return { ...e.value, patch: id, doc, base: 0, reason: typeof e.value['reason'] === 'string' ? e.value['reason'] : reason };
}

/** One `deep-show run`: each example's patch from the agent's session on its own copy of the product reveal; one reply each. */
export function sendAll(bin: string, reveal: JsonObject, examples: readonly Example[]): JsonObject[] {
  if (examples.length === 0) return [];
  const seed = asAgentsOwn(reveal);
  const docs: JsonObject = {};
  const calls: JsonObject[] = [];
  for (const e of examples) {
    const doc = docId(e.n);
    docs[doc] = { panel: 'main', document: seed };
    calls.push({ call: 'deep_show', session: AGENT.session, doc, patch: patchOf(e, doc) });
  }
  return run(bin, {
    evidence: tempDir('ev'),
    sessions: { [AGENT.session]: { thread: AGENT.thread, name: AGENT.name, process: { pid: AGENT.pid, start: AGENT.start } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: AGENT.pid, ppid: 1, start: AGENT.start }],
    panels: { main: { rect: [0, 0, 640, 360] } },
    docs,
    calls,
  });
}

/** Each example whose reply's outcome isn't `applied`, named with its ops, the reply's issues and the patch sent. */
export function applyFailures(examples: readonly Example[], replies: readonly JsonObject[]): string[] {
  return examples.flatMap((e, i) => {
    const r = replies[i] ?? {};
    if (r['outcome'] === 'applied') return [];
    const what = `example ${e.n} (code block ${e.block}, ${e.given === 'op' ? 'the op' : 'a patch of'} ${e.ops.join(', ')})`;
    return [`${what}: outcome ${show(r['outcome'] ?? null)}, not applied; issues: ${show(r['issues'] ?? r, 900)}; sent: ${show(patchOf(e, docId(e.n)), 700)}`];
  });
}
