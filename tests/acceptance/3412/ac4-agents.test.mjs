// AC4: AGENTS.md names GLOSSARY.md in one line; a planted AGENTS.md without the line fails, naming the file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, GLOSSARY, checkoutFile, commit, laneEnv, makeCopy, names, plantFile, runLintLane, startingGlossary, summary } from './helpers.mjs';

const ID = '#3412.4a7a02a4';
const naming = (line) => line.includes(GLOSSARY);

test(`${ID} AC4: AGENTS.md names GLOSSARY.md in one line`, () => {
  const lines = checkoutFile(AGENTS).split('\n').filter(naming);
  assert.equal(lines.length, 1, `${AGENTS} names ${GLOSSARY} in ${lines.length} lines, not one`);
});

test(`${ID} AC4: a planted AGENTS.md without the line fails, naming the file`, { timeout: 1_200_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const env = laneEnv(sandbox);
  // Both runs hold a glossary, the checkout's or else the issue's draft, so only the AGENTS.md line differs.
  plantFile(repo, GLOSSARY, startingGlossary());
  commit(repo, 'change: the glossary');
  const before = await runLintLane(repo, env);
  assert.ok(!before.missing, before.missing);
  const seenBefore = new Set(before.runs.flatMap((r) => r.lines.map((l) => `${r.name}: ${l}`)));

  plantFile(repo, AGENTS, checkoutFile(AGENTS).split('\n').filter((l) => !naming(l)).join('\n'));
  commit(repo, 'change: AGENTS.md without its glossary line');
  const after = await runLintLane(repo, env);
  // A line naming AGENTS.md that a failing command prints only once the line is gone.
  const named = after.runs.filter((r) => r.status !== 0)
    .flatMap((r) => r.lines.filter((l) => names(l, AGENTS)).map((l) => `${r.name}: ${l}`)).filter((l) => !seenBefore.has(l));
  assert.ok(named.length, `no failing lint lane command names ${AGENTS} once its line naming ${GLOSSARY} is gone\n${summary(after)}`);
});
