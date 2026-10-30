// R2: a manifest's lease kinds go through `table.declare('<id>', kind)` (lease.kind@1 data), which refuses a match
// form outside exact, glob, prefix and pool(n), and a name another package declared (the hand-off comment from #237;
// design: the Lease building block, "Each resource kind is lease.kind@1 data", and the Building blocks row
// "Environment and lease"). A kind is declared when its package is admitted: installed, checked and loaded; which
// of the three refuses a bad one is the host's choice (README, Readings).
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import { admit, loaded, openHost, openWorld, pkg, RIG, TREE, type Admission } from './helpers.ts';

/** test/alpha declares device.rig (exact) and repo.tree (glob): the table lists both, each declared by test/alpha. */
async function alphaDeclares(plant?: Plant): Promise<void> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  loaded(await admit(h, await pkg('leaser', { id: 'test/alpha', leases: [RIG, TREE] })), 'test/alpha');
  const kinds = await w.table.kinds();
  expect(kinds, 'table.kinds() lists device.rig, declared by test/alpha').toContainEqual({ ...RIG, plugin: 'test/alpha' });
  expect(kinds, 'table.kinds() lists repo.tree, declared by test/alpha').toContainEqual({ ...TREE, plugin: 'test/alpha' });
}

/** A kind whose match form is outside the closed four: test/odd isn't admitted, the refusal names the kind, and the table never lists it. */
async function oddRefused(match: string, plant?: Plant): Promise<void> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  // The control: the same package with a kind of one of the four loads, so the refusal below is the match form's,
  // never a manifest that can't carry lease kinds at all.
  loaded(await admit(h, await pkg('leaser', { id: 'test/fine', leases: [{ name: 'device.fine', match: 'exact', cap: 10, cooldown: 0, cost: 0 }] })), 'test/fine, whose kind device.fine matches by exact');
  const name = 'device.odd';
  const a = await admit(h, await pkg('leaser', { id: 'test/odd', leases: [{ name, match, cap: 10, cooldown: 0, cost: 0 }] }));
  refusedNaming(a, `test/odd, whose kind ${name} matches by ${match}`, name);
  expect((await w.table.kinds()).map((k) => k.name), `the table never lists ${name}`).not.toContain(name);
}

/** A name another package declared: test/beta's device.rig, after test/alpha's, is refused naming it; alpha's stays. */
async function takenRefused(plant?: Plant): Promise<void> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  loaded(await admit(h, await pkg('leaser', { id: 'test/alpha', leases: [RIG] })), 'test/alpha');
  const b = await admit(h, await pkg('leaser', { id: 'test/beta', leases: [{ ...RIG, match: 'glob' }] }));
  refusedNaming(b, 'test/beta, declaring device.rig after test/alpha', 'device.rig');
  const rigs = (await w.table.kinds()).filter((k) => k.name === 'device.rig');
  expect(rigs, 'device.rig stays test/alpha\'s, as alpha declared it').toEqual([{ ...RIG, plugin: 'test/alpha' }]);
}

function refusedNaming(a: Admission, what: string, name: string): void {
  expect(a.refusal, `${what} is refused: ${JSON.stringify(a.load)}`).not.toBeNull();
  expect(a.refusal ?? '', `${what}: the refusal names ${name}`).toContain(name);
}

describe('R2 #44.780b900a a manifest\'s lease kinds go through table.declare(\'<id>\', kind): a match form outside the four and a name another package declared are refused', () => {
  it('R2 a package\'s manifest lease kinds are declared by its id: table.kinds() lists device.rig (exact) and repo.tree (glob), each by test/alpha', async () => {
    await alphaDeclares();
  }, 120_000);

  it('R2 every match form of the four is declared: exact, glob, prefix and pool(2)', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    const forms = ['exact', 'glob', 'prefix', 'pool(2)'];
    const leases = forms.map((match, i) => ({ name: `device.form${i}`, match, cap: 10, cooldown: 0, cost: 0 }));
    loaded(await admit(h, await pkg('leaser', { id: 'test/forms', leases })), 'test/forms');
    const kinds = await w.table.kinds();
    for (const kind of leases) expect(kinds, `table.kinds() lists ${kind.name} (${kind.match}) by test/forms`).toContainEqual({ ...kind, plugin: 'test/forms' });
  }, 120_000);

  for (const match of ['regex', 'pool(0)', 'range']) {
    it(`R2 a kind matching by ${match}, outside exact, glob, prefix and pool(n), is refused naming the kind, and never declared`, async () => {
      await oddRefused(match);
    }, 120_000);
  }

  it('R2 a kind name another package declared is refused naming it, and stays the first package\'s', async () => {
    await takenRefused();
  }, 120_000);

  it('R2 (wrong program) a host that never declares a manifest\'s lease kinds fails the listing, naming device.rig', async () => {
    await expect(alphaDeclares('skips-kind-declare')).rejects.toThrow(/lists device\.rig, declared by test\/alpha/);
  }, 120_000);

  it('R2 (wrong program) a host that never declares a manifest\'s lease kinds admits a kind matching by regex, failing the test', async () => {
    await expect(oddRefused('regex', 'skips-kind-declare')).rejects.toThrow(/device\.odd matches by regex is refused/);
  }, 120_000);

  it('R2 (wrong program) a host that never declares a manifest\'s lease kinds admits a taken name, failing the test', async () => {
    await expect(takenRefused('skips-kind-declare')).rejects.toThrow(/declaring device\.rig after test\/alpha is refused/);
  }, 120_000);
});
