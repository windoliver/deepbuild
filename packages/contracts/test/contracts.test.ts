// Regressions the acceptance suite doesn't reach: schemas the lint must refuse because the validator or a
// generator can't serve them, and refusals that must stay in the one error shape.
import { describe, expect, it } from 'vitest';
import { canonicalize, contextBoundFor, decode, encode, fixtures, generateRust, generateTypeScript, joinHookReplies, lintSchemas, parseHandle, recordHash, registry, sha256Hex, validate } from '../src/index.js';
import type { JsonValue, Schema } from '../src/index.js';

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

  it('a pattern JavaScript compiles but the Rust matcher cannot run, in a field or as a map key', () => {
    for (const pattern of ['^a(?=b)$', '^(a)\\1$', '^a|b$', 'a', '^a*?$', '^.$', '^\\bx$', '^[\\d-z]$']) {
      expect(problemsOf(record({ a: { type: 'string', pattern } })), pattern).toEqual([expect.objectContaining({ path: '/properties/a/pattern' })]);
      expect(problemsOf(record({ m: { type: 'object', propertyNames: { pattern }, additionalProperties: { type: 'string' } } })), pattern)
        .toEqual([expect.objectContaining({ path: '/properties/m/propertyNames' })]);
    }
    expect(problemsOf(record({ a: { type: 'string', pattern: '^(x|y[0-9]{1,3})+[^\\s]*$' } }))).toEqual([]);
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
    for (const line of ['"1-0" => Ok(Self::V10)', '"1_0" => Ok(Self::V102)', '"self" => Ok(Self::Self_)', 'pub self_: ESelf']) expect(rust).toContain(line);
    expect(rust).not.toMatch(/r#self|^\s+Self,$/m);
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

describe('one JSON both languages accept', () => {
  const reply = { exit: 0, stdout: '', stderr: '' };
  const nest = (n: number): unknown => (n === 0 ? 1 : { a: nest(n - 1) });

  it('refuses half a surrogate pair, a hole, a Map, a Date, NaN and undefined, in validate and canonicalize alike', () => {
    // eslint-disable-next-line no-sparse-arrays
    for (const bad of ['\ud800', [, 1], new Map(), new Date(0), Number.NaN, undefined]) {
      expect(validate('hook.reply@1', { ...reply, stdout: bad }).ok, String(bad)).toBe(false);
      expect(() => canonicalize(bad as never), String(bad)).toThrow(expect.objectContaining({ name: 'ContractError' }));
    }
    expect(() => decode('hook.reply@1', '{"exit":0,"stdout":"\\ud800","stderr":""}')).toThrow(expect.objectContaining({ name: 'ContractError' }));
  });

  it('counts nesting from the document root, as the Rust parser does', () => {
    const request = { v: 1, agent: 'a', event: 'e', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [] };
    expect(validate('hook.request@1', { ...request, payload: nest(254) }).ok).toBe(true);
    expect(validate('hook.request@1', { ...request, payload: nest(256) }).ok).toBe(false);
  });

  it('a value whose getter throws is refused, not thrown', () => {
    const value = { ...reply, get stdout(): string { throw Error('getter'); } };
    expect(validate('hook.reply@1', value).ok).toBe(false);
  });
});

describe('the error shape', () => {
  it('a ContractError is exactly an error@1', () => {
    let error: unknown;
    try { decode('hook.ack@1', '1'); } catch (thrown) { error = thrown; }
    expect(error).toMatchObject({ name: 'ContractError' });
    expect(Object.keys(error as object).sort()).toEqual(['actual', 'code', 'evidence', 'path', 'remediation', 'retryable']);
    expect(validate('error@1', JSON.parse(JSON.stringify(error))).ok).toBe(true);
  });

  it('a value under the read cap is kept whole, with half a surrogate pair shown as U+FFFD, never dropped', () => {
    expect(() => parseHandle('ab\ud800')).toThrow(expect.objectContaining({ code: 'handle_syntax', actual: 'ab\ufffd' }));
    expect(() => parseHandle('a\ud800x\ud800')).toThrow(expect.objectContaining({ code: 'handle_syntax', actual: 'a\ufffdx\ufffd' }));
  });
});

describe('the generators refuse type names that are not identifiers, and escape a union tag', () => {
  it('names', () => {
    for (const name of ['9x@1', 'self@1', '-@1']) {
      const entries = [{ name, schema: { type: 'boolean' } as Schema }];
      expect(() => generateTypeScript(entries), name).toThrow(new RegExp(name.replace(/[-]/g, '\\-')));
      expect(() => generateRust(entries), name).toThrow();
    }
  });

  it('a tag with braces or quotes stays inside its Rust string', () => {
    const rust = generateRust([{ name: 'u@1', schema: { oneOf: [tagged('a', {}), tagged('b', {})].map((b) => ({ ...b, properties: { 'k{x}"': (b.properties as Schema).t!, }, required: ['k{x}"'] })) } }]);
    expect(rust).toContain('format!("{at}{}: {other} is not a listed tag", "/k{x}\\"")');
    expect(rust).not.toMatch(/format!\("[^"]*k\{x\}/);
  });
});

describe('a value that cannot be read as JSON is refused in the error shape everywhere', () => {
  const request = { v: 1, agent: 'a', event: 'e', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [], payload: {} };
  const contractError = expect.objectContaining({ name: 'ContractError', code: 'not_json' });

  it('a cyclic or unreadable object with no prototype', () => {
    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic.self = cyclic;
    const unreadable = Object.create(null, { a: { enumerable: true, get() { throw Error('boom'); } } }) as unknown;
    for (const value of [cyclic, unreadable]) {
      expect(validate('hook.request@1', value).ok).toBe(false);
      expect(() => encode('hook.request@1', value)).toThrow(contractError);
      expect(() => canonicalize(value as never)).toThrow(contractError);
    }
  });

  it('a getter or proxy that throws when it is read', () => {
    const proxy = new Proxy({}, { ownKeys() { throw Error('boom'); } });
    const getter = { ...request, get seq(): string { throw Error('boom'); } };
    for (const value of [proxy, getter]) expect(() => encode('hook.request@1', value)).toThrow(contractError);
    expect(() => canonicalize({ get a(): number { throw Error('boom'); } } as never)).toThrow(contractError);
  });

  it('a getter is read once, so one that would throw on a second read never does', () => {
    let reads = 0;
    const second = { ...request, get pid() { if (reads++) throw Error('second'); return 1; } };
    expect(validate('hook.request@1', second).ok).toBe(true);
    expect(reads).toBe(1);
  });

  it('a record hash over a function or a symbol', () => {
    for (const a of [() => 1, Symbol('x')]) expect(() => recordHash('verdict@1', { a } as never)).toThrow(contractError);
  });
});

it('the generators refuse a type name the generated code already uses', () => {
  for (const name of ['value@1', 'contract@1', 'string@1', 'vec@1', 'option@1', 'seq@1', 'array@1']) {
    const entries = [{ name, schema: record({ a: { type: 'string' } }) }];
    expect(() => generateRust(entries), name).toThrow(new RegExp(name));
    expect(() => generateTypeScript(entries), name).toThrow(new RegExp(name));
  }
  // A nested type never takes such a name either.
  expect(generateRust([{ name: 'str@1', schema: record({ ing: { type: 'object', properties: {}, required: [], additionalProperties: false } }) }])).not.toMatch(/pub struct String\b/);
});

describe('the fifth review', () => {
  const request = { v: 1, agent: 'a', event: 'e', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [], payload: {} };

  it('a revoked proxy is refused in the error shape', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(validate('hook.request@1', proxy).ok).toBe(false);
    expect(() => encode('hook.request@1', proxy)).toThrow(expect.objectContaining({ name: 'ContractError' }));
    expect(() => canonicalize(proxy as never)).toThrow(expect.objectContaining({ name: 'ContractError' }));
  });

  it('a nullable record at the root or in $defs generates Rust', () => {
    const rec: Schema = { type: ['object', 'null'], properties: { a: { type: 'boolean' } }, required: [], additionalProperties: false } as unknown as Schema;
    expect(lintSchemas([{ name: 'root@1', schema: rec }])).toEqual([]);
    expect(generateRust([{ name: 'root@1', schema: rec }])).toMatch(/pub type Root = Option<RootValue>;/);
    expect(() => generateRust([{ name: 'def@1', schema: { $defs: { maybe: rec }, ...record({ m: { $ref: '#/$defs/maybe' } }) } }])).not.toThrow();
  });

  it("a schema name never closes the generated doc comment", () => {
    const ts = generateTypeScript([{ name: 'a*/b@1', schema: { type: 'string' } }]);
    expect(ts).toContain('/** a*\\/b@1 */');
    expect(ts).not.toContain('a*/b');
  });

  it("an error's path is well-formed Unicode, so the error is an error@1", () => {
    try {
      decode('hook.request@1', JSON.stringify({ ...request, payload: { '\ud800': 1 } }));
      expect.unreachable();
    } catch (error) {
      expect(validate('error@1', JSON.parse(JSON.stringify(error))).ok).toBe(true);
    }
  });

  it('encode refuses an object that is not plain, with or without a seq', () => {
    class Event { constructor(fields: object) { Object.assign(this, fields); } }
    expect(() => encode('hook.request@1', new Event(request))).toThrow(expect.objectContaining({ code: 'not_json' }));
    expect(() => encode('hook.request@1', Object.assign(new Date(0), request))).toThrow(expect.objectContaining({ code: 'not_json' }));
  });
});

it('a string length counts code points, whatever shortcut decides it', () => {
  const reg = registry([
    { name: 'min@1', schema: record({ s: { type: 'string', minLength: 2 } }) },
    { name: 'max@1', schema: record({ s: { type: 'string', maxLength: 1 } }) },
  ]);
  expect(reg.validate('min@1', { s: '😀' }).ok).toBe(false);
  expect(reg.validate('min@1', { s: '😀😀' }).ok).toBe(true);
  expect(reg.validate('max@1', { s: '😀' }).ok).toBe(true);
  expect(reg.validate('max@1', { s: 'ab' }).ok).toBe(false);
});

it('an x-hash exclude resolves through a union, in every branch', () => {
  const branch = (tag: string, extra: Record<string, Schema>) => tagged(tag, { checkout: { type: 'string' }, ...extra });
  const hashed = { 'x-hash': { excludes: ['/checkout'] }, oneOf: [branch('a', {}), branch('b', {})] };
  expect(problemsOf(hashed)).toEqual([]);
  const missing = { 'x-hash': { excludes: ['/checkout'] }, oneOf: [branch('a', {}), tagged('b', {})] };
  expect(problemsOf(missing)).toEqual([expect.objectContaining({ path: '/x-hash' })]);
});

it('a PASS verdict record has no requirement short of PASS', () => {
  const verdict = fixtures('verdict@1')[0] as { outcome: string; requirements: { outcome: string }[] };
  const pass = { ...verdict, outcome: 'PASS', requirements: verdict.requirements.map((r) => ({ ...r, outcome: 'PASS' })) };
  expect(validate('verdict@1', pass).ok).toBe(true);
  for (const outcome of ['pending', 'FAIL']) {
    expect(validate('verdict@1', { ...pass, requirements: pass.requirements.map((r) => ({ ...r, outcome })) }).ok, outcome).toBe(false);
  }
});

it("canonical text reads an array by its indices, never through the array's own map or join", () => {
  const own: JsonValue[] = [1, 2];
  Object.defineProperty(own, 'map', { value: () => ['"forged"'] });
  class Joined extends Array<JsonValue> { override join() { return '"x":1'; } }
  const bare = [1];
  Object.setPrototypeOf(bare, null);
  for (const value of [own, Joined.from([1, 2]), bare]) expect(new TextDecoder().decode(canonicalize(value as JsonValue))).toBe(`[${[...Array.prototype.values.call(value)].join(',')}]`);
});

// The hash AC20 defines: the SHA-256 of the RFC 8785 bytes, without the checkout verdict@1 leaves out.
const verdictHash = (record: Record<string, unknown>): string => {
  const { checkout: _checkout, ...hashed } = record;
  return sha256Hex(canonicalize(hashed as JsonValue));
};

it('a record hash over what canonicalize accepts is a hash, not a clone error', () => {
  const record = fixtures('verdict@1')[0] as JsonValue;
  expect(recordHash('verdict@1', record)).toBe(verdictHash(record as Record<string, unknown>));
  const extra = Object.assign(structuredClone(record) as Record<string, unknown>, {});
  (extra.reasons as unknown as { note: unknown }).note = () => 1;
  expect(recordHash('verdict@1', extra as JsonValue)).toBe(recordHash('verdict@1', record));
  expect(recordHash('verdict@1', new Proxy(structuredClone(record) as object, {}) as JsonValue)).toBe(recordHash('verdict@1', record));
});

describe('a value is read once, so what is checked is what is written or hashed', () => {
  // A field that reads as `first` the first `times` reads, then as `then`.
  const flipping = (key: string, first: unknown, then: unknown, times = 1) => {
    const record = structuredClone(fixtures('verdict@1')[0]) as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(record, key, { enumerable: true, get: () => (reads++ < times ? first : then) });
    return record as JsonValue;
  };

  it('canonical text and a record hash never take a second, different read', () => {
    const fixture = structuredClone(fixtures('verdict@1')[0]) as Record<string, unknown>;
    const text = new TextDecoder().decode(canonicalize(flipping('checkout', 'x', undefined)));
    expect(text).toBe(new TextDecoder().decode(canonicalize({ ...fixture, checkout: 'x' } as JsonValue)));
    expect(recordHash('verdict@1', flipping('checkout', 'x', undefined))).toBe(verdictHash(fixture));
  });

  it('encode writes only the value it validated', () => {
    // The fixture is a FAIL verdict; its outcome reads FAIL for the first `times` reads, then PASS.
    for (const times of [1, 2, 3, 4]) {
      const out = JSON.parse(encode('verdict@1', flipping('outcome', 'FAIL', 'PASS', times))) as { outcome: string };
      expect(out.outcome, `after ${times} reads`).toBe('FAIL');
      expect(validate('verdict@1', out).ok, `after ${times} reads`).toBe(true);
    }
  });
});

it('every verdict outcome has a fixture', () => {
  expect(new Set(fixtures('verdict@1').map((f) => (f as { outcome: string }).outcome))).toEqual(new Set(['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE']));
});

it("encode reads a seq array by its indices, never through the array's own map", () => {
  const reg = registry([{ name: 's@1', schema: record({ s: { type: 'array', items: { type: 'string', format: 'seq' } } }) }]);
  const own: unknown[] = [1n];
  Object.defineProperty(own, 'map', { value: () => ['2'] });
  class Mapped extends Array<unknown> { override map<U>(): U[] { return ['2'] as U[]; } }
  for (const s of [own, Mapped.from([1n])]) expect(reg.encode('s@1', { s })).toBe('{"s":["1"]}');
});
