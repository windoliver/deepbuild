// AC14 #200.78025075: "A kit lists its rules, and each rule has its own planted wrong entry that breaks that rule
// alone and fails with that rule's message: a planted kit of three rules whose only planted entry breaks two of them
// is refused by the preflight, naming the rule no entry isolates, and the same kit with one entry per rule passes"
//
// asserts: the test module test.rules declares test.rules@1, whose kit lists three rules (size_at_most_64, size_even,
// name_lowercase). In `core,test-rules-shared` its only planted entry ({name: "odd", size: 65}) breaks size_at_most_64
// and size_even; the canvas conformance kit (#138's `kit` call, which the local preflight's canvas kit lane runs)
// fails test.rules in its `registries` part, its failures naming test.rules@1 and every rule no planted entry isolates:
// all three. In `core,test-rules-isolated`, with one planted entry per rule, the `registries` part passes, and
// deep://registries lists three planted entries, each failing exactly one rule, a different one each, with that
// rule's message as the kit lists it.

import { describe, expect, it } from 'vitest';
import {
  RULES, RULES_MODULE, RULE_IDS, kitCall, kitModule, listing, mentions, run, scenario, show, theRegistry, useBuilds, useEvidence, type Build,
} from './helpers.ts';

const SHARED: Build = { set: 'core', with: ['test-rules-shared'] };
const ISOLATED: Build = { set: 'core', with: ['test-rules-isolated'] };
const builds = useBuilds([SHARED, ISOLATED]);
const evidence = useEvidence();

const registriesPart = (bin: string) => {
  const [reply] = run(bin, scenario(evidence(), [kitCall([RULES_MODULE])]));
  const m = kitModule(reply!, RULES_MODULE);
  const part = m.parts.find((p) => p.part === 'registries');
  expect(part, `the kit runs a registries part on ${RULES_MODULE}; its parts are ${m.parts.map((p) => p.part).join(', ')}`).toBeDefined();
  return { module: m, part: part! };
};

describe('AC14 #200.78025075 every kit rule is isolated by its own planted wrong entry', () => {
  it('AC14 a kit of three rules whose only planted entry breaks two of them is refused by the preflight\'s kit, naming every rule no entry isolates', () => {
    const l = theRegistry(listing(builds.bin(SHARED), evidence()), RULES);
    expect((l.kit ?? []).map((k) => k.rule).sort(), 'the kit lists its three rules').toEqual([...RULE_IDS].sort());
    expect((l.planted ?? []).length, 'one planted entry').toBe(1);
    expect(l.planted![0]!.result.rules.filter((r) => r.verdict === 'FAIL').map((r) => r.rule).sort(), 'which breaks two rules at once').toEqual(['size_at_most_64', 'size_even']);
    const { module, part } = registriesPart(builds.bin(SHARED));
    expect([part.verdict, module.verdict], 'the kit fails test.rules in its registries part').toEqual(['FAIL', 'FAIL']);
    for (const rule of RULE_IDS) expect(part.failures.some((f) => mentions(f, rule) && mentions(f, RULES)), `a failure names test.rules@1 and the rule ${rule}, which no planted entry isolates: ${show(part.failures)}`).toBe(true);
  }, 1_800_000);

  it('AC14 the same kit with one planted entry per rule passes, each entry failing its rule alone with that rule\'s message', () => {
    const l = theRegistry(listing(builds.bin(ISOLATED), evidence()), RULES);
    const messages = new Map((l.kit ?? []).map((k) => [k.rule, k.message]));
    expect([...messages.keys()].sort(), 'the kit lists its three rules').toEqual([...RULE_IDS].sort());
    const broken = (l.planted ?? []).map((p) => {
      const failing = p.result.rules.filter((r) => r.verdict === 'FAIL');
      expect(failing.length, `the planted entry ${p.name} breaks one rule alone: ${show(p.raw)}`).toBe(1);
      expect(failing[0]!.message, `${p.name} fails with ${failing[0]!.rule}'s message`).toBe(messages.get(failing[0]!.rule));
      return failing[0]!.rule;
    });
    expect(broken.sort(), 'one planted entry per rule').toEqual([...RULE_IDS].sort());
    const { part } = registriesPart(builds.bin(ISOLATED));
    expect(part.verdict, `the kit's registries part passes: ${show(part.failures)}`).toBe('PASS');
  }, 1_800_000);
});
