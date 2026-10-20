// Regressions the acceptance suite doesn't reach: schemas the lint must refuse because the validator or a
// generator can't serve them, and refusals that must stay in the one error shape.
import { describe, expect, it } from 'vitest';
import { contextBoundFor, encode, fixtures, generateRust, generateTypeScript, joinHookReplies, lintSchemas, registry, validate } from '../src/index.js';
import type { Schema } from '../src/index.js';

const record = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const tagged = (tag: unknown, extra: Record<string, Schema>): Schema => record({ t: { const: tag as string }, ...extra });
const problemsOf = (schema: Schema) => lintSchemas([{ name: 'planted@1', schema }]);

describe('the lint refuses schemas the validator or a generator cannot serve', () => {
  it('a $ref cycle', () => {
    const schema: Schema = { $defs: { node: record({ next: { $ref: '#/$defs/node' } }, []) }, $ref: '#/$defs/node' };
    expect(problemsOf(schema).map((p) => p.reason).join()).toMatch(/cycle/);
  });

  it('a union whose tags repeat, or are not strings', () => {
    expect(problemsOf({ oneOf: [tagged('a', { x: { type: 'string' } }), tagged('a', { x: { type: 'integer' } })] }).length).toBeGreaterThan(0);
    expect(problemsOf({ oneOf: [tagged(1, {}), tagged(2, {})] }).length).toBeGreaterThan(0);
  });

  it('a pattern that does not compile as a Unicode regular expression', () => {
    expect(problemsOf(record({ a: { type: 'string', pattern: '^[\\w-.]+$' } }))).toEqual([expect.objectContaining({ path: '/properties/a/pattern' })]);
  });

  it('an opaque value in a hashed schema, and an x-hash exclude that names no field', () => {
    expect(problemsOf({ 'x-hash': { excludes: [] }, ...record({ a: { 'x-opaque': 'any' } }) }).length).toBeGreaterThan(0);
    expect(problemsOf({ 'x-hash': { excludes: ['/checkuot'] }, ...record({ checkout: { type: 'string' } }) })).toEqual([expect.objectContaining({ path: '/x-hash' })]);
  });

  it('a hashed integer that can fall below -(2^53 - 1), repeated enum values, a negative length, and an enum beside null', () => {
    expect(problemsOf({ 'x-hash': { excludes: [] }, ...record({ a: { type: 'integer', minimum: -1e20, maximum: 10 } }) }).length).toBeGreaterThan(0);
    expect(problemsOf(record({ a: { type: 'string', enum: ['x', 'x'] } })).length).toBeGreaterThan(0);
    expect(problemsOf(record({ a: { type: 'string', minLength: -1 } })).length).toBeGreaterThan(0);
    expect(problemsOf(record({ a: { type: ['string', 'null'], enum: ['x'] } as unknown as Schema })).length).toBeGreaterThan(0);
  });
});

