// R1: `deep.lease(resource, mode)` in the extension API. In the host's dispatch it is
// `table.lease({ holder: 'ext:<id>' }, { host: 'local', ...resource }, mode)`, returning the grant or the refusal
// naming the holder (the hand-off comment from #237; design: Extension API, `deep.lease`; the Lease building block).
// The sample TypeScript extension is fixtures/leaser, copied as test/alpha and test/beta. It runs sandboxed (outside
// DeepBuild's signed release), and once in the hub (a release package).
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import type { Mode } from '../../../packages/leases/src/index.ts';
import { admit, grantedTo, held, host, lease, loaded, openHost, openWorld, pkg, refusedNaming, releaseEntry, RIG, TREE, type Seen, type World } from './helpers.ts';

const ALPHA = 'test/alpha';
const BETA = 'test/beta';

/** test/alpha declares device.rig and repo.tree in its manifest; test/beta declares none and leases alpha's kinds. */
async function scenario(plant?: Plant): Promise<{ w: World; lease: (id: string, resource: Record<string, unknown>, mode: Mode) => Promise<Seen> }> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  loaded(await admit(h, await pkg('leaser', { id: ALPHA, leases: [RIG, TREE] })), ALPHA);
  loaded(await admit(h, await pkg('leaser', { id: BETA })), BETA);
  return { w, lease: (id, resource, mode) => lease(h, id, resource, mode) };
}

