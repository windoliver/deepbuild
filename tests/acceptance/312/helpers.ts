// Shared test-side tools for the issue #312 acceptance tests: fixture loading, JSON Pointer edits, hook
// request lines and refusal assertions. None of them stands in for the adapters package or the contracts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { catalogue, ContractError, ERROR_CODES, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, Validation } from '../../../packages/contracts/src/index.ts';
import type { Adapter, AdapterCaps, AdapterParts, HookRequestLine, Mapped } from '../../../packages/adapters/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const CORPUS = join(REPO, 'adapters', 'corpus');

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => structuredClone(v);

export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export const readJsonl = (path: string): JsonValue[] =>
  readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as JsonValue);
export const fixture = (...parts: string[]): JsonValue => readJson(join(FIXTURES, ...parts));
export const fixtureLines = (...parts: string[]): JsonValue[] => readJsonl(join(FIXTURES, ...parts));
/** Reads a fixtures/<dir>/*.json set, by file name. */
export function fixtureSet<T>(dir: string): T[] {
  return readdirSync(join(FIXTURES, dir)).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, dir, f), 'utf8')) as T);
}

/** The shipped facts files, read as data. */
export const claudeFacts = (): JsonValue => readJson(join(REPO, 'adapters', 'claude-code.facts.json'));
export const codexFacts = (): JsonValue => readJson(join(REPO, 'adapters', 'codex.facts.json'));
/** A recorded corpus session's payloads: adapters/corpus/<agent>/<version>/<session>/events.jsonl. */
export function corpusPayloads(agent: string, version: string, session: string): JsonObject[] {
  return readJsonl(join(CORPUS, agent, version, session, 'events.jsonl')).map((line) => {
    expect(isObject(line) && isObject(line.payload), `${agent}/${version}/${session}: a recorded payload`).toBe(true);
    return (line as JsonObject).payload as JsonObject;
  });
}

