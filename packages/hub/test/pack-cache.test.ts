// #1820 regression: a cached file's existence is not evidence of its bytes; first use is the document's use too.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { asks, doc, fetchA, kinds, newAsks, readyWorld, show, stored, until, yes, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';
import { A, PACK_A, PACK_A_VERSION, sha256 } from '../../../tests/acceptance/1820/pack.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('a document starts its missing asset job; corrupt cached bytes are never a fetched result, online or offline', async () => {
  const before = (await asks(w)).length;
  const document = doc('pad', sha256(A.pad.listed), `${PACK_A}@${PACK_A_VERSION}`);
  const first = await show(w, document);
  expect(first.reply).toMatchObject({ outcome: 'refused', status: 'held' });
  const raised = await newAsks(w, before, 'authority');
  expect(raised).toHaveLength(1);
  expect(w.packs.log).toEqual([]);
  expect((await yes(w, raised[0]!)).code).toBe(0);
  expect((await until(w, fetchA(A.pad))).value.status).toBe('fetched');
  expect(await stored(w, sha256(A.pad.listed))).toBeDefined();
  const hash = sha256(A.pad.listed);
  writeFileSync(join(w.hub.root, 'evidence', hash.slice(0, 2), hash.slice(2)), Buffer.from('corrupted cache bytes'));
  await w.packs.close();
  const cached = await kinds(w, fetchA(A.pad));
  expect(cached.value.status, cached.text).not.toBe('fetched');
  const used = await show(w, document);
  expect(used.reply?.outcome).toBe('refused');
  expect(JSON.stringify(used.reply)).toContain('BLOCKED');
}, 600_000);
