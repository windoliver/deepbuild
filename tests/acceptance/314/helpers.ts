// Shared test-side tools for the issue #314 acceptance tests: fixture loading, JSON Pointer edits, refusal
// assertions, the manifest the tests edit, the slot kits and fills the tests drive, and the wrong programs the
// criteria name, built here as stand-ins so each test can show it fails them. None of them stands in for the
// conformance package or the contracts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  checkManifest, ContractError, ERROR_CODES, getSchema, listSchemas, registry, validate,
} from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry, Validation } from '../../../packages/contracts/src/index.ts';
import { cleanFills, runKit, slotKits } from '../../../packages/conformance/src/index.ts';
import type {
  CheckContext, CheckResult, CheckRunnerFill, CheckSpec, Fixture, PlantedFill, SlotCaseResult, SlotFill, SlotKit, SlotReport, SlotRunOptions,
  Verdict,
} from '../../../packages/conformance/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => structuredClone(v);
export const asJson = (v: unknown): JsonValue => v as JsonValue;

export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export const fixture = (...parts: string[]): JsonValue => readJson(join(FIXTURES, ...parts));
export const fixturePath = (...parts: string[]): string => join(FIXTURES, ...parts);

// ---- JSON Pointers -------------------------------------------------------------------------------

export function segments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw Error(`not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export const segment = (key: string | number): string => `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
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

// ---- Refusals in the one error shape -------------------------------------------------------------

/** Asserts a refusal that names `path`, with every issue in the shared error shape (error@1). */
export function expectRefused(result: Validation, path: string, why: string): void {
  expect(result.ok, `${why}: should be refused`).toBe(false);
  if (result.ok) return;
  expect(result.issues.map((i) => i.path), `${why}: the refusal names ${path}`).toContain(path);
  for (const issue of result.issues) {
    expect(ERROR_CODES, `${why}: code ${issue.code} is from the closed set`).toContain(issue.code);
    expect(typeof issue.retryable, `${why}: says whether a retry can help`).toBe('boolean');
    expect(issue.remediation.length, `${why}: names one remediation`).toBeGreaterThan(0);
    expect(typeof issue.actual, `${why}: carries the refused value`).toBe('string');
    expect(Array.isArray(issue.evidence), `${why}: carries evidence handles`).toBe(true);
  }
}
/** Asserts a refusal at `path` whose refused value (error@1's `actual`) is `word`: the refusal names the word. */
export function expectRefusedWord(result: Validation, path: string, word: string, why: string): void {
  expectRefused(result, path, why);
  if (result.ok) return;
  const at = result.issues.filter((i) => i.path === path);
  expect(at.map((i) => i.actual), `${why}: the refusal at ${path} names ${word}`).toContain(word);
}
export function expectAccepted(result: Validation, why: string): void {
  expect(result.ok, `${why}: should be accepted ${result.ok ? '' : JSON.stringify(result.issues)}`).toBe(true);
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

// ---- The manifest and the envelope ---------------------------------------------------------------

export const MANIFEST = 'extension.manifest@1';
export const ENVELOPE = 'package.envelope@1';
/** The access words, as technical-design.md's Access lists them (device:<class> is a pattern beside them). */
export const ACCESS_WORDS = ['files', 'programs', 'hosts', 'run_as_you', 'screen', 'sound', 'microphone', 'camera', 'clipboard', 'window', 'agent', 'edit_as_you', 'record'] as const;
/** The media a panel may use, each only with its access word. */
export const MEDIA = ['sound', 'microphone', 'camera'] as const;
/** The lists of names a plug-in adds, each under the ext.<plugin>. rule: event kinds, store kinds, check kinds, codes, notice kinds, actions. */
export const NAME_LISTS = ['events', 'stores', 'checks', 'codes', 'notices', 'actions'] as const;
/** The plug-in the fixture manifest is: the name part of its owner/name id. */
export const PLUGIN = 'stocks';
export const SEED = 314;
export const RUNS = { numRuns: 1000, seed: SEED };

/** The fixture manifest, a fresh copy each time. */
export const manifest = (): JsonObject => fixture('manifests', 'stocks.json') as JsonObject;
export const envelope = (): JsonObject => fixture('envelopes', 'stocks.json') as JsonObject;
/** The manifest contract: the schema and the rules its node types can't hold, in one Validation. */
export const check = (value: JsonValue): Validation => checkManifest(value);
/** The published schemas with one of them replaced. */
export const replacing = (name: string, schema: Schema, entries: readonly SchemaEntry[] = listSchemas()): SchemaEntry[] =>
  entries.map((e) => (e.name === name ? { name, schema } : e));
/** Every value under a schema that mentions `word` in an enum member or a pattern alternative, with `word` removed. */
export function withoutWord(schema: Schema, word: string): Schema {
  const walk = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObject(node)) return node;
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value)) out[key] = value.filter((v) => v !== word);
      else if (key === 'pattern' && typeof value === 'string') out[key] = value.replace(new RegExp(`\\|${word}(?=[|)])`, 'g'), '').replace(new RegExp(`\\(${word}\\|`, 'g'), '(');
      else out[key] = walk(value);
    }
    return out;
  };
  return walk(schema as JsonValue) as Schema;
}
/** Whether a schema mentions `word` anywhere in an enum or a pattern. */
export function mentions(schema: Schema, word: string): boolean {
  let found = false;
  const walk = (node: JsonValue): void => {
    if (found) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value) && value.includes(word)) found = true;
      else if (key === 'pattern' && typeof value === 'string' && value.includes(word)) found = true;
      else walk(value);
    }
  };
  walk(schema as JsonValue);
  return found;
}

