import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { CC0 } from '../../../tests/acceptance/1820/pack.ts';
import { asks, kinds, newAsks, stored, until, yes } from '../../../tests/acceptance/1820/helpers.ts';
import { addAsset, bytes, installOrBlock, scopedWorld, sha, writePack, type Listed, type Scoped } from '../../../tests/acceptance/1820/scope/world.ts';

let w: Scoped;
const a: Listed = { path: 'sample.bin', body: bytes('attributed-work', 400), license: CC0, licenseText: 'Creative Commons Attribution 4.0 International Public License. Licensed under CC-BY-4.0; credit: Fixture Author.' };
beforeAll(async () => {
  w = await scopedWorld();
  addAsset(w.srv, 'fixture/attributed', '1.0.0', a, 'terms');
  await installOrBlock(w, writePack(join(w.tmp, 'pack'), w.srv, 'fixture/attributed', '1.0.0', [{ a, tag: 'terms' }]));
}, 600_000);
it('#1820 CC-BY license terms cannot be stored as a manifest claim of CC0 with no attribution', async () => {
  const args = { op: 'fetch', pack: 'fixture/attributed@1.0.0', asset: a.path };
  const before = (await asks(w)).length;
  let got = await kinds(w, args);
  if (got.value.status === 'held') {
    const raised = await newAsks(w, before, 'authority');
    expect((await yes(w, raised[0]!)).code).toBe(0);
    got = await until(w, args);
  }
  expect(got.value.status, got.text).toBe('refused');
  expect(got.text).toContain('CC-BY-4.0');
  expect(await stored(w, sha(a.body))).toBeUndefined();
}, 600_000);
