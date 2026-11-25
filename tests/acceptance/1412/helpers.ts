// Test-side tools for the #1412 acceptance tests: the `deep-show` binary (the hub's canvas side, as
// tests/acceptance/96 drives it), driven by one JSON scenario line; the hub's state folder (layer files by hash
// under `layers/<2 hex>/<62 hex>`, the `doc.patched` events in `record.jsonl`); two shared documents in one state
// folder; and the damage the criteria name (a layer file deleted, a layer file's bytes changed). Nothing here
// stands in for a restart, a commit point or a check: a restart is a second `deep-show run` with the same state
// folder. Copied in part from tests/acceptance/96/helpers.ts (same repository, same licence).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1412 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const binPath = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);

/** Each criterion's tag: `#1412.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs criterionId). */
export const AC = {
  deleted: '#1412.d0145601',
  changed: '#1412.83dd035b',
  other: '#1412.8d00dba2',
  clean: '#1412.09a35255',
} as const;

/** The issue codes this suite names (README: The codes). The design names none for these cases. */
export const MISSING = 'layer_file_missing';
export const MISMATCH = 'layer_file_mismatch';

// ---------------------------------------------------------------------------------------------------
// JSON

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

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file; `deep-show run` takes one scenario line and answers one line.

function build(): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${SHOW} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds deep-show once per file and fails every test of the file, BLOCKED, when it can't be built. */
export function useBinary(): void {
  let error = '';
  beforeAll(() => { error = build(); }, 900_000);
  beforeEach(() => { expect(error, `BLOCKED: ${SHOW} builds`).toBe(''); });
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function show(scenario: JsonObject): JsonObject[] {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(binPath(SHOW), ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW} run: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${SHOW} run ended with status ${run.status}, signal ${run.signal}:\n${run.stderr}`);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${SHOW} run: one answer line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Folders: an evidence store root and the hub's state folder per test, deleted after it.

export function useFolders(): { evidence: () => string; state: () => string } {
  let ev = '';
  let st = '';
  beforeEach(() => { ev = mkdtempSync(join(tmpdir(), 'deep-1412-ev-')); st = mkdtempSync(join(tmpdir(), 'deep-1412-state-')); });
  afterEach(() => {
    for (const dir of [ev, st]) if (dir) rmSync(dir, { recursive: true, force: true });
    ev = ''; st = '';
  });
  return { evidence: () => ev, state: () => st };
}

/** The path of a layer file in the state folder, by its hash: `layers/<2 hex>/<62 hex>`. */
export const layerPath = (state: string, sha: string): string => join(state, 'layers', sha.slice(0, 2), sha.slice(2));

/** Every layer file's hash in the state folder. */
export function layerHashes(state: string): string[] {
  const root = join(state, 'layers');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => /^[0-9a-f]{2}$/.test(d)).flatMap((d) => readdirSync(join(root, d)).filter((f) => /^[0-9a-f]{62}$/.test(f)).map((f) => d + f));
}

export interface Logged { log_pos: number; event: JsonObject }
/** The hub's record in the state folder: `record.jsonl`, one appended event per line. */
export function record(state: string): Logged[] {
  const path = join(state, 'record.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((line, i) => {
    const o = obj(JSON.parse(line) as JsonValue, `record.jsonl line ${i + 1}`);
    return { log_pos: num(o['log_pos'], `record line ${i + 1}: log_pos`), event: obj(o['event'], `record line ${i + 1}: event`) };
  });
}
export const dataOf = (l: Logged): JsonObject => obj(l.event['data'], `event ${l.log_pos}: data`);

/** Each logged event is a valid doc.patched event at the version it says, through the contracts package's public entry. */
export function expectValidPatched(logged: Logged[]): void {
  for (const l of logged) {
    const v = validate(`doc.patched@${String(l.event['v'])}`, l.event);
    expect(v.ok, `record line ${l.log_pos} is a valid doc.patched@${String(l.event['v'])} event: ${v.ok ? '' : JSON.stringify(v.issues).slice(0, 800)}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The world: you, at your own terminal, writing two shared documents; one panel each.

/** The OS process table the peer check reads: `deep show` run in your shell. */
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 }, // your terminal
  { pid: 3001, ppid: 3000, start: 110 }, // your shell
  { pid: 3002, ppid: 3001, start: 3_000 }, // `deep show` you ran
];
const YOU: JsonObject = { call: 'deep show', peer: { pid: 3002, start: 3_000 } };

/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** The two documents: A is damaged, B is the other document in the same state folder. */
export const DOC = { a: ulid('01JB1412A', 1), b: ulid('01JB1412B', 1) } as const;
/** Patch IDs. */
export const P = (n: number): string => ulid('01JB1412P', n);

