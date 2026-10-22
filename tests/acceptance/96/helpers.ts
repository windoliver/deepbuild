// Test-side tools for the #96 acceptance tests: the `deep-show` binary (the hub's canvas side, which
// carries agents' patches from R2) and the `deep-canvas` binary (the kernel: check, apply, canonical,
// merge), each driven by JSON lines; the shared board and its three writers; the hub's state folder (layer
// files by hash and its record of doc.patched events); and the reference-Mac gate for budgets. Nothing here
// stands in for a patch, a rebase, a merge, an undo, the scheduler or the commit point.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/96 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
export const CANVAS = 'deep-canvas';
const binPath = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);

/** Flicks per second (Time and the flick). */
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
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
// The binaries: built once per file; one JSON line out per line in.

function buildBinaries(): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW, '--bin', CANVAS], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${SHOW} --bin ${CANVAS} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds deep-show and deep-canvas once per file and fails every test of the file when they can't be built. */
export function useBinaries(): void {
  let error = '';
  beforeAll(() => { error = buildBinaries(); }, 900_000);
  beforeEach(() => { expect(error, `the binaries build: ${SHOW}, ${CANVAS}`).toBe(''); });
}

export interface Lines { lines: JsonValue[]; ms: number }

/** Pipes the lines into one run of `<name> <subcommand>`, timing the whole process. */
export function lines(name: string, subcommand: string, inputs: (JsonValue | string)[]): Lines {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const started = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(binPath(name), [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - started;
  const label = `${name} ${subcommand}`;
  // A binary that exits before reading all its input (an unknown subcommand) also breaks the pipe: its
  // exit status says why, so it goes first.
  if (run.status !== 0 && run.status !== null) throw Error(`${label} exited ${run.status}:\n${run.stderr}`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${label} ended by ${run.signal}:\n${run.stderr}`);
  const out = run.stdout.split('\n').filter((line) => line !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return { lines: out.map((line) => JSON.parse(line) as JsonValue), ms };
}

/** The JSON-lines convention: a line that isn't JSON, and one missing its required fields, each answer bad_input. */
export function expectBadInput(name: string, subcommand: string, missing: JsonObject): void {
  for (const [i, line] of lines(name, subcommand, ['{not json', missing]).lines.entries()) {
    expect(line, `${name} ${subcommand}: line ${i + 1} answers bad_input`).toEqual({ ok: false, code: 'bad_input' });
  }
}

export interface Run { replies: JsonObject[]; ms: number }

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function show(scenario: JsonObject): Run {
  const { lines: out, ms } = lines(SHOW, 'run', [scenario]);
  const answer = obj(out[0], `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies, ms };
}

/** A `deep-show run` the fault fixture kills: how it ended and what it wrote. */
export function showKilled(scenario: JsonObject): { status: number | null; signal: string | null; stdout: string } {
  const run = spawnSync(binPath(SHOW), ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW} run: ${run.error.message}`);
  return { status: run.status, signal: run.signal, stdout: run.stdout };
}

/** One line through `deep-canvas <subcommand>`. */
export const canvas = (subcommand: string, input: JsonObject): JsonObject =>
  obj(lines(CANVAS, subcommand, [input]).lines[0], `${CANVAS} ${subcommand}: the answer`);

/** The canonical bytes and revision hash of a document, by the kernel's `canonical`. */
export function canonical(doc: JsonValue): { bytes: string; sha256: string } {
  const out = canvas('canonical', { doc });
  return { bytes: str(out['bytes'], 'canonical: bytes'), sha256: str(out['sha256'], 'canonical: sha256') };
}

// ---------------------------------------------------------------------------------------------------
// Folders: an evidence store root and the hub's state folder per test, deleted after it.

export function useFolders(): { evidence: () => string; state: () => string } {
  let ev = '';
  let st = '';
  beforeEach(() => { ev = mkdtempSync(join(tmpdir(), 'deep-96-ev-')); st = mkdtempSync(join(tmpdir(), 'deep-96-state-')); });
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

/** Each logged doc.patched event against the published schema, through the contracts package's public entry. */
export function expectValidPatched(logged: Logged[]): void {
  for (const l of logged) {
    const v = validate('doc.patched@1', l.event);
    expect(v.ok, `record line ${l.log_pos} is a valid doc.patched@1 event: ${v.ok ? '' : JSON.stringify(v.issues).slice(0, 800)}`).toBe(true);
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

/** The scenario, with the shared board minted as revision 0 (or another seed) on the one panel. */
export function world(evidence: string, calls: JsonObject[], extra: JsonObject = {}, seed: JsonObject = fixture('board.json')): JsonObject {
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: { [DOC.board]: { panel: 'main', document: seed } }, calls, ...extra };
}

// Who a call writes as: alpha's MCP session, bravo's, or `deep show` from a process tree.
export type Who = JsonObject;
export const ASALPHA: Who = { call: 'deep_show', session: ALPHA.id };
export const ASBRAVO: Who = { call: 'deep_show', session: BRAVO.id };
export const CLI_YOU: Who = { call: 'deep show', peer: IN_YOURS };
export const CLI_ALPHA: Who = { call: 'deep show', peer: IN_ALPHA };
export const CLI_BRAVO: Who = { call: 'deep show', peer: IN_BRAVO };

export const patch = (id: string, base: number, ops: JsonObject[], doc: string = DOC.board, reason = 'a test patch'): JsonObject => ({ patch: id, doc, base, reason, ops });
export const send = (who: Who, p: JsonObject, extra: JsonObject = {}): JsonObject => ({ ...who, doc: p['doc']!, patch: p, ...extra });
export const undo = (who: Who, id: string, of: string, doc: string = DOC.board): JsonObject => ({ ...who, doc, undo: { patch: id, of } });
export const whole = (who: Who, document: JsonObject, removes?: string[], doc: string = DOC.board): JsonObject =>
  ({ ...who, doc, document, include: ['issues'], ...(removes ? { removes } : {}) });
export const read = (doc: string = DOC.board, as?: Who): JsonObject => {
  const call: JsonObject = { call: 'read', doc };
  if (as?.['session'] !== undefined) call['session'] = as['session']!;
  if (as?.['peer'] !== undefined) call['peer'] = as['peer']!;
  return call;
};
export const revisionsOf = (doc: string = DOC.board): JsonObject => ({ call: 'revisions', doc });

// Ops (Patch).
export const create = (item: JsonObject): JsonObject => ({ op: 'create', item });
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path, value });
export const del = (id: string): JsonObject => ({ op: 'delete', id, cascade: false });
export const move = (id: string, parent: string): JsonObject => ({ op: 'move', id, parent, keep: 'world' });
export const reorderAfter = (id: string, after: string): JsonObject => ({ op: 'reorder', id, after });

/** A node: a rect (the R1 slice's 2D marks). An item as a patch creates it: no `layer`. */
export const node = (id: string, name: string, pos: [number, number], order: string | null = 'a5'): JsonObject => ({
  id, kind: 'rect@1', name, ...(order === null ? {} : { order }),
  params: { box: [0, 0, 120, 48], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] },
});
/** An arrow: a path parented to a node. */
export const arrow = (id: string, name: string, parent: string, order = 'a5'): JsonObject => ({
  id, kind: 'path@1', name, parent, order, params: { d: 'M120 24 L200 24', paint: { stroke: { role: 'ink', width: 2 } } },
});

/** The envelope a whole revision carries for the shared board: the seed's own fields, no layers, no items. */
export function envelope(items: JsonObject[], extra: JsonObject = {}): JsonObject {
  const seed = fixture('board.json');
  return {
    format: seed['format']!, profile: seed['profile']!, title: seed['title']!, description: seed['description']!, size: seed['size']!,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// Replies

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; ids: string[]; path?: string; actual?: JsonValue }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { ...o, code: str(o['code'], `${what}: issues[${i}].code`), ids: strs(o['ids'] ?? [], `${what}: issues[${i}].ids`) } as Issue;
  });
}
export const codes = (reply: JsonObject): string[] => issues(reply).map((i) => i.code);

/** A `read` reply: the current revision as the hub shows it. */
export interface Shown { rev: number; hash: string; document: JsonObject; draws: string[]; issues: Issue[]; files: Record<string, string>; lost: string[] }
export function shown(reply: JsonObject, what = 'read'): Shown {
  const files = obj(reply['files'], `${what}: files`);
  return {
    rev: num(reply['rev'], `${what}: rev`),
    hash: str(reply['hash'], `${what}: hash`),
    document: obj(reply['document'], `${what}: document`),
    draws: sorted(strs(reply['draws'], `${what}: draws`)),
    issues: issues(reply, what),
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, str(v, `${what}: files.${k}`)])),
    lost: reply['lost'] === undefined ? [] : strs(reply['lost'], `${what}: lost`),
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

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/14 and 16), except
// that a result that can't be trusted fails with INCONCLUSIVE instead of skipping: it never passes.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}

/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin (the larger
 * of 5% and the runs' spread); else, and off a fit reference Mac, INCONCLUSIVE, which fails: it is not a pass. */
export function judge(name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const reading = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(reading);
  const problem = environmentProblem();
  if (problem) expect.fail(`INCONCLUSIVE: ${problem}; the reading is not a result: ${reading}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${reading}`).toBe(false);
  if (!runs.every((r) => r <= limit)) expect.fail(`INCONCLUSIVE: ${reading}`);
}
