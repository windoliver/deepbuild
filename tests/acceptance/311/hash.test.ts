import { describe, expect, it } from 'vitest';
import { canonicalize, getSchema, lintSchemas, recordHash, sha256Hex } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema } from '../../../packages/contracts/src/index.ts';
import { clone, deleteAt, firstFixture, getAt, isObject, leaves, segments, setAt } from './helpers.ts';

const hashed = (properties: Record<string, JsonValue>): Schema => ({
  'x-hash': { excludes: [] },
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const NAME = 'planted.hashed@1';

describe('AC20 a hashed integer that can pass 2^53 is a decimal string', () => {
  it.each([
    ['seed', { type: 'integer', minimum: 0 }],
    ['bytes', { type: 'number', minimum: 0 }],
    ['seed', { type: 'integer', minimum: 0, maximum: 9007199254740992 }],
  ] as const)('AC20 a hashed schema typing %s as a JSON number (%j) fails the contract test, naming the field', (field, node) => {
    const schema = hashed({ name: { type: 'string' }, [field]: clone(node) as JsonValue });
    const problems = lintSchemas([{ name: NAME, schema }]);
    expect(problems.some((p) => p.schema === NAME && p.path === `/properties/${field}`), `${NAME} ${field}: ${JSON.stringify(problems)}`).toBe(true);
  });

  it.each([
    ['as a canonical decimal string', { type: 'string', pattern: '^(0|[1-9][0-9]*)$' }],
    ['as an integer that stays below 2^53', { type: 'integer', minimum: 0, maximum: 9007199254740991 }],
    ['as a small bounded integer', { type: 'integer', minimum: 0, maximum: 65535 }],
  ] as const)('AC20 its clean twin, the seed %s, passes', (_how, node) => {
    const schema = hashed({ name: { type: 'string' }, seed: clone(node) as JsonValue });
    expect(lintSchemas([{ name: NAME, schema }])).toEqual([]);
  });
});

describe('AC20 a verdict record\'s hash leaves out only the fields its schema lists', () => {
  const excludes = (): string[] => {
    const marker = getSchema('verdict@1')['x-hash'];
    const list = isObject(marker) ? marker.excludes : undefined;
    expect(Array.isArray(list) && list.length > 0, 'verdict@1 lists the display fields its hash leaves out').toBe(true);
    return (list as JsonValue[]).map(String);
  };
  /** The record without every excluded pointer ('*' stands for each array item), as the test reads the list. */
  function without(record: JsonValue, paths: string[]): JsonValue {
    let out = clone(record);
    for (const path of paths) {
      const expand = (at: string, rest: string[]): string[] => {
        if (!rest.length) return [at];
        const [head, ...tail] = rest;
        if (head === '*') {
          const arr = getAt(out, at);
          return Array.isArray(arr) ? arr.flatMap((_, i) => expand(`${at}/${i}`, tail)) : [];
        }
        return expand(`${at}/${head!.replace(/~/g, '~0').replace(/\//g, '~1')}`, tail);
      };
      for (const p of expand('', segments(path)).reverse()) if (getAt(out, p) !== undefined) out = deleteAt(out, p);
    }
    return out;
  }
  const isExcluded = (path: string, paths: string[]) => paths.some((ex) => {
    const a = segments(ex);
    const b = segments(path);
    return a.length <= b.length && a.every((s, i) => s === '*' || s === b[i]);
  });

  it('AC20 the hash is the SHA-256 of the RFC 8785 bytes of the record without its listed fields', () => {
    const record = firstFixture('verdict@1');
    expect(recordHash('verdict@1', record)).toBe(sha256Hex(canonicalize(without(record, excludes()))));
  });

  it('AC20 a changed local path (a listed display field) keeps the hash', () => {
    const record = firstFixture('verdict@1');
    const before = recordHash('verdict@1', record);
    const listed = leaves(record).filter((l) => isExcluded(l.path, excludes()));
    expect(listed.length, 'the verdict@1 fixture fills a field its hash leaves out').toBeGreaterThan(0);
    for (const { path, value } of listed) {
      const changed = setAt(record, path, typeof value === 'string' ? `${value}/moved/elsewhere` : 'moved');
      expect(recordHash('verdict@1', changed), `changing ${path}`).toBe(before);
    }
  });

  it('AC20 a changed outcome changes the hash, as does any field the schema does not list', () => {
    const record = firstFixture('verdict@1');
    const before = recordHash('verdict@1', record);
    const outcome = getAt(record, '/outcome');
    expect(['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE']).toContain(outcome);
    expect(recordHash('verdict@1', setAt(record, '/outcome', outcome === 'FAIL' ? 'PASS' : 'FAIL'))).not.toBe(before);
    for (const { path, value } of leaves(record).filter((l) => !isExcluded(l.path, excludes()))) {
      const next: JsonValue = typeof value === 'string' ? `${value}x` : typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : 'x';
      expect(recordHash('verdict@1', setAt(record, path, next)), `changing ${path} changes the hash`).not.toBe(before);
    }
  });
});
