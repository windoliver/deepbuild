import { afterEach, expect, it } from 'vitest';
import { clean, releaseRuns, start, world } from './fixture.ts';
afterEach(clean, 60_000);

it('#2067 scope / AC4: the same inherited release failure stays BLOCKED on a second claim', async () => {
  const r = await start(world({ files: {
    'src/release-state.js': 'module.exports = { ready: false };\n',
    'tests/release.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('release is ready', () => {\n  assert.equal(require('../src/release-state.js').ready, true);\n});\n",
  } }));
  const first = await r.open();
  const head = r.w.head();
  const expectedTree = r.g('merge-tree', '--write-tree', head, r.w.main);
  const runs = releaseRuns(first.events);
  const merged = runs.filter(({ started }) => {
    const commit = String(started.data.commit);
    return r.g('rev-parse', `${commit}^{tree}`) === expectedTree
      && r.g('show', '-s', '--format=%P', commit).split(' ').includes(r.w.main);
  });
  expect(merged, 'one real release run on the merged head').toHaveLength(1);
  expect(merged[0]!.finished?.data.outcome, 'real assertion fails on the merge').toBe('failed');
  const base = runs.filter((run) => !merged.includes(run));
  expect(base.some((run) => run.finished?.data.outcome === 'failed'), 'real base comparison fails too').toBe(true);
  console.log(`2067 scope inherited first ${JSON.stringify({ verdict: first.verdict.data.outcome, reasons: first.verdict.data.reasons, runs: runs.map((r) => ({ commit: r.started.data.commit, result: r.finished?.data })) })}`);
  expect(first.verdict.data.outcome, 'first claim is BLOCKED as inherited, not a new failure').toBe('BLOCKED');
  expect(JSON.stringify(first.verdict.data.reasons)).toMatch(/preflight.*inherited/i);
  // Work occurred but its net contents, head, check and environment are unchanged.
  await r.s.edit('src/auth.js', 'note: 0', 'note: 1');
  await r.s.edit('src/auth.js', 'note: 1', 'note: 0');
  const second = await r.claim();
  console.log(`2067 scope inherited second ${JSON.stringify({ verdict: second.verdict.data.outcome, reasons: second.verdict.data.reasons, releaseRuns: releaseRuns(second.events).length })}`);
  expect(second.id, 'second claim, not the earlier verdict').not.toBe(first.id);
  expect(second.verdict.data.commit).toBe(head);
  expect(r.w.head(), 'judging preserves branch head').toBe(head);
  expect.soft(second.verdict.data.outcome, 'reuse preserves BLOCKED for the same inherited failure, never FAIL or PASS').toBe('BLOCKED');
  expect.soft(JSON.stringify(second.verdict.data.reasons), 'carried verdict still names inherited preflight').toMatch(/preflight.*inherited/i);
  expect.soft(releaseRuns(second.events).map((r) => r.started.data.run), 'unchanged merged head reuses its runs, including base proof').toEqual(runs.map((r) => r.started.data.run));
}, 540_000);
