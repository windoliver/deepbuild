// AC7 (the library half) and AC16: each code family has one source, an enum in the schemas, with a total
// mapping to a verdict; a value added without its mapping is named; a code no enum lists makes its result
// INVALID, naming the raw code, never PASS; every code is raised alone by one planted entry, its page at
// deep://codes/<code> is generated from the family's schema and that entry, and replaying the entry raises it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, getSchema, listSchemas } from '../../../packages/contracts/src/index.ts';
import type { Schema } from '../../../packages/contracts/src/index.ts';
import { codeFamilies, codesPage, exitCode, judge, kitProblems, kits, replay, unmappedCodes } from '../../../packages/conformance/src/index.ts';
import type { CodeFamily, FamilyName, PlantedEntry, Verdict } from '../../../packages/conformance/src/index.ts';
import { adapterKit, EXIT_CODES, expectThrown, FAMILIES, familyEnum, fixture, getAt, isClosed, kitWith, replacing, RUN_OUTCOMES, RUNS, setAt, VERDICTS } from './helpers.ts';

const families = (): Map<FamilyName, CodeFamily> => new Map(codeFamilies().map((f) => [f.family, f]));
const family = (name: FamilyName): CodeFamily => {
  const f = families().get(name);
  expect(f, `codeFamilies() has the ${name} family`).toBeDefined();
  return f!;
};
/** Every planted entry across the shipped kits. */
const planted = (): PlantedEntry[] => kits().flatMap((k) => k.planted);
const kitOf = (entry: PlantedEntry) => kits().find((k) => k.planted.includes(entry))!;

