// Criterion 2: a heading renamed in a fixture design doc fails every doc line that links its old slug, naming each.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docLinks, fakeGh, laneName, makeFixture, namesDocLine, openIssues, renameHeading, runLane, sandboxEnv, verdicts } from './helpers.mjs';

/** Renames one heading in the fixture, runs the lane with clean open issues, and checks each linking doc line is named. */
function renamed(t, { doc, from, to, slug, atLeast }) {
  const { sandbox, repo } = makeFixture(t);
  const target = `${doc}#${slug}`;
  const linking = docLinks(repo).filter((l) => l.target === target);
  // The fixture is the real docs: if they stop linking this heading, this test needs a new heading, not a pass.
  assert.ok(linking.length >= atLeast, `the docs link ${target} from ${linking.length} lines, fewer than the ${atLeast} this test needs`);
  renameHeading(repo, doc, from, to);
  fakeGh(sandbox, { issues: openIssues() });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.notEqual(run.status, 0, `the checks passed with ${linking.length} doc lines linking the renamed heading's old slug:\n${run.output}`);
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the lane's verdict is FAIL:\n${run.output}`);
  // A lane that reads only the issues, names only the first bad line, or names the anchor without the line, fails here.
  const missed = linking.filter((l) => !namesDocLine(run, l.doc, l.line, slug)).map((l) => `${l.doc}:${l.line}`);
  assert.deepEqual(missed, [], `these doc lines link #${slug} and no output line names them with the anchor:\n${run.output}`);
}

test('#910.4dcc6995 criterion 2: renaming canvas-primitives.md\'s "Canvas module: interface and implementation" fails each technical-design.md line that links its old slug, naming each', (t) => {
  renamed(t, {
    doc: 'docs/canvas-primitives.md',
    from: '#### Canvas module: interface and implementation',
    to: '#### Canvas module: its interface and its implementation',
    slug: 'canvas-module-interface-and-implementation',
    atLeast: 2,
  });
});

test('#910.4dcc6995 criterion 2: renaming technical-design.md\'s "How we know version 0 works" fails each doc line that links its old slug from the same doc, naming each', (t) => {
  renamed(t, {
    doc: 'docs/technical-design.md',
    from: '## How we know version 0 works',
    to: '## How we know version 0 holds',
    slug: 'how-we-know-version-0-works',
    atLeast: 1,
  });
});
