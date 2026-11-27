// Criterion 2 (#3546.a6d8d944): a fixture issue whose sections total one token over the limit, 25,001, prints only
// headings: one line a heading, each with an anchor that prints with `node scripts/design-section.mjs <doc>#<anchor>`
// and its own tokens, which add up to the total. With `--all` its output is byte-equal to the merge base's. #9548 links
// three sections in five links (one inside another, one twice), six headings in all. The planted program is
// planted/text-past-limit.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorProblems, BASE_SECTION, baseHolds, cachedIssues, closing, closingProblems, firstRead, fixtureHolds, LIMIT, n, none, outlineProblems, OVER, runIn, sameProblems, scratch, SECTION, SECTION_ISSUES, sectionDocs, TD } from './helpers.mjs';

const ARGS = ['--issue', String(OVER.number)];

test('#3546.a6d8d944 AC2 an issue whose sections total one token over the limit prints only headings, one line each with an anchor that prints with the anchor command and its own tokens, which add up to the total; a planted script that prints the text past the limit fails, naming the count', (t) => {
  const copy = scratch(t, { docs: sectionDocs() });
  fixtureHolds(copy, TD);
  const env = cachedIssues(copy, SECTION_ISSUES);
  const read = firstRead(copy, OVER);
  const run = runIn(copy, SECTION, ARGS, { env });
  const problems = outlineProblems(run, read);
  none(problems, `${SECTION} ${ARGS.join(' ')} doesn't print #${OVER.number}'s outline, though its sections total ${n(read.tokens)} tokens, one over the limit of ${n(LIMIT)}:\n${problems.join('\n')}\n\n${run.output}`);
  const unprinted = anchorProblems(copy, read);
  none(unprinted, `an anchor of the outline doesn't print its section with \`node ${SECTION} <doc>#<anchor>\`:\n${unprinted.join('\n')}`);

  const planted = runIn(copy, null, ARGS, { planted: 'text-past-limit', env });
  const base = runIn(copy, BASE_SECTION, ARGS, { env });
  assert.ok(planted.stdout.equals(base.stdout), `the planted script doesn't print #${OVER.number}'s text past the limit, so it shows nothing here:\n${planted.output}`);
  const caught = outlineProblems(planted, read);
  assert.ok(caught.some((problem) => problem.includes(`${n(LIMIT + 1)} tokens`) && problem.includes('1 past the limit')), `this test passes the planted script that prints the text past the limit, or fails it without naming the count:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted text-past-limit.mjs fails: ${caught.join('; ')}`);
});

test('#3546.a6d8d944 AC2 with --all the same issue prints its text, byte-equal to the merge base\'s, and the closing line counts it: one token over the limit', (t) => {
  const copy = scratch(t, { docs: sectionDocs() });
  const env = cachedIssues(copy, SECTION_ISSUES);
  const read = firstRead(copy, OVER);
  const base = runIn(copy, BASE_SECTION, ARGS, { env });
  baseHolds(base, read);
  const run = runIn(copy, SECTION, [...ARGS, '--all'], { env });
  const problems = [...sameProblems(run, base), ...closingProblems(run)];
  if (!problems.length && closing(run).tokens !== LIMIT + 1) problems.push(`the closing line gives ${n(closing(run).tokens)} tokens, not the ${n(LIMIT + 1)} this issue's sections hold`);
  none(problems, `${SECTION} ${ARGS.join(' ')} --all doesn't print #${OVER.number}'s text as the merge base does, counted:\n${problems.join('\n')}\n\n${run.output}`);
});
