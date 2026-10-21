// AC4 and AC13: every enum in the hub's schemas carries a closure (a registry, closed with its reason, what
// would reopen it and its mark, or open); the preflight's schema lint fails one with none, naming it; a closed
// enum says exhaustive or extensible, an extensible one carries unknown, a minor may add to an extensible
// enum and not to an exhaustive one, and a reader at the earlier minor reads a new member as unknown.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getSchema, lintSchemas, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema } from '../../../packages/contracts/src/index.ts';
import { codeFamilies, contractStep, judge, serveAt } from '../../../packages/conformance/src/index.ts';
import type { Closure } from '../../../packages/conformance/src/index.ts';
import { allEnums, asJson, deleteAt, enumNodes, expectAccepted, FACTS, fixture, getAt, isClosed, isObject, readJson, REPO, replacing, RUNS, setAt } from './helpers.ts';
import { join } from 'node:path';

const STOP_CAUSE = '/$defs/stopCause';
const closures = fixture('planted', 'closures.json') as { registry: Closure; closed: Closure; open: Closure; unmarked: JsonValue; extensible: Closure };
/** The lint problems that name an enum at `pointer` of `name`. */
const naming = (name: string, schema: Schema, pointer: string) => lintSchemas(replacing(name, schema)).filter((p) => p.schema === name && p.path.startsWith(pointer));

describe('AC4 every enum in the hub\'s schemas carries a closure, and the preflight fails an enum with none, naming it', () => {
  it('AC4 the published schemas lint clean, and every enum node (stop causes, tool-call kinds, caps, access words among them) carries a closure of one of the three forms', () => {
    expect(lintSchemas(listSchemas())).toEqual([]);
    const enums = allEnums();
    expect(enums.length, 'the schemas hold enums').toBeGreaterThan(40);
    for (const e of enums) {
      const c = e.closure;
      expect(c, `${e.schema} ${e.pointer} carries x-closure`).toBeDefined();
      const form = c === 'open' ? 'open' : isObject(asJson(c)) && 'registry' in (c as object) ? 'registry' : isClosed(c) ? 'closed' : 'none';
      expect(form, `${e.schema} ${e.pointer}: closure ${JSON.stringify(c)} is a registry, closed or open`).not.toBe('none');
      if (form === 'registry') expect((c as { registry: string }).registry).toMatch(/^[a-z][a-z0-9.-]*@[1-9][0-9]*$/);
      if (isClosed(c)) {
        expect(c.closed.length, `${e.schema} ${e.pointer}: a closed enum says why`).toBeGreaterThan(0);
        expect(c.reopens.length, `${e.schema} ${e.pointer}: a closed enum says what would reopen it`).toBeGreaterThan(0);
      }
    }
    // The enums the issue names are among them.
    expect(enumNodes(FACTS, getSchema(FACTS)).map((e) => e.pointer)).toEqual(expect.arrayContaining([STOP_CAUSE, '/$defs/toolKind']));
    // The adapter caps are a listed set of flag names (closed properties, each a boolean) and the access words a
    // listed set written as a pattern of alternatives: neither is an `enum` node, so their closure sits on the
    // list itself, the caps' root and the words' items node (Readings).
    const caps = getSchema('adapter.caps@1');
    expect(isClosed(caps['x-closure'] as unknown as Closure), 'the adapter caps carry a closed closure on their root').toBe(true);
    const words = getAt(getSchema('access@1'), '/properties/words/items');
    expect(isObject(words) && (Array.isArray(words.enum) || typeof words.pattern === 'string'), 'access words are a listed set').toBe(true);
    expect(isObject(words) && isClosed(words['x-closure'] as unknown as Closure), 'the access words carry a closed closure').toBe(true);
  });

  it('AC4 with the stop-cause enum\'s closure removed, the lint fails, naming adapter.facts@1 and /$defs/stopCause', () => {
    const schema = getSchema(FACTS);
    expect(getAt(schema, `${STOP_CAUSE}/x-closure`), 'the stop-cause enum has a closure to remove').toBeDefined();
    const problems = naming(FACTS, deleteAt(schema, `${STOP_CAUSE}/x-closure`) as Schema, STOP_CAUSE);
    expect(problems.length, 'the lint names the enum').toBeGreaterThan(0);
    expect(problems[0]!.reason.toLowerCase()).toContain('closure');
  });

  it('AC4 a planted enum added to a schema with no closure fails the same way, naming it', () => {
    const planted = readJson(join(REPO, 'tests', 'acceptance', '313', 'fixtures', 'planted', 'enum-without-closure.json')) as { schema: string; pointer: string; node: JsonValue };
    const schema = setAt(getSchema(planted.schema), planted.pointer, planted.node) as Schema;
    const problems = naming(planted.schema, schema, planted.pointer);
    expect(problems.length, `the lint names ${planted.schema} ${planted.pointer}`).toBeGreaterThan(0);
    expect(problems[0]!.reason.toLowerCase()).toContain('closure');
  });

  it.each([['a registry', 'registry'], ['closed with its reason, what would reopen it and its mark', 'closed'], ['open', 'open']] as const)('AC4 the planted enum passes once it names %s', (_, form) => {
    const planted = readJson(join(REPO, 'tests', 'acceptance', '313', 'fixtures', 'planted', 'enum-without-closure.json')) as { schema: string; pointer: string; node: JsonValue };
    const node = setAt(planted.node, '/x-closure', asJson(closures[form]));
    const schema = setAt(getSchema(planted.schema), planted.pointer, node) as Schema;
    expect(naming(planted.schema, schema, planted.pointer)).toEqual([]);
    // And the stop-cause enum with each form in turn.
    const stop = setAt(getSchema(FACTS), `${STOP_CAUSE}/x-closure`, asJson(form === 'closed' ? closures.extensible : closures[form])) as Schema;
    expect(naming(FACTS, stop, STOP_CAUSE)).toEqual([]);
  });

  it('AC4 a closure that is none of the three forms (a bare reason, a registry with no name, a closed with no reopens) is refused, naming the enum, while a well-formed one passes', () => {
    const schema = getSchema(FACTS);
    expect(naming(FACTS, setAt(schema, `${STOP_CAUSE}/x-closure`, asJson(closures.extensible)) as Schema, STOP_CAUSE), 'a well-formed closure is accepted').toEqual([]);
    for (const bad of ['closed: record', { registry: '' }, { closed: 'record', mark: 'extensible' }, { reopens: 'never', mark: 'exhaustive' }, 7] as JsonValue[]) {
      const problems = naming(FACTS, setAt(schema, `${STOP_CAUSE}/x-closure`, bad) as Schema, STOP_CAUSE);
      expect(problems.length, `closure ${JSON.stringify(bad)} is refused`).toBeGreaterThan(0);
    }
  });

  it('AC4 for every enum in the schemas, removing its closure fails the lint naming that enum and no other (1,000 cases)', () => {
    const enums = allEnums();
    fc.assert(fc.property(fc.constantFrom(...enums), (e) => {
      const stripped = deleteAt(getSchema(e.schema), `${e.pointer}/x-closure`) as Schema;
      const problems = lintSchemas(replacing(e.schema, stripped));
      expect(problems.length, `${e.schema} ${e.pointer}`).toBeGreaterThan(0);
      for (const p of problems) expect(p.schema).toBe(e.schema);
      expect(problems.some((p) => p.path.startsWith(e.pointer)), `a problem names ${e.pointer}: ${JSON.stringify(problems)}`).toBe(true);
    }), RUNS);
  });
});

