// The issue's Proof asks for a test of each refusal. R1 and R2's own refusals (a lease another holder's could match;
// a match form outside the four; a name another package declared) are in lease.test.ts and kinds.test.ts. This file
// holds the one left: `deep.lease` on a kind no package declared. The design says a lease's resource is "of a
// declared lease.kind@1" (Building blocks, Environment and lease; Extension API, `deep.lease`), so it is refused: the
// call rejects, or returns a result that isn't a grant; either way naming the kind, and nothing is leased or declared.
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import { admit, held, lease, loaded, openHost, openWorld, pkg } from './helpers.ts';

async function undeclaredRefused(plant?: Plant): Promise<void> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  loaded(await admit(h, await pkg('leaser', { id: 'test/gamma' })), 'test/gamma');
  const seen = await lease(h, 'test/gamma', { kind: 'device.none', key: 'n-1' }, 'exclusive');
  const what = `test/gamma's deep.lease({kind: device.none, key: n-1}) on a kind no package declared`;
  expect(seen.result?.status, `${what} is never granted: ${JSON.stringify(seen)}`).not.toBe('granted');
  expect(seen.error !== undefined || (seen.result !== undefined && seen.result !== null), `${what} rejects or returns a refusal: ${JSON.stringify(seen)}`).toBe(true);
  expect(JSON.stringify(seen), `${what}: the refusal names device.none`).toContain('device.none');
  expect(seen.error ?? '', `${what}: the refusal is the host's, not a missing method`).not.toMatch(/is not a function|no method/);
  expect((await held(w, 'device.none', 'n-1')).map((v) => v.lease), `${what}: nothing is leased`).toEqual([]);
  expect((await w.events('lease.acquired')).filter((e) => (e.data as { resource?: { kind?: string } }).resource?.kind === 'device.none'), `${what}: no lease.acquired on record`).toEqual([]);
  expect((await w.table.kinds()).map((k) => k.name), `${what}: device.none is not declared by asking`).not.toContain('device.none');
}

describe('R3 #44.544d1a4a tests for each refusal, failing first, plus a sample extension in TypeScript and one over JSON-RPC', () => {
  it('R3 deep.lease on a kind no package declared is refused naming the kind; nothing is leased or declared', async () => {
    await undeclaredRefused();
  }, 120_000);

  it('R3 (wrong program) a host that declares an unknown kind for its caller on first lease fails, naming device.none', async () => {
    await expect(undeclaredRefused('declares-kind-on-first-lease')).rejects.toThrow(/device\.none.* is never granted/);
  }, 120_000);
});
