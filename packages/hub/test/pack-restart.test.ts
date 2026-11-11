// Pending network authority survives a hub restart: no duplicate question and no unrecorded permission.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { asks, fetchA, kinds, newAsks, readyWorld, until, yes, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';
import { A } from '../../../tests/acceptance/1820/pack.ts';
import { Libraries } from '../src/libraries.js';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('#1820 restores pending authority from its persisted fetch record without another ask or a network call', async () => {
  const before = (await asks(w)).length;
  const held = await kinds(w, fetchA(A.pad));
  expect(held.value.status).toBe('held');
  const raised = await newAsks(w, before, 'authority');
  expect(raised).toHaveLength(1);
  const file = join(w.hub.root, 'libraries.json');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { held?: Record<string, { ask: string; picked: { file: { path: string } } }> };
  expect(saved.held?.[`pack:acme/sounds@1.0.0#${A.pad.path}`]).toMatchObject({ ask: held.value.ask, picked: { file: { path: A.pad.path } } });
  expect(w.packs.log).toEqual([]);
  const restored = new Libraries({ root: w.hub.root, now: Date.now, host: () => undefined,
    keep: async () => { throw Error('restoration wrote bytes'); }, keepFile: async () => { throw Error('restoration wrote a file'); },
    has: async () => false, raise: async () => { throw Error('restoration asked twice'); } });
  expect(await restored.fetchPack('acme/sounds@1.0.0', A.pad.path)).toEqual({ status: 'held', ask: held.value.ask });
  expect((await yes(w, raised[0]!)).code).toBe(0);
  expect((await until(w, fetchA(A.pad))).value.status).toBe('fetched');
}, 600_000);
