// Criterion 6: "A lane graph with a rack bay no park bay can reach is refused at check, naming the bay. The planted
// library that enters a held zone fails `lanes.clear`, naming both vehicles, the zone and the step. The interface's
// pack is refused without its planted library."
//
// Through `deep-logic first_party`, `check`, `judge` and `pack_check` (README: The surface).
// - The refused graph (scenes.ts: refused): two park bays on a two-way lane and rack.7 on a spur that runs one way out
//   of the rack, so no bay reaches it. Its twin, the spur two-way, is admitted.
// - The planted library: lanes@1's own (first_party), carried by this suite's pack `plants` as planted_lanes@1 with a
//   fixture of its own that it passes (#190's rule), linked by that name under criterion 2's merge. README: Planted
//   gives its wrong rule: it takes a junction whether or not another vehicle holds it. Both vehicles then run free, so
//   both reach J's zone at one step, worked here: their centres first come within half a length of it at step 98.
//   The reference library on the same run passes.
// - The pack: lanes@1's entry copied into an installed pack `lanescopy`, without its planted libraries, is refused,
//   naming the interface; with them it installs.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, checkCall, logicBin, onHost, prebuild, refusedOf, show, type JsonObject } from '../190/helpers.ts';
import { MERGE_ROUTES, MERGE_STEPS, endOf, mergeRun } from './fixtures.ts';
import { AC, INTERFACE, LANES, PLANTED, carry, judgeCall, judged, lanes, layout, piece, plantsPack, rule, type Assets } from './helpers.ts';
import { dispatchProgram, lanesWrites } from './programs.ts';
import { MERGE, bay, junctionReach, profile, refused, routeZones, unreachableBays } from './scenes.ts';

prebuild(() => { logicBin(); });

const mergeSends = [{ at: 0, v: 0, bay: bay(MERGE, 'dock.e') }, { at: 0, v: 1, bay: bay(MERGE, 'rack.m') }];

describe(`${AC[6]} refusals and the planted library`, () => {
  it(`${AC[6]} a lane graph with a rack bay no park bay can reach is refused at check, naming the bay`, () => {
    expect([unreachableBays(refused(false)), unreachableBays(refused(true))], 'by search: rack.7 is reached by no bay, and by both once its spur is two-way').toEqual([['rack.7'], []]);
    const L = lanes();
    const writes = lanesWrites(1);
    layout(writes);
    const replies = onHost([false, true].map((twoWay) => {
      const s = refused(twoWay);
      const program = dispatchProgram(s.name, INTERFACE, [bay(s, 'park.1')], [{ at: 0, v: 0, bay: bay(s, 'park.2') }], 0.1);
      return checkCall(piece({ lanes: { program, writes, scene: s, links: [L.ref] } }, [], carry({ ...L.assets }, program)));
    }));
    const r = refusedOf(replies[0]!, 'the check of the graph whose rack bay no bay reaches');
    expect([r.code, r.item], 'it is refused at check, naming the item').toEqual(['logic_refused', 'lanes']);
    expect(r.refusals.filter((x) => typeof x['bay'] === 'string').map((x) => x['bay']), `a refusal names rack.7, and no other bay: ${show(r.refusals as never)}`).toEqual(['rack.7']);
    expect(replies[1]!['ok'], `the same graph with its spur two-way is admitted: ${show(replies[1])}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[6]} the planted library that enters a held zone fails lanes.clear, naming both vehicles, the zone and the step`, () => {
    // Both vehicles on the free profile: the first step at whose end each centre is within half a length of J's zone.
    const v = MERGE.vehicle, run = mergeRun();
    const j = routeZones(MERGE, MERGE_ROUTES[0]!).find((z) => z.junction)!;
    const free = profile(36.25, v.speed, v.accel, v.decel);
    const enters = Array.from({ length: MERGE_STEPS }, (_, k) => k).find((k) => free.at(endOf(MERGE, k)) + v.length / 2 > j.from + 1e-6)!;
    expect([j.name, j.from, enters, run.junction], 'J\'s zone, junction:a,b,c1, starts 1.25 m short of J; both enter it at step 98').toEqual(['junction:a,b,c1', 20 - junctionReach(v), 98, 'junction:a,b,c1']);

    const L = lanes();
    const writes = lanesWrites(2);
    layout(writes);
    const ref = dispatchProgram('merge', INTERFACE, [bay(MERGE, 'park.w'), bay(MERGE, 'park.s')], mergeSends, 0.1);
    const own = dispatchProgram('merge', 'lib:planted_lanes', [bay(MERGE, 'park.w'), bay(MERGE, 'park.s')], mergeSends, 0.1);
    // Each planted library of lanes@1 under the merge: the one this criterion names is the one that enters J held.
    const tried = L.iface.planted.map((id) => {
      const assets: Assets = carry({ ...L.assets }, own);
      const plants = plantsPack(L.program(id), false, '1.0.0', assets);
      const [reply] = onHost([judgeCall(piece({ merge: { program: own, writes, scene: MERGE, links: [{ name: PLANTED, asset: id }] } }, [plants], assets), MERGE_STEPS)]);
      return { id, reply: reply! };
    });
    const fails = tried.map(({ id, reply }) => ({ id, reply, clear: reply['ok'] === true ? rule(judged(reply, 'merge'), 'lanes.clear') : null }));
    const planted = fails.find((f) => f.clear?.verdict === 'FAIL');
    expect(planted, `a planted library of lanes@1 fails lanes.clear under the merge: ${show(fails.map((f) => ({ id: f.id, clear: f.clear, reply: f.clear ? 'ok' : f.reply })) as never)}`).toBeDefined();
    const first = planted!.clear!.fails[0]!;
    expect([first['step'], first['zone'], first['vehicles']], 'its first fail names step 98, J\'s zone and vehicles 0 and 1').toEqual([98, 'junction:a,b,c1', [0, 1]]);
    // The reference library on the same run passes.
    const [control] = onHost([judgeCall(piece({ merge: { program: ref, writes, scene: MERGE, links: [L.ref] } }, [], carry({ ...L.assets }, ref)), MERGE_STEPS)]);
    expect(rule(judged(control!, 'merge'), 'lanes.clear').verdict, 'the reference library passes lanes.clear on the same run').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[6]} the interface's pack is refused without its planted library`, () => {
    const L = lanes();
    const entry = (planted: string[]): JsonObject => ({ ...(L.pack['interfaces'] as JsonObject)[LANES] as JsonObject, planted });
    const copy = (version: string, planted: string[]): JsonObject => ({ call: 'pack_check', pack: { name: 'lanescopy', version, origin: 'installed', libs: {}, interfaces: { [LANES]: entry(planted) } }, assets: L.assets });
    const [without, withIt] = onHost([copy('1.0.0', []), copy('1.0.1', L.iface.planted)]);
    const r = refusedOf(without!, 'the pack check of lanescopy@1.0.0, lanes@1 without its planted library');
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'lanescopy@1.0.0']);
    expect(r.refusals.some((x) => x['interface'] === LANES || x['interface'] === `lanescopy.${LANES}`), `a refusal names the interface: ${show(r.refusals as never)}`).toBe(true);
    expect([withIt!['ok'], withIt!['installed'], withIt!['pack']], `the same pack with lanes@1's planted library installs: ${show(withIt)}`).toEqual([true, true, 'lanescopy@1.0.1']);
  }, TIMEOUT);
});
