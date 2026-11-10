import { beforeAll, expect, it } from 'vitest';
import { A, PACK_A, PACK_A_VERSION, sha256 } from '../../../tests/acceptance/1820/pack.ts';
import { asks, doc, readyWorld, show, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('#1820 two assets waiting for the same pack host cause one unblock ask, never one per asset', async () => {
  await w.packs.close();
  const before = (await asks(w, 'unblock')).length;
  for (const asset of [A.pad, A.away]) {
    const used = await show(w, doc('sample', sha256(asset.listed), `${PACK_A}@${PACK_A_VERSION}`));
    expect(used.reply).toMatchObject({ outcome: 'refused', status: 'BLOCKED' });
  }
  expect((await asks(w, 'unblock')).slice(before)).toHaveLength(1);
}, 600_000);