// ---- The slot kits and the fills the tests drive -------------------------------------------------

export const VERDICTS: readonly Verdict[] = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
export const RUN_OUTCOMES = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'] as const;
export const CHECK_KIND = 'check.kind@1';
export const INDEX = 'index@1';
export const ENVIRONMENT = 'environment@1';
export const SOURCE = 'source@1';
export const READING_SOURCE = 'reading.source@1';
/** The slots whose kits this issue brings, with the fixtures and planted fills the core contracts bring. */
export const SLOTS = [CHECK_KIND, INDEX, ENVIRONMENT, SOURCE, READING_SOURCE] as const;
export const FILLS: Record<string, 'one' | 'many'> = { [CHECK_KIND]: 'one', [INDEX]: 'one', [ENVIRONMENT]: 'one', [SOURCE]: 'many', [READING_SOURCE]: 'many' };
/** The planted wrong fills the criteria name, by the name each kit lists them under (README, Readings). */
export const PLANTED: Record<string, readonly string[]> = {
  [CHECK_KIND]: ['crashed-suite', 'past-deadline', 'dropped-output', 'type-error-as-assertion'],
  [INDEX]: ['keeps-dropped-source', 'sourceless-hit'],
  [ENVIRONMENT]: ['ready-before-health', 'unleased-port'],
  [SOURCE]: ['skips-first-after-resume'],
  [READING_SOURCE]: ['cache-as-of', 'stale-mcp-digest'],
};
/** The check catalog's code each check.kind@1 planted runner raises (check.code@1). */
export const CHECK_PLANTED_CODES: Record<string, string> = {
  'crashed-suite': 'crashed_before_first_assertion', 'past-deadline': 'reported_after_deadline', 'dropped-output': 'output_dropped', 'type-error-as-assertion': 'type_error_as_assertion',
};
/** The six check.kind@1 fixture suites, by the word in each fixture's id. */
export const CHECK_FIXTURES = ['known-pass', 'known-fail', 'fail-elsewhere', 'ran-nothing', 'masked-exit', 'past-deadline'] as const;
export const EXPECTED_JSON = 'data/expected.json';

