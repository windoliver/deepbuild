// AC4 #485.008d1e79: The operator registries are the core's: a test build with scene3d and without the effects module
// seals, with scene3d's vertex_offset, light and ambient in gpu.output@1 and core.light@1 and core.ambient@1 in
// gpu.function@1, and the house fixture shades by core.light@1 with the same pixel hash as the full build on one
// machine; effects@1's interface digest is the same in builds with and without scene3d; and a planted effects module
// that declares gpu.output@1 itself leaves scene3d's entries with no registry in that build and is refused at its seal,
// naming gpu.output@1.
//
// Through `deep-show run` (#200's surfaces) in four builds (README: Assumed surfaces): `full`; `full,test-leave-out-effects`
// (#200's feature: the set's list without effects), the test build; `full,test-leave-out-effects,test-gpu-output-in-effects`,
// the same with the planted layout in which the effects module declares gpu.output@1 (so the core doesn't, and with
// effects left out nothing does); and `full,test-leave-out-scene3d`, the set's list without scene3d.
// 1. The test build starts (the seal takes it); its `registry` lists scene3d and not effects; in its `registries`
//    (deep://registries), gpu.output@1 and gpu.function@1 are the core's (`owner: core`), gpu.output@1 holds scene3d's
//    vertex_offset, light and ambient (`material.<name>`, module scene3d) and gpu.function@1 holds core.light@1 and
//    core.ambient@1 (module scene3d). Then, on this Mac, the house (#446's at night, helpers: `houseDoc`; no operator,
//    so every part shades by core.light@1 and core.ambient@1, its defaults) presented with a snapshot in the test build
//    and in `full` gives one pixel hash. (The house alone would draw alike in both builds at the base too, where effects
//    doesn't shade it; the entries come first.)
// 2. effects@1's interface digest (`schedule`'s `interfaces["effects@1"].digest`) is the same in `full` and in the build
//    without scene3d, which holds effects and not scene3d.
// 3. The planted layout's startup is refused at the seal (exit 2, `seal_refused`), the line naming gpu.output@1, so the
//    seal check fails naming it.
// Wrong programs: the base (no light, ambient or vertex_offset entries, no core.light@1 or core.ambient@1, none of the
// new features); scene3d's entries declared by scene3d or by effects; effects' digest holding scene3d's entries; a
// house shaded otherwise without effects.
import { describe, expect, it } from 'vitest';
import {
  AC, HOUSE, TIMEOUT, arr, failsNaming, houseDoc, inconclusive, isObject, mentions, none, obj, present, refusalOf, registryRow, requireMetal, runShow,
  scenario, sealFailures, shown, snapshotHash, startup, str, useEvidence, useShows, type RegistryRow,
} from './helpers.ts';

const ID = AC[4];
const FULL = 'full';
const NO_EFFECTS = 'full,test-leave-out-effects';
const PLANTED = 'full,test-leave-out-effects,test-gpu-output-in-effects';
const NO_SCENE3D = 'full,test-leave-out-scene3d';
const show = useShows([FULL, NO_EFFECTS, PLANTED, NO_SCENE3D]);
const evidence = useEvidence();

/** Each of `names` in `row` as scene3d's entry (an output by its name, `material.<name>` or `<name>@1`). */
function heldFailures(row: RegistryRow, names: readonly string[], match: (entry: string, name: string) => boolean): string[] {
  const out: string[] = [];
  if (row.owner !== 'core') out.push(`${row.name} is ${row.owner}'s, not the core's`);
  for (const name of names) {
    const e = row.entries.find((x) => match(x.name, name));
    if (!e) out.push(`${row.name} holds no ${name}; it holds ${row.entries.map((x) => x.name).slice(0, 60).join(', ')}`);
    else if (e.module !== 'scene3d') out.push(`${row.name}'s ${e.name} comes from ${e.module ?? 'no module'}, not scene3d`);
  }
  return out;
}
const outputMatch = (entry: string, name: string): boolean => entry === name || entry === `material.${name}` || entry === `${name}@1`;