/** The stored document both start from: your two nodes in your layer. */
export function board(title: string): JsonObject {
  return {
    format: 1, profile: 'board', title, description: 'A board you write, restarted from the hub\'s state folder.', size: [640, 360],
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: {
      'you.n1': { id: 'you.n1', kind: 'rect@1', layer: 'you-main', name: 'Node 1', order: 'a0', params: { box: [0, 0, 120, 48], paint: { fill: { role: 'muted' } } }, at: { pos: [40, 40, 0] } },
      'you.n2': { id: 'you.n2', kind: 'rect@1', layer: 'you-main', name: 'Node 2', order: 'a1', params: { box: [0, 0, 120, 48], paint: { fill: { role: 'muted' } } }, at: { pos: [40, 200, 0] } },
    },
  };
}

export function world(evidence: string, state: string, calls: JsonObject[]): JsonObject {
  return {
    evidence, state, processes: PROCESSES, sessions: {},
    panels: { main: { rect: [0, 0, 640, 360] }, side: { rect: [0, 360, 640, 360] } },
    docs: { [DOC.a]: { panel: 'main', document: board('Board A') }, [DOC.b]: { panel: 'side', document: board('Board B') } },
    calls,
  };
}

/** Your patch moving node 1 of a document to x, on base revision `base`. */
export const moveN1 = (doc: string, id: string, base: number, x: number): JsonObject =>
  ({ ...YOU, doc, patch: { patch: id, doc, base, reason: 'move node 1', ops: [{ op: 'set', id: 'you.n1', path: 'items/you.n1/at/pos', value: [x, 40, 0] }] } });
export const read = (doc: string): JsonObject => ({ call: 'read', doc });
export const revisionsOf = (doc: string): JsonObject => ({ call: 'revisions', doc });

// ---------------------------------------------------------------------------------------------------
// What a document shows: its read and its revisions.

export interface Row { rev: number; hash: string; patches: string[] }
export interface Seen { reply: JsonObject; rev: number | undefined; hash: string | undefined; codes: string[]; rows: Row[] | undefined }

/** Every issue code a reply carries: its own `code` and each of its `issues`' codes. */
export function codesOf(reply: JsonObject): string[] {
  const out: string[] = [];
  if (typeof reply['code'] === 'string') out.push(reply['code']);
  for (const i of Array.isArray(reply['issues']) ? reply['issues'] : []) if (isObject(i) && typeof i['code'] === 'string') out.push(i['code']);
  return out;
}

/** A document's read and revisions replies: the revision it shows (if it shows one), its codes, its revision rows (if it lists any). */
export function seen(readReply: JsonObject, revisionsReply: JsonObject): Seen {
  const rows = Array.isArray(revisionsReply['revisions'])
    ? revisionsReply['revisions'].map((v, i) => {
      const o = obj(v, `revisions[${i}]`);
      return { rev: num(o['rev'], `revisions[${i}].rev`), hash: str(o['hash'], `revisions[${i}].hash`), patches: strs(o['patches'] ?? [], `revisions[${i}].patches`) };
    })
    : undefined;
  return {
    reply: readReply,
    rev: typeof readReply['rev'] === 'number' ? readReply['rev'] : undefined,
    hash: typeof readReply['hash'] === 'string' ? readReply['hash'] : undefined,
    codes: [...codesOf(readReply), ...codesOf(revisionsReply)],
    rows,
  };
}

/** Before the restart: three revisions of A and three of B, interleaved, committed to a fresh state folder. */
export interface Before { a: Seen; b: Seen; logged: Logged[] }
export const MOVES = { a: [100, 200, 300], b: [110, 210, 310] } as const;

export function commitBoth(evidence: string, state: string): Before {
  const calls: JsonObject[] = [];
  for (let k = 0; k < 3; k++) {
    calls.push(moveN1(DOC.a, P(1 + k), k, MOVES.a[k]!));
    calls.push(moveN1(DOC.b, P(11 + k), k, MOVES.b[k]!));
  }
  calls.push(read(DOC.a), revisionsOf(DOC.a), read(DOC.b), revisionsOf(DOC.b));
  const r = show(world(evidence, state, calls));
  for (let k = 0; k < 6; k++) expect(r[k]!['outcome'], `patch ${k + 1} of 6 applies before the restart: ${JSON.stringify(r[k]).slice(0, 600)}`).toBe('applied');
  const a = seen(r[6]!, r[7]!);
  const b = seen(r[8]!, r[9]!);
  expect([a.rev, b.rev], 'before the restart each document shows its revision 3').toEqual([3, 3]);
  for (const s of [a, b]) expect(s.rows?.map((row) => row.rev), 'and lists revisions 0 to 3').toEqual([0, 1, 2, 3]);
  const logged = record(state);
  expectValidPatched(logged);
  expect(logged.length, 'the record holds one doc.patched event per patch').toBe(6);
  return { a, b, logged };
}