/** The shipped kit of a slot, failing the test when it isn't among the slot kits. */
export function slotKit<F extends SlotFill = SlotFill>(slot: string): SlotKit<F> {
  const kit = slotKits().find((k) => k.slot === slot);
  expect(kit, `slotKits() ships a kit for ${slot} (it has: ${slotKits().map((k) => k.slot).join(', ')})`).toBeDefined();
  return kit as SlotKit<F>;
}
/** The kit's reference fills, at least one. */
export function cleans<F extends SlotFill>(kit: SlotKit<F>): F[] {
  const fills = cleanFills(kit);
  expect(fills.length, `${kit.slot} has a reference fill`).toBeGreaterThan(0);
  return fills;
}
export const clean = <F extends SlotFill>(kit: SlotKit<F>): F => cleans(kit)[0]!;
export const run = <F extends SlotFill>(kit: SlotKit<F>, fill: F, options: SlotRunOptions = {}): Promise<SlotReport> => runKit(kit, fill, options);
/** A kit variant: the same kit with some of its lists replaced. */
export const kitWith = <F extends SlotFill>(kit: SlotKit<F>, patch: Partial<SlotKit<F>>): SlotKit<F> => ({ ...kit, ...patch });
export const planted = <F extends SlotFill>(kit: SlotKit<F>, name: string): PlantedFill<F> => {
  const found = kit.planted.find((p) => p.name === name);
  expect(found, `${kit.slot} plants a fill named "${name}" (it has: ${kit.planted.map((p) => p.name).join(', ')})`).toBeDefined();
  return found!;
};
export const failing = (report: SlotReport): SlotCaseResult[] => report.cases.filter((c) => c.outcome === 'FAIL');
export const part = (report: SlotReport, which: 'fixed' | 'seeded'): SlotCaseResult[] => report.cases.filter((c) => c.part === which);
export const notPassing = (cases: readonly SlotCaseResult[]): string[] => cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`);
export const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
/** A stable text for a JSON value, so two inputs compare as values. */
export const canonical = (value: unknown): string => {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : isObject(v as JsonValue) ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as JsonObject)[k])])) : v);
  try { return JSON.stringify(sort(value), (_, v: unknown) => (typeof v === 'function' ? '[function]' : typeof v === 'bigint' ? v.toString() : v)) ?? 'undefined'; } catch { return String(value); }
};

/** A check.kind@1 fixture's input: the check's spec, the folder it runs in and the time it may take. */
export interface CheckInput { spec: CheckSpec; checkout: string; deadline: number }
export const checkKit = (): SlotKit<CheckRunnerFill> => slotKit<CheckRunnerFill>(CHECK_KIND);
/** The check.kind@1 fixture whose id carries `word`, with its input read. */
export function checkFixture(kit: SlotKit<CheckRunnerFill>, word: string): Fixture & { input: CheckInput & JsonObject } {
  const found = kit.fixtures.find((f) => f.id.includes(word));
  expect(found, `${CHECK_KIND} ships a fixture whose id has "${word}" (it has: ${kit.fixtures.map((f) => f.id).join(', ')})`).toBeDefined();
  const input = found!.input;
  expect(isObject(input) && isObject(input.spec) && typeof input.checkout === 'string' && typeof input.deadline === 'number', `fixture ${found!.id}'s input is {spec, checkout, deadline}: ${JSON.stringify(input)}`).toBe(true);
  return found as Fixture & { input: CheckInput & JsonObject };
}
/** The context a fixture's run gets: its checkout and deadline, on the wall clock. */
export const contextFor = (input: CheckInput): CheckContext => ({ checkout: input.checkout, deadline: input.deadline, now: () => Date.now() });
export const runFixture = async (fill: CheckRunnerFill, f: { input: CheckInput }): Promise<CheckResult> => fill.run(f.input.spec, contextFor(f.input));

// ---- Wrong programs the criteria name, as stand-ins fed to this suite's own assertions -----------
// Each is the program its criterion says must fail the test. A test feeds it to the same assertion the real
// program gets and expects that assertion to throw, naming what the criterion says it must name.

