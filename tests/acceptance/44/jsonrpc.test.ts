// R3's sample extension over JSON-RPC, on R1 and R2: a package in another language (Python 3, fixtures/pylease/main)
// on #348's wire, JSON-RPC 2.0 as JSON lines on stdio, calls the method `deep.lease` with positional params
// [resource, mode]. Its manifest's lease kind is declared by its id; its grant is held by ext:test/pylease on host
// local; a TypeScript package's overlapping lease is refused naming it; and its own lease on a key the TypeScript
// package holds comes back to Python as the refusal naming ext:test/beta.
import { describe, expect, it } from 'vitest';
import { admit, grantedTo, lease, loaded, needPython3, openHost, openWorld, pkg, refusedNaming, RIG } from './helpers.ts';

async function scenario() {
  needPython3();
  const w = await openWorld();
  const h = await openHost(w);
  const py = loaded(await admit(h, await pkg('pylease', { leases: [RIG] })), 'test/pylease');
  loaded(await admit(h, await pkg('leaser', { id: 'test/beta' })), 'test/beta');
  return { w, h, py };
}

describe('R3 #44.544d1a4a tests for each refusal, failing first, plus a sample extension in TypeScript and one over JSON-RPC', () => {
  it('R3 the Python package loads in the sandbox, its manifest kind device.rig is declared by test/pylease, and its deep.lease is granted, held by ext:test/pylease on host local', async () => {
    const { w, h, py } = await scenario();
    expect(py.place, 'a package in another language runs out of process, in the sandbox (#348)').toBe('sandbox');
    expect(await w.table.kinds(), 'table.kinds() lists device.rig, declared by test/pylease').toContainEqual({ ...RIG, plugin: 'test/pylease' });
    await grantedTo(w, await lease(h, 'test/pylease', { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'ext:test/pylease', 'device.rig', 'rig-1', 'exclusive');
  }, 120_000);

  it('R3 refusals both ways: test/beta\'s lease on the Python package\'s key names ext:test/pylease; the Python package\'s lease on beta\'s key comes back naming ext:test/beta', async () => {
    const { w, h } = await scenario();
    await grantedTo(w, await lease(h, 'test/pylease', { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'ext:test/pylease', 'device.rig', 'rig-1', 'exclusive');
    await refusedNaming(w, await lease(h, 'test/beta', { kind: 'device.rig', key: 'rig-1' }, 'exclusive'), 'test/beta', 'ext:test/pylease', 'device.rig', 'rig-1');
    await grantedTo(w, await lease(h, 'test/beta', { kind: 'device.rig', key: 'rig-2' }, 'exclusive'), 'ext:test/beta', 'device.rig', 'rig-2', 'exclusive');
    await refusedNaming(w, await lease(h, 'test/pylease', { kind: 'device.rig', key: 'rig-2' }, 'exclusive'), 'test/pylease', 'ext:test/beta', 'device.rig', 'rig-2');
  }, 120_000);
});
