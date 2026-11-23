// AC1 #2697.588cc8a0: "The skill is at most 1,900 tokens by the pinned tokenizer (drafted from 3,599 less the section's
// 1,900, plus its one line). On the merge base it is 3,599, and the test fails, naming the count"
//
// asserts: skills/deepbuild/SKILL.md, as the checkout holds it (the file `deep setup` copies into a session's skills and
// every session loads whole), counts at most 1,900 tokens by gpt-tokenizer 4.0.0's o200k_base, the tokenizer the facts
// files pin; a failure names the count. The same check on the merge base's skill (fixtures/base-SKILL.md, 3,735 tokens
// at 4aa543da7; the issue's 3,599 is an older commit's) fails, naming its count.
// Wrong program: the merge base, whose skill holds the 1,900-token section "Craft checks a film brief names".
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { AC, BASE_SKILL, CEILING, SKILL, ceilingFailures, failsNaming, none, tokens } from './helpers.ts';

test(`${AC.ceiling} the skill is at most ${CEILING} tokens by the pinned tokenizer, and the merge base's skill fails the same check, naming its count`, () => {
  const skill = readFileSync(SKILL, 'utf8');
  const base = readFileSync(BASE_SKILL, 'utf8');
  console.log(`skills/deepbuild/SKILL.md: ${tokens(skill)} tokens; the merge base's: ${tokens(base)} tokens`);
  none(ceilingFailures(skill, 'skills/deepbuild/SKILL.md'), `the skill is at most ${CEILING} tokens`);
  failsNaming(ceilingFailures(base, 'the merge base\'s skill'), [String(tokens(base))], 'the merge base\'s skill');
});
