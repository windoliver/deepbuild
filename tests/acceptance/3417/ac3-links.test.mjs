import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ANCHOR, cleanEnv, makeCopy, names, runLane } from './helpers.mjs';

const ID = '#3417.33df4e7a';
const LANE = 'design links and names';

test(`${ID} AC3: the design links lane passes with the open issues read, so every link an open issue makes to One word per idea lands`, { timeout: 1_800_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const env = cleanEnv({ DEEP_OPEN_ISSUES: join(sandbox, 'open-issues.json') });
  for (const key of ['GH_REPO', 'GH_HOST', 'DEEP_PREFLIGHT']) delete env[key];
  const lane = await runLane(repo, env, LANE);
  assert.ok(!lane.missing, lane.missing);
  assert.ok(lane.runs.length, `the ${LANE} lane runs no node command`);
  const lines = lane.runs.flatMap((r) => r.lines);
  const unread = lines.find((l) => /^INCONCLUSIVE\b/.test(l) || /the open issues were not read|could not (fetch|read) the (cached )?open issues/.test(l));
  if (unread) {
    t.skip(`INCONCLUSIVE: the open issues were not read (network or gh sign-in): ${unread}`);
    return;
  }
  const broken = lines.filter((l) => names(l, ANCHOR));
  assert.deepEqual(broken, [], `lines of the ${LANE} lane naming #${ANCHOR}`);
  for (const run of lane.runs) assert.equal(run.status, 0, `${run.name} fails:\n${run.lines.join('\n')}`);
});
