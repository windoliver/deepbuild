// #3461 criterion 4 (README): `deep start approve` with two `--host` flags still asks for a run on both hosts. A
// stand-in hub at the home's socket records the call; the merge base passes this test (it is today's behavior), and the
// twin `repeats-refused` fails it.
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { SECOND, callsShown, cleanup, deep, needBuild, repo, rootOf, shown, standIn, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.1bda0a26';

it(`${ID} deep start approve with two --host flags asks the hub for a run on both hosts`, async () => {
  needBuild();
  const w = world();
  const hub = await standIn(rootOf(w));
  const checkout = repo(w);
  const r = await deep(w, ['start', 'approve', '--repo', checkout, '--issues', '1', '--agents', 'claude-code', '--at-once', '1', '--plan-share', '10',
    '--host', 'spark-a', '--host', 'spark-b'], { timeoutMs: 60 * SECOND });
  const approvals = hub.calls.filter((c) => c.method === 'start.approve');
  const said = `It printed: ${shown(r)}; the hub got ${callsShown(hub)}`;
  expect(approvals.length, `deep start approve with two --host flags asks the hub for one run. ${said}`).toBe(1);
  expect(approvals[0]!.params.hosts, `the run it asks for names both hosts, in order. ${said}`).toEqual(['spark-a', 'spark-b']);
  expect(approvals[0]!.params.repo, said).toBe(join(checkout));
  expect(r.code, said).toBe(0);
}, 120 * SECOND);
