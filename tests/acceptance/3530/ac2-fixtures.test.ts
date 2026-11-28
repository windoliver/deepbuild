import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { titlePrefix, bakeCall, blocked, debugLogicAnswers, logicDebug, expectNoProblems, prebuild } from './helpers.ts';
import { judgeFixtures, type Recording } from './judges.ts';

const ID = titlePrefix(2);
prebuild(logicDebug);
const RECORDING = join(dirname(fileURLToPath(import.meta.url)), 'base.json');

it(`${ID} every fixture of #531 reaches the step hashes and full-state hashes it reached on the merge base, and each step is charged the fuel it was charged there`, () => {
  if (!existsSync(RECORDING)) blocked('tests/acceptance/3530/base.json, the merge base\'s recording, is missing');
  const base = JSON.parse(readFileSync(RECORDING, 'utf8')) as Recording;
  const fixtures = Object.keys(base.items);
  expect([fixtures.length, base.steps], 'the recording holds #531\'s 14 fixtures over 60 steps').toEqual([14, 60]);
  const [reply] = debugLogicAnswers([bakeCall(base.piece, base.steps, base.track)], 10 * 60_000);
  const problems = judgeFixtures(base, reply!);
  expectNoProblems(problems, `${ID}: #531's fixtures differ from the merge base's bake (${base.commit.slice(0, 9)}, tests/acceptance/3530/base.json)`);
}, 12 * 60_000);
