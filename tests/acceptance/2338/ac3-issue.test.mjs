// Criterion 3 (#2338.64ab4593): from a fixture issue (#9338) that links three sections in four links, alpha twice and
// the plan by its explicit <a id> the-plan, the script prints the three sections once each in the order first linked,
// reading the open issues the lanes read (here the DEEP_OPEN_ISSUES file the shared fetch reads). Without fetched
// issues it prints BLOCKED naming what is missing and exits non-zero. The planted programs are
// planted/once-per-link.mjs (prints four) and planted/blocked-prints-nothing.mjs (prints nothing, exits 0).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE, SECTION, SECTION_DOCS, blockedProblems, cachedIssues, issueProblems, readSections, runIn, scratch } from './helpers.mjs';

const ARGS = ['--issue', String(ISSUE)];

test('#2338.64ab4593 AC3 an issue linking three sections in four links prints the three once each in first-linked order; a planted script that prints a section once per link prints four and fails, naming the count', (t) => {
  const copy = scratch(t, SECTION_DOCS);
  const env = cachedIssues(copy);
  const run = runIn(copy, SECTION, ARGS, { env });
  const problems = issueProblems(run);
  assert.deepEqual(problems, [], `${SECTION} ${ARGS.join(' ')} doesn't print #${ISSUE}'s three sections once each in order:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, SECTION, ARGS, { planted: 'once-per-link', env });
  assert.equal(readSections(planted).sections.length, 4, `the planted script that prints once per link doesn't print four sections, so it shows nothing here:\n${planted.output}`);
  const caught = issueProblems(planted);
  assert.ok(caught.some((problem) => /\bprinted 4 sections, not 3\b/.test(problem)), `this test passes the planted script that prints once per link, or fails it without naming the count 4:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted once-per-link.mjs fails: ${caught.join('; ')}`);
});

test('#2338.64ab4593 AC3 with no fetched issues the script prints BLOCKED naming what is missing, exits non-zero and prints no section; a planted script that prints nothing and exits 0 fails', (t) => {
  // No DEEP_OPEN_ISSUES, and the gh stand-in fails as gh with no sign-in does: no open issues are fetched.
  const copy = scratch(t, SECTION_DOCS);
  const run = runIn(copy, SECTION, ARGS);
  const problems = blockedProblems(run);
  assert.deepEqual(problems, [], `${SECTION} ${ARGS.join(' ')} isn't BLOCKED without the open issues:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, SECTION, ARGS, { planted: 'blocked-prints-nothing' });
  assert.ok(planted.status === 0 && !planted.text.trim(), `the planted script doesn't print nothing and exit 0, so it shows nothing here:\n${planted.output}`);
  const caught = blockedProblems(planted);
  assert.ok(caught.some((problem) => problem.includes('exited 0')) && caught.some((problem) => problem.includes('BLOCKED')), `this test passes the planted script that prints nothing and exits 0:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted blocked-prints-nothing.mjs fails: ${caught.join('; ')}`);
});
