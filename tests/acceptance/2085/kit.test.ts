// AC2 #2085.353d4030: the effects kit still runs each of #429's planted documents and fails a check that stops
// raising its code. #429's suite is the criterion's proof and the implementer runs it unchanged; this is the
// fastest faithful check of the issue's second scope bullet ("The kit still finds each planted document and
// still proves it raises its code"): the conformance kit's `kit` call (#138) over the effects module, its
// `fixtures` and `catalog` parts, in the full build.
//
// The wrong programs: a fix that drops the planted documents, or their sidecars' codes, so the kit no longer
// finds or runs them (the first test); and a check that stops raising a planted document's code, which the kit
// must fail at that document's exact-codes case (the second test, under the plant `trusts_write_index`, README:
// The plant). The first test passes on the base by construction: the base's kit finds all twelve.
import { describe, expect, it } from 'vitest';
import { AC2, KIT_EFFECTS, PLANTED, TRUSTS_WRITE_INDEX, codesCase, isFixture, kitModule, part, run, scenario, useEvidence, useFull, type KitModule } from './helpers.ts';

const full = useFull();
const evidence = useEvidence();

/** The kit over the effects module's fixtures and catalog parts, in one process, under `planted` if given. */
function kit(planted?: string): KitModule {
  const [reply] = run(full(), scenario(evidence(), [KIT_EFFECTS], 1, planted ? { planted } : {}), planted ? `the kit under the plant ${planted} (README: The plant)` : 'the kit');
  return kitModule(reply!, 'effects');
}

describe(`${AC2} the effects kit still runs each of #429's planted documents and fails a check that stops raising its code`, () => {
  it(`${AC2} the kit finds each of #429's twelve planted documents by name, runs it and passes its exact-codes case on exactly its code; the catalog proves each code by it`, () => {
    const m = kit();
    const fixtures = part(m, 'fixtures');
    const catalog = part(m, 'catalog');
    const problems: string[] = [];
    for (const [name, code] of PLANTED) {
      const c = codesCase(fixtures, name);
      if (!c) { problems.push(`${name}: the fixtures part has no exact-codes case for it`); continue; }
      if (c.verdict !== 'PASS') problems.push(`${name}: its exact-codes case ${c.case} is ${c.verdict}: ${JSON.stringify(c.failure ?? null)}`);
      if (JSON.stringify(c.expected_codes) !== JSON.stringify([code])) problems.push(`${name}: its case expects ${JSON.stringify(c.expected_codes)}, not [${code}]`);
      if (JSON.stringify(c.raised_codes) !== JSON.stringify([code])) problems.push(`${name}: the check raised ${JSON.stringify(c.raised_codes)} on it, not exactly [${code}]`);
      // The catalog proves the module's code by its planted document (#138: every catalog code has a planted fixture that raises it).
      const row = catalog.cases.find((x) => x.case === `code:${code}`);
      if (!row) problems.push(`${code}: the catalog part has no case for it`);
      else {
        if (!isFixture(row.fixture, name)) problems.push(`${code}: the catalog proves it by ${row.fixture ?? 'no fixture'}, not by ${name}`);
        if (row.verdict !== 'PASS') problems.push(`${code}: its catalog case is ${row.verdict}: ${JSON.stringify(row.failure ?? null)}`);
      }
    }
    expect(problems, 'the kit runs each planted document and proves exactly its code').toEqual([]);
  }, 3_600_000);

  it(`${AC2} under a check that trusts a compute write's index (planted ${TRUSTS_WRITE_INDEX}), scattered-write stops raising operator_kind_rule and the kit fails its exact-codes case, naming it and the missing code; the other eleven still pass`, () => {
    const m = kit(TRUSTS_WRITE_INDEX);
    const fixtures = part(m, 'fixtures');
    const c = codesCase(fixtures, 'scattered-write');
    expect(c, 'the kit still runs scattered-write\'s exact-codes case under the plant').toBeDefined();
    expect(c!.raised_codes ?? [], 'the planted check no longer raises operator_kind_rule on scattered-write: the plant took').not.toContain('operator_kind_rule');
    expect(c!.verdict, `the kit fails the case: ${JSON.stringify(c!.raw)}`).toBe('FAIL');
    expect(c!.failure?.['code'], 'with unexpected_codes').toBe('unexpected_codes');
    expect(c!.failure?.['missing'], 'naming the code the check stopped raising').toEqual(['operator_kind_rule']);
    expect(isFixture(String(c!.failure?.['fixture']), 'scattered-write'), `and the fixture: ${JSON.stringify(c!.failure)}`).toBe(true);
    expect(m.verdict, 'the module fails the kit').toBe('FAIL');
    const others = PLANTED.filter(([name]) => name !== 'scattered-write').map(([name]) => [name, codesCase(fixtures, name)?.verdict] as const).filter(([, v]) => v !== 'PASS');
    expect(others, 'the plant changes that check alone: every other planted document\'s case still passes').toEqual([]);
  }, 3_600_000);
});
