// Criterion 2 (live: needs network and gh signed in with read access to windoliver/deepbuild): the follow-on issues are
// filed, each citing this one and none changing an entry's layout, and between them they cover the three things the
// criterion lists. It finds them as GitHub records them: the issues #3267's timeline shows as citing it, filed after
// it, each then read with `gh issue view`. Offline or signed out it skips as INCONCLUSIVE; it never passes then.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE, REPO, gh, ghDown, judgeFollowOns, said } from './helpers.mjs';

const CRITERION = 'AC2 #3267.426b9145';
const PAGE = 100;

/** The numbers of the issues, no pull requests, filed after #3267 in this repository that GitHub records as citing it. */
function citing() {
  const numbers = new Set();
  for (let page = 1; ; page++) {
    const call = `repos/${REPO}/issues/${ISSUE}/timeline?per_page=${PAGE}&page=${page}`;
    const read = gh(['api', call]);
    if (read.status !== 0) return { why: `gh api ${call} failed: ${said(read)}` };
    let events;
    try {
      events = JSON.parse(read.stdout);
    } catch (error) {
      return { why: `gh api ${call} gave no JSON: ${error.message}` };
    }
    if (!Array.isArray(events)) return { why: `gh api ${call} gave no list` };
    for (const event of events) {
      const from = event?.event === 'cross-referenced' ? event.source?.issue : null;
      if (from && from.number > ISSUE && !from.pull_request && (!from.repository_url || from.repository_url.toLowerCase().endsWith(`/repos/${REPO}`))) numbers.add(from.number);
    }
    if (events.length < PAGE) return { numbers: [...numbers].sort((a, b) => a - b) };
  }
}

test(`${CRITERION} (live) issues filed after #3267 that cite it cover the class's mark with the named gestures on save, export and Join, the scan of everything that leaves the machine, and #1186's clip, and none names a device class at a new major`, (t) => {
  const down = ghDown();
  if (down) {
    t.skip(`INCONCLUSIVE: ${down}, so the follow-on issues can't be read`);
    return;
  }
  const found = citing();
  if (found.why) {
    t.skip(`INCONCLUSIVE: the issues that cite #${ISSUE} can't be read: ${found.why}`);
    return;
  }
  const issues = [];
  for (const number of found.numbers) {
    const view = gh(['issue', 'view', String(number), '--repo', REPO, '--json', 'number,body,state,stateReason']);
    if (view.status !== 0) {
      t.skip(`INCONCLUSIVE: gh couldn't read #${number}: ${said(view)}`);
      return;
    }
    issues.push(JSON.parse(view.stdout));
  }
  assert.deepEqual(judgeFollowOns(issues), [], `the follow-on issues are not all filed as the criterion lists them; GitHub records ${found.numbers.length ? found.numbers.map((n) => `#${n}`).join(', ') : 'no issue'} filed after #${ISSUE} as citing it`);
});
