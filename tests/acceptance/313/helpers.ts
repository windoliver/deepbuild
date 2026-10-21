// Shared test-side tools for the issue #313 acceptance tests: fixture loading, JSON Pointer edits, refusal
// assertions, the kit and fill the tests drive, the enum walk, and the wrong programs the criteria name,
// built here as stand-ins so each test can show it fails them. None of them stands in for the conformance
// package or the contracts.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ContractError, ERROR_CODES, getSchema, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry, Validation } from '../../../packages/contracts/src/index.ts';
import type { Adapter, AdapterCaps, HookRequestLine } from '../../../packages/adapters/src/index.ts';
import { cleanFill, kits, proveFake, runKit } from '../../../packages/conformance/src/index.ts';
import type {
  Case, CaseResult, Closure, Fake, FakeProof, FamilyName, Fill, Harness, Kit, Operation, Report, Verdict,
} from '../../../packages/conformance/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const NODE = process.execPath;

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

// ---- The kit and the fills the tests drive -------------------------------------------------------

export const VERDICTS: readonly Verdict[] = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
export const RUN_OUTCOMES = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'] as const;
export const EXIT_CODES = ['0', '1', '2', '3'] as const;
export const FAMILIES: readonly FamilyName[] = ['verdict', 'run', 'refusal', 'check', 'doctor', 'exit'];
export const OPERATIONS: readonly Operation[] = ['startTurn', 'steer', 'followUp', 'interrupt', 'respond', 'history'];
export const FLAGS = [
  'holdStop', 'wakeIdle', 'steer', 'followUp', 'answerPermission', 'nativeTools', 'mcp', 'rewrite', 'editInput', 'errorTurnHook', 'startTurn',
] as const satisfies readonly (keyof AdapterCaps)[];
/** The five broken fakes the issue names, by the message each must fail the runner with. */
export const FIVE_MESSAGES = [
  'duplicate event ID', 'event after stop', 'answer delivered to another session', 'steer outlived interrupt', 'acknowledged with no transcript sign',
] as const;
/** The adapter rules, the design's phrases in the issue's order; each x-rules entry's text must contain its phrase. */
export const RULE_PHRASES = [
  'who is calling', 'order by `seq` with ties by ID', 'a clock stepped back', 'a late event in a stopped turn', 'unknown rather than finished',
  'threads across rotated IDs', 'one owner per session', 'allow only from `decision`', 'a stop that can\'t be parsed read as unknown',
  'delivery confirmed from the transcript',
] as const;
export const FACTS = 'adapter.facts@1';
export const SEED = 313;
export const RUNS = { numRuns: 1000, seed: SEED };

/** The shipped adapter kit, failing the test when it isn't among the kits. */
export function adapterKit(): Kit {
  const kit = kits().find((k) => k.name === 'adapter@1');
  expect(kit, 'kits() ships a kit named adapter@1').toBeDefined();
  return kit!;
}
export const clean = (kit: Kit = adapterKit()): Fill => cleanFill(kit);
/** A copy of a fill with parts of its adapter replaced (a Fill is plain data and closures, so it spreads). */
export const withAdapter = (fill: Fill, patch: Partial<Adapter>): Fill => ({ ...fill, adapter: { ...fill.adapter, ...patch } as Adapter });
export const run = (kit: Kit, fill: Fill): Report => runKit(kit, fill, { headless: true });
/** A kit variant: the same kit with some of its lists replaced. */
export const kitWith = (kit: Kit, patch: Partial<Kit>): Kit => ({ ...kit, ...patch });
export const fakeByMessage = (kit: Kit, message: string): Fake => {
  const fake = kit.fakes.find((f) => f.message === message);
  expect(fake, `the kit holds a broken fake whose message is "${message}" (it has: ${kit.fakes.map((f) => f.message).join(' | ')})`).toBeDefined();
  return fake!;
};
export const failing = (report: Report): CaseResult[] => report.cases.filter((c) => c.outcome === 'FAIL');
export const resultOf = (report: Report, id: string): CaseResult => {
  const result = report.cases.find((c) => c.id === id);
  expect(result, `the report has a result for case ${id} (it has: ${report.cases.map((c) => c.id).join(', ')})`).toBeDefined();
  return result!;
};
/** The one key a fake's `breaks` names, failing the test when it isn't exactly one. */
export function brokenItem(fake: Fake): { key: 'rule' | 'flag' | 'operation' | 'kind'; item: string } {
  const keys = Object.keys(fake.breaks).filter((k) => (fake.breaks as Record<string, unknown>)[k] !== undefined);
  expect(keys, `fake "${fake.name}" mishandles exactly one item`).toHaveLength(1);
  const key = keys[0] as 'rule' | 'flag' | 'operation' | 'kind';
  return { key, item: String(fake.breaks[key]) };
}
export const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** A case built by a test: what it declares and what it does. */
export const testCase = (id: string, declares: Partial<Case['declares']>, body: (h: Harness) => void, revision = adapterKit().revision): Case => ({
  id, revision, declares: { flags: [], operations: [], kinds: [], ...declares }, run: body,
});

