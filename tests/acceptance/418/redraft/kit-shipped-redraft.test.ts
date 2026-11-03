// #418.186ac2bb, redrafted blind for the shipped side of the scope item: "The look module's interface `look@1`
// (#185), apart from the look asset of that name: its manifest names the implementation, and its conformance kit
// is every part of the canvas kit (#138) on this module's fixtures, with no behavior part, so it seals only bit,
// canonical implementations".
//
// One debug build of the shipped `full` build set. Its published plan (`{"call":"schedule"}`, #185) must name
// `look@1` as the look module's interface: the shipped implementation, named by its manifest, is the reference,
// bit and canonical; the interface lists every part of #138's kit and holds no behavior part. The kit (#138's
// `{"call":"kit"}`) run over the look module alone must test it at that digest and pass every part it runs, with
// each of the module's own fixtures (the `manifest` call's entries whose module is `look`) run by the `fixtures`
// part. "This module's fixtures" are the ones the issue's Proof names for the look's finish, so between them they
// set each look@1 field the issue adds: tone_map (filmic, agx and neutral named; none is the default), ao,
// deband, grade and bloom. See README.md for the reading.
import { describe, expect, it } from 'vitest';
import {
  arr, debugBuild, interfaceIn, isObject, moduleIn, num, obj, run, scenario, show, str, useDir, useEvidence,
  type Build, type JsonValue,
} from '../../185/redraft/helpers.ts';

const INTERFACE = 'look@1';
const MODULE = 'look';
const FULL: Build = { set: 'full' };

/** Every part of the canvas conformance kit (#138), by the names its `kit` call reports. */
const CANVAS_KIT = [
  'fixtures', 'clean_rebuild', 'patch_fuzz', 'read_set', 'order', 'schedule', 'repair_loop', 'carried_state',
  'late_entry', 'time_order', 'contribution', 'catalog', 'migration',
];
/** The look@1 fields #418 adds (its Fields), which the look module's fixtures must set between them. */
const FINISH_FIELDS = ['tone_map', 'ao', 'deband', 'grade', 'bloom'];
/** The tone maps other than the default `none`, each named by some fixture's tone_map. */
const TONE_MAPS = ['filmic', 'agx', 'neutral'];

const dir = useDir('deep-418-kit-redraft-');
const evidence = useEvidence();

/** Every value found under `key` anywhere in `v`. */
function under(v: JsonValue | undefined, key: string, out: JsonValue[] = []): JsonValue[] {
  if (Array.isArray(v)) for (const x of v) under(x, key, out);
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) { if (k === key) out.push(x); under(x, key, out); }
  return out;
}

