import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { CEILINGS, CHECKOUT, atBase, base, makeCopy, readJson, run, shown } from './helpers.mjs';

const ID = '#3413.6523d84f';
const LIMIT = 16_384;

test(`${ID} AC4: the doc ceilings check passes against the merge base`, { timeout: 600_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const r = await run(repo, sandbox, ['scripts/doc-ceilings.mjs']);
  t.diagnostic(shown(r, 5));
  assert.equal(r.status, 0, shown(r));
  assert.ok(r.lines.some((l) => l.startsWith('PASS doc-ceilings')), shown(r));
  assert.ok(!r.lines.some((l) => /no .* at a merge base/.test(l)), `the check found no merge base to compare with\n${shown(r)}`);
});

test(`${ID} AC4: no ceiling in ${CEILINGS} is above the merge base's`, async () => {
  const now = readJson(join(CHECKOUT, CEILINGS));
  const text = atBase(CEILINGS);
  assert.ok(text !== undefined, `${CEILINGS} is not at the merge base ${base()}`);
  const was = JSON.parse(text);
  const { anchors } = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'doc-links.mjs')).href);
  const above = [];
  for (const [key, ceiling] of Object.entries(now)) {
    const [doc, heading] = key.split('#');
    let limit = was[key];
    if (limit === undefined) {
      const held = anchors(join(CHECKOUT, doc));
      const old = Object.keys(was).filter((k) => k.split('#')[0] === doc && held.get(k.split('#')[1]) === heading).map((k) => was[k]);
      limit = old.length ? Math.max(...old) : LIMIT;
    }
    if (ceiling > limit) above.push(`${key}: ${ceiling} > ${limit}`);
  }
  assert.deepEqual(above, [], `ceilings above the merge base's ${base()}`);
});
