// AC2 #2697.5bf72d0a: "`deep_kinds` with `op: read` and the guide's name returns every craft check with its
// description, its thresholds and its fix, each equal to the text the merge base's skill holds. A planted guide that
// drops one check fails, naming it"
//
// asserts: the guide's name is the one the skill's craft line gives (README: The guide's name): of the names the lines
// saying "craft" hold, the first `deep_kinds {op: read, guide: <name>}` serves text for. That guide, every page joined,
// holds each of the sixteen craft checks the merge base's skill states (fixtures/base-SKILL.md), its description, its
// threshold and its fix each as the merge base's skill writes them, following the check's name (README: Readings).
// The planted guide is that guide with text_led's statement cut out, from its name to its fix (text_led's name still
// stands in ends's description): the same check fails it naming text_led, and nothing else.
// Wrong programs: the merge base (its skill's craft lines name no guide deep_kinds serves), a guide that rewords or
// drops a check, and the plant.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, SKILL, TIMEOUT, baseChecks, failsNaming, guideFailures, guideName, guideText, none, useCleanup, useShow, withoutCheck } from './helpers.ts';

const bin = useShow();
useCleanup();
/** The check the planted guide drops. */
const DROPPED = 'text_led';

/** The guide the skill names, read in full; the test fails at the first thing missing. */
function theGuide(b: string): { name: string; text: string } {
  const named = guideName(b, readFileSync(SKILL, 'utf8'));
  expect(named.failure, 'the skill\'s craft line names the guide deep_kinds serves').toBeUndefined();
  const guide = guideText(b, named.name!);
  expect(guide.failure, `deep_kinds read guide: ${named.name}`).toBeUndefined();
  console.log(`the guide: ${named.name}, ${guide.text.length} characters`);
  return { name: named.name!, text: guide.text };
}

describe(`${AC.guide} the guide deep_kinds serves states every craft check as the merge base's skill did`, () => {
  it(`${AC.guide} deep_kinds op: read with the guide's name returns every craft check with its description, thresholds and fix, each the merge base's skill's text`, () => {
    const { name, text } = theGuide(bin());
    none(guideFailures(text, baseChecks()), `the guide ${name} against the merge base's skill`);
  }, TIMEOUT);

  it(`${AC.guide} a planted guide that drops ${DROPPED} fails, naming it`, () => {
    const { name, text } = theGuide(bin());
    const checks = baseChecks();
    const planted = withoutCheck(text, checks.find((c) => c.name === DROPPED)!);
    failsNaming(guideFailures(planted, checks), [DROPPED], `the guide ${name} with ${DROPPED} dropped`, true);
  }, TIMEOUT);
});
