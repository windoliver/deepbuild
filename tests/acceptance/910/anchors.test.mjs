// The Scope's rule for a good link: the file exists and the anchor is a heading, slugged the way GitHub slugs it, or
// an explicit <a id>. A section appended to the fixture's technical-design.md holds headings whose GitHub slugs are
// worked by hand (README: Slugs); links to those slugs pass, and near misses each fail, named.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOB, appendDoc, fakeGh, laneName, makeFixture, namesIssueLink, openIssues, runLane, sandboxEnv, verdicts } from './helpers.mjs';

const SECTION = [
  '## Slug fixture: Links, anchors & GitHub (#910)',
  '',
  'A section #910\'s acceptance tests append to a scratch copy. It is not part of the design.',
  '',
  '### The `deep_show` call — modes',
  '',
  '### Café über naïve',
  '',
  '### Twice-named section',
  '',
  '### Twice-named section',
  '',
  '### See [the hub](#arch) and **bold** words',
  '',
  '### 3.2 Numbers, v1.0/v2',
  '',
  '<a id="slug-fixture-explicit"></a>',
  '<a name="slug-fixture-named"></a>',
  '',
  '```md',
  '## Fenced not a heading',
  '```',
  '',
  'Same-doc links to each: [one](#slug-fixture-links-anchors--github-910), [two](#the-deep_show-call--modes),',
  '[three](#café-über-naïve), [four](#twice-named-section), [five](#twice-named-section-1),',
  '[six](#see-the-hub-and-bold-words), [seven](#32-numbers-v10v2), [eight](#slug-fixture-explicit), [nine](#slug-fixture-named).',
].join('\n');

const link = (target) => `${BLOB}docs/${target}`;
const issueLinking = (target, text) => [
  'An issue body for #910\'s acceptance tests. It is not a real issue.',
  '',
  `**Epic:** #5 · **Design:** [${text}](${link(target)})`,
].join('\n');

test('scope: links to GitHub slugs (punctuation dropped, a space each its own hyphen, `_` and Unicode letters kept, markdown reduced to text, duplicates numbered) and to <a id> and <a name> anchors pass', (t) => {
  const { sandbox, repo } = makeFixture(t);
  appendDoc(repo, 'docs/technical-design.md', SECTION);
  fakeGh(sandbox, {
    issues: openIssues({
      9639: issueLinking('technical-design.md#slug-fixture-links-anchors--github-910', 'Slug fixture'),
      9638: issueLinking('technical-design.md#the-deep_show-call--modes', 'The deep_show call'),
      9637: issueLinking('technical-design.md#twice-named-section-1', 'The second twice-named section'),
      9636: issueLinking('technical-design.md#see-the-hub-and-bold-words', 'See the hub'),
      9635: issueLinking('technical-design.md#32-numbers-v10v2', 'Numbers'),
      9634: issueLinking('technical-design.md#slug-fixture-explicit', 'An explicit anchor'),
    }),
  });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  // A slugger that collapses hyphens, drops `_` or non-ASCII letters, keeps link markup or punctuation, numbers no
  // duplicates, or a lane that ignores <a id>/<a name>, fails a good link here.
  assert.deepEqual(verdicts(run, name), ['PASS'], `the lane's verdict is PASS when every link lands on a GitHub slug or an explicit anchor:\n${run.output}`);
  assert.equal(run.status, 0, run.output);
});

test('scope: near misses of those slugs, a heading inside fenced code and a missing docs file each fail the lane, each named with its issue', (t) => {
  const { sandbox, repo } = makeFixture(t);
  appendDoc(repo, 'docs/technical-design.md', SECTION);
  const bad = {
    9601: 'technical-design.md#slug-fixture-links-anchors-github-910', // hyphens collapsed
    9602: 'technical-design.md#the-deep_show-call-modes', // hyphens collapsed
    9603: 'technical-design.md#the-deepshow-call--modes', // `_` dropped
    9604: 'technical-design.md#twice-named-section-2', // there is no third
    9606: 'technical-design.md#see-the-hubarch-and-bold-words', // link markup kept
    9607: 'technical-design.md#fenced-not-a-heading', // a line in fenced code is not a heading
    9608: 'technical-design.md#caf-ber-nave', // non-ASCII letters dropped
    9609: 'no-such-design.md#overview', // the file doesn't exist
  };
  fakeGh(sandbox, { issues: openIssues(Object.fromEntries(Object.entries(bad).map(([n, target]) => [n, issueLinking(target, 'A near miss')]))) });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  assert.notEqual(run.status, 0, run.output);
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the lane's verdict is FAIL:\n${run.output}`);
  const missed = Object.entries(bad).filter(([n, target]) => !namesIssueLink(run, n, target)).map(([n, target]) => `#${n} ${target}`);
  assert.deepEqual(missed, [], `no output line names these issues with their links:\n${run.output}`);
});
