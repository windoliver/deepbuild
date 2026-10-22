// Test-side tools for the #375 acceptance tests: the auto layout binary and the canvas's one shaper
// (`deep-text`, as #390 left it) driven by JSON lines, the fixture documents, boxes read from the
// layout's answer, and cargo metadata for the scope line. Nothing here lays anything out or measures
// any text: every size a test compares with comes from the binaries or from the fixtures' own fields.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/375 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The marks2d module's auto layout: `solve`. */
export const LAYOUT_BIN = exe('deep-layout');
/** The canvas's one shaper (#390): `fit`. */
export const TEXT_BIN = exe('deep-text');

/** The criterion's tolerance, in u (one logical pixel at zoom 1, so also px). */
export const TOL = 0.5;

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonObject;
}

export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonValue[];
}

export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}

/** `actual` is within `tol` of `expected`, with a message that names both. */
export function near(actual: number, expected: number, what: string, tol = TOL): void {
  expect(Math.abs(actual - expected) <= tol, `${what}: ${actual} is within ${tol} of ${expected}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Documents and boxes

/** The item `id` of a document's `items` map. */
export function item(doc: JsonObject, id: string): JsonObject {
  return obj(obj(doc['items'], 'the document items')[id], `item ${id}`);
}

/** The item's params. */
export function params(doc: JsonObject, id: string): JsonObject {
  return obj(item(doc, id)['params'], `${id}'s params`);
}

/** The IDs of the items whose parent is `frame`, in their `order` keys' order (never the map's order). */
export function children(doc: JsonObject, frame: string): string[] {
  const items = Object.values(obj(doc['items'], 'the document items')).map((i) => obj(i, 'an item'));
  return items
    .filter((i) => i['parent'] === frame)
    .sort((a, b) => (String(a['order']) < String(b['order']) ? -1 : String(a['order']) > String(b['order']) ? 1 : 0))
    .map((i) => String(i['id']));
}

/** A fixed child's own size, from its `box: [x, y, w, h]`. */
export function fixedSize(doc: JsonObject, id: string): { w: number; h: number } {
  const b = arr(params(doc, id)['box'], `${id}'s box`);
  return { w: num(b[2], `${id}'s box w`), h: num(b[3], `${id}'s box h`) };
}

/** A box `[x, y, w, h]` in document u, y down, origin top left. */
export interface Box { x: number; y: number; w: number; h: number }
export const right = (b: Box): number => b.x + b.w;
export const bottom = (b: Box): number => b.y + b.h;

/** The `boxes` of an accepted `solve` answer, each read as `[x, y, w, h]` with w, h ≥ 0. */
export function boxesOf(out: JsonObject, what: string): Record<string, Box> {
  const boxes = obj(out['boxes'], `${what}: boxes`);
  const read: Record<string, Box> = {};
  for (const [id, value] of Object.entries(boxes)) {
    const b = arr(value, `${what}: boxes[${id}]`);
    expect(b.length, `${what}: boxes[${id}] is [x, y, w, h]`).toBe(4);
    const [x, y, w, h] = b.map((v, i) => num(v, `${what}: boxes[${id}][${i}]`)) as [number, number, number, number];
    expect(w >= 0 && h >= 0, `${what}: boxes[${id}] has a size of at least zero, got ${w} × ${h}`).toBe(true);
    read[id] = { x, y, w, h };
  }
  return read;
}

/** The box of `id`, which the answer must hold. */
export function boxOf(boxes: Record<string, Box>, id: string, what: string): Box {
  const b = boxes[id];
  expect(b, `${what}: the answer holds a box for ${id}; it holds ${JSON.stringify(Object.keys(boxes))}`).toBeDefined();
  return b!;
}

// ---------------------------------------------------------------------------------------------------
// The binaries: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

/** Builds one binary by name across the workspace; returns '' or the build's error text. */
export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the named binaries once per file and fails every test of the file when one can't be built. */
export function useBinaries(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(buildBinary).filter((e) => e !== '').join('\n'); }, 900_000);
  beforeEach(() => { expect(error, `the binaries build: ${names.join(', ')}`).toBe(''); });
}

/** Pipes every input line into one run of `<bin> <subcommand>` and returns the output lines as written. */
export function rawLines(bin: string, subcommand: string, inputs: (JsonValue | string)[]): string[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${bin.split(/[\\/]/).at(-1)} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines;
}

export function batch(bin: string, subcommand: string, inputs: (JsonValue | string)[]): JsonValue[] {
  return rawLines(bin, subcommand, inputs).map((line) => JSON.parse(line) as JsonValue);
}

/** Each document solved in one run of `deep-layout solve`; every answer must be accepted. */
export function solveAll(docs: JsonObject[], what: string): Record<string, Box>[] {
  return batch(LAYOUT_BIN, 'solve', docs.map((doc) => ({ doc }))).map((line, i) => {
    const out = obj(line, `${what} [${i}]: the answer`);
    expect(out['ok'], `deep-layout solve refused ${what} [${i}]: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
    return boxesOf(out, `${what} [${i}]`);
  });
}

export function solve(doc: JsonObject, what: string): Record<string, Box> {
  return solveAll([doc], what)[0]!;
}

/** The JSON-lines convention: a line that isn't JSON, and one missing its required fields, each answer bad_input. */
export function expectBadInput(bin: string, subcommand: string): void {
  const out = batch(bin, subcommand, ['{not json', {}]);
  for (const [i, line] of out.entries()) {
    expect(line, `${bin.split(/[\\/]/).at(-1)} ${subcommand}: line ${i + 1} answers bad_input`).toEqual({ ok: false, code: 'bad_input' });
  }
}

/**
 * What the canvas's one shaper measures for a text leaf's params (#390's `deep-text fit`, no box);
 * `number: true` measures a bound number's text, with its tabular numerals.
 */
export interface Measured { width: number; height: number; lines: number }
export function measure(texts: JsonObject[]): Measured[] {
  const inputs = texts.map((p) => {
    const line: JsonObject = { text: p['text'] ?? null };
    for (const key of ['font', 'size', 'weight', 'number'] as const) if (p[key] !== undefined) line[key] = p[key]!;
    return line;
  });
  return batch(TEXT_BIN, 'fit', inputs).map((line, i) => {
    const out = obj(line, `deep-text fit [${i}]`);
    expect(out['ok'], `deep-text fit refused ${JSON.stringify(inputs[i])}: ${JSON.stringify(out)}`).toBe(true);
    return { width: num(out['width'], 'deep-text width'), height: num(out['height'], 'deep-text height'), lines: num(out['lines'], 'deep-text lines') };
  });
}

// ---------------------------------------------------------------------------------------------------
// cargo metadata: the workspace's packages and the normal-dependency closure of one of them.

export interface Metadata {
  packages: { id: string; name: string; targets: { name: string; kind: string[] }[] }[];
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null; target: string | null }[] }[] }[] };
  workspace_members: string[];
}

export function cargoMetadata(): Metadata {
  const run = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (run.error) throw Error(`cargo metadata: ${run.error.message}`);
  if (run.status !== 0) throw Error(`cargo metadata exited ${run.status}:\n${run.stderr}`);
  return JSON.parse(run.stdout) as Metadata;
}

/** The names of every package reachable from the package `id` over normal (not dev, not build) dependencies. */
export function normalClosure(meta: Metadata, id: string): Set<string> {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dep of nodes.get(next)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null || k.kind === 'normal')) queue.push(dep.pkg);
    }
  }
  seen.delete(id);
  return new Set([...seen].map((p) => byId.get(p)?.name ?? p));
}