describe('AC7 verdict and run outcomes, refusal codes, the check catalog\'s codes, deep doctor codes and the deep exit codes each have one source, an enum in the schemas, with a total mapping', () => {
  it('AC7 the six families each name a published schema and an enum node in it whose values are the family\'s codes', () => {
    const found = codeFamilies();
    expect(found.map((f) => f.family).sort()).toEqual([...FAMILIES].sort());
    const names = new Set(listSchemas().map((e) => e.name));
    for (const f of found) {
      expect(names.has(f.schema), `${f.family}'s source ${f.schema} is a published schema`).toBe(true);
      const node = familyEnum(f.schema, f.pointer);
      expect(node.values, `${f.family}'s codes are its enum's values`).toEqual(f.codes);
      expect(isClosed(node.closure), `${f.family}'s enum is closed`).toBe(true);
      expect(new Set(f.codes).size).toBe(f.codes.length);
    }
    // Codes are unique across families, so deep://codes/<code> names one.
    const all = found.flatMap((f) => f.codes);
    expect(new Set(all).size, `codes shared across families: ${all.filter((c, i) => all.indexOf(c) !== i).join(', ')}`).toBe(all.length);
  });

  it('AC7 the verdict family is exactly the five outcomes, the run family the seven, the refusal family error@1\'s codes and the exit family 0 to 3', () => {
    expect(family('verdict').codes).toEqual([...VERDICTS]);
    expect(family('run').codes).toEqual([...RUN_OUTCOMES]);
    expect(family('refusal').codes).toEqual([...ERROR_CODES]);
    expect(family('refusal').schema).toBe('error@1');
    expect(family('exit').codes).toEqual([...EXIT_CODES]);
    expect(family('check').codes.length).toBeGreaterThan(0);
    expect(family('doctor').codes).toContain('unknown');
  });

  it('AC7 one source: the verdict record\'s and verdict.made\'s union tags, and run.finished\'s outcome, are the family\'s codes and no others', () => {
    const tags = (schema: Schema, at: string): string[] => ((getAt(schema, at) as Schema[]) ?? []).map((b) => String(getAt(b, '/properties/outcome/const')));
    expect(tags(getSchema('verdict@1'), '/oneOf').sort()).toEqual([...family('verdict').codes].sort());
    expect(tags(getSchema('verdict.made@1'), '/properties/data/oneOf').sort()).toEqual([...family('verdict').codes].sort());
    expect(getAt(getSchema('run.finished@1'), '/properties/data/properties/outcome/enum')).toEqual(family('run').codes);
  });

  it('AC7 every code of every family maps to a verdict, and the mapping is total: nothing is unmapped', () => {
    expect(unmappedCodes()).toEqual([]);
    for (const f of codeFamilies()) for (const code of f.codes) {
      const judged = judge(f.family, code);
      expect(judged.listed, `${f.family} ${code} is listed`).toBe(true);
      expect(VERDICTS, `${f.family} ${code} maps to a verdict`).toContain(judged.verdict);
      expect(judged.code).toBe(code);
    }
    for (const v of VERDICTS) expect(judge('verdict', v).verdict).toBe(v);
    expect(judge('run', 'passed').verdict).toBe('PASS');
    expect(judge('run', 'failed').verdict).toBe('FAIL');
    for (const code of ERROR_CODES) expect(judge('refusal', code).verdict, `a refusal (${code}) is never a PASS`).not.toBe('PASS');
    expect(judge('exit', '0').verdict).toBe('PASS');
    expect(judge('exit', '1').verdict).toBe('FAIL');
    expect(judge('exit', '2').verdict).not.toBe('PASS');
    expect(['BLOCKED', 'INVALID', 'INCONCLUSIVE']).toContain(judge('exit', '3').verdict);
    expect(judge('doctor', 'unknown').verdict, 'unknown is never a success').not.toBe('PASS');
  });

  it.each(['verdict', 'refusal', 'exit'] as const)('AC7 adding a value to the %s enum without its mapping fails the build, naming the value', (name) => {
    const f = family(name);
    const widened = setAt(getSchema(f.schema), `${f.pointer}/enum`, [...f.codes, 'flaky_maybe']) as Schema;
    const unmapped = unmappedCodes(replacing(f.schema, widened));
    expect(unmapped).toEqual([{ family: name, code: 'flaky_maybe' }]);
  });

  it('AC7 a run result that carries a code no enum lists, a planted flaky_maybe, reads INVALID with that code, never PASS', () => {
    const judged = judge('run', 'flaky_maybe');
    expect(judged.verdict).toBe('INVALID');
    expect(judged.listed).toBe(false);
    expect(judged.code).toBe('flaky_maybe');
    expect(judged.message).toContain('flaky_maybe');
    // The same for the run result (a run.finished@1 event) replayed through the kit: it raises the raw code, which
    // the family doesn't list, and never the family's success.
    const raised = replay(adapterKit(), 'run', fixture('run-results', 'flaky-maybe.json'));
    expect(raised).toContain('flaky_maybe');
    expect(raised).not.toContain('passed');
    expect(family('run').codes).not.toContain('flaky_maybe');
  });

  it('AC7 for any string no family lists, every family judges it INVALID naming it, never PASS (1,000 cases)', () => {
    const listed = new Set(codeFamilies().flatMap((f) => f.codes));
    fc.assert(fc.property(fc.constantFrom(...FAMILIES), fc.string({ minLength: 1, maxLength: 24 }), (name, raw) => {
      fc.pre(!listed.has(raw));
      const judged = judge(name, raw);
      expect(judged.verdict).toBe('INVALID');
      expect(judged.listed).toBe(false);
      expect(judged.message).toContain(raw);
    }), RUNS);
  });

  it('AC7 the one exit-code table: 0 for PASS, 1 for FAIL or a failed item, 3 for anything not decided; when 1 and 3 both apply, 1 (1,000 cases)', () => {
    expect(exitCode(['PASS'])).toBe(0);
    expect(exitCode(['PASS', 'PASS'])).toBe(0);
    expect(exitCode(['FAIL'])).toBe(1);
    expect(exitCode(['BLOCKED'])).toBe(3);
    expect(exitCode(['INVALID'])).toBe(3);
    expect(exitCode(['INCONCLUSIVE'])).toBe(3);
    expect(exitCode(['FAIL', 'BLOCKED'])).toBe(1);
    expect(exitCode(['PASS', 'INVALID'])).toBe(3);
    expect(exitCode([]), 'nothing checked is not decided').toBe(3);
    fc.assert(fc.property(fc.array(fc.constantFrom<Verdict>(...VERDICTS), { minLength: 1, maxLength: 12 }), (verdicts) => {
      const want = verdicts.includes('FAIL') ? 1 : verdicts.every((v) => v === 'PASS') ? 0 : 3;
      expect(exitCode(verdicts), verdicts.join(',')).toBe(want);
    }), RUNS);
  });
});

