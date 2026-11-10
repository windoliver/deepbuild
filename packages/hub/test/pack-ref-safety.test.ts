import { beforeAll, expect, it } from 'vitest';
import { A, PACK_A, PACK_A_VERSION, sha256 } from '../../../tests/acceptance/1820/pack.ts';
import { asks, readyWorld, show, type PackWorld } from '../../../tests/acceptance/1820/helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);
it('#1820 a kind naming a pinned hash in params starts the same first-use job as a declared document asset', async () => {
  const before = (await asks(w, 'authority')).length;
  const result = await show(w, { format: 1, profile: 'figure', title: 'Pinned kind input', description: 'A kind resolves its input through the pack.', size: [64, 64], packs: [`${PACK_A}@${PACK_A_VERSION}`], items: {
    image: { id: 'image', kind: 'image@1', name: 'Image', order: 'a0', params: { asset: sha256(A.pad.listed), box: [0, 0, 64, 64], fit: 'fill', alt: 'Pinned input' } },
  } });
  expect(result.reply, JSON.stringify(result.reply)).toMatchObject({ outcome: 'refused', status: 'held' });
  expect((await asks(w, 'authority')).slice(before)).toHaveLength(1);
  expect(w.packs.log).toEqual([]);
}, 600_000);
