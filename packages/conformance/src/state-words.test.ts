// A state list holds the words its own schema publishes and no others (#2146): a word another list holds, `none` on a
// verdict list, or a new list of state words is named by the code-mappings check, as any unmapped code is.
import { expect, it } from 'vitest';
import { listSchemas } from '@deepbuild/contracts';
import type { JsonValue, SchemaEntry } from '@deepbuild/contracts';
import { unmappedCodes } from '@deepbuild/conformance';

/** The published schemas, with `word` added to every list of `schema` that holds PASS. */
function widened(schema: string, word: string): SchemaEntry[] {
  let lists = 0;
  const add = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) return node.map(add);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(node)) out[key] = key === 'enum' && Array.isArray(child) && child.includes('PASS') ? (lists += 1, [...child, word]) : add(child);
    return out;
  };
  const entries = listSchemas().map((e) => (e.name === schema ? { ...e, schema: add(e.schema as JsonValue) as SchemaEntry['schema'] } : e));
  expect(lists, `${schema} has a list that holds PASS`).toBeGreaterThan(0);
  return entries;
}

it('names nothing over the published schemas', () => {
  expect(unmappedCodes()).toEqual([]);
});

it.each([
  ['row.set@4', 'context full', 'an attempt cause on a row\'s word list'],
  ['work.attempt@1', 'queued', 'a row\'s word on an attempt\'s cause list'],
  ['schedule.run@1', 'none', 'none on a verdict list that never held it'],
  ['verdict.made@2', 'none', 'none on a requirement\'s outcome'],
  ['verdict.made@2', 'queued', 'a state word on a verdict list'],
  ['landing.made@1', 'stale', 'a state word on the list that holds the five verdicts or none'],
])('names a word added to %s that its list never held: %s (%s)', (schema, word) => {
  expect(unmappedCodes(widened(schema, word))).toEqual([{ family: 'verdict', code: word }]);
});

it('names the state word of a new list that holds PASS without FAIL', () => {
  const template = listSchemas().find((e) => e.name === 'verdict.outcome@1')!;
  const planted = { ...template, name: 'planted.state@1', schema: { ...template.schema, enum: ['PASS', 'BLOCKED', 'INCONCLUSIVE', 'finished'] } as SchemaEntry['schema'] };
  expect(unmappedCodes([...listSchemas(), planted])).toEqual([{ family: 'verdict', code: 'finished' }]);
});
