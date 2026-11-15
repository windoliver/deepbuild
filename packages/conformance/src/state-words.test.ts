// A state list holds the words its own schema publishes and no others (#2146): a word another list holds, `none` on a
// verdict list, or a new list of state words is named by the code-mappings check, as any unmapped code is.
import { expect, it } from 'vitest';
import { listSchemas } from '@deepbuild/contracts';
import type { JsonValue, SchemaEntry } from '@deepbuild/contracts';
import { unmappedCodes } from '@deepbuild/conformance';

const VERDICTS = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'pending'];
type Json = Record<string, JsonValue>;
const isObject = (node: JsonValue | undefined): node is Json => typeof node === 'object' && node !== null && !Array.isArray(node);
/** Every published list that holds PASS: its schema, the keys down to its enum's node, and its words that are no verdict. */
const lists = listSchemas().flatMap((entry) => {
  const found: { schema: string; keys: string[]; words: string[] }[] = [];
  const walk = (node: JsonValue | undefined, keys: string[]): void => {
    if (!isObject(node)) return;
    if (Array.isArray(node.enum) && node.enum.includes('PASS')) found.push({ schema: entry.name, keys, words: node.enum.map(String).filter((v) => !VERDICTS.includes(v)) });
    for (const [key, child] of Object.entries(node)) walk(child, [...keys, key]);
  };
  walk(entry.schema as JsonValue, []);
  return found;
});
const stateLists = lists.filter((l) => l.words.length > 0);
const name = (l: { schema: string; keys: string[] }): string => `${l.schema} /${l.keys.join('/')}`;

/** The published schemas, with the enum at `keys` in `schema` (or a property beside it, `as`) holding `values`. */
function planted(schema: string, keys: string[], change: (node: Json, parent: Json) => void): SchemaEntry[] {
  return listSchemas().map((e) => {
    if (e.name !== schema) return e;
    const copy = structuredClone(e.schema) as unknown as Json;
    let node = copy;
    let parent = copy;
    for (const key of keys) { parent = node; node = node[key] as Json; }
    change(node, parent);
    return { ...e, schema: copy as unknown as SchemaEntry['schema'] };
  });
}
const adding = (word: string) => (node: Json): void => { node.enum = [...(node.enum as string[]), word]; };

it('names nothing over the published schemas, whose state lists are the eight the issue found', () => {
  expect(unmappedCodes()).toEqual([]);
  expect(stateLists.map(name).sort()).toEqual([
    'landing.made@1 /properties/data/properties/outcome', 'row.set@1 /properties/data/properties/word', 'row.set@2 /properties/data/properties/word',
    'row.set@3 /properties/data/properties/word', 'row.set@4 /properties/data/properties/word', 'session.state@2 /properties/data/properties/state',
    'work.attempt@1 /properties/data/properties/cause', 'work.state@1 /properties/data/properties/word',
  ]);
});

// Every word some state list holds, added to each list that holds PASS and doesn't publish it: a state list holds
// its own words only, and a verdict list none of them.
const words = [...new Set(stateLists.flatMap((l) => l.words))];
it.each(lists.map((l) => [name(l), l] as const))('names each state word that %s doesn\'t publish, when it is added there', (_name, list) => {
  const foreign = words.filter((w) => !list.words.includes(w));
  expect(foreign.length).toBeGreaterThan(0);
  for (const word of foreign) expect(unmappedCodes(planted(list.schema, list.keys, adding(word))), `${word} added to ${name(list)}`).toEqual([{ family: 'verdict', code: word }]);
});

it.each(stateLists.map((l) => [name(l), l] as const))('names the words of %s on a second list beside it in the same schema', (_name, list) => {
  const twin = planted(list.schema, list.keys, (node, parent) => { parent.planted_twin = structuredClone(node); });
  expect(unmappedCodes(twin).map((u) => u.code).sort()).toEqual([...list.words].sort());
});

it('names the words of a state list under a property whose name spells the list\'s path', () => {
  const list = stateLists.find((l) => l.schema === 'row.set@1')!;
  const aliased = planted(list.schema, [], (root) => { (root.properties as Json)[list.keys.slice(1).join('/')] = { enum: ['PASS', 'queued', 'stuck'] }; });
  expect(unmappedCodes(aliased).map((u) => u.code).sort()).toEqual(['queued', 'stuck']);
});

it('names the state word of a new list that holds PASS without FAIL', () => {
  const template = listSchemas().find((e) => e.name === 'verdict.outcome@1')!;
  const fresh = { ...template, name: 'planted.state@1', schema: { ...template.schema, enum: ['PASS', 'BLOCKED', 'INCONCLUSIVE', 'finished'] } as SchemaEntry['schema'] };
  expect(unmappedCodes([...listSchemas(), fresh])).toEqual([{ family: 'verdict', code: 'finished' }]);
});
