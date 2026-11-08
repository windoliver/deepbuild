// Criterion 1: CONTRIBUTING.md names the docs as the source, and a design change lands with no step outside the repo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BLOB, CHECKOUT, appendRepoFile, cleanBody, commit, fakeGh, laneName, makeFixture, namesIssue, openIssues, runLanes, sandboxEnv, verdicts } from './helpers.mjs';

// CONTRIBUTING.md's blocks: paragraphs, with each list item its own block.
const blocks = (text) => text.split(/\n\s*\n|\n(?=\s*[-*] )/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
const aboutDocs = (block) => /docs\/|technical-design\.md|canvas-primitives\.md|design doc/i.test(block);

test('#1329.6069ef82 criterion 1: CONTRIBUTING.md names docs/technical-design.md and docs/canvas-primitives.md as the source, and no longer says docs/ is generated or not to be edited', () => {
  const text = readFileSync(join(CHECKOUT, 'CONTRIBUTING.md'), 'utf8');
  const all = blocks(text);
  // The base's "`docs/` is generated from the design, so don't edit it in a feature pull request" fails both of these.
  const generated = all.filter((b) => aboutDocs(b) && /\b(?:is|are)\s+generated\b|\bgenerated\s+from\b/i.test(b));
  assert.deepEqual(generated, [], 'CONTRIBUTING.md still says the docs are generated');
  const noEdit = all.filter((b) => aboutDocs(b) && /\b(?:don't|do not|never)\s+edit\b/i.test(b));
  assert.deepEqual(noEdit, [], 'CONTRIBUTING.md still says not to edit the docs');
  const source = all.filter((b) => /\bsource\b/i.test(b)
    && ((b.includes('technical-design.md') && b.includes('canvas-primitives.md')) || b.includes('docs/')));
  assert.ok(source.length, `no paragraph or list item of CONTRIBUTING.md names the docs (docs/, or technical-design.md and canvas-primitives.md) as the source:\n${text}`);
});

test('#1329.6069ef82 criterion 1: a design change committed in the repo is what the lanes read: an open issue naming `deep zorptangle` and its heading fails the drift lane before it, and the drift, design links and public-text lanes pass after it', (t) => {
  const { sandbox, repo } = makeFixture(t);
  commit(repo, 'The base', { base: true });
  const heading = 'technical-design.md#zorptangle-fixture-command';
  fakeGh(sandbox, openIssues({
    9605: cleanBody(9605, { link: `${BLOB}docs/${heading}`, extra: ['- `deep zorptangle` prints the sample this issue builds.'] }),
  }));
  const env = sandboxEnv(sandbox);

  // Before the design change, the issue's command and heading aren't in the design.
  const before = runLanes(repo, env, ['drift']);
  const drift = laneName(before, 'drift');
  assert.deepEqual(verdicts(before, drift), ['FAIL'], `before the design change, the drift lane's verdict is FAIL:\n${before.output}`);
  assert.ok(namesIssue(before, 9605, 'deep zorptangle'), `before the design change, no output line names issue 9605 and \`deep zorptangle\`:\n${before.output}`);

  // The design change: a commit to docs/technical-design.md in the repo, and nothing else.
  appendRepoFile(repo, 'docs/technical-design.md', [
    '## Zorptangle fixture command',
    '',
    'A fixture section for #1329\'s acceptance tests: `deep zorptangle` prints a sample. It is not part of the design.',
  ].join('\n'));
  commit(repo, 'Design: the zorptangle command');

  // After it, on the doc lanes, with no step outside the repo: no generation, no publish, no other login.
  const after = runLanes(repo, env, ['drift', 'links', 'public']);
  for (const key of ['drift', 'links', 'public']) {
    const name = laneName(after, key);
    assert.deepEqual(verdicts(after, name), ['PASS'], `after the design change, the ${key} lane (${name}) doesn't pass:\n${after.output}`);
  }
  assert.equal(after.status, 0, `runLanes didn't return 0 after the design change:\n${after.output}`);
});