describe('#418.186ac2bb the shipped look module\'s look@1: bit, canonical, every part of the canvas kit, no behavior part', () => {
  it('#418.186ac2bb the plan names look@1 with the shipped look module as its bit, canonical reference and the whole canvas kit, and the look module passes that kit on its own fixtures, which cover the finish', () => {
    const debug = debugBuild(FULL, dir());
    expect(debug.error, 'the debug build compiles: deep-show with features full').toBe('');
    const [schedule, manifest, reply] = run(debug.bin, scenario(evidence(), [
      { call: 'schedule' }, { call: 'manifest' },
      { call: 'kit', sequences: 100, param_sets: 50, modules: [MODULE] },
    ]));

    // 1. The published plan: look@1, apart from the look asset, is the look module's interface.
    const iface = interfaceIn(schedule!, INTERFACE);
    expect(iface.module, 'look@1 is implemented by the canvas module look').toBe(MODULE);
    expect(iface.implementation.name.length, `the manifest names the implementation: ${show(iface.implementation.raw)}`).toBeGreaterThan(0);
    expect(iface.implementation.version, 'the implementation carries a semver version').toMatch(/^\d+\.\d+\.\d+/);
    expect(iface.reference, 'the shipped look module is look@1\'s reference implementation').toBe(iface.implementation.name);
    expect(iface.implementation.equivalence, 'the shipped implementation is bit').toBe('bit');
    expect(iface.implementation.state, 'the shipped implementation is canonical').toBe('canonical');
    expect(iface.behavior, `look@1 holds no behavior part: ${show(iface.raw)}`).toBe('none');
    expect(CANVAS_KIT.filter((p) => !iface.kit.includes(p)), `look@1's kit lists every part of the canvas kit: ${show(iface.kit)}`).toEqual([]);
    expect(iface.kit, 'look@1\'s kit lists no behavior part').not.toContain('behavior');
    expect(iface.digest, 'look@1 has a digest').toMatch(/\S/);

    // 2. This module's fixtures, as the manifest lists them, cover the look's finish.
    const fixtures = arr(manifest!['fixtures'], 'manifest.fixtures').map((f, i) => obj(f, `manifest.fixtures[${i}]`))
      .filter((f) => f['module'] === MODULE);
    const names = fixtures.map((f, i) => str(f['name'], `the look module's fixtures[${i}].name`));
    expect(names.length, 'the look module has fixtures of its own').toBeGreaterThan(0);
    const bodies: JsonValue[] = fixtures.map((f) => [f['document'] ?? null, f['sidecar'] ?? null]);
    const missing = FINISH_FIELDS.filter((k) => under(bodies, k).length === 0);
    expect(missing, `the look module's fixtures (${names.join(', ')}) set each look@1 field the issue adds`).toEqual([]);
    const toneMaps = JSON.stringify(under(bodies, 'tone_map'));
    expect(TONE_MAPS.filter((t) => !toneMaps.includes(t)), `the look module's fixtures name each tone map: ${toneMaps.slice(0, 600)}`).toEqual([]);

    // 3. The kit tests the look module at look@1's digest and it passes every part it runs.
    const look = moduleIn(reply!, MODULE);
    expect(look['digest'], 'the kit tests the look module at look@1\'s digest').toBe(iface.digest);
    const parts = arr(look['parts'], 'look.parts').map((p, i) => obj(p, `look.parts[${i}]`));
    const ran = parts.map((p, i) => str(p['part'], `look.parts[${i}].part`));
    expect(ran, 'the kit ran no behavior part on look').not.toContain('behavior');
    expect(ran.filter((p) => !iface.kit.includes(p)), `every part run on look is one look@1's kit lists: ${ran.join(', ')}`).toEqual([]);
    for (const p of parts) {
      const name = String(p['part']);
      const cases = arr(p['cases'], `${name}.cases`).map((c, i) => obj(c, `${name}.cases[${i}]`));
      expect(num(p['ran'], `${name}.ran`), `${name}: ran every case it declares`).toBe(num(p['declared'], `${name}.declared`));
      expect(cases.length, `${name}: ran at least one case`).toBeGreaterThan(0);
      const bad = cases.filter((c) => c['verdict'] === 'FAIL' || c['verdict'] === 'INVALID');
      expect(bad.map((c) => `${String(c['case'])}: ${String(c['verdict'])}`), `${name}: no case failed or is INVALID`).toEqual([]);
      expect(p['verdict'], `${name} passes on look: ${show(p['failures'], 1500)}`).toBe('PASS');
    }
    const fixturesPart = parts.find((p) => p['part'] === 'fixtures');
    expect(fixturesPart, `the kit ran the fixtures part on look; it ran ${ran.join(', ')}`).toBeDefined();
    const runFixtures = new Set(arr(fixturesPart!['cases'], 'fixtures.cases').map((c) => obj(c, 'a fixtures case')['fixture']));
    const plain = fixtures.filter((f) => f['profile'] !== 'scene').map((f) => String(f['name']));
    expect(plain.filter((n) => !runFixtures.has(n)), 'the fixtures part ran each of the look module\'s own fixtures').toEqual([]);
    expect(look['verdict'], `the look module passes look@1's kit: ${show(look['failures'], 2000)}`).toBe('PASS');
    expect(arr(look['failures'], 'look.failures'), 'the look module raised no failure').toEqual([]);
  }, 3_600_000);
});
