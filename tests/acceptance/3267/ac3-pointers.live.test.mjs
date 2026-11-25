// Criterion 3 (live: needs network and gh signed in with read access to windoliver/deepbuild): #1186, #1187 and #1188
// each gain a line pointing here, added by you or on your word, and none of their criteria is reworded by an agent.
// It reads each body with `gh issue view`, holds its criteria to the ones saved-criteria.json kept on November 23, and
// then reads the owner's word for the line as a signed approval of docs/evidence/3267/pointing-line.txt (README.md,
// The owner's word). Offline or signed out it skips as INCONCLUSIVE; it never passes then.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LINE_RECORD, REPO, approvedIn, fileHere, gh, ghDown, git, judgePointers, judgeWord, linesOf, readApprovals, said } from './helpers.mjs';

const CRITERION = 'AC3 #3267.c390821e';
/** Each issue's criteria as its body held them on November 23: `{ id, starts }`, the ID and the first eight words. */
const saved = JSON.parse(readFileSync(new URL('./saved-criteria.json', import.meta.url), 'utf8'));

test(`${CRITERION} (live) #1186, #1187 and #1188 each hold a line citing #3267 that a signed approval of ${LINE_RECORD} holds, and every criterion they had on November 23 is still in them, word for word`, (t) => {
  const down = ghDown();
  if (down) {
    t.skip(`INCONCLUSIVE: ${down}, so the three issues can't be read`);
    return;
  }
  const bodies = {};
  for (const number of Object.keys(saved)) {
    const view = gh(['issue', 'view', number, '--repo', REPO, '--json', 'body']);
    if (view.status !== 0) {
      t.skip(`INCONCLUSIVE: gh couldn't read #${number}: ${said(view)}`);
      return;
    }
    bodies[number] = JSON.parse(view.stdout).body ?? '';
  }
  const { problems, lines } = judgePointers({ bodies, saved });
  assert.deepEqual(problems, [], 'the three issues are not as the criterion asks');
  const approvals = readApprovals(git, [LINE_RECORD]);
  if (approvals.blocked) {
    t.skip(`INCONCLUSIVE: the approvals can't be read: ${approvals.blocked}`);
    return;
  }
  const record = new Set(linesOf(fileHere(LINE_RECORD)));
  const approved = approvedIn(git, approvals.approved, LINE_RECORD, linesOf)?.filter((line) => record.has(line)) ?? null;
  assert.deepEqual(judgeWord({ lines, approved, refused: approvals.refused }), [], "the lines pointing here don't have the owner's word");
});
