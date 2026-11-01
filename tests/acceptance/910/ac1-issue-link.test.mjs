// Criterion 1: a planted issue body linking technical-design.md#no-such-heading fails the lane, naming the issue
// and the link.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOB, fakeGh, laneName, makeFixture, namesIssueLink, openIssues, runLane, sandboxEnv, verdicts } from './helpers.mjs';

test('#910.ed201fe7 criterion 1: an open issue body linking technical-design.md#no-such-heading fails the lane, naming issue 9605 (the 36th of 40) and the link', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, {
    issues: openIssues({
      9605: [
        'A planted issue body for #910\'s acceptance tests. It is not a real issue.',
        '',
        `**Epic:** #5 · **Design:** [The rule this issue follows](${BLOB}docs/technical-design.md#no-such-heading)`,
        '',
        '### Scope',
        `- A change in [scripts/checks.mjs](${BLOB}scripts/checks.mjs).`,
      ].join('\n'),
    }),
  });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.notEqual(run.status, 0, `the checks passed with an issue linking a heading that doesn't exist:\n${run.output}`);
  // A lane that ignores issue bodies, checks only that the file exists, reads only gh's default 30 issues, or
  // reports the failure as another state, fails here.
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the lane's verdict is FAIL:\n${run.output}`);
  assert.ok(namesIssueLink(run, 9605, 'technical-design.md#no-such-heading'), `no output line names issue 9605 and technical-design.md#no-such-heading:\n${run.output}`);
});
