// AC3 (its second sentence; the first is in hub.test.ts): "A planted pack folder whose recipe fails the pack check is
// absent from the listing and named by `deep doctor`."
//
// asserts: an installed tree (#41's scripts/install-prefix.mjs), the hub's release, ships the first-party packs: a folder
// of the tree holds a pack folder whose pack.json is byte for byte one of the checkout's packs/*/pack.json (helpers.ts,
// shippedPackRoots). The planted pack folder (fixtures/plant1720-1.0.0: one recipe whose input `width` defaults to 1,
// outside its own range of 2 to 10) is copied beside them, and `deep-show run` of the same canvas core refuses it at the pack check
// (#306's `packs` row: state `refused`, with issues). Then, with the tree's `deep hub run` in a temporary HOME, a Claude
// Code session bound by its hooks and its `deep mcp`: every page of `deep_kinds list` names each first-party pack the
// tree ships with its version, and nothing in the listing names plant1720; and the tree's `deep doctor --json` holds
// an item whose text names plant1720 at level warn or fail.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKOUT_PACKS, PLANT_NAME, cleanup, doctor, firstParty, install, listed, listing, openSession, plant, plantRowOnRun, shippedPackRoots, useCanvasCore, type Installed } from './helpers.ts';

const built = useCanvasCore();
let tree: Installed | undefined;
let laid = '';
beforeAll(() => {
  try {
    built();
    tree = install();
  } catch (error) {
    laid = String((error as Error).message ?? error);
  }
}, 1_800_000);
afterAll(cleanup, 60_000);

describe('AC3 a planted pack folder whose recipe fails the pack check is absent from the listing and named by deep doctor', () => {
  it('AC3 the planted pack is refused: absent from deep_kinds list beside the shipped packs, and named by deep doctor', async () => {
    expect(laid, 'the canvas core is built and the installed tree laid out').toBe('');
    const roots = shippedPackRoots(tree!.tree);
    expect(roots, `the installed tree ${tree!.tree} ships the first-party packs: a folder holding pack folders whose pack.json is one of the checkout's packs/*/pack.json`).not.toEqual([]);
    for (const root of roots) plant(root);

    // The plant fails the pack check of the very canvas core the tree ships, by #306's own row.
    const row = plantRowOnRun(tree!.core);
    expect([row?.state, Array.isArray(row?.issues) && row!.issues.length > 0], `deep-show run's pack check refuses the planted pack, with its issues: ${JSON.stringify(row).slice(0, 600)}`).toEqual(['refused', true]);

    const live = await openSession(tree!.deep);
    const { pages, failure } = await listing(live.agent);
    expect(failure, 'deep_kinds list answers every page through the installed hub and deep mcp').toBeUndefined();
    const shipped = roots.flatMap((root) => firstParty(root)).filter((p) => p.name !== PLANT_NAME);
    const ours = new Set(firstParty(CHECKOUT_PACKS).map((p) => p.ref));
    const missing = [...new Set(shipped.filter((p) => ours.has(p.ref) && !listed(pages, p)).map((p) => p.ref))];
    expect(missing, 'the installed hub lists each first-party pack it ships, with its version, beside the plant').toEqual([]);
    const plantText = JSON.stringify(pages);
    expect(plantText.includes(PLANT_NAME), `the planted pack is absent from deep_kinds list: ${plantText.slice(Math.max(0, plantText.indexOf(PLANT_NAME) - 200), plantText.indexOf(PLANT_NAME) + 200)}`).toBe(false);

    const d = await doctor(tree!.deep, live.home);
    const naming = d.items.filter((i) => [i.item, i.code, i.evidence, i.fix].some((t) => String(t).includes(PLANT_NAME)));
    expect(naming.filter((i) => i.level === 'warn' || i.level === 'fail'), `deep doctor names the planted pack in an item that warns or fails: ${JSON.stringify(naming).slice(0, 800)} (${d.items.length} items, exit ${d.ran.code}; stderr ${d.ran.stderr.slice(-600)})`).not.toEqual([]);
  }, 1_800_000);
});
