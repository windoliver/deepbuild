// The verdict family has one source: a verdict list elsewhere can't grow past it, and a list of state words is no verdict list.
import { expect, it } from 'vitest';
import { getSchema, listSchemas, type Schema, type SchemaEntry } from '@deepbuild/contracts';
import { unmappedCodes } from '@deepbuild/conformance';

const withEnum = (name: string, pointer: string[], values: string[]): SchemaEntry[] => {
  const schema = structuredClone(getSchema(name)) as Record<string, unknown>;
  let node = schema;
  for (const key of pointer) node = node[key] as Record<string, unknown>;
  node.enum = values;
  return listSchemas().map((entry) => (entry.name === name ? { name, schema: schema as Schema } : entry));
};
const OUTCOME = ['properties', 'data', 'properties', 'outcome'], WORD = ['properties', 'data', 'properties', 'word'];
const enumAt = (name: string, pointer: string[]): string[] => {
  let node = getSchema(name) as Record<string, unknown>;
  for (const key of pointer) node = node[key] as Record<string, unknown>;
  return node.enum as string[];
};

it('names nothing in the published schemas: a row word list holds PASS beside sent back, and is no verdict list', () => {
  expect(enumAt('row.set@4', WORD)).toEqual(expect.arrayContaining(['PASS', 'sent back']));
  expect(enumAt('row.set@4', WORD)).not.toContain('FAIL');
  expect(unmappedCodes()).toEqual([]);
});

it('names a word a verdict list elsewhere adds: landing.made lists the five verdicts and none', () => {
  expect(unmappedCodes(withEnum('landing.made@1', OUTCOME, [...enumAt('landing.made@1', OUTCOME), 'flaky_maybe']))).toEqual([{ family: 'verdict', code: 'flaky_maybe' }]);
});

it('names a state word once its list holds FAIL too, since the list then reads as verdicts', () => {
  const named = unmappedCodes(withEnum('row.set@4', WORD, [...enumAt('row.set@4', WORD), 'FAIL']));
  expect(named).toContainEqual({ family: 'verdict', code: 'sent back' });
});
