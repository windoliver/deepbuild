// Criterion 4 (live: needs network and gh signed in with read access to windoliver/deepbuild): the issues that build
// the answer are filed, each with a design link that lands in the new text. It finds them as GitHub records them: the
// issues #3472's timeline shows as citing it, filed after it, each then read with `gh issue view`; no list is kept in
// the repo. The new text's anchors are read from docs/technical-design.md here and at the base commit. Offline or
// signed out it skips as INCONCLUSIVE, or fails when the design alone already shows a failure; it never passes then.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, ISSUE, REPO, citing, gh, ghDown, judgeBuilders, judgeLanding, read, said } from './helpers.mjs';

const CRITERION = 'AC4 #3472.78cc555a';

test(`${CRITERION} (live) at least two issues filed after #3472 cite it and hold a design link that lands on an anchor States people see gained since ${BASE.slice(0, 8)}, and among them are \`deep\`'s list read by the lane and a lane run that reaches every state`, (t) => {
  const { fresh } = read();
  // A failure the design alone shows isn't hidden by a skip.
  const unread = (why) => {
    assert.deepEqual(judgeLanding(fresh), [], `the new text has nothing for a design link to land on; and the issues were not read: ${why}`);
    t.skip(`INCONCLUSIVE: ${why}`);
  };
  const down = ghDown();
  if (down) return unread(`${down}, so the issues that build the answer can't be read`);
  const found = citing();
  if (found.why) return unread(`the issues that cite #${ISSUE} can't be read: ${found.why}`);
  const issues = [];
  for (const number of found.numbers) {
    const view = gh(['issue', 'view', String(number), '--repo', REPO, '--json', 'number,title,body,state,stateReason']);
    if (view.status !== 0) return unread(`gh couldn't read #${number}: ${said(view)}`);
    issues.push(JSON.parse(view.stdout));
  }
  assert.deepEqual(judgeBuilders({ issues, landing: fresh }), [], `the issues that build the answer are not all filed with a design link that lands in the new text; GitHub records ${found.numbers.length ? found.numbers.map((n) => `#${n}`).join(', ') : 'no issue'} filed after #${ISSUE} as citing it`);
});
