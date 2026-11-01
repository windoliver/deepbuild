// The clean case and the Proof's count: the real docs with clean open issues pass the lane, which reports how many
// links it checked. This guards the planted tests: a lane that always fails fails here. And the Scope's reuse of the
// drift lane's cached open-issue fetch: across both lanes, gh lists the open issues once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docLinks, fakeGh, ghCalls, issueTargets, laneName, laneOutput, makeFixture, openIssues, runLane, sandboxEnv, verdicts } from './helpers.mjs';

test('clean: the real docs and 40 clean open issues pass the lane, and its output reports a count of links checked no lower than the distinct links there are', (t) => {
  const { sandbox, repo } = makeFixture(t);
  const issues = openIssues();
  fakeGh(sandbox, { issues });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  // A lane that fails every link, slugs differently from GitHub (keeps punctuation, keeps case, drops `_`, numbers no
  // duplicates) or ignores explicit <a id> anchors fails here, on the real docs' links or the issues'.
  assert.deepEqual(verdicts(run, name), ['PASS'], `the lane's verdict on clean data is PASS:\n${run.output}`);
  assert.equal(run.status, 0, `runLanes didn't return 0:\n${run.output}`);
  // The Proof asks for the lane's count of links checked. However it counts (each link, or each distinct target),
  // the count is at least the number of distinct docs/*.md targets the docs and the issues link.
  const distinct = new Set([...docLinks(repo).map((l) => l.target), ...issueTargets(issues)]).size;
  const counts = laneOutput(run, name).filter((l) => /\blinks?\b/i.test(l))
    .flatMap((l) => [...l.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replaceAll(',', ''))));
  assert.ok(counts.length, `the lane printed no line counting the links it checked:\n${run.output}`);
  assert.ok(Math.max(...counts) >= distinct, `the lane's count of links checked, ${Math.max(...counts)}, is under the ${distinct} distinct docs/*.md targets the docs and issues link:\n${run.output}`);
});

test('scope: run beside the catalogue drift lane, as the preflight runs them, the lane reuses its fetch: gh lists the open issues once', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, { issues: openIssues() });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.deepEqual(verdicts(run, name), ['PASS'], `the lane's verdict on clean data is PASS:\n${run.output}`);
  // A lane that fetches the open issues again fails here.
  const lists = ghCalls(sandbox).filter((args) => args[0] === 'issue' && args[1] === 'list');
  assert.equal(lists.length, 1, `gh issue list ran ${lists.length} times across the drift and links lanes: ${JSON.stringify(lists)}\n${run.output}`);
});
