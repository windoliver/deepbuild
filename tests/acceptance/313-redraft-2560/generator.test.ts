// #313 AC15 (the fifteenth criterion of issue #313): "For every JSON Schema in the contracts, a generator draws valid
// instances each consumer accepts and four mutations (a required field removed, an enum value off its list, a number
// past its range and an unknown field), each refused with its own code and the field's path, at 1,000 cases from a
// recorded seed; a consumer that accepts the off-list value fails, naming the schema and the seed"
// #2560, second criterion: "A lint that fails still fails the packaging test, and a mutation with the wrong code still
// fails AC15"
//
// Blind redraft of one test of tests/acceptance/313/generator.test.ts after #2560 (REDRAFT.md). The scenario, every
// assertion and every message are the original's. One thing changes: the test carries a timeout of its own, the
// 600_000 ms the neighbouring AC15 test carries for the same draws, instead of vitest's default 5 s. What the original
// read from the rest of its file is set up here as it was there: every published schema's 1,000 draws at the recorded
// seed, drawn once and memoized (there by the file's earlier test, here by a beforeAll with that test's budget).
//
// asserts: across every published schema's 1,000 draws at RECORDED_SEED, each mutation's kind is one of the four, its
// code is its kind's (required, enum, range, unlisted_field) and its path is a JSON Pointer; every kind the schema
// affords is among its draws; some draw carries a mutation. The same assertion fails a copy of one schema's draws with
// one fault planted: a mutation carrying another kind's code or a code none of the four has, one whose kind is not
// among the four, one whose path is not a JSON Pointer, and every mutation of a kind the schema affords taken out.
import { beforeAll, describe, expect, it } from 'vitest';
import { listSchemas } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry } from '../../../packages/contracts/src/index.ts';
import { draw, RECORDED_SEED } from '../../../packages/conformance/src/index.ts';
import type { Drawn, Mutation, MutationKind } from '../../../packages/conformance/src/index.ts';
import { isObject } from '../313/helpers.ts';

const CASES = 1000;
const CODE_OF: Record<MutationKind, string> = { required_removed: 'required', enum_off_list: 'enum', number_past_range: 'range', unknown_field: 'unlisted_field' };
const KINDS = Object.keys(CODE_OF) as MutationKind[];

/** The mutation kinds a schema affords: it has a required field, an enum, a bounded number or a closed object anywhere. */
function affords(schema: Schema): Set<MutationKind> {
  const kinds = new Set<MutationKind>();
  const walk = (node: JsonValue): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    if (Array.isArray(node.required) && node.required.length) kinds.add('required_removed');
    if (Array.isArray(node.enum)) kinds.add('enum_off_list');
    if (typeof node.minimum === 'number' || typeof node.maximum === 'number') kinds.add('number_past_range');
    if (node.additionalProperties === false) kinds.add('unknown_field');
    for (const [key, value] of Object.entries(node)) if (key !== 'enum') walk(value);
  };
  walk(schema);
  return kinds;
}

/** The 1,000 draws of a schema at the recorded seed, drawn once per run. */
const memo = new Map<string, Drawn[]>();
const drawnFor = (entry: SchemaEntry): Drawn[] => {
  let drawn = memo.get(entry.name);
  if (!drawn) memo.set(entry.name, (drawn = draw(entry.schema, RECORDED_SEED, CASES)));
  return drawn;
};
const drawnAll = { get: (name: string) => drawnFor(listSchemas().find((e) => e.name === name)!) };

/** The original test's assertions, word for word, over each schema's draws: the published ones, or a copy with one fault planted. */
function expectMutationsNamed(schemas: readonly SchemaEntry[], draws: { get(name: string): Drawn[] | undefined }): void {
  for (const entry of schemas) {
    const drawn = draws.get(entry.name)!;
    const seen = new Set<MutationKind>();
    for (const d of drawn) for (const m of d.mutations) {
      expect(KINDS, `${entry.name}: kind ${m.kind}`).toContain(m.kind);
      expect(m.code, `${entry.name}: ${m.kind} raises ${CODE_OF[m.kind]}`).toBe(CODE_OF[m.kind]);
      expect(m.path === '' || m.path.startsWith('/'), `${entry.name}: ${m.path} is a JSON Pointer`).toBe(true);
      seen.add(m.kind);
    }
    for (const kind of affords(entry.schema)) expect(seen.has(kind), `${entry.name} affords ${kind}, so the draws include it`).toBe(true);
    expect(drawn.some((d) => d.mutations.length > 0), `${entry.name} draws mutations`).toBe(true);
  }
}

