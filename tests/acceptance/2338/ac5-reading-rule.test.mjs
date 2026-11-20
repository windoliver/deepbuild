// Criterion 5 (#2338.a3eb5a70): AGENTS.md and CONTRIBUTING.md state the reading rule in the same words, AGENTS.md's
// first rule being "Read the design sections your issue links before edits", held by a text check the lint lane runs
// (scripts/reading-rule.mjs) that fails when one file is edited alone, naming both lines. The edits are planted in
// scratch copies; the planted program is planted/agents-only.mjs, a check that reads AGENTS.md alone.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, EDITED, PHRASE, RULE, editRule, lineOf, lintCommand, namesBothProblems, rulePassProblems, runIn, runInCheckout, scratch, sentenceFrom } from './helpers.mjs';

test('#2338.a3eb5a70 AC5 AGENTS.md\'s first rule is the reading rule, CONTRIBUTING.md states it in the same words, and the lint lane\'s text check passes on this checkout', async () => {
  assert.ok(existsSync(join(CHECKOUT, RULE)), `${RULE} does not exist: the text check #2338 asks for isn't in this checkout`);
  const agents = readFileSync(join(CHECKOUT, 'AGENTS.md'), 'utf8');
  const contributing = readFileSync(join(CHECKOUT, 'CONTRIBUTING.md'), 'utf8');
  // The first rule: the first sentence of the first line after the title.
  const first = agents.split('\n').slice(1).find((line) => line.trim()) ?? '';
  assert.ok(first.startsWith(PHRASE), `AGENTS.md's first rule isn't "${PHRASE}": its first line after the title is "${first}"`);
  const rule = sentenceFrom(first, PHRASE);
  assert.ok(contributing.split('\n').some((line) => line.includes(rule)), `CONTRIBUTING.md doesn't state AGENTS.md's reading rule in the same words: "${rule}"`);

  const run = runInCheckout(await lintCommand(RULE));
  const problems = rulePassProblems(run);
  assert.deepEqual(problems, [], `the lint lane's ${RULE} doesn't pass on this checkout:\n${problems.join('\n')}\n\n${run.output}`);
});

test('#2338.a3eb5a70 AC5 the text check fails when AGENTS.md or CONTRIBUTING.md is edited alone, naming both lines, and passes when both are; a planted check that reads AGENTS.md alone fails this test', (t) => {
  assert.ok(existsSync(join(CHECKOUT, RULE)), `${RULE} does not exist: the text check #2338 asks for isn't in this checkout`);
  const lines = (copy) => {
    const read = (file) => readFileSync(join(copy.repo, file), 'utf8');
    const at = (file) => lineOf(read(file), EDITED) || lineOf(read(file), PHRASE);
    return [at('AGENTS.md'), at('CONTRIBUTING.md')];
  };
  const results = [];
  for (const file of ['AGENTS.md', 'CONTRIBUTING.md']) {
    const copy = scratch(t, {});
    editRule(copy, [file]);
    const run = runIn(copy, RULE, []);
    const [agentsLine, contributingLine] = lines(copy);
    results.push({ copy, run, problems: namesBothProblems(run, agentsLine, contributingLine).map((p) => `${file} edited alone: ${p}`) });
  }
  const problems = results.flatMap(({ problems: found }) => found);
  assert.deepEqual(problems, [], `${RULE} doesn't fail an edit of one file alone, naming both lines:\n${problems.join('\n')}\n\n${results.map(({ run }) => run.output).join('\n\n')}`);

  const both = scratch(t, {});
  editRule(both, ['AGENTS.md', 'CONTRIBUTING.md']);
  const together = runIn(both, RULE, []);
  const togetherProblems = rulePassProblems(together);
  assert.deepEqual(togetherProblems, [], `${RULE} fails though both files were edited to the same words:\n${togetherProblems.join('\n')}\n\n${together.output}`);

  // CONTRIBUTING.md edited alone, against the check that reads AGENTS.md alone.
  const { copy } = results[1];
  const planted = runIn(copy, RULE, [], { planted: 'agents-only' });
  assert.equal(planted.status, 0, `the planted check that reads AGENTS.md alone doesn't pass CONTRIBUTING.md edited alone, so it shows nothing here:\n${planted.output}`);
  const [agentsLine, contributingLine] = lines(copy);
  const caught = namesBothProblems(planted, agentsLine, contributingLine);
  assert.ok(caught.some((problem) => problem.includes('exited 0')), `this test passes the planted check that reads AGENTS.md alone:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted agents-only.mjs fails: ${caught.join('; ')}`);
});
