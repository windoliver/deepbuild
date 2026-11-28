// #3428's `deep doctor` items for paseo (README, The worlds): AC3's doctor half (the plugin paseo refused at load is
// its item at the error level, with paseo's reason) and AC4 (on a covered paseo with the plugin loaded every paseo item
// reads ok; with no paseo on the PATH there is none). An item is paseo's when its agent is `paseo`.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, NODE, OLD_RANGE, cleanup, doctor, doctorCodes, itemsShown, needCoveredRelease, newestCovered, paseoItems, setup, source, world,
} from './world.ts';

afterEach(cleanup, 120_000);

describe(`${AC[3]} With the plugin listed in paseo and refused at load, deep doctor shows the plugin's item at its error level with paseo's reason`, () => {
  it(`${AC[3]} paseo lists deepbuild failed at load: the plugin's item reads fail, with a stable code and paseo's reason`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'old copy', registry: 'serves' });
    const { items } = await doctor(w);
    const ours = paseoItems(items);
    const plugin = ours.filter((i) => /plugin/i.test(String(i.item)));
    const state = `paseo ${newestCovered()} lists deepbuild with status failed: Plugin "deepbuild" requires Paseo ${OLD_RANGE}. Your daemon is ${newestCovered()}.`;
    expect(plugin.length, `${AC[3]} ${state} deep doctor has an item for the plugin, its agent paseo; paseo's items: ${itemsShown(ours)}`).toBeGreaterThan(0);
    const failing = plugin.filter((i) => i.level === 'fail');
    expect(failing.length, `${AC[3]} ${state} the plugin's item reads at its error level, fail: ${itemsShown(plugin)}`).toBeGreaterThan(0);
    expect(failing.filter((i) => String(i.evidence).includes(`requires Paseo ${OLD_RANGE}`)).length, `${AC[3]} ${state} the plugin's failed item says paseo's reason: ${itemsShown(failing)}`).toBeGreaterThan(0);
    const codes = doctorCodes();
    for (const i of failing) expect({ item: i.item, stable: codes.has(String(i.code)), healthy: i.code === 'healthy' || i.code === 'unknown' }, `${AC[3]} ${i.item}'s code ${i.code} is one of the doctor family's, and no success`).toEqual({ item: i.item, stable: true, healthy: false });
  }, 600_000);
});

describe(`${AC[4]} On a covered paseo with the plugin loaded, every paseo item reads ok. With no paseo on the PATH there is no paseo item`, () => {
  it(`${AC[4]} paseo at the facts' newest, the plugin installed from the facts' source and running, the source resolving: paseo's items for its version, the plugin and the source all read ok`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'installed', registry: 'serves', hub: true });
    await setup(w);
    const { items } = await doctor(w);
    const ours = paseoItems(items);
    const shown = itemsShown(ours);
    const has = {
      version: ours.some((i) => String(i.evidence).includes(newestCovered())),
      plugin: ours.some((i) => /plugin/i.test(String(i.item))),
      source: ours.some((i) => String(i.evidence).includes(source().name)),
    };
    expect(has, `${AC[4]} deep doctor shows paseo's items: its version ${newestCovered()} against the versions covered, the plugin installed, enabled and loaded, and the source it installs from (${source().source}); paseo's items: ${shown}`).toEqual({ version: true, plugin: true, source: true });
    const codes = doctorCodes();
    expect(ours.filter((i) => i.level !== 'ok').map((i) => `${i.item} ${i.level} ${i.code}: ${i.evidence}`), `${AC[4]} on paseo ${newestCovered()}, which the facts cover, with the plugin loaded, every paseo item reads ok`).toEqual([]);
    expect(ours.filter((i) => !codes.has(String(i.code))).map((i) => `${i.item}: ${i.code}`), `${AC[4]} each paseo item has a stable code, one of the doctor family's`).toEqual([]);
    needCoveredRelease(`paseo's items on paseo ${newestCovered()}`);
  }, 600_000);

  it(`${AC[4]} with no paseo on the PATH, though ~/.paseo stays, deep doctor has no paseo item`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'installed', registry: 'serves' });
    rmSync(join(w.bin, 'paseo'));
    const PATH = [w.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    const found = PATH.split(':').find((d) => existsSync(join(d, 'paseo')));
    if (found) throw Error(`BLOCKED: a paseo is on this Mac's PATH at ${found}, so no test here can run the doctor with no paseo on its PATH`);
    const { items } = await doctor(w, { PATH });
    expect(paseoItems(items).map((i) => `${i.item} ${i.level} ${i.code}: ${i.evidence}`), `${AC[4]} with no paseo on the PATH (${PATH.split(w.tmp).join('<tmp>')}) there is no paseo item`).toEqual([]);
    needCoveredRelease('no paseo item with no paseo on the PATH');
  }, 600_000);
});