/** A JSON Pointer's segments ('' is the root). */
export function segments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw Error(`not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
function child(node: JsonValue | undefined, key: string): JsonValue | undefined {
  if (Array.isArray(node)) return node[Number(key)];
  if (isObject(node)) return Object.hasOwn(node, key) ? node[key] : undefined;
  return undefined;
}
export function getAt(value: JsonValue, path: string): JsonValue | undefined {
  let node: JsonValue | undefined = value;
  for (const key of segments(path)) node = child(node, key);
  return node;
}
/** A copy of `value` with the value at `path` replaced (or added to its parent object). */
export function setAt(value: JsonValue, path: string, next: JsonValue): JsonValue {
  const copy = clone(value);
  const keys = segments(path);
  const last = keys.pop();
  if (last === undefined) return next;
  const parent = keys.reduce<JsonValue | undefined>((node, key) => child(node, key), copy);
  if (Array.isArray(parent)) parent[Number(last)] = next;
  else if (isObject(parent)) parent[last] = next;
  else throw Error(`no parent at ${path}`);
  return copy;
}
/** A copy of `value` without the member at `path`. */
export function deleteAt(value: JsonValue, path: string): JsonValue {
  const copy = clone(value);
  const keys = segments(path);
  const last = keys.pop();
  const parent = keys.reduce<JsonValue | undefined>((node, key) => child(node, key), copy);
  if (last === undefined || !isObject(parent) || !Object.hasOwn(parent, last)) throw Error(`nothing to delete at ${path}`);
  delete parent[last];
  return copy;
}

/** Asserts a refusal that names `path`, with every issue in the shared error shape (error@1). */
export function expectRefused(result: Validation, path: string, why: string): void {
  expect(result.ok, `${why}: should be refused`).toBe(false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path);
  expect(paths, `${why}: the refusal names ${path}`).toContain(path);
  for (const issue of result.issues) {
    expect(ERROR_CODES, `${why}: code ${issue.code} is from the closed set`).toContain(issue.code);
    expect(typeof issue.retryable, `${why}: says whether a retry can help`).toBe('boolean');
    expect(issue.remediation.length, `${why}: names one remediation`).toBeGreaterThan(0);
    expect(typeof issue.actual, `${why}: carries the refused value`).toBe('string');
    expect(Array.isArray(issue.evidence), `${why}: carries evidence handles`).toBe(true);
  }
}
export function expectAccepted(result: Validation, why: string): void {
  const shown = result.ok ? '' : JSON.stringify(result.issues);
  expect(result.ok, `${why}: should be accepted ${shown}`).toBe(true);
}
/** Asserts that `run` throws the one error shape, naming `path`. */
export function expectThrown(run: () => unknown, path: string, why: string): ContractError {
  let thrown: unknown;
  try { run(); } catch (error) { thrown = error; }
  expect(thrown, `${why}: should throw a ContractError`).toBeInstanceOf(ContractError);
  const error = thrown as ContractError;
  expect(error.path, `${why}: the refusal names ${path}`).toBe(path);
  expect(ERROR_CODES, `${why}: code ${error.code} is from the closed set`).toContain(error.code);
  expect(error.remediation.length, `${why}: names one remediation`).toBeGreaterThan(0);
  return error;
}

/** The schema name the catalogue gives an event kind (at one version, when given), failing the test when it isn't catalogued. */
export function kindSchema(kind: string, version?: number): string {
  const entry = catalogue().find((e) => e.kind === kind && (version === undefined || e.version === version));
  expect(entry, `event kind ${kind}${version === undefined ? '' : `@${version}`} is in the catalogue`).toBeDefined();
  return entry!.schema;
}
/** The implementation's first valid fixture for a schema, as a fresh copy. */
export function firstFixture(name: string): JsonValue {
  const all = fixtures(name);
  expect(all.length, `${name} has at least one valid fixture`).toBeGreaterThan(0);
  return clone(all[0]!);
}
export const eventFixture = (kind: string): JsonValue => firstFixture(kindSchema(kind));

/** The ULID the design's hook example uses, and a seq beside it. */
export const ULID = '01K74FKZVK8Q2X5R7M3N9P4T6W';
export const SEQ = '1760013451123456789';
/** A hook request line (hook.request@1) carrying one agent's payload, as deep-hook would stamp it. */
export function request(agent: string, payload: JsonValue, event?: string): HookRequestLine {
  const name = event ?? (isObject(payload) && typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'unknown');
  return { v: 1, agent, event: name, seq: SEQ, id: ULID, pid: 81234, ppid: 81200, matched: [], payload };
}
/** The one event of a kind a mapping produced, failing the test when there isn't exactly one. */
export function only(mapped: Mapped, kind: string, why: string): { agent: string; kind: string; data: JsonObject; rule: string } {
  const events = mapped.events.filter((e) => e.kind === kind);
  expect(events.length, `${why}: exactly one ${kind} (got ${JSON.stringify(mapped.events.map((e) => e.kind))})`).toBe(1);
  return events[0]!;
}

/** The caps a test adapter declares: nothing driven, nothing it can't prove. */
export const NO_CAPS: AdapterCaps = {
  holdStop: false, wakeIdle: false, steer: false, followUp: false, answerPermission: false, nativeTools: false,
  mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false,
};
export const CAP_NAMES = Object.keys(NO_CAPS) as (keyof AdapterCaps)[];
/** The parts of the cursor test adapter that aren't data: it answers doctor with one item it never ran. */
export const cursorParts = (): AdapterParts => ({
  caps: { ...NO_CAPS },
  unsupported: { terminal: ['steer', 'interrupt'] },
  doctor: () => [{ code: 'cursor.binary', level: 'skip', evidence: 'not checked: no binary was looked for', fix: 'Install Cursor and run deep doctor again.' }],
});
export const cursorFacts = (): JsonValue => fixture('cursor', 'cursor.facts.json');
export interface CursorCase { payload: JsonObject; expect: { kind: string; data: JsonObject } }
export const cursorCases = (): CursorCase[] => fixtureLines('cursor', 'events.jsonl') as unknown as CursorCase[];
export const CURSOR_VERSION = '1.7.0';

/** Something that stands where an adapter must, for registration refusals. */
export const asAdapter = (value: unknown): Adapter => value as Adapter;

export interface PlantedSchema { name: string; field: string; why: string; schema: Schema }
export interface PlantedCodexSchema { name: string; version: string; hook: string; field: string; schema: Schema }
export interface EditFixture { version: string; why: string; payload: JsonObject; paths?: string[] }

/** The stop causes the issue closes the set on, as the corpus's slugs. */
export const STOP_CAUSES = [
  'sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'rate_limited', 'refusal', 'max_turns',
  'context_overflow', 'tool_schema_rejected', 'agent_crashed', 'timed_out', 'unknown',
] as const;
export const TOOL_KINDS = ['shell', 'read', 'edit', 'write', 'search', 'fetch', 'mcp', 'unknown'] as const;
export const PERMISSION_KINDS = ['tool', 'plan', 'question', 'mode'] as const;
export const DECISIONS = ['allow', 'deny', 'cancel'] as const;
export const SCOPES = ['call', 'session'] as const;
export const BASES = ['reported', 'estimated', 'unpriced'] as const;
export const ATTENTION = ['finished', 'failed', 'waiting_permission', 'unknown'] as const;
/** The facts sections the issue lists, each naming the core rule that reads it and its conformance case. */
export const FACTS_SECTIONS = [
  'hookTimeouts', 'continuation', 'launch', 'modelFamily', 'billing', 'usage', 'questionTools', 'transcripts', 'appLinks', 'errorTexts',
  'events', 'mapping', 'toolKinds',
] as const;
