// Test-side tools for the #96 redraft (AC6, AC9, AC14 and the proof): the `deep-show` binary (the hub's canvas
// side, which carries agents' patches from R2) driven by JSON lines; the shared board and its three writers; the
// hub's state folder (layer files by hash and its record of doc.patched events). Copied from the first draft's
// tests/acceptance/96/helpers.ts, trimmed to what these four criteria read; the record check reads each event by
// the schema version it names (doc.patched@1 or @2). Nothing here stands in for a patch, an undo or the commit point.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/96-redraft-1412 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const binPath = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const strs = (value: JsonValue | undefined, what: string): string[] => arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
/** Sorted copy, by code point. */
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file; one JSON line out per line in.

function buildBinary(): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${SHOW} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds deep-show once per file and fails every test of the file when it can't be built. */
export function useBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(); }, 3_600_000);
  beforeEach(() => { expect(error, `the binary builds: ${SHOW}`).toBe(''); });
}

export interface Run { replies: JsonObject[] }

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function show(scenario: JsonObject): Run {
  const run = spawnSync(binPath(SHOW), ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW} run: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${SHOW} run ended with status ${run.status}, signal ${run.signal}:\n${run.stderr}`);
  const out = run.stdout.split('\n').filter((line) => line !== '');
  expect(out.length, `${SHOW} run: one output line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies };
}

