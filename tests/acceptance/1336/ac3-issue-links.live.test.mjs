// Criterion 3 (live: needs network and gh signed in with read access to windoliver/deepbuild): #1337, #1338, #1339 and
// #1340 each link into the new section, a `docs/technical-design.md#<anchor>` link whose anchor is the section's slug or
// one of its `<a id>`s. Offline or signed out it skips as INCONCLUSIVE; it never passes then.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { findSection, readDesign } from './helpers.mjs';

const REPO = 'windoliver/deepbuild';
const ISSUES = [1337, 1338, 1339, 1340];

test('#1336.0ffe6c3b criterion 3 (live): #1337, #1338, #1339 and #1340 each have a body link into the new section of docs/technical-design.md', (t) => {
  const section = findSection(readDesign());
  assert.ok(section, 'docs/technical-design.md has no heading holding the words "hub" and "project", so there is no new section for the issues to link into');
  const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (auth.status !== 0) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't reach GitHub, so the issues can't be read: ${`${auth.error?.message ?? ''}${auth.stderr ?? ''}`.trim()}`);
    return;
  }
  const missing = [];
  for (const number of ISSUES) {
    const gh = spawnSync('gh', ['issue', 'view', String(number), '--repo', REPO, '--json', 'body'], { encoding: 'utf8' });
    if (gh.status !== 0) {
      t.skip(`INCONCLUSIVE: gh couldn't read #${number}: ${`${gh.error?.message ?? ''}${gh.stderr ?? ''}`.trim()}`);
      return;
    }
    const body = JSON.parse(gh.stdout).body ?? '';
    const links = [...body.matchAll(/technical-design\.md#([^\s)"'>\]]+)/g)].map((m) => decodeURIComponent(m[1]));
    if (!links.some((anchor) => section.anchors.includes(anchor))) missing.push(`#${number} links only to ${links.map((a) => `#${a}`).join(', ') || 'no design anchor'}`);
  }
  assert.deepEqual(missing, [], `these issues don't link into the section "${section.heading}" (${section.anchors.map((a) => `#${a}`).join(', ')})`);
});