/** R1's first half: a sandboxed package's exclusive lease is granted, held by ext:test/alpha on host local. */
async function alphaHoldsRig(plant?: Plant): Promise<void> {
  const s = await scenario(plant);
  await grantedTo(s.w, await s.lease(ALPHA, { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'ext:test/alpha', 'device.rig', 'rig-1', 'exclusive');
}

/** Two shared leases on one key are both granted (design, Lease: "unless both are shared"): the mode is the caller's. */
async function bothShared(plant?: Plant): Promise<void> {
  const s = await scenario(plant);
  await grantedTo(s.w, await s.lease(ALPHA, { kind: 'device.rig', key: 'rig-s' }, 'shared'), 'ext:test/alpha', 'device.rig', 'rig-s', 'shared');
  await grantedTo(s.w, await s.lease(BETA, { kind: 'device.rig', key: 'rig-s' }, 'shared'), 'ext:test/beta', 'device.rig', 'rig-s', 'shared');
}

/**
 * The holder is the caller's own, `ext:<id>`, whatever the call's arguments say: beta's request naming alpha as its
 * holder, on a key alpha holds, is refused naming alpha, and on a free key is either refused or held by beta itself.
 */
async function holderIsTheCallers(plant?: Plant): Promise<void> {
  const s = await scenario(plant);
  await grantedTo(s.w, await s.lease(ALPHA, { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'ext:test/alpha', 'device.rig', 'rig-1', 'exclusive');
  const forged = await s.lease(BETA, { kind: 'device.rig', key: 'rig-1', holder: 'ext:test/alpha' }, 'exclusive');
  expect(forged.result?.status, `beta naming ext:test/alpha as its holder is never granted alpha's rig-1: ${JSON.stringify(forged)}`).not.toBe('granted');
  expect((await held(s.w, 'device.rig', 'rig-1')).map((v) => v.lease.holder), 'rig-1 is held once, by ext:test/alpha').toEqual(['ext:test/alpha']);
  const free = await s.lease(BETA, { kind: 'device.rig', key: 'rig-9', holder: 'ext:test/alpha' }, 'exclusive');
  if (free.result?.status === 'granted') expect(free.result.lease.holder, 'a lease beta asked for is beta\'s, never the holder its arguments name').toBe('ext:test/beta');
  expect((await held(s.w, 'device.rig', 'rig-9')).filter((v) => v.lease.holder !== 'ext:test/beta').map((v) => v.lease), 'nobody but ext:test/beta holds what beta asked for').toEqual([]);
}

describe('R1 #44.2d670703 deep.lease(resource, mode): the host leases with holder ext:<id> on host local, returning the grant or the refusal naming the holder', () => {
  it('R1 the extension API schema lists deep.lease', async () => {
    const { EXTENSION_API } = await host();
    expect(EXTENSION_API.map((m) => m.method)).toContain('deep.lease');
  });

  it('R1 a sandboxed TypeScript package\'s deep.lease({kind, key}, exclusive) is granted, held by ext:test/alpha on host local: as returned, in the table, on record', async () => {
    await alphaHoldsRig();
  }, 120_000);

  it('R1 a TypeScript package in the hub (a release package) gets the same: held by ext:test/hub on host local', async () => {
    const w = await openWorld();
    const dir = await pkg('leaser', { id: 'test/hub', leases: [RIG] });
    const h = await openHost(w, { release: [await releaseEntry(dir)] });
    const load = loaded(await admit(h, dir), 'test/hub');
    expect(load.place, 'a release package no agent wrote loads in the hub (#348)').toBe('hub');
    await grantedTo(w, await lease(h, 'test/hub', { kind: 'device.rig', key: 'rig-h' }, 'exclusive'), 'ext:test/hub', 'device.rig', 'rig-h', 'exclusive');
  }, 120_000);

  it('R1 a second package\'s overlapping exclusive lease is refused, naming the holder ext:test/alpha; its lease on a free key of the same kind is its own', async () => {
    const s = await scenario();
    await grantedTo(s.w, await s.lease(ALPHA, { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'ext:test/alpha', 'device.rig', 'rig-1', 'exclusive');
    await refusedNaming(s.w, await s.lease(BETA, { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'test/beta', 'ext:test/alpha', 'device.rig', 'rig-1');
    await grantedTo(s.w, await s.lease(BETA, { kind: 'device.rig', key: 'rig-2' }, 'exclusive'), 'ext:test/beta', 'device.rig', 'rig-2', 'exclusive');
  }, 120_000);

  it('R1 a glob kind: beta\'s exclusive src/lib/a.ts, which alpha\'s src/** could match, is refused naming ext:test/alpha', async () => {
    const s = await scenario();
    await grantedTo(s.w, await s.lease(ALPHA, { kind: 'repo.tree', key: 'src/**' }, 'exclusive'), 'ext:test/alpha', 'repo.tree', 'src/**', 'exclusive');
    await refusedNaming(s.w, await s.lease(BETA, { kind: 'repo.tree', key: 'src/lib/a.ts' }, 'exclusive'), 'test/beta', 'ext:test/alpha', 'repo.tree', 'src/lib/a.ts');
  }, 120_000);

  it('R1 two shared leases on one key are both granted, each held by its caller in mode shared', async () => {
    await bothShared();
  }, 120_000);

  it('R1 the holder is the caller\'s ext:<id>, never one the call\'s arguments name', async () => {
    await holderIsTheCallers();
  }, 120_000);

  it('R1 (wrong program) a host that never declares a manifest\'s lease kinds fails the grant, naming device.rig', async () => {
    await expect(alphaHoldsRig('skips-kind-declare')).rejects.toThrow(/device\.rig.* for ext:test\/alpha (rejected|returns a grant)/);
  }, 120_000);

  // A host that leases every call exclusive grants alpha's first shared call (nothing else holds rig-s), but the
  // table's lease carries the mode the host passed, exclusive: grantedTo's first failing assertion is alpha's mode,
  // before beta is ever asked.
  it('R1 (wrong program) a host that leases every call exclusive fails the shared pair, naming ext:test/alpha\'s mode', async () => {
    await expect(bothShared('drops-mode')).rejects.toThrow(/\{kind: device\.rig, key: rig-s\}, shared\) for ext:test\/alpha: its mode as asked: expected 'exclusive' to be 'shared'/);
  }, 120_000);

  it('R1 (wrong program) a host that takes the holder from the call\'s arguments fails, naming ext:test/alpha', async () => {
    await expect(holderIsTheCallers('holder-from-arguments')).rejects.toThrow(/ext:test\/alpha as its holder is never granted/);
  }, 120_000);
});