/** The ULID the design's hook example uses, and a seq beside it. */
export const ULID = '01K74FKZVK8Q2X5R7M3N9P4T6W';
export const SEQ = '1760013451123456789';
/** A hook request line (hook.request@1) carrying the fill's agent's payload, as deep-hook would stamp it. */
export function line(fill: Fill, payload: JsonValue, overrides: Partial<HookRequestLine> = {}): HookRequestLine {
  const agent = isObject(fill.adapter.facts) && typeof fill.adapter.facts.agent === 'string' ? fill.adapter.facts.agent : 'fake';
  const event = isObject(payload) && typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'unknown';
  return { v: 1, agent, event, seq: SEQ, id: ULID, pid: 81234, ppid: 81200, matched: [], payload, ...overrides };
}

// ---- The adapter rules and the enums -------------------------------------------------------------

export interface Rule { id: string; rule: string }
/** adapter.facts@1's numbered rule list, read from the published schema. */
export function rules(): Rule[] {
  const list = getSchema(FACTS)['x-rules'];
  expect(Array.isArray(list), 'adapter.facts@1 carries x-rules, the adapter rules as one list').toBe(true);
  return (list as unknown as Rule[]).map((r) => ({ id: String(r.id), rule: String(r.rule) }));
}
export interface EnumNode { schema: string; pointer: string; values: JsonValue[]; closure: Closure | undefined }
/** Every node with an `enum` under a schema, with the closure beside it (x-closure), in document order. */
export function enumNodes(name: string, schema: Schema): EnumNode[] {
  const found: EnumNode[] = [];
  const walk = (node: JsonValue, pointer: string): void => {
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, pointer + segment(i)));
    else if (isObject(node)) {
      if (Array.isArray(node.enum)) found.push({ schema: name, pointer, values: node.enum, closure: node['x-closure'] as Closure | undefined });
      for (const [key, value] of Object.entries(node)) if (key !== 'enum') walk(value, pointer + segment(key));
    }
  };
  walk(schema, '');
  return found;
}
export const allEnums = (entries: readonly SchemaEntry[] = listSchemas()): EnumNode[] => entries.flatMap((e) => enumNodes(e.name, e.schema));
export const isClosed = (c: Closure | undefined): c is { closed: string; reopens: string; mark: 'exhaustive' | 'extensible' } => isObject(c as JsonValue) && 'closed' in (c as object);
/** The enum node a code family names, failing the test when the schema or the pointer doesn't lead to one. */
export function familyEnum(schema: string, pointer: string): EnumNode {
  const node = enumNodes(schema, getSchema(schema)).find((e) => e.pointer === pointer);
  expect(node, `${schema} has an enum at ${pointer}`).toBeDefined();
  return node!;
}
/** The published schemas with one of them replaced. */
export const replacing = (name: string, schema: Schema, entries: readonly SchemaEntry[] = listSchemas()): SchemaEntry[] =>
  entries.map((e) => (e.name === name ? { name, schema } : e));

