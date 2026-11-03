// The look module's interface `look@1` (the issue's scope, last item): "its manifest names the implementation, and its
// conformance kit is every part of the canvas kit (#138) on this module's fixtures, with no behavior part, so it
// seals only bit, canonical implementations; a planted implementation declared bit whose finish pass at identity
// defaults changes one pixel fails the kit, naming the fixture and the first field, and a release build refuses it."
// It is the kit's side of #418.186ac2bb (the finish at identity changes no pixel), so the tests carry that ID.
//
// `deep-show` in the shipped `full` build set, and with this suite's test feature `test-look-finish-off` (README: The
// look@1 kit): the published plan's `interfaces` (#185), #138's `kit` call, and a release build embedding the kit's
// ledger (DEEP_KIT_LEDGER at build time), whose seal refuses at startup. Release builds are slow. At the base there
// is no `test-look-finish-off` feature, so that build fails.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  interfacesOf, kitCall, kitFailures, kitModule, releaseBuild, showRun, shown, startupRefusal, useOut, useShowBuilds, type JsonObject, type ShowFeature,
} from './helpers.ts';

const SHIPPED: ShowFeature[] = ['full'];
const PLANTED: ShowFeature[] = ['full', 'test-look-finish-off'];
const LOOK = 'look@1';
const builds = useShowBuilds([SHIPPED, PLANTED]);
const evidence = useOut();
let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-418-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('#418.186ac2bb the look module seals only bit, canonical implementations of look@1, by the whole canvas kit', () => {
  it('#418.186ac2bb look@1 names the shipped implementation, bit and canonical, with no behavior part and every kit part, and the shipped look passes that kit on its own fixtures', () => {
    const [schedule, report] = showRun(builds.bin(SHIPPED), evidence(), [{ call: 'schedule' }, kitCall({ modules: ['look'] })]);
    const all = interfacesOf(schedule!);
    const i = all[LOOK];
    expect(i, `the plan names ${LOOK}; it names ${Object.keys(all).join(', ')}`).toBeDefined();
    expect(i!.module, `${LOOK} is the look module's interface`).toBe('look');
    expect(i!.implementation.name.length, 'its manifest names the implementation').toBeGreaterThan(0);
    expect([i!.implementation.equivalence, i!.implementation.state], 'the shipped implementation is bit and canonical').toEqual(['bit', 'canonical']);
    expect(i!.reference, 'the shipped implementation is look@1\'s reference').toBe(i!.implementation.name);
    expect(i!.behavior, `${LOOK} holds no behavior part`).toBe('none');
    const every = new Set(Object.values(all).flatMap((x) => x.kit.filter((p) => p !== x.behavior)));
    const missing = [...every].filter((p) => !i!.kit.includes(p));
    expect(missing, `${LOOK}'s kit is every part of the canvas kit (${[...every].join(', ')})`).toEqual([]);

    const look = kitModule(report!, 'look');
    expect(look.verdict, `the shipped look passes its kit: ${shown(kitFailures(look).slice(0, 5) as JsonObject[])}`).toBe('PASS');
    expect(new Set(look.parts.map((p) => p.part)), `the kit ran ${LOOK}'s parts on the look module`).toEqual(new Set(i!.kit));
    const fixtures = look.parts.flatMap((p) => p.cases.flatMap((c) => (c.fixture ? [c.fixture] : [])));
    expect(fixtures.length, 'the kit ran the look module\'s fixtures').toBeGreaterThan(0);
    expect(fixtures.filter((f) => !f.startsWith('parity/look/')), 'every fixture it ran is the look module\'s own (parity/look/…)').toEqual([]);
  }, 7_200_000);

  it('#418.186ac2bb a planted implementation declared bit whose finish at identity changes one pixel fails the kit, naming the fixture and the first field, and a release build refuses it', () => {
    const bin = builds.bin(PLANTED);
    const ledger = join(dir, 'planted-ledger.json');
    const [schedule, lookOnly, whole] = showRun(bin, evidence(), [{ call: 'schedule' }, kitCall({ modules: ['look'] }), kitCall({ ledger })]);
    const i = interfacesOf(schedule!)[LOOK];
    expect(i, `the planted build's plan names ${LOOK}`).toBeDefined();
    expect(i!.implementation.equivalence, 'the planted implementation declares bit').toBe('bit');
    expect(i!.implementation.name, 'the build chose the planted implementation, not the reference').not.toBe(i!.reference);

    const look = kitModule(lookOnly!, 'look');
    expect(look.verdict, 'the planted implementation fails the look@1 kit').toBe('FAIL');
    const ran = new Set(look.parts.flatMap((p) => p.cases.flatMap((c) => (c.fixture ? [c.fixture] : []))));
    const named = kitFailures(look).filter((f) => typeof f['fixture'] === 'string' && typeof f['field'] === 'string' && (f['field'] as string).length > 0);
    expect(named.length, `a failure names the fixture and the first field that differs: ${shown(kitFailures(look).slice(0, 5) as JsonObject[])}`).toBeGreaterThan(0);
    expect(ran, `the fixture it names (${String(named[0]!['fixture'])}) is one the kit ran`).toContain(named[0]!['fixture']);
    expect(String(named[0]!['fixture']), 'that fixture is the look module\'s own').toMatch(/^parity\/look\//);
    expect(kitModule(whole!, 'look').verdict, 'the whole kit records the look module FAIL in its ledger').toBe('FAIL');

    expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
    const release = releaseBuild(PLANTED, ledger, dir);
    expect(release.error, 'the release build compiles').toBe('');
    const refusal = startupRefusal(release.bin);
    expect(refusal['interface'], `the release build refuses the planted implementation, naming ${LOOK}: ${shown(refusal)}`).toBe(LOOK);
  }, 7_200_000);
});
