// Criterion 2, live half (needs network and gh signed in with read access to windoliver/deepbuild): with the new text
// in States people see, the doc lanes (design links and names, catalogue drift, public text) pass, or find nothing
// the change brings. Each lane's own commands run on this checkout against one fetch of the open issues, and a lane
// that fails is held to what the base commit's docs give under the same commands (doc-lanes.mjs; README.md, The doc
// lanes). A lane that fails for what the change brings fails the test. Signed out or offline, or with a lane that
// can't run or can't read all it checks, it skips as INCONCLUSIVE; it never passes then.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseFolder, runDocLanes } from './doc-lanes.mjs';
import { BASE, REPO, gh, read, said } from './helpers.mjs';

const CRITERION = 'AC2 #3472.afb5879c';
// Far above the open issue count; a list this long may have been cut, as scripts/open-issues.mjs reads it.
const LIMIT = 5000;

test(`${CRITERION} (live) with the new text in States people see, the doc lanes (design links and names, catalogue drift, public text) find nothing the change brings`, async (t) => {
  assert.ok(read().gained.length, `States people see holds no sentence it didn't hold at ${BASE.slice(0, 8)}: there is no new text for the doc lanes to hold the design against`);
  const listed = gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', String(LIMIT), '--json', 'number,body']);
  if (listed.status !== 0) {
    t.skip(`INCONCLUSIVE: gh couldn't list the open issues (signed out or offline), so the doc lanes can't read them: ${said(listed)}`);
    return;
  }
  if (JSON.parse(listed.stdout).length >= LIMIT) {
    t.skip(`INCONCLUSIVE: gh listed ${LIMIT} open issues, the most it was asked for, so some may be unread`);
    return;
  }
  const temp = mkdtempSync(join(tmpdir(), 'deep-3472-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  writeFileSync(join(temp, 'open-issues.json'), listed.stdout);
  baseFolder(join(temp, 'base'));
  const { failures, unrun } = await runDocLanes({ baseDir: join(temp, 'base'), issues: join(temp, 'open-issues.json'), log: (text) => t.diagnostic(text) });
  assert.deepEqual(failures, [], `the doc lanes find what the change brings${unrun.length ? `; and not run: ${unrun.join('; ')}` : ''}`);
  if (unrun.length) t.skip(`INCONCLUSIVE: ${unrun.join('; ')}`);
});