// ---- Child processes ------------------------------------------------------------------------------

export interface Ran { status: number | null; stdout: string; stderr: string; out: string }
export function node(args: string[], options: { input?: string } = {}): Ran {
  const result = spawnSync(NODE, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(options.input === undefined ? {} : { input: options.input }) });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}\n${result.stderr}` };
}
/** Builds the workspaces once (tsc; a second run is incremental), so dist/ holds the CLI and the conformance bin. */
export function buildWorkspaces(): void {
  const built = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw Error(`npm run build --workspaces failed:\n${built.stdout}\n${built.stderr}`);
}

// ---- Wrong programs the criteria name, as stand-ins fed to this suite's own assertions -----------
// Each is the program its criterion says must fail the test. A test feeds it to the same assertion the real
// program gets and expects that assertion to throw, naming what the criterion says it must name.

/** AC3: a runner that checks only the shape of each reply. It never runs a case's own checks. */
export function shapeOnlyRunKit(kit: Kit, fill: Fill): Report {
  const cases: CaseResult[] = kit.cases.map((c) => {
    const codes: string[] = [];
    const messages: string[] = [];
    const checked = (name: string, value: unknown, where: string) => {
      const result = validate(name, value);
      if (!result.ok) for (const issue of result.issues) { codes.push(issue.code); messages.push(`${where}${issue.path}`); }
    };
    const payload: JsonValue = { hook_event_name: 'SessionStart', session_id: 'sess_01', source: 'startup' };
    try {
      for (const event of fill.adapter.mapHook(line(fill, payload), fill.version).events) checked('adapter.event@1', event, '/events/0');
    } catch (error) { codes.push('type'); messages.push(String(error)); }
    for (const operation of OPERATIONS) {
      const reply = fill.drive(operation, {}, 'sess_01');
      if (reply.outcome !== 'ok' && reply.outcome !== 'unsupported') { codes.push('union'); messages.push('/outcome'); }
    }
    return {
      id: c.id, outcome: codes.length ? 'FAIL' : 'PASS', message: messages.join('; '), codes, declared: c.declares, reached: c.declares, probes: [], killed: [], survived: [],
    };
  });
  return { verdict: cases.some((c) => c.outcome === 'FAIL') ? 'FAIL' : 'PASS', revision: fill.revision, cases };
}
/** AC6: a runner that counts INVALID and BLOCKED cases as passed. */
export function countingRunKit(kit: Kit, fill: Fill): Report {
  const report = run(kit, fill);
  const cases = report.cases.map((c) => (c.outcome === 'INVALID' || c.outcome === 'BLOCKED' ? { ...c, outcome: 'PASS' as Verdict } : c));
  return { ...report, verdict: cases.some((c) => c.outcome === 'FAIL') ? 'FAIL' : 'PASS', cases };
}
/** AC11: a runner that runs every case on every fill, whatever revision the fill declares. */
export const everyCaseRunKit = (kit: Kit, fill: Fill): Report => ({ ...run(kit, { ...fill, revision: Number.MAX_SAFE_INTEGER }), revision: fill.revision });
/** AC14: a runner that checks only that the expected codes are among those raised. */
export function subsetProveFake(kit: Kit, fake: Fake): FakeProof {
  const proof = proveFake(kit, fake);
  return { ...proof, killed: proof.missing.length === 0 };
}
/** AC15: a consumer that accepts a value off an enum's list. */
export function lenientValidate(name: string, value: unknown): Validation {
  const result = validate(name, value);
  if (result.ok) return result;
  const issues = result.issues.filter((i) => i.code !== 'enum');
  return issues.length ? { ok: false, issues } : { ok: true };
}
