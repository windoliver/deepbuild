import { beforeAll, expect, it } from 'vitest';
import { A, PACK_A } from '../../../tests/acceptance/1820/pack.ts';
import { asks, fetchA, kinds, must, newAsks, readyWorld, until, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('#1820 a later explicit pack rule supersedes a declined one-off fetch without borrowing another pack rule', async () => {
  const before = (await asks(w)).length;
  expect((await kinds(w, fetchA(A.kick))).value.status).toBe('held');
  const raised = await newAsks(w, before, 'authority');
  expect(raised).toHaveLength(1);
  await must(w, 'ask.answer', { ask: raised[0]!.handle, option: 'decline' });
  expect((await kinds(w, fetchA(A.kick))).value.status).toBe('refused');
  await must(w, 'pack.rule', { pack: PACK_A, licenses: ['CC0-1.0'] });
  expect((await until(w, fetchA(A.kick))).value.status).toBe('fetched');
  expect((await newAsks(w, before, 'authority')).length).toBe(1);
}, 600_000);