/** A `deep-show run` the fault fixture kills: how it ended and what it wrote. */
export function showKilled(scenario: JsonObject): { status: number | null; signal: string | null; stdout: string } {
  const run = spawnSync(binPath(SHOW), ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW} run: ${run.error.message}`);
  return { status: run.status, signal: run.signal, stdout: run.stdout };
}

// ---------------------------------------------------------------------------------------------------
// Folders: an evidence store root and the hub's state folder per test, deleted after it.

export function useFolders(): { evidence: () => string; state: () => string } {
  let ev = '';
  let st = '';
  beforeEach(() => { ev = mkdtempSync(join(tmpdir(), 'deep-96r-ev-')); st = mkdtempSync(join(tmpdir(), 'deep-96r-state-')); });
  afterEach(() => {
    for (const dir of [ev, st]) if (dir) rmSync(dir, { recursive: true, force: true });
    ev = ''; st = '';
  });
  return { evidence: () => ev, state: () => st };
}

/** Every layer file in the state folder, by hash: `layers/<2 hex>/<62 hex>`. */
export function layerFiles(state: string): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>();
  const root = join(state, 'layers');
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const file of readdirSync(join(root, dir))) {
      if (!/^[0-9a-f]{62}$/.test(file)) continue;
      out.set(dir + file, obj(JSON.parse(readFileSync(join(root, dir, file), 'utf8')) as JsonValue, `layer file ${dir}${file}`));
    }
  }
  return out;
}

export interface Logged { log_pos: number; session: string | null; event: JsonObject }
/** The hub's record in the state folder: `record.jsonl`, one appended event per line. */
export function record(state: string): Logged[] {
  const path = join(state, 'record.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((line, i) => {
    const o = obj(JSON.parse(line) as JsonValue, `record.jsonl line ${i + 1}`);
    return { log_pos: num(o['log_pos'], `record line ${i + 1}: log_pos`), session: o['session'] === null ? null : str(o['session'], `record line ${i + 1}: session`), event: obj(o['event'], `record line ${i + 1}: event`) };
  });
}

/** The published doc.patched versions (packages/contracts/schemas): an event is read by the version its `v` names. */
export const PATCHED_VERSIONS = [1, 2];

/** Each logged event is a doc.patched event, valid against the published schema of the version it names. */
export function expectValidPatched(logged: Logged[]): void {
  for (const l of logged) {
    expect(l.event['kind'], `record line ${l.log_pos} is a doc.patched event`).toBe('doc.patched');
    const v = l.event['v'];
    expect(PATCHED_VERSIONS.includes(v as number), `record line ${l.log_pos} names a published doc.patched version (${PATCHED_VERSIONS.join(', ')}), got ${JSON.stringify(v)}`).toBe(true);
    const checked = validate(`doc.patched@${String(v)}`, l.event);
    expect(checked.ok, `record line ${l.log_pos} is a valid doc.patched@${String(v)} event: ${checked.ok ? '' : JSON.stringify(checked.issues).slice(0, 800)}`).toBe(true);
  }
}
export const patchedData = (l: Logged): JsonObject => obj(l.event['data'], `event ${l.log_pos}: data`);

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: two agents' sessions, the process table, one panel, the documents.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: diagram', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: labels', process: { pid: 5200, start: 2_000 } };
export const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));

/** The OS process table the peer check reads: `deep` run in each agent's tree, and in yours. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 }, // your terminal
  { pid: 3001, ppid: 3000, start: 110 }, // your shell
  { pid: 3002, ppid: 3001, start: 3_000 }, // `deep show` you ran
  { pid: 4100, ppid: 3001, start: 1_000 }, // agent alpha
  { pid: 4101, ppid: 4100, start: 1_100 }, // alpha's tool shell
  { pid: 4102, ppid: 4101, start: 1_200 }, // `deep show` alpha ran
  { pid: 5200, ppid: 3001, start: 2_000 }, // agent bravo
  { pid: 5201, ppid: 5200, start: 2_100 },
  { pid: 5202, ppid: 5201, start: 2_200 }, // `deep show` bravo ran
];
const peerOf = (pid: number): JsonObject => ({ pid, start: PROCESSES.find((p) => p['pid'] === pid)!['start']! });
export const IN_ALPHA = peerOf(4102);
export const IN_BRAVO = peerOf(5202);
export const IN_YOURS = peerOf(3002);

export const PANELS: JsonObject = { main: { rect: [0, 0, 640, 360] } };

/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** The documents the hub has minted. */
export const DOC = { board: ulid('01JB96D', 1) } as const;
/** Patch IDs. */
export const P = (n: number): string => ulid('01JB96P', n);

/** Writers as a layer's `writer` holds them (`<kind>:<id>`), and as a revision row names them. */
export const W = { you: 'you:you', alpha: `agent:${ALPHA.thread}`, bravo: `agent:${BRAVO.thread}` } as const;
export const WRITER = { you: { kind: 'you', id: 'you' }, alpha: { kind: 'agent', id: ALPHA.thread }, bravo: { kind: 'agent', id: BRAVO.thread } } as const;

/** The scenario, with the shared board minted as revision 0 on the one panel. */
export function world(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: { [DOC.board]: { panel: 'main', document: fixture('board.json') } }, calls, ...extra };
}

// Who a call writes as: alpha's MCP session, or `deep show` from a process tree.
export type Who = JsonObject;
export const ASALPHA: Who = { call: 'deep_show', session: ALPHA.id };
export const CLI_YOU: Who = { call: 'deep show', peer: IN_YOURS };
export const CLI_ALPHA: Who = { call: 'deep show', peer: IN_ALPHA };
export const CLI_BRAVO: Who = { call: 'deep show', peer: IN_BRAVO };

export const patch = (id: string, base: number, ops: JsonObject[], reason = 'a test patch'): JsonObject => ({ patch: id, doc: DOC.board, base, reason, ops });
export const send = (who: Who, p: JsonObject): JsonObject => ({ ...who, doc: p['doc']!, patch: p });
export const undo = (who: Who, id: string, of: string): JsonObject => ({ ...who, doc: DOC.board, undo: { patch: id, of } });
export const read = (as?: Who): JsonObject => {
  const call: JsonObject = { call: 'read', doc: DOC.board };
  if (as?.['session'] !== undefined) call['session'] = as['session']!;
  if (as?.['peer'] !== undefined) call['peer'] = as['peer']!;
  return call;
};
export const revisionsOf = (): JsonObject => ({ call: 'revisions', doc: DOC.board });

// Ops (Patch).
export const create = (item: JsonObject): JsonObject => ({ op: 'create', item });
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path, value });
export const del = (id: string): JsonObject => ({ op: 'delete', id, cascade: false });

/** A node: a rect (the R1 slice's 2D marks). An item as a patch creates it: no `layer`. */
export const node = (id: string, name: string, pos: [number, number], order = 'a5'): JsonObject => ({
  id, kind: 'rect@1', name, order,
  params: { box: [0, 0, 120, 48], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] },
});
/** An arrow: a path parented to a node. */
export const arrow = (id: string, name: string, parent: string, order = 'a5'): JsonObject => ({
  id, kind: 'path@1', name, parent, order, params: { d: 'M120 24 L200 24', paint: { stroke: { role: 'ink', width: 2 } } },
});

// ---------------------------------------------------------------------------------------------------
// Replies

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; ids: string[] }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), ids: strs(o['ids'] ?? [], `${what}: issues[${i}].ids`) } as Issue;
  });
}
export const codes = (reply: JsonObject): string[] => issues(reply).map((i) => i.code);
/** `lost` on any reply: the patches of this writer acknowledged as applied that never became current. */
export const lostOf = (reply: JsonObject, what: string): string[] => (reply['lost'] === undefined ? [] : strs(reply['lost'], `${what}: lost`));

/** A `read` reply: the current revision as the hub shows it. */
export interface Shown { rev: number; hash: string; document: JsonObject; files: Record<string, string>; lost: string[] }
export function shown(reply: JsonObject, what = 'read'): Shown {
  const files = obj(reply['files'], `${what}: files`);
  return {
    rev: num(reply['rev'], `${what}: rev`),
    hash: str(reply['hash'], `${what}: hash`),
    document: obj(reply['document'], `${what}: document`),
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, str(v, `${what}: files.${k}`)])),
    lost: lostOf(reply, what),
  };
}

export const items = (doc: JsonObject): JsonObject => obj(doc['items'], 'the document\'s items');
export const item = (doc: JsonObject, id: string): JsonObject | undefined => {
  const v = items(doc)[id];
  return isObject(v) ? v : undefined;
};
/** The layer whose `writer` is this writer's text. */
export function layerOf(doc: JsonObject, writer: string): string {
  const found = Object.entries(obj(doc['layers'], 'the document\'s layers')).filter(([, l]) => isObject(l) && l['writer'] === writer).map(([id]) => id);
  expect(found.length, `exactly one layer has writer ${writer}: ${JSON.stringify(doc['layers'])}`).toBe(1);
  return found[0]!;
}
/** The writer text of an item's layer. */
export function writerOf(doc: JsonObject, id: string): string | undefined {
  const it = item(doc, id);
  const layer = it && typeof it['layer'] === 'string' ? obj(doc['layers'], 'layers')[it['layer']] : undefined;
  return isObject(layer) && typeof layer['writer'] === 'string' ? layer['writer'] : undefined;
}
export const posOf = (doc: JsonObject, id: string): JsonValue | undefined => {
  const at = item(doc, id)?.['at'];
  return isObject(at) ? at['pos'] : undefined;
};

export interface RevisionRow { rev: number; writer: JsonValue; hash: string; state: string; patches: string[] }
export function revisionRows(reply: JsonObject): RevisionRow[] {
  return arr(reply['revisions'], 'revisions').map((v, i) => {
    const o = obj(v, `revisions[${i}]`);
    return { rev: num(o['rev'], `revisions[${i}].rev`), writer: o['writer'] ?? null, hash: str(o['hash'], `revisions[${i}].hash`), state: str(o['state'], `revisions[${i}].state`), patches: strs(o['patches'] ?? [], `revisions[${i}].patches`) };
  });
}