/** A's event for revision `rev`, and the layer files it alone names: no other event in the record names them. */
export function ownFiles(logged: Logged[], doc: string, rev: number): string[] {
  const subject = `doc:${doc}`;
  const it = logged.find((l) => dataOf(l)['doc'] === subject && dataOf(l)['rev'] === rev);
  expect(it, `the record has ${subject}'s revision ${rev}`).toBeDefined();
  const named = strs(it!.event['evidence'] ?? [], `revision ${rev}'s evidence`);
  const elsewhere = new Set(logged.filter((l) => l !== it).flatMap((l) => strs(l.event['evidence'] ?? [], 'evidence')));
  const own = named.filter((h) => !elsewhere.has(h));
  expect(own.length, `${subject}'s revision ${rev} names a layer file no other event names (${JSON.stringify(named)})`).toBeGreaterThan(0);
  return own;
}

/** Deletes a layer file. */
export function deleteLayerFile(state: string, sha: string): void {
  const path = layerPath(state, sha);
  expect(existsSync(path), `layer file ${sha} is in the state folder`).toBe(true);
  unlinkSync(path);
}

/** Changes a layer file's bytes in place: still JSON, node 1 moved somewhere no revision put it. */
export function changeLayerFile(state: string, sha: string): void {
  const path = layerPath(state, sha);
  const before = readFileSync(path, 'utf8');
  const layer = obj(JSON.parse(before) as JsonValue, `layer file ${sha}`);
  const n1 = obj(obj(layer['items'], 'its items')['you.n1'], 'its you.n1');
  n1['at'] = { pos: [555, 40, 0] };
  const after = JSON.stringify(layer);
  expect(after, 'the bytes change').not.toBe(before);
  writeFileSync(path, after);
}

/** Restarts the hub on the state folder: a read and the revisions of each document. */
export function restart(evidence: string, state: string): { a: Seen; b: Seen } {
  const r = show(world(evidence, state, [read(DOC.a), revisionsOf(DOC.a), read(DOC.b), revisionsOf(DOC.b)]));
  return { a: seen(r[0]!, r[1]!), b: seen(r[2]!, r[3]!) };
}

/** The hash each of a document's doc.patched events carries for its revision, by revision (README: The event's field). */
export function recordedHashes(logged: Logged[], doc: string): Map<number, string | undefined> {
  const subject = `doc:${doc}`;
  return new Map(logged.filter((l) => dataOf(l)['doc'] === subject).map((l) => {
    const h = dataOf(l)['hash'];
    return [num(dataOf(l)['rev'], `event ${l.log_pos}: data.rev`), typeof h === 'string' ? h : undefined];
  }));
}

/** Each revision row past 0 against the hash its event recorded, as failures. */
function provenFailures(rows: Row[], recorded: Map<number, string | undefined>): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.rev === 0) continue;
    const want = recorded.get(row.rev);
    if (want === undefined) out.push(`revision ${row.rev}'s doc.patched event carries no data.hash, so its hash ${row.hash} is proven by nothing`);
    else if (want !== row.hash) out.push(`revision ${row.rev} restores at hash ${row.hash}, its doc.patched event recorded ${want}`);
  }
  return out;
}

/**
 * What the criterion asks of the damaged document after the restart, as failures; empty when it holds. It reports
 * `code`, and shows no revision past `lastGood`: what it shows, if anything, is a revision at or before it at the
 * hash it had before the restart, and its revisions list none after it.
 */
export function damagedFailures(after: Seen, before: Seen, code: string, lastGood: number): string[] {
  const out: string[] = [];
  if (!after.codes.includes(code)) out.push(`the document reports no ${code} issue (codes: ${JSON.stringify(after.codes)})`);
  if (after.rev !== undefined) {
    if (after.rev > lastGood) out.push(`the document shows revision ${after.rev}, past revision ${lastGood}, the last one whose layer files are intact`);
    const was = before.rows?.find((row) => row.rev === after.rev)?.hash;
    if (after.hash !== was) out.push(`the document shows revision ${after.rev} at hash ${after.hash}, not the hash ${was} it had before the restart`);
  }
  const past = (after.rows ?? []).filter((row) => row.rev > lastGood).map((row) => row.rev);
  if (past.length > 0) out.push(`the document lists revisions ${JSON.stringify(past)}, past revision ${lastGood}`);
  return out;
}

/**
 * What "restores whole" asks of a document, as failures: the same shown revision and hash, the same revisions by
 * hash and patch, each revision's hash the one its doc.patched event recorded, and no issue of the damage.
 */
export function wholeFailures(after: Seen, before: Seen, recorded: Map<number, string | undefined>): string[] {
  const out: string[] = [];
  if (after.rev !== before.rev || after.hash !== before.hash) out.push(`it shows revision ${after.rev} at ${after.hash}, before the restart revision ${before.rev} at ${before.hash}`);
  if (JSON.stringify(after.rows) !== JSON.stringify(before.rows)) out.push(`its revisions are ${JSON.stringify(after.rows)}, before the restart ${JSON.stringify(before.rows)}`);
  out.push(...provenFailures(after.rows ?? [], recorded));
  const damage = after.codes.filter((c) => c === MISSING || c === MISMATCH);
  if (damage.length > 0) out.push(`it reports ${JSON.stringify(damage)}`);
  return out;
}
