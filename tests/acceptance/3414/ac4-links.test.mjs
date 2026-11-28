import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { BASE, DOCS, anchorIds, baseFile, checkoutFile, cleanEnv, commit, headings, laneCommands, makeCopy, runCommands, summary } from './helpers.mjs';

const ID = '#3414.242e5035';
const LANE = 'design links and names';
const cleanups = [];
after(() => { for (const clean of cleanups.reverse()) clean(); });

test(`${ID} AC4: the renamed headings keep their old anchors, prim-kernel stays, and the design links lane passes with the open issues read`, { timeout: 1_800_000 }, async () => {
  const still = DOCS.flatMap((doc) => headings(checkoutFile(doc)).filter((h) => /kernel/i.test(h.text)).map((h) => `${doc}:${h.index + 1} "${h.text}"`));
  assert.deepEqual(still, [], `these headings still call the core the kernel, so none was renamed:\n${still.join('\n')}`);

  const lost = DOCS.flatMap((doc) => {
    const now = anchorIds(checkoutFile(doc));
    return [...anchorIds(baseFile(doc))].filter((id) => /kernel/i.test(id) && !now.has(id)).map((id) => `${doc}#${id}`);
  });
  assert.deepEqual(lost, [], `these anchors the merge base ${BASE} held no longer land:\n${lost.join('\n')}`);
  assert.ok(anchorIds(checkoutFile('docs/technical-design.md')).has('prim-kernel'), 'docs/technical-design.md no longer holds the anchor prim-kernel');

  const { sandbox, repo } = makeCopy((fn) => cleanups.push(fn));
  commit(repo, 'change: nothing more');
  const env = { ...cleanEnv(), DEEP_OPEN_ISSUES: join(sandbox, 'open-issues.json') };
  const runs = await runCommands(repo, env, laneCommands(repo, env, LANE));
  const lines = runs.flatMap((r) => r.lines);
  const unread = lines.filter((l) => /^INCONCLUSIVE\b|open issues were not read|could not (?:fetch|read) the (?:cached )?open issues/i.test(l));
  assert.deepEqual(unread, [], `the design links lane did not read the open issues:\n${unread.join('\n')}`);
  const kernelLinks = lines.filter((l) => /#[\w-]*kernel[\w-]*/i.test(l) && /land|no heading/i.test(l));
  assert.deepEqual(kernelLinks, [], `links into prim-kernel or a renamed heading land nowhere:\n${kernelLinks.join('\n')}`);
  assert.deepEqual(runs.filter((r) => r.status !== 0).map((r) => r.name), [], `the design links lane fails:\n${summary(runs)}`);
  const read = lines.map((l) => l.match(/(\d[\d,]*) open issues/)).find(Boolean);
  assert.ok(read && Number(read[1].replaceAll(',', '')) > 0, `the design links lane's pass line names no open issues read:\n${lines.join('\n')}`);
});
