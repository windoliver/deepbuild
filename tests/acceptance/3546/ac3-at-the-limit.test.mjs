// Criterion 3 (#3546.bf38895d): a fixture issue at the limit, its sections 25,000 tokens, prints its text, byte-equal
// to the merge base's. #9549 is #9548 with a last section one token smaller. The byte-equal text is what the merge base
// prints already; that the script counts this issue at the limit is new, and its closing line says so. The planted
// program is planted/outline-at-limit.mjs, which prints the outline from the limit on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT, BASE_SECTION, baseHolds, cachedIssues, closing, closingProblems, firstRead, fixtureHolds, LIMIT, n, none, runIn, scratch, SECTION, SECTION_ISSUES, sectionDocs, TD, textProblems } from './helpers.mjs';

const ARGS = ['--issue', String(AT.number)];

test('#3546.bf38895d AC3 an issue whose sections total exactly the limit prints its text, byte-equal to the merge base\'s, and its closing line counts 25,000 tokens; a planted script that prints the outline from the limit on fails, naming the count', (t) => {
  const copy = scratch(t, { docs: sectionDocs() });
  fixtureHolds(copy, TD);
  const env = cachedIssues(copy, SECTION_ISSUES);
  const read = firstRead(copy, AT);
  const base = runIn(copy, BASE_SECTION, ARGS, { env });
  baseHolds(base, read);
  const run = runIn(copy, SECTION, ARGS, { env });
  const problems = [...textProblems(run, base, read), ...closingProblems(run)];
  if (!problems.length && closing(run).tokens !== LIMIT) problems.push(`the closing line gives ${n(closing(run).tokens)} tokens, not the ${n(LIMIT)} this issue's sections hold: the limit`);
  none(problems, `${SECTION} ${ARGS.join(' ')} doesn't print #${AT.number}'s text as the merge base does and count it at the limit:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, null, ARGS, { planted: 'outline-at-limit', env });
  assert.ok(planted.status === 0 && planted.stdout.length && !planted.stdout.equals(base.stdout), `the planted script doesn't print something other than #${AT.number}'s text, so it shows nothing here:\n${planted.output}`);
  const caught = textProblems(planted, base, read);
  assert.ok(caught.some((problem) => problem.includes(`total ${n(LIMIT)} tokens, which is the limit`)), `this test passes the planted script that prints the outline at the limit, or fails it without naming the count:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted outline-at-limit.mjs fails: ${caught.join('; ')}`);
});
