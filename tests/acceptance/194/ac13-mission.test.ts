// AC13 #194.c61ec22d: "A mission whose victory needs `built {self, extractor, 3}` fails scenario.unreachable when
// extractors are denied at the start and never allowed, naming the victory, `built` and extractor; allowing extractors
// at `time 60` makes it pass; and a planted check that ignores `deny` fails the conformance kit, naming the fixture"
//
// The scenario catalog (fixtures.ts, criterion 7's) with the mission's two trigger tables: mission_denied, a start row
// `time 0` denying extractor and a victory `built {self, extractor, 3}`; mission_allowed, the same with a row `time 60`
// allowing extractor. scenario.reach through the hub: the denied mission fails with one failure
// `mission_denied.victory`, its message starting scenario.unreachable and naming victory, built and extractor (found
// `{code: scenario.unreachable, row: victory, why}`, `why` naming built and extractor); the allowed mission passes.
// The plug-in's kit (README: The surface, `catalogKit`): its planted runner `scenario_ignores_deny` passes the denied
// mission, its reference fill fails it the same way, and the kit's fixed part run on `scenario_ignores_deny` reads FAIL
// at a case raising scenario.unreachable whose message names its fixture (the case's ID).
// The wrong programs: the base (no plug-in), a scenario check that ignores deny, takes a later allow as never firing,
// or counts a time trigger as unreachable; a kit that admits the deny-ignoring runner or names no fixture.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import {
  AC, TIMEOUT, catalogKit, catalogOf, failuresOf, fillOf, foundOf, names, openHub, packAll, packCall, passes, prebuildCatalog, runCheck, runFill, scenario, scratch,
  show, shown,
} from './helpers.ts';
import { SCENARIO_SCHEMA, scenarioTables } from './fixtures.ts';

prebuildCatalog();

describe(`${AC[13]} a mission whose victory needs a kind denied at the start`, () => {
  it(`${AC[13]} denied and never allowed fails naming the victory, built and extractor; allowed at time 60 passes; the deny-ignoring runner fails the kit, naming the fixture`, async () => {
    const [c] = packAll([packCall(scratch('ac13'), scenarioTables(), SCENARIO_SCHEMA)], 'the scenario catalog');
    const hub = await openHub();
    const denied = await runCheck(hub, scenario(c!, 'mission_denied'));
    expect(denied.outcome, `the mission with extractors denied and never allowed fails: ${shown(denied)}`).toBe('failed');
    const f = failuresOf(denied, 'scenario.unreachable');
    expect(f.map((x) => x.test), `one failure, the victory's: ${shown(denied)}`).toEqual(['mission_denied.victory']);
    for (const w of ['victory', 'built', 'extractor']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    const found = foundOf(denied, 'scenario.reach', 'scenario.unreachable');
    expect(found, 'it finds the victory').toMatchObject([{ code: 'scenario.unreachable', row: 'victory' }]);
    for (const w of ['built', 'extractor']) expect(names(String(found[0]!['why']), w), `its why names ${w}: ${String(found[0]!['why'])}`).toBe(true);
    expect(catalogOf(denied, 'scenario.reach').found.length, 'and nothing else').toBe(1);
    passes(await runCheck(hub, scenario(c!, 'mission_allowed')), 'scenario.reach', c!, 'the mission allowing extractors at time 60');

    const kit = await catalogKit();
    const ignoresDeny = fillOf(kit, 'scenario_ignores_deny');
    const wrong = await runFill(ignoresDeny, scenario(c!, 'mission_denied'));
    expect(wrong.outcome, `the planted scenario_ignores_deny passes the denied mission: ${shown(wrong)}`).toBe('passed');
    const reference = await runFill(fillOf(kit, 'clean'), scenario(c!, 'mission_denied'));
    expect(failuresOf(reference, 'scenario.unreachable').map((x) => x.test), `the kit's reference fill fails it: ${shown(reference)}`).toEqual(['mission_denied.victory']);
    const report = await runKit(kit as never, ignoresDeny as never, { parts: ['fixed'] });
    expect(report.verdict, `the kit catches scenario_ignores_deny: ${show(report.cases.filter((x) => x.outcome !== 'PASS'))}`).toBe('FAIL');
    const named = report.cases.filter((x) => x.outcome === 'FAIL' && x.codes.includes('scenario.unreachable') && x.id !== '' && x.message.includes(x.id));
    expect(named.length, `a failed case raising scenario.unreachable names its fixture: ${show(report.cases.map((x) => [x.id, x.outcome, x.codes, x.message]))}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
