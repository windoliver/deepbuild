// #100's criterion on the rendered issues (live: needs network and gh signed in with read access to windoliver/deepbuild):
// no issue, open or closed, has a rope, cloth or solver waiting on a licensing or patent review in its title or body.
// It reads GitHub once and writes nothing. Offline or signed out it skips as INCONCLUSIVE; it never passes then.
// Run: node --test tests/acceptance/100/issues.live.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { waiting } from './reader.mjs';

const REPO = 'windoliver/deepbuild';
// More than the repository's issues: a read that fills it may have been cut short, so it is INCONCLUSIVE.
const LIMIT = 20_000;

test('AC1 #100.acd6f892 (live) a search of the rendered issues finds no rope, cloth or solver of ours waiting on a licensing or patent review', (t) => {
  const gh = spawnSync('gh', ['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', String(LIMIT), '--json', 'number,title,body'], { encoding: 'utf8', maxBuffer: 1 << 29, timeout: 10 * 60_000 });
  let issues = null;
  try {
    if (gh.status === 0) issues = JSON.parse(gh.stdout);
  } catch { /* not JSON: unread, as below */ }
  if (!Array.isArray(issues)) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't read the issues of ${REPO}: ${`${gh.error?.message ?? ''}${gh.stderr ?? ''}`.trim().split('\n')[0] || `exit ${gh.status}`}`);
    return;
  }
  // This issue is among them when the read reached the repository's issues.
  if (issues.length >= LIMIT || !issues.some(({ number }) => number === 100)) {
    t.skip(`INCONCLUSIVE: gh listed ${issues.length} issues of ${REPO}${issues.length >= LIMIT ? ', its limit' : ', #100 not among them'}, so not every issue was searched`);
    return;
  }
  const found = issues.flatMap(({ number, title, body }) => waiting(`${title}\n\n${body ?? ''}`, title).map(({ sentence }) => `#${number} "${title}": ${sentence}`));
  assert.deepEqual(found, [], `the ${issues.length} rendered issues have a rope, cloth or solver waiting on a licensing or patent review in ${found.length} statement${found.length === 1 ? '' : 's'}`);
});