describe('AC13 every closed enum says exhaustive or extensible, and an extensible one carries unknown', () => {
  it('AC13 every closed enum carries the mark, and every extensible one lists unknown; the stop causes, tool kinds and doctor codes are extensible, the verdicts and run outcomes exhaustive', () => {
    for (const e of allEnums()) {
      if (!isClosed(e.closure)) continue;
      expect(['exhaustive', 'extensible'], `${e.schema} ${e.pointer} says which`).toContain(e.closure.mark);
      if (e.closure.mark === 'extensible') expect(e.values, `${e.schema} ${e.pointer} is extensible, so it carries unknown`).toContain('unknown');
    }
    const facts = getSchema(FACTS);
    const mark = (schema: Schema, pointer: string) => { const c = getAt(schema, `${pointer}/x-closure`) as unknown as Closure; return isClosed(c) ? c.mark : c; };
    expect(mark(facts, STOP_CAUSE)).toBe('extensible');
    expect(mark(facts, '/$defs/toolKind')).toBe('extensible');
    const families = Object.fromEntries(codeFamilies().map((f) => [f.family, f]));
    expect(mark(getSchema(families.verdict!.schema), families.verdict!.pointer)).toBe('exhaustive');
    expect(mark(getSchema(families.run!.schema), families.run!.pointer)).toBe('exhaustive');
    expect(mark(getSchema(families.doctor!.schema), families.doctor!.pointer)).toBe('extensible');
    expect(familyValues('doctor')).toContain('unknown');
  });

  it('AC13 a closure without the mark fails the preflight\'s lint, naming the enum', () => {
    const schema = setAt(getSchema(FACTS), `${STOP_CAUSE}/x-closure`, closures.unmarked) as Schema;
    const problems = naming(FACTS, schema, STOP_CAUSE);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.reason.toLowerCase()).toMatch(/exhaustive|extensible|mark/);
  });

  it('AC13 an extensible enum without unknown fails the lint, naming the enum', () => {
    const schema = getSchema(FACTS);
    const values = (getAt(schema, `${STOP_CAUSE}/enum`) as string[]).filter((v) => v !== 'unknown');
    const problems = naming(FACTS, setAt(schema, `${STOP_CAUSE}/enum`, values) as Schema, STOP_CAUSE);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.reason).toContain('unknown');
  });

  it('AC13 a schema change that adds a stop cause passes the contract step as a minor', () => {
    const before = listSchemas();
    const after = replacing(FACTS, setAt(getSchema(FACTS), `${STOP_CAUSE}/enum`, [...(getAt(getSchema(FACTS), `${STOP_CAUSE}/enum`) as JsonValue[]), 'quota_paused']) as Schema, before);
    expect(contractStep(before, after)).toEqual([]);
  });

  it('AC13 a schema change that adds a verdict outcome fails the contract step, naming the enum, unless it takes a new major', () => {
    const verdict = codeFamilies().find((f) => f.family === 'verdict')!;
    const before = listSchemas();
    const widened = setAt(getSchema(verdict.schema), `${verdict.pointer}/enum`, [...verdict.codes, 'MAYBE']) as Schema;
    const breaks = contractStep(before, replacing(verdict.schema, widened, before));
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks.some((b) => b.schema === verdict.schema && b.path.startsWith(verdict.pointer)), `a break names ${verdict.schema} ${verdict.pointer}: ${JSON.stringify(breaks)}`).toBe(true);
    // Under a new major (the next number in the name) the same shape is a new entry, and the step passes.
    const [base, major] = verdict.schema.split('@') as [string, string];
    const next = `${base}@${Number(major) + 1}`;
    expect(contractStep(before, [...before, { name: next, schema: { ...widened, title: next } }])).toEqual([]);
  });

  it('AC13 a reader built at the earlier minor reads the new stop cause as unknown, which makes no result pass', () => {
    const earlier = getSchema(FACTS);
    const claude = readJson(join(REPO, 'adapters', 'claude-code.facts.json'));
    const at = '/stop/cause/payload/values/rate_limit';
    expect(getAt(claude, at), 'the shipped facts map rate_limit to a cause').toBeDefined();
    const later = setAt(claude, at, 'quota_paused');
    const served = serveAt(earlier, later);
    expect(getAt(served, at)).toBe('unknown');
    expectAccepted(validate(FACTS, served), 'what the earlier reader sees');
    // Everything else is as it was.
    expect(setAt(served, at, getAt(claude, at)!)).toEqual(claude);
    // unknown is never a success: in every extensible code family it judges below PASS.
    const doctor = judge('doctor', 'unknown');
    expect(doctor.verdict).not.toBe('PASS');
  });

  it('AC13 for any member added to an extensible enum, the earlier reader sees unknown, and for any member of an exhaustive one the step is a break (1,000 cases)', () => {
    const facts = getSchema(FACTS);
    const verdict = codeFamilies().find((f) => f.family === 'verdict')!;
    const claude = readJson(join(REPO, 'adapters', 'claude-code.facts.json'));
    const at = '/stop/cause/payload/values/rate_limit';
    const stopCauses = getAt(facts, `${STOP_CAUSE}/enum`) as string[];
    fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z_]{2,20}$/), (member) => {
      fc.pre(!stopCauses.includes(member) && !verdict.codes.includes(member));
      expect(getAt(serveAt(facts, setAt(claude, at, member)), at)).toBe('unknown');
      const widened = setAt(getSchema(verdict.schema), `${verdict.pointer}/enum`, [...verdict.codes, member]) as Schema;
      expect(contractStep(listSchemas(), replacing(verdict.schema, widened)).some((b) => b.schema === verdict.schema)).toBe(true);
    }), RUNS);
  });
});

function familyValues(family: string): JsonValue[] {
  const f = codeFamilies().find((x) => x.family === family)!;
  return getAt(getSchema(f.schema), `${f.pointer}/enum`) as JsonValue[];
}
