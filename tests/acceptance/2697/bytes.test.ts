// AC5 #2697.2d464f5e: "Two sessions started a minute apart receive byte-identical skill text"
//
// A session receives the skill as `deep setup` installs it: skills/deepbuild, copied from the checkout, whose SKILL.md
// `node scripts/skill.mjs` writes from `generate()`. asserts: `generate()`'s skill, from two fresh Node processes whose
// clocks read 61 s apart (the second's Date moved a minute ahead by a preload: tests move time, never wait for it), is
// the same text, character for character, and is skills/deepbuild/SKILL.md, the bytes setup copies. The same comparison
// fails a planted text that states each start's clock time, naming the second start's time.
// Wrong program: twins/skill-names-its-time (the merge base's scripts/skill.mjs, its craft line stating the clock time
// it was generated at).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { AC, REPO, SKILL, generatedSkill, none, sameFailures, useCleanup } from './helpers.ts';

useCleanup();
const MINUTE_MS = 61_000;
const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

test(`${AC.bytes} two sessions started a minute apart receive byte-identical skill text, the checkout's SKILL.md; a planted text holding the clock time fails, naming it`, () => {
  const startedAt = Date.now();
  const first = generatedSkill(REPO);
  const second = generatedSkill(REPO, MINUTE_MS);
  expect(first.failure, 'the first start generates the skill').toBeUndefined();
  expect(second.failure, 'the second start generates the skill').toBeUndefined();
  none(sameFailures(first.text, second.text, 'the two starts\' skill texts, a minute apart,'), 'two starts a minute apart receive the same skill');
  none(sameFailures(second.text, readFileSync(SKILL, 'utf8'), 'the skill a start generates and skills/deepbuild/SKILL.md, which setup copies,'), 'a start receives the checkout\'s skill');

  const later = clock(startedAt + MINUTE_MS);
  const planted = sameFailures(`${first.text}\nGenerated at ${clock(startedAt)}.\n`, `${second.text}\nGenerated at ${later}.\n`, 'the planted texts');
  expect(planted.some((f) => f.includes(later.slice(-2))), `the planted text holding the clock time fails, naming it (${clock(startedAt)} then ${later}): ${planted.join(' | ') || 'it passed'}`).toBe(true);
}, 1_200_000);
