// Criterion 6 (#3546.c49452fc): the text check #2338 added still holds: a planted edit of one file's sentence alone
// fails, naming both lines. The Scope has AGENTS.md and CONTRIBUTING.md say what the script now does in the same words;
// the sentence is found in each file as the one that names the limit, 25,000. The check is the lint lane's
// scripts/reading-rule.mjs. The edits are planted in a scratch copy: the limit's sentence in one file alone, and the
// reading rule's, which the check held before. The planted program is planted/first-sentence-only.mjs, a check that
// holds the reading rule's sentence alone.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, editLine, laneCommands, limitSentence, namesBothProblems, none, PHRASE, PHRASE_EDITED, read, RULE, rulePassProblems, runCommands, runIn, runInCheckout, scratch } from './helpers.mjs';

const FILES = ['AGENTS.md', 'CONTRIBUTING.md'];
/** The sentence with three words more, still one sentence that names the limit. */
const edited = (sentence) => sentence.replace(/\.?$/, ' and no more.');
const lineOf = (text, words) => text.split('\n').findIndex((line) => line.includes(words)) + 1;

test('#3546.c49452fc AC6 AGENTS.md and CONTRIBUTING.md each hold one sentence that names the limit, 25,000, in the same words, and the lint lane\'s text check passes on this checkout', () => {
  const { agents, contributing, same } = limitSentence(...FILES.map((file) => read(CHECKOUT, file)));
  assert.ok(agents, 'AGENTS.md holds no sentence that names the limit, 25,000: it doesn\'t say that an issue\'s sections past 25,000 tokens print as an outline');
  assert.ok(contributing, `CONTRIBUTING.md holds no sentence that names the limit, 25,000, where AGENTS.md:${agents.line} says "${agents.sentence}"`);
  assert.ok(same, `AGENTS.md:${agents.line} and CONTRIBUTING.md:${contributing.line} don't name the limit in the same words: "${agents.sentence}" and "${contributing.sentence}"`);

  const { rule } = laneCommands();
  assert.ok(rule, `the lint lane runs no ${RULE}, the text check #2338 added`);
  const run = runInCheckout(RULE, rule);
  const problems = rulePassProblems(run);
  none(problems, `the lint lane's ${RULE} doesn't pass on this checkout:\n${problems.join('\n')}\n\n${run.output}`);
});

test('#3546.c49452fc AC6 the text check fails when the limit\'s sentence is edited in AGENTS.md or CONTRIBUTING.md alone, naming both lines, as it still does for the reading rule\'s sentence; a planted check that holds the reading rule\'s sentence alone fails this test', (t) => {
  const copy = scratch(t);
  const original = Object.fromEntries(FILES.map((file) => [file, read(copy.repo, file)]));
  const restore = () => { for (const file of FILES) writeFileSync(join(copy.repo, file), original[file]); };
  const { agents, contributing, same } = limitSentence(...FILES.map((file) => original[file]));
  assert.ok(same, 'AGENTS.md and CONTRIBUTING.md hold no one sentence that names the limit, 25,000, so no edit of it can be planted');
  const { rule } = laneCommands();
  assert.ok(rule, `the lint lane runs no ${RULE}, the text check #2338 added`);
  const check = (what) => runCommands(copy, `${RULE}, with ${what}`, [rule]);

  const clean = check('nothing edited');
  const cleanProblems = rulePassProblems(clean);
  none(cleanProblems, `${RULE} doesn't pass the copy with nothing edited, so a failure after an edit would show nothing:\n${cleanProblems.join('\n')}\n\n${clean.output}`);

  const problems = [];
  const judge = (run, lines) => { for (const problem of namesBothProblems(run, ...lines)) problems.push(`${problem}\n${run.output}`); };
  const limitLines = [agents.line, contributing.line];
  const ruleLines = FILES.map((file) => lineOf(original[file], PHRASE));
  for (const [i, file] of FILES.entries()) {
    restore();
    const { line, sentence } = [agents, contributing][i];
    editLine(copy, file, line, sentence, edited(sentence));
    judge(check(`${file}:${line}'s sentence on the limit edited alone`), limitLines);
    restore();
    editLine(copy, file, ruleLines[i], PHRASE, PHRASE_EDITED);
    judge(check(`${file}:${ruleLines[i]}'s reading rule edited alone`), ruleLines);
  }
  none(problems, `${RULE} doesn't fail an edit of one file's sentence alone, naming both lines:\n${problems.join('\n\n')}`);

  // CONTRIBUTING.md's sentence on the limit edited alone, against the check that holds the reading rule's sentence alone.
  restore();
  editLine(copy, 'CONTRIBUTING.md', contributing.line, contributing.sentence, edited(contributing.sentence));
  const planted = runIn(copy, null, [], { planted: 'first-sentence-only' });
  assert.equal(planted.status, 0, `the planted check that holds the reading rule's sentence alone doesn't pass CONTRIBUTING.md's sentence on the limit edited alone, so it shows nothing here:\n${planted.output}`);
  const caught = namesBothProblems(planted, ...limitLines);
  assert.ok(caught.some((problem) => problem.includes('exited 0')), `this test passes the planted check that holds the reading rule's sentence alone:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted first-sentence-only.mjs fails: ${caught.join('; ')}`);
});
