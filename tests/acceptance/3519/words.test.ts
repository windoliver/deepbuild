// AC1 #3519.a718f309: "The canvas skill holds no craft check's description, threshold or fix, and is at most 16,700
// tokens by the pinned tokenizer (drafted from 18,440 less the section's 1,881, plus its one line). On the merge base
// it is 18,440, and the test fails, naming the count"
//
// asserts: skills/deepbuild-canvas/SKILL.md, as the checkout holds it, holds none of the sixteen checks' description,
// threshold or fix as crates/deep-canvas/src/craft.json words them (white space collapsed, code and bold marks
// aside), and counts at most 16,700 tokens by gpt-tokenizer 4.0.0's o200k_base. The same check on the merge base's
// canvas skill (fixtures/base-canvas-SKILL.md) fails, naming its count.
// Wrong program: the merge base, whose section "Craft checks (craft@1)" writes each check in full.
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { tokens } from '../2697/helpers.ts';
import { AC, BASE_CANVAS, CANVAS, CEILING, failsNaming, none, read, wordsFailures } from './helpers.ts';

test(`${AC.words} the canvas skill holds no craft check's description, threshold or fix and is at most ${CEILING} tokens by the pinned tokenizer, and the merge base's fails, naming its count`, () => {
  const skill = read(CANVAS);
  const base = readFileSync(BASE_CANVAS, 'utf8');
  console.log(`${CANVAS}: ${tokens(skill)} tokens; the merge base's: ${tokens(base)} tokens`);
  none(wordsFailures(skill, CANVAS), `${CANVAS} against craft.json and the ceiling`);
  failsNaming(wordsFailures(base, 'the merge base\'s canvas skill'), [String(tokens(base))], 'the merge base\'s canvas skill');
});
