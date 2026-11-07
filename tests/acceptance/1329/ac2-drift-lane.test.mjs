// Criterion 2: a planted open issue that names a `deep` command the design doesn't hold fails the drift lane, naming the
// issue and the command, and a planted link to a missing heading fails too. The clean twin passes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOB, cleanBody, commit, fakeGh, laneName, makeFixture, namesIssue, openIssues, plantPlanned, runLanes, sandboxEnv, verdicts } from './helpers.mjs';

// One run of the drift lane alone over the fixture's 40 open issues, `bodies` replacing some.
function driftRun(t, bodies, planted = []) {
  const { sandbox, repo } = makeFixture(t);
  if (planted.length) plantPlanned(repo, planted);
  commit(repo, 'The base', { base: true });
  fakeGh(sandbox, openIssues(bodies));
  const run = runLanes(repo, sandboxEnv(sandbox), ['drift']);
  return { run, name: laneName(run, 'drift') };
}

test('#1329.bbfb846d criterion 2: an open issue (9605, the 36th of 40) naming `deep zorptangle`, which the design doesn\'t hold, fails the drift lane, naming the issue and the command', (t) => {
  const { run, name } = driftRun(t, { 9605: cleanBody(9605, { extra: ['- Run `deep zorptangle` to print the sample.'] }) });
  // A lane that ignores issue bodies, reads only gh's default 30 issues, or checks only links passes here.
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the drift lane's verdict is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0:\n${run.output}`);
  assert.ok(namesIssue(run, 9605, 'deep zorptangle'), `no output line names issue 9605 and \`deep zorptangle\`:\n${run.output}`);
});

test('#1329.bbfb846d criterion 2: an open issue (9605) whose design link is technical-design.md#no-such-heading-1329 fails the drift lane, naming the issue and the link', (t) => {
  const { run, name } = driftRun(t, { 9605: cleanBody(9605, { link: `${BLOB}docs/technical-design.md#no-such-heading-1329` }) });
  // A lane that checks only names, or only that the linked file exists, passes here.
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the drift lane's verdict is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0:\n${run.output}`);
  assert.ok(namesIssue(run, 9605, 'technical-design.md#no-such-heading-1329'), `no output line names issue 9605 and technical-design.md#no-such-heading-1329:\n${run.output}`);
});

test('#1329.bbfb846d criterion 2, clean twin: 40 open issues naming only commands and tools the design holds, linking real headings, and #9601 naming `deep quuxify` and `deep_quuxify` from the planned-names list, pass the drift lane', (t) => {
  const { run, name } = driftRun(
    t,
    { 9601: cleanBody(9601, { extra: ['- `deep quuxify` and the agent tool `deep_quuxify` come with this issue.'] }) },
    [['deep quuxify', 9601], ['deep_quuxify', 9601]],
  );
  // A lane that fails every issue, misreads real commands, tools or headings, or ignores the planned-names list fails here.
  assert.deepEqual(verdicts(run, name), ['PASS'], `the drift lane's verdict on clean issues is PASS:\n${run.output}`);
  assert.equal(run.status, 0, `runLanes didn't return 0:\n${run.output}`);
});
