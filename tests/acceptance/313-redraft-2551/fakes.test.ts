// #313 AC12 (the twelfth criterion of issue #313): "The adapter rules are one numbered list in `adapter.facts@1` (…),
// and each rule has one broken fake that fails the runner with that rule's message; with the fake for a clock stepped
// back removed, the local preflight fails, naming the rule"
// #2551, first criterion: "The design's numbered adapter rules and `adapter.facts@1`'s `x-rules` hold the same rules in
// the same order"
//
// Blind redraft of one test of tests/acceptance/313/fakes.test.ts after #2551 (REDRAFT.md). The scenario, every
// assertion and every message are the original's. One thing changes: the list of phrases the rules are held to. The
// design's sentence (docs/technical-design.md, How we know version 0 works, Conformance tests: "The adapter rules are
// one numbered list in `adapter.facts@1`: …") now names twelve rules, so the list here is 313's ten, imported
// unchanged, followed by the design's two new phrases in the design's order.
//
// asserts: adapter.facts@1's x-rules holds exactly as many rules as the design's sentence names (twelve); rule i's text
// contains the design's i-th phrase, compared in lower case with the phrase's backticks dropped; each id matches
// ^[a-z][a-z0-9_-]*$; no two rules share an id. The same assertion fails a list that lacks the design's last two rules,
// one that lacks a rule in the middle, one with two rules swapped, one with a rule the design doesn't name, one whose
// rule says something else, one with an id repeated and one with an id out of form.
import { describe, expect, it } from 'vitest';
import { RULE_PHRASES, rules } from '../313/helpers.ts';
import type { Rule } from '../313/helpers.ts';

/**
 * The adapter rules, the design's phrases in the design's order: suite 313's ten, then the two the amended sentence
 * adds after "delivery confirmed from the transcript". Each x-rules entry's text must contain its phrase.
 */
const DESIGN_RULE_PHRASES = [
  ...RULE_PHRASES,
  'a block the model needs goes out only on an output the facts mark as reaching the model',
  'a block the model needs never goes out as stderr on exit 0',
] as const;

/** The original test's assertions, word for word, on a rule list: the published one, or a wrong one built from it. */
function expectDesignRules(list: Rule[]): void {
  expect(list.length).toBe(DESIGN_RULE_PHRASES.length);
  list.forEach((rule, i) => {
    expect(rule.rule.toLowerCase(), `rule ${i + 1} is ${DESIGN_RULE_PHRASES[i]}`).toContain(DESIGN_RULE_PHRASES[i]!.toLowerCase().replace(/`/g, ''));
    expect(rule.id).toMatch(/^[a-z][a-z0-9_-]*$/);
  });
  expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
}

/** A copy of the published list with one fault planted; the published schema is never touched. */
function planted(edit: (list: Rule[]) => Rule[] | void): Rule[] {
  const copy = rules().map((r) => ({ ...r }));
  return edit(copy) ?? copy;
}

describe('AC12 the adapter rules are one numbered list in adapter.facts@1, each with one broken fake that fails the runner with that rule\'s message', () => {
  it('AC12 adapter.facts@1 lists the twelve rules in the design\'s order, each with an id (redraft 2551)', () => {
    expectDesignRules(rules());
  });

  it('AC12 (wrong program) a list that holds only the first ten rules fails this test, twelve against ten (redraft 2551)', () => {
    expect(() => expectDesignRules(planted((list) => list.slice(0, 10)))).toThrow(/expected 10 to be 12/);
  });

  it('AC12 (wrong program) a list that lacks a rule in the middle fails this test (redraft 2551)', () => {
    expect(() => expectDesignRules(planted((list) => { list.splice(2, 1); }))).toThrow(/expected 11 to be 12/);
  });

  it('AC12 (wrong program) a list with a thirteenth rule the design doesn\'t name fails this test (redraft 2551)', () => {
    const extra: Rule = { id: 'hook-replies-within-a-second', rule: 'A hook replies within a second.' };
    expect(() => expectDesignRules(planted((list) => [...list, extra]))).toThrow(/expected 13 to be 12/);
    // In the middle of the list it fails the same way, on the count.
    expect(() => expectDesignRules(planted((list) => { list.splice(10, 0, extra); }))).toThrow(/expected 13 to be 12/);
  });

  it('AC12 (wrong program) a list with the last two rules swapped fails this test, naming rule 11 and the design\'s phrase (redraft 2551)', () => {
    const swapped = planted((list) => { [list[10], list[11]] = [list[11]!, list[10]!]; });
    expect(() => expectDesignRules(swapped)).toThrow(/rule 11 is a block the model needs goes out only on an output the facts mark as reaching the model/);
  });

  it('AC12 (wrong program) a list with two of the first ten rules swapped fails this test, naming the first of them (redraft 2551)', () => {
    const swapped = planted((list) => { [list[2], list[3]] = [list[3]!, list[2]!]; });
    expect(() => expectDesignRules(swapped)).toThrow(/rule 3 is a clock stepped back/);
  });

  it('AC12 (wrong program) a list whose twelfth rule says something else fails this test, naming rule 12 and the design\'s phrase (redraft 2551)', () => {
    const reworded = planted((list) => { list[11] = { id: list[11]!.id, rule: 'A block the model needs may go out as stderr on exit 0.' }; });
    expect(() => expectDesignRules(reworded)).toThrow(/rule 12 is a block the model needs never goes out as stderr on exit 0/);
  });

  it('AC12 (wrong program) a list with one id used twice, or an id out of form, fails this test (redraft 2551)', () => {
    expect(() => expectDesignRules(planted((list) => { list[11]!.id = list[10]!.id; }))).toThrow(/expected 11 to be 12/);
    expect(() => expectDesignRules(planted((list) => { list[11]!.id = 'No Block On Stderr'; }))).toThrow(/to match/);
  });
});