describe(`${ID} the operator registries are the core's`, () => {
  it(`${ID} a test build with scene3d and without effects seals, with scene3d's vertex_offset, light and ambient in gpu.output@1 and core.light@1 and core.ambient@1 in gpu.function@1, and the house shades by core.light@1 with the full build's pixel hash on this Mac`, () => {
    const bin = show(NO_EFFECTS);
    none(sealFailures(startup(bin), NO_EFFECTS), 'the build without effects seals');
    const [registry, registries] = runShow(bin, scenario(evidence(), [{ call: 'registry' }, { call: 'registries' }]));
    const modules = arr(registry!['modules'], 'registry: modules').map(String);
    expect([modules.includes('scene3d'), modules.includes('effects')], `${NO_EFFECTS} holds scene3d and not effects: ${modules.join(', ')}`).toEqual([true, false]);
    none([
      ...heldFailures(registryRow(registries!, 'gpu.output@1'), ['vertex_offset', 'light', 'ambient'], outputMatch),
      ...heldFailures(registryRow(registries!, 'gpu.function@1'), ['core.light@1', 'core.ambient@1'], (e, n) => e === n),
    ], 'scene3d\'s entries in the core\'s registries, in the build without effects');

    // The house shades by core.light@1 there, its default, with the full build's pixel hash.
    requireMetal();
    const hashes: string[] = [];
    for (const set of [FULL, NO_EFFECTS]) {
      const [reply] = runShow(show(set), scenario(evidence(), [present(houseDoc(), HOUSE.size)]));
      const hash = snapshotHash(reply!, `the house in ${set}`);
      if (hash === null) inconclusive(`no GPU to draw the house on here (unsupported_platform in ${set}); its pixel hash is compared only on macOS`);
      hashes.push(hash);
    }
    expect(hashes[1], `the house's pixel hash in ${NO_EFFECTS} (${hashes[1]}) is the full build's (${hashes[0]})`).toBe(hashes[0]);
  }, 2 * TIMEOUT);

  it(`${ID} effects@1's interface digest is the same in builds with and without scene3d`, () => {
    const digests: string[] = [];
    for (const set of [FULL, NO_SCENE3D]) {
      const [registry, schedule] = runShow(show(set), scenario(evidence(), [{ call: 'registry' }, { call: 'schedule' }]));
      const modules = arr(registry!['modules'], `${set}: registry.modules`).map(String);
      expect([modules.includes('effects'), modules.includes('scene3d')], `${set} holds effects, and scene3d only in ${FULL}: ${modules.join(', ')}`).toEqual([true, set === FULL]);
      const interfaces = obj(schedule!['interfaces'], `${set}: schedule.interfaces`);
      expect(isObject(interfaces['effects@1']), `${set}: schedule lists effects@1's interface: ${Object.keys(interfaces).join(', ')}`).toBe(true);
      digests.push(str(obj(interfaces['effects@1'], `${set}: interfaces["effects@1"]`)['digest'], `${set}: effects@1's digest`));
    }
    expect(digests[1], `effects@1's interface digest without scene3d (${digests[1]}) is its digest with scene3d (${digests[0]})`).toBe(digests[0]);
  }, 2 * TIMEOUT);

  it(`${ID} a planted effects module that declares gpu.output@1 itself (test-gpu-output-in-effects) leaves scene3d's entries with no registry in the build without effects and is refused at its seal, naming gpu.output@1`, () => {
    const s = startup(show(PLANTED));
    // The label holds no registry name, so only the refusal line can name it.
    failsNaming(sealFailures(s, PLANTED), ['gpu.output@1'], 'the planted layout');
    const r = refusalOf(s);
    expect(typeof r === 'string' ? r : 'the seal\'s refusal', `the planted layout's startup is the seal's refusal: ${s.stdout.slice(0, 600)}`).toBe('the seal\'s refusal');
    if (typeof r !== 'string') expect(mentions(r, 'gpu.output@1'), `the refusal names gpu.output@1: ${shown(r)}`).toBe(true);
  }, 2 * TIMEOUT);
});
