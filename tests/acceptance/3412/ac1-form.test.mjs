// AC1: GLOSSARY.md is at the repo root and the lint lane's check passes on it; a planted entry of three sentences
// fails, naming the term. The other two plants are in ac1-plants.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLOSSARY, TERM, checkoutFile, commit, laneEnv, makeCopy, names, plantedRun, runLintLane, summary } from './helpers.mjs';

const ID = '#3412.5946d19d';
const THREE = `**${TERM}**:\nA fixture term the acceptance tests of this task plant. It names nothing real. It is one sentence too long.`;

// One three-sentence plant run serves both tests that need it, so this file stays under 20 minutes.
let three;
const threeRun = (t) => (three ??= plantedRun(t, [THREE], 'change: a three-sentence entry'));

test(`${ID} AC1: GLOSSARY.md is at the repo root and the lint lane's check passes on it`, { timeout: 1_200_000 }, async (t) => {
  assert.ok(checkoutFile(GLOSSARY) !== undefined, `${GLOSSARY} is not at the repo root of the checkout`);

  // The copy as the checkout has it: no command's line that starts with a non-PASS verdict word names GLOSSARY.md.
  const { sandbox, repo } = makeCopy(t);
  commit(repo, 'change: nothing more');
  const env = laneEnv(sandbox);
  const real = await runLintLane(repo, env);
  assert.ok(!real.missing, real.missing);
  const against = real.runs.flatMap((r) => r.lines.filter((l) => names(l, GLOSSARY) && /^\s*(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(l)).map((l) => `${r.name}: ${l}`));
  assert.deepEqual(against, [], `the lint lane has lines against ${GLOSSARY}:\n${against.join('\n')}`);

  // Some command reads it: the one that fails, naming the term, once a three-sentence entry is planted. That same
  // command must pass on the glossary as it is.
  const { lane, named } = await threeRun(t);
  const checks = [...new Set(named.map((l) => l.split(': ')[0]))];
  assert.ok(checks.length, `no lint lane command reads ${GLOSSARY}: a planted three-sentence entry made no failing command name "${TERM}"\n${summary(lane)}`);
  for (const name of checks) {
    const run = real.runs.find((r) => r.name === name);
    assert.equal(run?.status, 0, `the lint lane's check (${name}) does not pass on ${GLOSSARY}:\n${run?.lines.join('\n')}`);
  }
});

test(`${ID} AC1: a planted entry of three sentences fails, naming the term`, { timeout: 1_200_000 }, async (t) => {
  const { lane, named } = await threeRun(t);
  assert.ok(!lane.missing, lane.missing);
  assert.ok(named.length, `no failing lint lane command names "${TERM}" for its three-sentence entry\n${summary(lane)}`);
});
