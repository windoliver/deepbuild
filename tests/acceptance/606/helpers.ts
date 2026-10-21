// Shared test-side tools for the issue #606 acceptance tests: JSON Pointer edits, refusal checks and
// the recorded corpus read as data. None of them stands in for the contracts package or the adapter.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { JsonValue, Validation } from '../../../packages/contracts/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const CORPUS = join(REPO, 'adapters', 'corpus');

/** The design's closed set of ask outcomes (canvas-primitives.md, Closed enums: Ask outcome; the asks table). */
export const ASK_OUTCOMES = ['answered', 'decided_for_you', 'escalated', 'defaulted', 'unanswerable', 'cancelled', 'superseded', 'moot', 'unanswered'] as const;

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

const segments = (pointer: string): string[] =>
  pointer === '' ? [] : pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
const escape = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

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
  const copy = structuredClone(value);
  const keys = segments(path);
  const last = keys.pop();
  if (last === undefined) return next;
  const parent = keys.reduce<JsonValue | undefined>((node, key) => child(node, key), copy);
  if (Array.isArray(parent)) parent[Number(last)] = next;
  else if (isObject(parent)) parent[last] = next;
  else throw Error(`no parent at ${path}`);
  return copy;
}
/** Every string leaf with its JSON Pointer. */
export function stringLeaves(value: JsonValue, at = ''): { path: string; value: string }[] {
  if (typeof value === 'string') return [{ path: at, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${at}/${i}`));
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, `${at}/${escape(k)}`));
  return [];
}

/** Why a validation isn't a refusal that names `path` and the refused value there, or undefined when it is. */
export function notRefusedAt(result: Validation, path: string, actual: string): string | undefined {
  if (result.ok) return `accepted ${JSON.stringify(actual)} at ${path}`;
  if (result.issues.some((i) => i.path === path && i.actual === actual)) return undefined;
  return `refused ${JSON.stringify(actual)}, but no issue names ${path} with that value: ${JSON.stringify(result.issues.map(({ code, path: p, actual: a }) => ({ code, path: p, actual: a })))}`;
}
export function expectAccepted(result: Validation, what: string): void {
  expect(result.ok, `${what}: ${result.ok ? '' : JSON.stringify(result.issues.map(({ code, path, actual }) => ({ code, path, actual })))}`).toBe(true);
}

/** One recorded hook call of the corpus (adapters/corpus/<agent>/<version>/<session>/events.jsonl), as data. */
export interface CorpusCase {
  agent: string;
  version: string;
  session: string;
  line: number;
  payload: JsonObject;
  expect: { kind: string; data: JsonObject }[] | undefined;
}
const folders = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
};
export function corpusCases(agent: string): CorpusCase[] {
  return folders(join(CORPUS, agent)).flatMap((version) => folders(join(CORPUS, agent, version)).flatMap((session) => {
    let text = '';
    try {
      text = readFileSync(join(CORPUS, agent, version, session, 'events.jsonl'), 'utf8');
    } catch {
      return [];
    }
    return text.split('\n').flatMap((line, index) => {
      if (!line.trim()) return [];
      const record = JSON.parse(line) as JsonObject;
      return [{ agent, version, session, line: index + 1, payload: record.payload as JsonObject, expect: record.expect as CorpusCase['expect'] }];
    });
  }));
}
export const where = (c: CorpusCase): string => `${c.agent}/${c.version}/${c.session}/events.jsonl:${c.line}`;
