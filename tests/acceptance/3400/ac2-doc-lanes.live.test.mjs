// Criterion 2, live half (needs network and gh signed in with read access to windoliver/deepbuild): with the new text
// in the design, the doc lanes (catalogue drift, design links and names, public text) find nothing the change brings.
// It first requires the new text, since "no line contradicts the new text" means nothing without it. Then each lane's
// own commands run on this checkout against one fetch of the open issues (doc-lanes.mjs). A finding the change brings
// fails. Signed out or offline, or when a lane can't run or can't read all it checks, it skips as INCONCLUSIVE; it
// never passes then.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { docLanes } from './doc-lanes.mjs';
import { HUB, NO_HUB, REPO, auditProblems, baseDesign, decisionProblems, gh, listed, readDesign, sectionAt } from './helpers.mjs';

// Far above the open issue count, as scripts/open-issues.mjs asks: a list this long may have been cut.
const LIMIT = 5000;

test('AC2 #3400.7371b274 (live) with the new text in the design, the doc lanes (catalogue drift, design links and names, public text) find nothing the change brings', async (t) => {
  const design = readDesign();
  const section = sectionAt(design, HUB);
  assert.ok(section, NO_HUB);
  const missing = [...decisionProblems(section.lines), ...auditProblems(design, baseDesign())];
  assert.ok(!missing.length, `the design doesn't hold the new text yet, so the doc lanes have nothing to hold the rest of it against:${listed(missing)}`);
  const list = gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', String(LIMIT), '--json', 'number,body'], 600_000);
  let count = null;
  try {
    count = JSON.parse(list.out).length;
  } catch { /* no list, or one that isn't JSON: unread */ }
  if (!Number.isInteger(count) || count >= LIMIT) {
    t.skip(`INCONCLUSIVE: gh couldn't list the open issues (signed out, offline, or a list of ${LIMIT} that may be cut), so the doc lanes can't read them: ${list.why ?? `${count} issues listed`}`);
    return;
  }
  const temp = mkdtempSync(join(tmpdir(), 'deep-3400-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  writeFileSync(join(temp, 'open-issues.json'), list.out);
  const { brought, unrun, log } = await docLanes({ issues: join(temp, 'open-issues.json'), temp });
  for (const entry of log) t.diagnostic(entry);
  assert.ok(!brought.length, `the doc lanes find what the change brings:${listed(brought)}`);
  if (unrun.length) t.skip(`INCONCLUSIVE: ${unrun.join('; ')}`);
});