describe('AC16 each code in every code family is raised alone by one planted entry in a kit, and deep://codes/<code> is generated from the family\'s schema and that entry', () => {
  it('AC16 every code has exactly one planted entry across the kits, and no entry names a code outside its family', () => {
    const entries = planted();
    for (const f of codeFamilies()) for (const code of f.codes) {
      const mine = entries.filter((e) => e.family === f.family && e.code === code);
      expect(mine.length, `${f.family} ${code} has one planted entry (has ${mine.length})`).toBe(1);
    }
    for (const e of entries) expect(family(e.family).codes, `${e.family} ${e.code} is a code of its family`).toContain(e.code);
  });

  it('AC16 replaying a planted entry raises exactly its code, and its clean twin raises nothing', () => {
    for (const e of planted()) {
      const kit = kitOf(e);
      expect(replay(kit, e.family, e.entry), `${e.family} ${e.code}'s entry`).toEqual([e.code]);
      expect(replay(kit, e.family, e.twin.value), `${e.family} ${e.code}'s twin`).toEqual([]);
      expect(e.fix.length, `${e.family} ${e.code} has a fix`).toBeGreaterThan(0);
    }
  });

  it('AC16 deep://codes/<code> is generated for every code from the family\'s schema and that entry, with its clean twin and fix; a code no family lists has no page', () => {
    for (const f of codeFamilies()) for (const code of f.codes) {
      const page = codesPage(`deep://codes/${code}`);
      expect(page.uri).toBe(`deep://codes/${code}`);
      expect(page.code).toBe(code);
      expect(page.family).toBe(f.family);
      expect(page.schema).toBe(f.schema);
      const entry = planted().find((e) => e.family === f.family && e.code === code)!;
      expect(page.entry).toEqual(entry);
      expect(page.markdown).toContain(code);
      expect(page.markdown).toContain(f.schema);
      expect(page.markdown).toContain(entry.fix);
      expect(page.markdown).toContain(JSON.stringify(entry.entry));
      expect(page.markdown).toContain(JSON.stringify(entry.twin.value));
    }
    expectThrown(() => codesPage('deep://codes/flaky_maybe'), '/code', 'a page for a code no family lists');
    expectThrown(() => codesPage('deep://codes/'), '/code', 'a page for no code');
    expectThrown(() => codesPage('https://example.invalid/codes/enum'), '/uri', 'a page at another scheme');
  });

  it('AC16 replaying a page\'s entry raises exactly that code', () => {
    for (const f of codeFamilies()) for (const code of f.codes) {
      const page = codesPage(`deep://codes/${code}`);
      expect(replay(kitOf(page.entry), page.family, page.entry.entry), `deep://codes/${code}`).toEqual([code]);
    }
  });

  it('AC16 a planted code no entry raises fails the preflight\'s kit check, naming the code', () => {
    const kit = adapterKit();
    expect(kitProblems(kit)).toEqual([]);
    const victim = kit.planted.find((e) => e.family === 'refusal' && e.code === 'enum')!;
    expect(victim, 'the adapter kit plants error@1\'s enum code').toBeDefined();
    const problems = kitProblems(kitWith(kit, { planted: kit.planted.filter((e) => e !== victim) }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.name === 'enum' || p.reason.includes('enum')), `a problem names the code enum: ${JSON.stringify(problems)}`).toBe(true);
    // An entry that names a code its replay doesn't raise is a problem too, naming the code.
    const twoCodes: PlantedEntry = { ...victim, codes: [victim.code, 'planted_extra'] };
    const extra = kitProblems(kitWith(kit, { planted: kit.planted.map((e) => (e === victim ? twoCodes : e)) }));
    expect(extra.some((p) => p.reason.includes('planted_extra') || p.name === 'planted_extra'), `an entry naming a code it doesn't raise is a problem: ${JSON.stringify(extra)}`).toBe(true);
    // And a twin that names a code is one, since a twin raises none.
    const namedTwin: PlantedEntry = { ...victim, twin: { ...victim.twin, codes: [victim.code] } };
    expect(kitProblems(kitWith(kit, { planted: kit.planted.map((e) => (e === victim ? namedTwin : e)) })).length).toBeGreaterThan(0);
  });

  it('AC16 for every code, the page\'s entry raises it alone and the twin raises none (1,000 cases)', () => {
    const codes = codeFamilies().flatMap((f) => f.codes.map((code) => [f.family, code] as const));
    fc.assert(fc.property(fc.constantFrom(...codes), ([name, code]) => {
      const page = codesPage(`deep://codes/${code}`);
      expect(page.family).toBe(name);
      const kit = kitOf(page.entry);
      expect(replay(kit, name, page.entry.entry)).toEqual([code]);
      expect(replay(kit, name, page.entry.twin.value)).toEqual([]);
    }), RUNS);
  });
});
