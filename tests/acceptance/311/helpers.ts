// Shared test-side tools for the issue #311 acceptance tests: JSON Pointer edits, fixture loading, and
// assertions on refusals. None of them stands in for the contracts package.

import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { catalogue, ERROR_CODES, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, Validation } from '../../../packages/contracts/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export const fixture = (...parts: string[]): JsonValue => readJson(join(FIXTURES, ...parts));
export const fixtureText = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), 'utf8');
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const utf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/** The ULID the design's hook example uses. */
export const ULID = '01K74FKZVK8Q2X5R7M3N9P4T6W';
export const SEQ_MAX = 9223372036854775807n;

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => structuredClone(v);

/** A JSON Pointer's segments ('' is the root). */
export function segments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw Error(`not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export const pointer = (parts: readonly (string | number)[]): string =>
  parts.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

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
/** Every leaf (a value that isn't a non-empty object or array) with its pointer. */
export function leaves(value: JsonValue, at = ''): { path: string; value: JsonValue }[] {
  if (Array.isArray(value) && value.length) return value.flatMap((v, i) => leaves(v, `${at}/${i}`));
  if (isObject(value) && Object.keys(value).length) return Object.entries(value).flatMap(([k, v]) => leaves(v, `${at}${pointer([k])}`));
  return [{ path: at, value }];
}

/** The first pointer at which two JSON values differ, or undefined when they are equal. */
export function firstDifference(a: JsonValue | undefined, b: JsonValue | undefined, at = ''): string | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${at}/${i}`);
      if (d !== undefined) return d;
    }
    return undefined;
  }
  if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDifference(a[k], b[k], `${at}${pointer([k])}`);
      if (d !== undefined) return d;
    }
    return undefined;
  }
  return Object.is(a, b) || (a === 0 && b === 0) ? undefined : at;
}

/** Asserts a refusal that names `path`, with every issue in the shared error shape. */
export function expectRefused(result: Validation, path: string, why: string): void {
  expect(result.ok, `${why}: should be refused`).toBe(false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path);
  expect(paths, `${why}: the refusal names ${path}`).toContain(path);
  for (const issue of result.issues) {
    expect(ERROR_CODES, `${why}: code ${issue.code} is from the closed set`).toContain(issue.code);
    expect(typeof issue.retryable, `${why}: says whether a retry can help`).toBe('boolean');
    expect(issue.remediation.length, `${why}: names one remediation`).toBeGreaterThan(0);
  }
}
export function expectAccepted(result: Validation, why: string): void {
  const shown = result.ok ? '' : JSON.stringify(result.issues);
  expect(result.ok, `${why}: should be accepted ${shown}`).toBe(true);
}

/** The schema name the catalogue gives an event kind, failing the test when the kind isn't catalogued. */
export function kindSchema(kind: string): string {
  const entry = catalogue().find((e) => e.kind === kind);
  expect(entry, `event kind ${kind} is in the catalogue`).toBeDefined();
  return entry!.schema;
}
/** The implementation's first valid fixture for a schema, as a fresh copy. */
export function firstFixture(name: string): JsonValue {
  const all = fixtures(name);
  expect(all.length, `${name} has at least one valid fixture`).toBeGreaterThan(0);
  return clone(all[0]!);
}
/** The first fixture of an event kind's schema. */
export const eventFixture = (kind: string): JsonValue => firstFixture(kindSchema(kind));

/** Reads a fixtures/<dir>/*.json set. */
export function fixtureSet<T>(dir: string): T[] {
  return readdirSync(join(FIXTURES, dir)).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, dir, f), 'utf8')) as T);
}
export interface NodeFixture { name: string; node: string; schema: Schema; instances: JsonValue[] }
export interface LintFixture { name: string; path: string; schema: Schema }

/** Crockford base32, the ULID alphabet. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A random valid ULID: Crockford base32, 26 characters, the first at most 7 (48 bits of time). */
export const ulidArb = fc.tuple(fc.constantFrom(...'01234567'), fc.string({ unit: fc.constantFrom(...CROCKFORD), minLength: 25, maxLength: 25 }))
  .map(([a, b]) => a + b);

/**
 * The event kinds the design documents, read at the base commit: every row of the canvas reference's
 * event catalogue (docs/canvas-primitives.md, The event catalogue) and the kinds the tech design's
 * Event primitive names. `transcript.archived` and the four `learn.*` kinds are among them.
 */
export const DESIGN_KINDS = [
  'session.start', 'session.child_started', 'session.attention', 'worktree.created', 'worktree.removed',
  'user.ask', 'task.created', 'task.closed', 'definition.drafted', 'definition.locked', 'definition.revised',
  'tool.before', 'tool.after', 'agent.stop', 'claim.made', 'claim.sent_back', 'claim.stalled', 'delivery.outcome',
  'run.started', 'run.finished', 'verdict.made', 'verdict.stale', 'ask.created', 'ask.batched', 'ask.answered',
  'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.later', 'decision.created', 'decision.applied',
  'plan.proposed', 'open_item.opened', 'open_item.closed', 'notice.subscribed', 'notice.sent', 'action.entered',
  'action.reported', 'lease.acquired', 'lease.released', 'lease.stale', 'lease.denied', 'merge.dry_run',
  'reading.recorded', 'reading.batch', 'reading.rollup', 'layer.rows', 'pr.merged', 'evidence.put',
  'transcript.archived', 'learn.proposed', 'learn.applied', 'learn.widened', 'learn.rolled_back', 'doc.patched',
  'note.opened', 'note.closed', 'suggestion.filed', 'suggestion.settled',
] as const;

/** The kinds in the first column of the live canvas reference's event catalogue table. */
export function catalogueTableKinds(): string[] {
  const doc = readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8');
  const start = doc.indexOf('### The event catalogue');
  const end = doc.indexOf('\n### ', start + 1);
  expect(start, 'docs/canvas-primitives.md has its event catalogue').toBeGreaterThan(-1);
  const kinds: string[] = [];
  for (const line of doc.slice(start, end).split('\n')) {
    const first = /^\|\s*([^|]+)\|/.exec(line)?.[1] ?? '';
    for (const m of first.matchAll(/`([a-z][a-z_]*\.[a-z][a-z_]*)`/g)) kinds.push(m[1]!);
  }
  return kinds;
}

/** The RFC 8785 kernel fixture: one record of each hashed kind, its canonical text and SHA-256, computed before any encoder. */
export interface KernelRecord { kind: string; input: string; canonical: string; sha256: string }
export const KERNEL = (fixture('rfc8785-kernel.json') as unknown as { records: KernelRecord[] }).records;
export const HASHED_KINDS = ['verdict record', 'definition of done', "approval's plan", "ask's key", "open item's ID", 'package envelope'];
