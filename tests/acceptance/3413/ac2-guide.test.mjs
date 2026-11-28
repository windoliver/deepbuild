import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeCopy, run, shown } from './helpers.mjs';

const ID = '#3413.493e049c';

test(`${ID} AC2: node scripts/guide.mjs --check passes on the generated guide`, { timeout: 600_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const r = await run(repo, sandbox, ['scripts/guide.mjs', '--check']);
  t.diagnostic(shown(r, 5));
  assert.equal(r.status, 0, shown(r));
  assert.deepEqual(r.lines.filter((l) => /^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(l)), [], shown(r));
});
