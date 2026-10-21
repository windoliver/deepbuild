// Criterion 1, offline half: the lane fails on a planted doc line and on a planted issue body, naming each
// kind and where, and passes on the real docs (the five names rewritten) with clean open issues.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGh, ghCalls, laneName, makeFixture, openIssues, plantDocLine, runLane, sandboxEnv, verdicts } from './helpers.mjs';

// A line naming the kind and its source; a lane that drops either, or names one without the other, fails here.
const naming = (run, kind, where) => run.lines.find((line) => line.includes(kind) && where.test(line));

test('criterion 1: a planted doc line naming verdict.imagined, an uncatalogued kind in the catalogued verdict family, fails the lane, naming the kind and docs/canvas-primitives.md', (t) => {
  const { sandbox, repo } = makeFixture(t);
  plantDocLine(repo, 'docs/canvas-primitives.md', 'When a check is made up, the hub appends `verdict.imagined` beside the verdict it replaces.');
  fakeGh(sandbox, { issues: openIssues() });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.notEqual(run.status, 0, `the lane passed a doc naming verdict.imagined:\n${run.output}`);
  assert.deepEqual(verdicts(run, name).map((l) => l.split(' ')[0]), ['FAIL'], `the lane's verdict is FAIL:\n${run.output}`);
  // A lane that reads only the issues, or names the kind without the file, fails here.
  assert.ok(naming(run, 'verdict.imagined', /canvas-primitives\.md/), `no line names verdict.imagined and canvas-primitives.md:\n${run.output}`);
});

test('criterion 1: a planted open issue body that calls claim.imagined an event kind fails the lane, naming the kind and the issue, #9605 (the 36th of 40 open issues)', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, {
    issues: openIssues([
      'A planted issue body (#605\'s acceptance tests). It is not a real issue.',
      '',
      '### Scope',
      '- When the agent claims work it never did, the hub appends the event kind `claim.imagined`, and `verdict.made` follows.',
    ].join('\n')),
  });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.notEqual(run.status, 0, `the lane passed an open issue naming claim.imagined:\n${run.output}`);
  assert.deepEqual(verdicts(run, name).map((l) => l.split(' ')[0]), ['FAIL'], `the lane's verdict is FAIL:\n${run.output}`);
  // A lane that ignores issue bodies, or keeps gh's default limit of 30 and never sees #9605, fails here.
  assert.ok(naming(run, 'claim.imagined', /(?<!\d)9605(?!\d)/), `no line names claim.imagined and issue 9605:\n${run.output}`);
});

test('criterion 1: the real docs, with the five names rewritten, and 40 clean open issues pass the lane, which fetched them with gh issue list --state open --json number,body', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, { issues: openIssues() });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  // On docs that still name verdict.created, claim.point, user.pivot, reading.overflow or layer.unsupported
  // in backticks, the lane fails here, naming them.
  for (const kind of ['verdict.created', 'claim.point', 'user.pivot', 'reading.overflow', 'layer.unsupported']) {
    assert.equal(run.lines.some((l) => l.includes(kind)), false, `the lane still names ${kind}:\n${run.output}`);
  }
  assert.equal(run.status, 0, `the lane didn't pass:\n${run.output}`);
  assert.deepEqual(verdicts(run, name).map((l) => l.split(' ')[0]), ['PASS'], `the lane's verdict is PASS:\n${run.output}`);
  const list = ghCalls(sandbox).filter((args) => args[0] === 'issue' && args[1] === 'list');
  assert.ok(list.length >= 1, `the lane never ran gh issue list: ${JSON.stringify(ghCalls(sandbox))}`);
  for (const args of list) {
    const json = args.find((a, i) => args[i - 1] === '--json' || a.startsWith('--json='))?.replace(/^--json=/, '') ?? '';
    assert.ok(['number', 'body'].every((f) => json.split(',').includes(f)), `gh issue list asked for --json number,body: ${JSON.stringify(args)}`);
    const state = args.find((a, i) => args[i - 1] === '--state' || a.startsWith('--state='))?.replace(/^--state=/, '') ?? 'open';
    assert.equal(state, 'open', `gh issue list read open issues: ${JSON.stringify(args)}`);
  }
});
