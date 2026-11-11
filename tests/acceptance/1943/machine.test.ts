// #1943.9249618e, the machine clause: on a test host, a service that doesn't survive a restart fails the machine check,
// naming the service.
//
// On deep-fedora, through the world's SSH config (README, reading 2), two enabled, active user services: a steady one,
// which a restart starts again, and a stale one, which takes a lock on start and never gives it back, so it exits 1 on
// any start after its first. The machine check passes the steady one and fails the stale one at its assertion, naming
// it (judgeMachine). The wrong program: the kit's planted runner never-restarts, run on fresh services of the same
// kind, fails that judge for passing the stale service.
import { describe, expect, test } from 'vitest';
import { AC, hostChecks, judgeMachine, PLANTS, servicesOnHost, world } from './helpers.ts';

const VM = 'deep-fedora';

describe(AC, () => {
  test('machine: an enabled user service that survives a restart passes; one that doesn\'t survive a restart fails at the check\'s assertion, naming the service', async () => {
    const w = await world(VM);
    const units = await servicesOnHost(w, 'ref');
    const { hostFill } = await hostChecks();
    const fill = hostFill('machine', { config: w.config });
    expect(fill.kind).toBe('machine');
    expect(await judgeMachine(w, fill, units)).toEqual([]);
  }, 600_000);

  test(`machine, the wrong program: the planted runner ${PLANTS.machine} fails that test, passing the service that doesn't survive a restart`, async () => {
    const w = await world(VM);
    const units = await servicesOnHost(w, 'plant');
    const { hostKit } = await hostChecks();
    const kit = hostKit('machine', { config: w.config, host: w.alias, folder: w.folder });
    const plant = kit.planted.find((p) => p.name === PLANTS.machine);
    expect(plant, `the machine kit's planted runners: ${kit.planted.map((p) => p.name).join(', ')}`).toBeDefined();
    const findings = await judgeMachine(w, plant!.fill, units);
    expect(findings.some((f) => f.startsWith(`the machine check passed ${units.stale}`)), `the judge's findings on ${PLANTS.machine}: ${JSON.stringify(findings)}`).toBe(true);
  }, 600_000);
});