/** The first published schema that affords an off-list mutation and draws one: every fault below is planted in its draws. */
function enumSchema(): SchemaEntry {
  const entry = listSchemas().find((e) => affords(e.schema).has('enum_off_list') && drawnAll.get(e.name)!.some((d) => d.mutations.some((m) => m.kind === 'enum_off_list')));
  expect(entry, 'some schema has an enum').toBeDefined();
  return entry!;
}

/** A copy of the schema's draws with one fault planted (its mutations in draw order, and the draws); the memo is never touched. */
function planted(entry: SchemaEntry, edit: (mutations: Mutation[], drawn: Drawn[]) => void): Map<string, Drawn[]> {
  const copy = structuredClone(drawnAll.get(entry.name)!);
  edit(copy.flatMap((d) => d.mutations), copy);
  return new Map([[entry.name, copy]]);
}

/** What the assertion throws on a wrong input; a wrong input it lets through fails here. */
function thrownBy(run: () => void): string {
  try { run(); } catch (error) { return String((error as Error).message); }
  throw Error('the assertion let a wrong program through');
}

describe('AC15 a generator draws valid instances and four mutations for every schema, at 1,000 cases from the recorded seed', () => {
  // What the original read from its file's earlier test: every published schema's draws, drawn once and memoized.
  beforeAll(() => { for (const entry of listSchemas()) drawnFor(entry); }, 600_000);

  it('AC15 each mutation names its kind, its code (required, enum, range, unlisted_field) and a JSON Pointer; every kind the schema affords is drawn (redraft 2560)', () => {
    expectMutationsNamed(listSchemas(), drawnAll);
  }, 600_000);

  // The first three faults sit on the schema's last mutation, or its last of a kind, so the walk passes every other
  // mutation before it reaches them; the fourth takes a kind out of every draw.
  it('AC15 (wrong program) draws where one mutation carries the wrong code fail this test, naming the schema, the kind and its code (redraft 2560)', () => {
    const entry = enumSchema();
    for (const code of ['unlisted_field', 'type']) {
      const wrong = planted(entry, (mutations) => { mutations.filter((m) => m.kind === 'enum_off_list').pop()!.code = code; });
      const message = thrownBy(() => expectMutationsNamed([entry], wrong));
      expect(message).toContain(`${entry.name}: enum_off_list raises enum`);
      expect(message).toContain(`expected '${code}' to be 'enum'`);
    }
  }, 600_000);

  it('AC15 (wrong program) draws with a mutation whose kind is not among the four fail this test, naming the kind (redraft 2560)', () => {
    const entry = enumSchema();
    const wrong = planted(entry, (mutations) => { (mutations[mutations.length - 1] as { kind: string }).kind = 'type_changed'; });
    const message = thrownBy(() => expectMutationsNamed([entry], wrong));
    expect(message).toContain(`${entry.name}: kind type_changed`);
    expect(message).toContain(`to include 'type_changed'`);
  }, 600_000);

  it('AC15 (wrong program) draws with a mutation whose path is not a JSON Pointer fail this test, naming the path (redraft 2560)', () => {
    const entry = enumSchema();
    let path = '';
    const wrong = planted(entry, (mutations) => { const m = mutations[mutations.length - 1]!; m.path = path = `#${m.path}`; });
    const message = thrownBy(() => expectMutationsNamed([entry], wrong));
    expect(message).toContain(`${entry.name}: ${path} is a JSON Pointer`);
    expect(message).toContain('expected false to be true');
  }, 600_000);

  it('AC15 (wrong program) a schema\'s draws missing a kind it affords fail this test, naming the schema and the kind (redraft 2560)', () => {
    const entry = enumSchema();
    const wrong = planted(entry, (_, drawn) => { for (const d of drawn) d.mutations = d.mutations.filter((m) => m.kind !== 'enum_off_list'); });
    const message = thrownBy(() => expectMutationsNamed([entry], wrong));
    expect(message).toContain(`${entry.name} affords enum_off_list, so the draws include it`);
    expect(message).toContain('expected false to be true');
  }, 600_000);
});
