// The Rust types refuse what the schemas refuse: each published schema's fixtures, and mutants of every value
// in them, decode in Rust exactly when the TypeScript validator accepts them.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixtures, listSchemas, validate } from '../src/index.js';
import type { JsonValue, Schema } from '../src/index.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-contracts');

beforeAll(() => {
  const build = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-contracts', '--bin', 'deep-contracts'], { cwd: REPO, encoding: 'utf8' });
  if (build.status !== 0) throw Error(`cargo build failed:\n${build.stderr}`);
}, 600_000);

/** Each verdict of the Rust types for the given values of a schema: true where they decode. */
function rustAccepts(name: string, values: JsonValue[]): boolean[] {
  const run = spawnSync(BIN, ['check', name], { input: `${values.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`deep-contracts check ${name} failed:\n${run.stderr}`);
  return run.stdout.trimEnd().split('\n').map((line) => line === 'ok');
}

/** The schema node a value at this place answers to, through refs, nullables and the branch its tag names. */
function nodeAt(root: Schema, schema: Schema, value: JsonValue): Schema {
  for (;;) {
    if (typeof schema.$ref === 'string') schema = (root.$defs as Record<string, Schema>)[schema.$ref.slice('#/$defs/'.length)]!;
    else if (Array.isArray(schema.oneOf)) {
      const branch = (schema.oneOf as Schema[]).find((b) => Object.entries(b.properties as Record<string, Schema>)
        .some(([key, s]) => 'const' in s && typeof value === 'object' && value !== null && !Array.isArray(value) && value[key] === s.const));
      if (!branch) return schema;
      schema = branch;
    } else return schema;
  }
}

const hasHalfPair = (text: string) => /\p{Surrogate}/u.test(text);
const sample = <T>(arb: fc.Arbitrary<T>, numRuns: number, seed: number): T[] => fc.sample(arb, { seed, numRuns });

/** Values to put where `value` is, for the schema node it answers to: near its bounds, past them, and other text. */
function replacements(schema: Schema, value: JsonValue, seed: number): JsonValue[] {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  const num = (key: string) => (typeof schema[key] === 'number' ? (schema[key] as number) : undefined);
  if (typeof value === 'string' && type === 'string') {
    const out = ['', 'x', `${value}!`, value.slice(1), ` ${value}`, value.toUpperCase(), '01K74FKZVK8Q2X5R7M3N9P4T6W', '9223372036854775808', 'A'.repeat(8193)];
    for (const key of ['minLength', 'maxLength']) {
      const n = num(key);
      if (n !== undefined && n < 10_000) out.push('a'.repeat(n), 'a'.repeat(n + 1), 'a'.repeat(Math.max(0, n - 1)));
    }
    if (typeof schema.pattern === 'string') {
      const matching = fc.stringMatching(new RegExp(schema.pattern, 'u'));
      out.push(...sample(matching, 8, seed));
      out.push(...sample(matching.chain((s) => fc.tuple(fc.constant(s), fc.nat(s.length), fc.string({ maxLength: 2, unit: 'binary' })))
        .map(([s, i, inserted]) => s.slice(0, i) + inserted + s.slice(i + 1)), 8, seed + 1));
    }
    out.push(...sample(fc.string({ maxLength: 12, unit: 'binary' }), 3, seed + 2));
    return out.filter((s) => !hasHalfPair(s));
  }
  if (typeof value === 'number') {
    const out = [-1, 0, 1, 0.5, 2 ** 53, -(2 ** 53), 1e300, value + 1, value - 1];
    for (const key of ['minimum', 'maximum']) {
      const n = num(key);
      if (n !== undefined) out.push(n, n - 1, n + 1, n - 0.5, n + 0.5);
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [[], value.slice(0, -1), [...value, ...value]];
    const min = num('minItems');
    if (min !== undefined && value.length) out.push(Array.from({ length: Math.max(0, min - 1) }, () => value[0]!));
    return out;
  }
  if (value !== null && typeof value === 'object' && type === 'object' && !schema.properties) {
    const [first] = Object.values(value);
    return first === undefined ? [] : [{ ...value, 'Not A Key': first }, { ...value, '': first }];
  }
  return [];
}

/** Every value under a fixture with the schema node it answers to, and a setter that rebuilds the fixture. */
function places(root: Schema, schema: Schema, value: JsonValue, set: (v: JsonValue) => JsonValue): { schema: Schema; value: JsonValue; set: (v: JsonValue) => JsonValue }[] {
  const node = nodeAt(root, schema, value);
  const out = [{ schema: node, value, set }];
  if (Array.isArray(value) && node.items) {
    value.forEach((item, i) => out.push(...places(root, node.items as Schema, item, (v) => set(value.map((x, j) => (j === i ? v : x))))));
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      const child = node.properties ? (node.properties as Record<string, Schema>)[key] : (node.additionalProperties as Schema | undefined);
      if (child) out.push(...places(root, child, item, (v) => set({ ...value, [key]: v })));
    }
  }
  return out;
}

describe('the Rust types refuse what the schemas refuse', () => {
  const patternsSeen = new Map<string, { accepted: number; refused: number }>();

  it.each(listSchemas().map((e) => [e.name, e.schema] as const))('%s: each fixture and its mutants decode in Rust exactly when they validate', (name, schema) => {
    const cases: JsonValue[] = [];
    const patterns: (string | undefined)[] = [];
    fixtures(name).forEach((fixture, f) => {
      cases.push(fixture);
      patterns.push(undefined);
      places(schema, schema, fixture, (v) => v).forEach((place, p) => {
        for (const replacement of replacements(place.schema, place.value, 311 + f * 1000 + p)) {
          cases.push(place.set(replacement));
          patterns.push(typeof place.schema.pattern === 'string' ? place.schema.pattern : undefined);
        }
      });
    });
    const rust = rustAccepts(name, cases);
    const wrong = cases.flatMap((value, i) => {
      const ts = validate(name, value).ok;
      const pattern = patterns[i];
      if (pattern) {
        const seen = patternsSeen.get(pattern) ?? { accepted: 0, refused: 0 };
        seen[ts ? 'accepted' : 'refused']++;
        patternsSeen.set(pattern, seen);
      }
      return rust[i] === ts ? [] : [`${ts ? 'TypeScript accepts' : 'TypeScript refuses'}, Rust ${rust[i] ? 'accepts' : 'refuses'}: ${JSON.stringify(value).slice(0, 300)}`];
    });
    expect(rust).toHaveLength(cases.length);
    expect(wrong.slice(0, 5), `${wrong.length} of ${cases.length} cases disagree`).toEqual([]);
  }, 120_000);

  it('every published pattern was matched and refused in some field', () => {
    const published = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) {
        if (key === 'pattern' && typeof child === 'string') published.add(child);
        else if (key !== 'enum' && key !== 'propertyNames') walk(child);
      }
    };
    for (const { schema } of listSchemas()) walk(schema);
    const unexercised = [...published].filter((p) => !(patternsSeen.get(p)?.accepted && patternsSeen.get(p)?.refused));
    expect(unexercised).toEqual([]);
  });
});
