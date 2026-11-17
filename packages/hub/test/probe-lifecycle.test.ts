// Built-in kinds bypass ExtensionHost's dispatch, but their actual check probes must still be supervised.
import { afterAll, expect, it } from 'vitest';
import { join } from 'node:path';
import { addToBase, cleanup, judged, lastPos, openTask, reportWindow, reviewWorld, startHub, trustRepo } from '../../../tests/acceptance/1537/helpers.ts';
import { req } from '../../../tests/acceptance/322/helpers.ts';

afterAll(cleanup, 60_000);
it('a built-in document run records its probe and end before its verdict', async () => {
  const ask = 'check the source-backed report';
  const check = '.deepbuild/checks/report.json';
  const spec = { kind: 'document', runner: 'markdown', document: 'report.md', inputs: ['report.md', 'source.json'], depth: 'unit', oracle: 'code', contract: null };
  const world = addToBase(reviewWorld({ spec: null, drafts: [{ ask, requirements: [req('R1', 'The number matches its source', { check, asserts: [], depth: 'unit', oracle: 'code', refuted_by: 'a number that differs' })], deliverables: ['report.md'], budget: null }] }),
    { [check]: JSON.stringify(spec), 'source.json': '{"count":7}' });
  await trustRepo(world, true);
  const hub = await startHub(world);
  await reportWindow(hub, 5, Date.now() + 3 * 3_600_000);
  const { s, ref } = await openTask(hub, world, ask, '#2314 built-in work');
  await s.read('source.json');
  const since = await lastPos(hub);
  expect((await s.writeCall('report.md', 'There are 8 [source](source.json#/count).\n')).allowed).toBe(true);
  await s.stop('The report is written with its source.');
  const events = await judged(hub, ref, since);
  const verdict = events.findLast(e => e.kind === 'verdict.made' && e.log_pos > since);
  expect(verdict?.data.outcome).toBe('FAIL');
  expect(JSON.stringify(verdict?.data)).toContain("doesn't match");
  const probes = events.filter(e => e.kind === 'process.tracked' && e.log_pos > since && String(e.data.cwd).startsWith(join(world.root, 'checkouts')));
  expect(probes.length, 'the built-in probe is owned, not just a command check or a job').toBeGreaterThan(0);
  for (const probe of probes) {
    const ended = events.find(e => e.kind === 'process.ended' && e.data.run === probe.data.run && e.data.pid === probe.data.pid && e.log_pos > probe.log_pos);
    expect(ended, 'each tracked probe is proven gone before the verdict').toBeDefined();
    expect(ended!.log_pos).toBeLessThan(verdict!.log_pos);
  }
}, 600_000);
