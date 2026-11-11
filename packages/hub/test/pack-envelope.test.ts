// The pack feature serves every document asset, not only the asset.game recipe from #1731.
import { beforeAll, expect, it } from 'vitest';
import { A, PACK_A, PACK_A_VERSION, sha256 } from '../../../tests/acceptance/1820/pack.ts';
import { asks, readyWorld, show, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('#1820 an asset in the document envelope waits on the same authority job before any kind can read it', async () => {
  const before = (await asks(w, 'authority')).length;
  const used = await show(w, { format: 1, profile: 'scene', title: 'Pack sample', description: 'A declared asset consumed by a document.', packs: [`${PACK_A}@${PACK_A_VERSION}`],
    assets: { sample: { sha256: sha256(A.pad.listed), license: A.pad.license } }, items: {} });
  expect(used.reply, JSON.stringify(used.reply)).toMatchObject({ outcome: 'refused', status: 'held' });
  expect((await asks(w, 'authority')).slice(before)).toHaveLength(1);
  expect(w.packs.log).toEqual([]);
}, 600_000);