/** AC1: a manifest schema that accepts unknown fields (its root open), through the contracts' own registry. */
export function openSchemaValidate(): (value: unknown) => Validation {
  const twin = setAt(getSchema(MANIFEST) as JsonValue, '/additionalProperties', true) as Schema;
  const twinRegistry = registry(replacing(MANIFEST, twin));
  return (value) => twinRegistry.validate(MANIFEST, value);
}
/** AC2: a manifest schema that leaves the microphone word out of its access words. */
export function withoutMicrophoneValidate(): (value: unknown) => Validation {
  const twin = withoutWord(getSchema(MANIFEST), 'microphone');
  const twinRegistry = registry(replacing(MANIFEST, twin));
  return (value) => twinRegistry.validate(MANIFEST, value);
}
/** The published validator, in the same shape as the twins above. */
export const publishedValidate = (value: unknown): Validation => validate(MANIFEST, value);

/** AC3: a kit that checks only each reply's shape: it keeps a FAIL only when every code it raised is a refusal of error@1 (a shape), and passes any other finding. */
export async function shapeOnlyRunKit<F extends SlotFill>(kit: SlotKit<F>, fill: F, options: SlotRunOptions = {}): Promise<SlotReport> {
  const report = await run(kit, fill, options);
  const shapeOnly = (c: SlotCaseResult): boolean => c.codes.length > 0 && c.codes.every((code) => ERROR_CODES.includes(code));
  const cases = report.cases.map((c) => (c.outcome === 'FAIL' && !shapeOnly(c) ? { ...c, outcome: 'PASS' as Verdict, message: '', codes: [] } : c));
  const verdict: Verdict = cases.some((c) => c.outcome === 'FAIL') ? 'FAIL' : cases.every((c) => c.outcome === 'PASS') ? 'PASS' : report.verdict;
  return { ...report, verdict, cases };
}

/** AC4: a check runner that records only the spec's declared paths as read, whatever the suite opened. */
export const declaredOnlyRunner = (base: CheckRunnerFill): CheckRunnerFill => ({
  ...base,
  run: async (spec, ctx) => ({ ...(await base.run(spec, ctx)), read: [...spec.inputs] }),
});

/**
 * AC6: a fill that returns the shipped fixtures' expected answers by their inputs. It is built from the kit's
 * reference fill by recording every call the fixed part makes (method, arguments and the answer, by occurrence),
 * and answers later calls from that record: a known input gets its recorded answer, an input it never saw gets the
 * first answer it recorded for that method. It never computes anything, so only the fixed part can suit it.
 */
export async function memorizingFill<F extends SlotFill>(kit: SlotKit<F>, base: F): Promise<F> {
  interface Call { method: string; args: string; result: unknown; promised: boolean }
  const recorded: Call[] = [];
  const methods = Object.keys(base).filter((key) => typeof (base as Record<string, unknown>)[key] === 'function');
  const recorder = { ...base } as Record<string, unknown>;
  for (const method of methods) {
    const original = (base as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;
    recorder[method] = (...args: unknown[]) => {
      const out = original(...args);
      const entry: Call = { method, args: canonical(args), result: undefined, promised: out instanceof Promise };
      recorded.push(entry);
      if (out instanceof Promise) return out.then((value) => { entry.result = value; return value; });
      entry.result = out;
      return out;
    };
  }
  await run(kit, recorder as F, { parts: ['fixed'] });
  const seen = new Map<string, number>();
  const memo = { ...base } as Record<string, unknown>;
  for (const method of methods) {
    memo[method] = (...args: unknown[]) => {
      const key = `${method}\n${canonical(args)}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const matches = recorded.filter((c) => c.method === method && c.args === canonical(args));
      const hit = matches[n] ?? matches[0] ?? recorded.find((c) => c.method === method);
      if (!hit) return undefined;
      return hit.promised ? Promise.resolve(hit.result) : hit.result;
    };
  }
  return memo as F;
}