describe('the generators refuse names that would collide', () => {
  it('two schemas with one type name', () => {
    const entries = [{ name: 'run.started@1', schema: record({ a: { type: 'string' } }) }, { name: 'run_started@1', schema: record({ b: { type: 'string' } }) }];
    expect(() => generateTypeScript(entries)).toThrow(/run_started@1/);
    expect(() => generateRust(entries)).toThrow(/run_started@1/);
  });

  it('two properties with one Rust field, and enum values with one variant', () => {
    expect(() => generateRust([{ name: 'a@1', schema: record({ 'a-b': { type: 'string' }, a_b: { type: 'string' } }) }])).toThrow(/a_b/);
    const rust = generateRust([{ name: 'e@1', schema: record({ self: { type: 'string', enum: ['1-0', '1_0', 'self'] } }) }]);
    expect(rust).not.toMatch(/r#self|\b102\b|^\s+Self,$/m);
  });
});

describe('seq and the one error shape', () => {
  const union: Schema = record({ u: { oneOf: [tagged('a', { at: { type: 'string', format: 'seq' } }), tagged('b', { at: { type: 'string' } })] } });
  const reg = registry([{ name: 'u@1', schema: union }]);

  it("a seq in one branch of a union leaves another branch's field alone", () => {
    expect(reg.decode<{ u: { at: unknown } }>('u@1', '{"u":{"t":"b","at":"42"}}').u.at).toBe('42');
    expect(reg.decode<{ u: { at: unknown } }>('u@1', '{"u":{"t":"a","at":"42"}}').u.at).toBe(42n);
  });

  it('a refused value holding a bigint, or a cycle, is still refused in the error shape', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [[1n], { n: 1n }, cyclic]) expect(validate('hook.ack@1', value).ok).toBe(false);
  });

  it('a value cut at the read cap never ends in half a surrogate pair', () => {
    const result = validate('hook.ack@1', { ack: `a${'\u{1F600}'.repeat(5000)}`, hold_until_ms: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.actual).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('an opaque value that is not JSON is refused, not thrown at encode', () => {
    const request = { v: 1, agent: 'a', event: 'e', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [] };
    for (const payload of [Number.NaN, Infinity, { a: undefined }, 1n]) {
      expect(validate('hook.request@1', { ...request, payload }).ok, String(payload)).toBe(false);
      expect(() => encode('hook.request@1', { ...request, payload })).toThrow(expect.objectContaining({ name: 'ContractError' }));
    }
  });
});

it('a join with a bound below zero keeps no context', () => {
  expect(joinHookReplies([{ extension: 'a', firstParty: true, context: ['hello world'] }], -3).context).toEqual([]);
});

describe('names Object.prototype holds are not listed names', () => {
  it('a format, a type, a required name or an x-hash exclude the schema does not list', () => {
    for (const format of ['toString', 'constructor', '__proto__', 'valueOf']) {
      expect(problemsOf(record({ a: { type: 'string', format } })).length, format).toBeGreaterThan(0);
    }
    for (const type of ['toString', 'constructor', '__proto__']) {
      expect(problemsOf(record({ a: { type } })).length, type).toBeGreaterThan(0);
    }
    expect(problemsOf({ type: 'object', properties: { a: { type: 'string' } }, required: ['toString'], additionalProperties: false }).length).toBeGreaterThan(0);
    const hashed = { 'x-hash': { excludes: ['/__proto__'] }, ...record({ a: { type: 'string' } }) };
    expect(problemsOf(hashed)).toEqual([expect.objectContaining({ path: '/x-hash' })]);
  });

  it('a value checked against an unlisted format is refused in the error shape, never thrown', () => {
    const reg = registry([{ name: 'f@1', schema: record({ a: { type: 'string', format: '__proto__' } }) }]);
    expect(reg.validate('f@1', { a: 'x' }).ok).toBe(false);
  });
});

it("a union is told apart by its required tag, not by another constant every branch shares", () => {
  const branch = (kind: string, extra: Record<string, Schema>): Schema =>
    ({ type: 'object', properties: { v: { const: 1 }, kind: { const: kind }, ...extra }, required: ['kind', ...Object.keys(extra)], additionalProperties: false });
  const reg = registry([{ name: 'u@1', schema: { oneOf: [branch('a', { x: { type: 'string' } }), branch('b', { y: { type: 'integer' } })] } }]);
  expect(reg.validate('u@1', { kind: 'a', x: 's' })).toEqual({ ok: true });
  expect(reg.validate('u@1', { v: 1, kind: 'b', y: 2 })).toEqual({ ok: true });
});

it('an opaque value with a hole, or an object JSON does not carry, is refused', () => {
  const request = { v: 1, agent: 'a', event: 'e', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [] };
  // eslint-disable-next-line no-sparse-arrays
  for (const payload of [{ a: [, 2] }, new Map(), new Date(0)]) {
    expect(validate('hook.request@1', { ...request, payload }).ok).toBe(false);
  }
});

describe('the join counts characters, as the schema bounds them', () => {
  it('never cuts a character in half, and keeps a block that fits in characters', () => {
    expect(joinHookReplies([{ extension: 'a', firstParty: true, context: ['😀😀'] }], 3).context).toEqual([{ extension: 'a', text: '😀😀' }]);
    expect(joinHookReplies([{ extension: 'a', firstParty: true, context: ['😀😀😀'] }], 2).context).toEqual([{ extension: 'a', text: '😀😀' }]);
  });

  it('a reply the join or contextBoundFor gives is one its schema accepts', () => {
    for (const ms of [0, 1, 1e14, 1e308, Infinity, Number.NaN, -5]) {
      const bound = contextBoundFor(ms);
      expect(validate('hook.joined@1', joinHookReplies([], bound)).ok, String(ms)).toBe(true);
    }
    for (const bound of [-1, 2.5, Number.NaN, Infinity]) expect(validate('hook.joined@1', joinHookReplies([], bound)).ok, String(bound)).toBe(true);
    expect(contextBoundFor(1e308)).toBeGreaterThanOrEqual(contextBoundFor(1e14));
  });
});

it('a fixture name that leaves the fixtures folder reads nothing', () => {
  expect(fixtures('..')).toEqual([]);
  expect(fixtures('.')).toEqual([]);
});

it('an integer is one both languages hold exactly: within ±(2^53 - 1)', () => {
  const reg = registry([{ name: 'i@1', schema: record({ n: { type: 'integer' } }) }]);
  for (const n of [0, -9007199254740991, 9007199254740991]) expect(reg.validate('i@1', { n }).ok, String(n)).toBe(true);
  for (const n of [9007199254740992, -9007199254740992, 1e21]) expect(reg.validate('i@1', { n }).ok, String(n)).toBe(false);
});

it('a schema string holding half a surrogate pair, which no Rust literal can, is refused', () => {
  expect(problemsOf(record({ e: { type: 'string', enum: ['\ud800'] } })).length).toBeGreaterThan(0);
  expect(problemsOf(record({ '\udc00': { type: 'string' } })).length).toBeGreaterThan(0);
  expect(problemsOf(record({ e: { const: 'a\ud83d' } })).length).toBeGreaterThan(0);
});
