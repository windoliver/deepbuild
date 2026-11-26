// AC1 #3233.0404c3df: the kit fails each of the three planted fills with its own code and message and no other, the
// reference panel passes, and the five earlier plants still fail with theirs alone. A kit that passes one of the three
// plants fails its own hygiene, naming the rule.
//
// The kit is `panel@1`'s, from the conformance package's public entry (`slotKits`, `cleanFills`, `runKit`,
// `kitProblems`), as #349's suite reaches it. It reads TypeScript only and builds nothing. A run takes both of the
// kit's parts, the fixed one and the seeded one from a seed written here. The planted kit is test code: the shipped
// kit, spread, with a judge that lets one rule's finding through (README, Planted things).
import { describe, expect, it } from 'vitest';
import type { SlotKit, SlotKitImpl } from '../../../packages/conformance/src/index.ts';
import { AC1, conformance, PANEL } from './helpers.ts';
import { EARLIER_PLANTS, kitShapeProblems, NEW_RULES, plantRunProblems, problemNamesRule } from './judges.ts';

const SEED = 3233;

async function shipped(): Promise<SlotKit> {
  const { slotKits } = await conformance();
  const kit = slotKits().find((k) => k.slot === PANEL);
  if (!kit) throw Error(`BLOCKED: the conformance package ships no ${PANEL} kit`);
  return kit;
}

/** The shipped kit with one change: its judge lets a finding that raises `code` through, so that rule holds nothing. */
function admitting(kit: SlotKit, code: string): SlotKit {
  const impl = kit as SlotKitImpl;
  const judge: SlotKitImpl['judge'] = function* (fill, c) {
    try {
      yield* impl.judge(fill, c);
    } catch (error) {
      const codes = (error as { codes?: unknown } | null)?.codes;
      if (!Array.isArray(codes) || !codes.includes(code)) throw error;
    }
  };
  return { ...impl, judge } as SlotKit;
}

describe(`AC1 ${AC1} the kit at revision 2: three planted fills each failing alone, beside the five`, () => {
  it(`AC1 ${AC1} the kit is at revision 2 and lists "Names what it presses", "Reads on its fill" and "Reaches by key" beside its five rules, each with one planted fill of its own`, async () => {
    expect(kitShapeProblems(await shipped())).toEqual([]);
  });

  it(`AC1 ${AC1} the kit fails each of the three planted fills with its own code and message and no other`, async () => {
    const { runKit } = await conformance();
    const kit = await shipped();
    const problems: string[] = [];
    for (const { name, code } of NEW_RULES) {
      const plant = kit.planted.find((p) => p.codes.includes(code));
      if (!plant) { problems.push(`the kit plants no fill that raises ${code}, for "${name}"`); continue; }
      const report = await runKit(kit, plant.fill, { seed: SEED });
      problems.push(...plantRunProblems(plant, report.verdict, report.cases, kit.planted));
    }
    expect(problems).toEqual([]);
  });

  it(`AC1 ${AC1} the reference panel passes (it does at the base too: the three rules must not fail it)`, async () => {
    const { cleanFills, runKit } = await conformance();
    const kit = await shipped();
    const fills = cleanFills(kit);
    expect(fills.length, 'the kit has a reference panel').toBeGreaterThan(0);
    for (const fill of fills) {
      const report = await runKit(kit, fill, { seed: SEED });
      expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), 'every case of both parts passes').toEqual([]);
      expect(report.cases.length, 'the run held cases').toBeGreaterThan(0);
      expect(report.verdict).toBe('PASS');
    }
  });

  it(`AC1 ${AC1} the five earlier plants still fail with theirs alone (they do at the base too: the three rules must not reach them)`, async () => {
    const { runKit } = await conformance();
    const kit = await shipped();
    const problems: string[] = [];
    for (const { name, code } of EARLIER_PLANTS) {
      const plant = kit.planted.find((p) => p.name === name);
      if (!plant) { problems.push(`the kit no longer plants ${name}`); continue; }
      if (plant.codes.join() !== code) problems.push(`${name} names the codes ${plant.codes.join(', ')}, not ${code} alone`);
      const report = await runKit(kit, plant.fill, { seed: SEED });
      problems.push(...plantRunProblems(plant, report.verdict, report.cases, kit.planted));
    }
    expect(problems).toEqual([]);
  });

  it(`AC1 ${AC1} planted: a kit that passes one of the three plants fails its own hygiene, naming the rule`, async () => {
    const { kitProblems, runKit } = await conformance();
    const kit = await shipped();
    expect(kitProblems(kit), 'the shipped kit passes its own hygiene, before a wrong kit failing it means anything').toEqual([]);
    const problems: string[] = [];
    for (const { name, code } of NEW_RULES) {
      const plant = kit.planted.find((p) => p.codes.includes(code));
      const rule = kit.rules.find((r) => r.id === plant?.breaks);
      if (!plant || !rule) { problems.push(`the kit plants no fill that raises ${code} and breaks a rule it lists, for "${name}"`); continue; }
      const wrong = admitting(kit, code);
      const admitted = await runKit(wrong, plant.fill, { parts: ['fixed'] });
      if (admitted.verdict !== 'PASS') { problems.push(`BLOCKED: the kit made to pass ${plant.name} still reads ${admitted.verdict} on it, so it isn't a kit that passes the plant: ${admitted.cases.find((c) => c.outcome !== 'PASS')?.message ?? ''}`); continue; }
      const found = kitProblems(wrong);
      if (!found.length) problems.push(`a kit that passes ${plant.name} passes its own hygiene`);
      else if (!found.some((p) => problemNamesRule(p, rule, name))) problems.push(`a kit that passes ${plant.name} fails its hygiene without naming the rule ${rule.id} ("${name}"): ${found.map((p) => `${p.check} ${p.name}: ${p.reason}`).join(' | ')}`);
    }
    expect(problems).toEqual([]);
  });
});
