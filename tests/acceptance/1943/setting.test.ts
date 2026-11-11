// #1943.9249618e, the setting clause: on a test host, a setting the definition requires, changed by a planted drift,
// fails the setting check, naming the setting.
//
// On deep-ubuntu, through the world's SSH config (README, reading 2), a settings file holds both settings the
// definition requires (listen_address = 127.0.0.1, max_connections = 100). The setting check passes; a planted drift
// then sets max_connections to 500 in the file on the host, and the same fill's next run fails at its assertion,
// naming max_connections and not listen_address (judgeSetting). The wrong program: the kit's planted runner
// misses-the-drift, run on the same kind of world, fails that judge for missing the drift.
import { describe, expect, test } from 'vitest';
import { AC, DRIFTED, hostChecks, judgeSetting, PLANTS, settingsOnHost, world } from './helpers.ts';

const VM = 'deep-ubuntu';

describe(AC, () => {
  test('setting: a required setting that holds on the host passes; changed there by a planted drift, it fails at the check\'s assertion, naming the setting', async () => {
    const w = await world(VM);
    const spec = await settingsOnHost(w, 'held');
    const { hostFill } = await hostChecks();
    const fill = hostFill('setting', { config: w.config });
    expect(fill.kind).toBe('setting');
    expect(await judgeSetting(w, fill, spec)).toEqual([]);
  }, 600_000);

  test(`setting, the wrong program: the planted runner ${PLANTS.setting} fails that test, missing the drift of ${DRIFTED.name}`, async () => {
    const w = await world(VM);
    const spec = await settingsOnHost(w, 'plant');
    const { hostKit } = await hostChecks();
    const kit = hostKit('setting', { config: w.config, host: w.alias, folder: w.folder });
    const plant = kit.planted.find((p) => p.name === PLANTS.setting);
    expect(plant, `the setting kit's planted runners: ${kit.planted.map((p) => p.name).join(', ')}`).toBeDefined();
    const findings = await judgeSetting(w, plant!.fill, spec);
    expect(findings.some((f) => f.startsWith(`the setting check missed the drift of ${DRIFTED.name}`)), `the judge's findings on ${PLANTS.setting}: ${JSON.stringify(findings)}`).toBe(true);
  }, 600_000);
});
