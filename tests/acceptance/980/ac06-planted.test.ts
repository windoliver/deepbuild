// Criterion 6: "The planted library that drops a case when the belt end blocks fails `process.conserve`, naming the step,
// the kind and a gap of 1. A planted library that grants a third request on a resource of capacity 2 fails
// `process.busy`, naming the resource and the step. The interface's pack is refused without its planted library."
//
// Through `deep-logic first_party`, `judge` and `pack_check` (README: The surface).
// - process@1 ships both planted libraries in its first-party pack (README: Planted): `drop` (a belt's lead at a blocked
//   end is removed, its row freed, no sink) and `over` (a request is granted while busy ≤ capacity, one past it). This
//   suite carries each in its own pack `plants` as planted_process@1, with a fixture of its own that both pass (#190's
//   rule), and links it by that name, so no interface fixture refuses it. Each planted library runs under the belt scene
//   and under the capacity-2 grant scene; the tests find the one that fails each rule.
// - Under the belt scene (criterion 3's), belt B's lead reaches the end at step 1,199 and is blocked from tick 1,200; the
//   dropping library frees it there, so at step 1,200 cases made 19 = held 17 + out 1 + 1: process.conserve's first fail
//   names step 1,200, kind `case` and gap 1 (fixtures.ts: beltRun). The reference library passes the same run.
// - Under GRANT2 (one resource of capacity 2, three requests at tick 0), the over-granting library grants all three at
//   tick 0: process.busy's first fail names resource 0 and step 0. The reference library passes it.
// - The pack: process@1's entry copied into an installed pack `processcopy` without its planted libraries is
//   `pack_refused` naming the interface; with them it installs.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild, refusedOf, show, type JsonObject } from '../190/helpers.ts';
import { beltRun } from './fixtures.ts';
import { AC, INTERFACE, PLANTED, PLANTED_MODULE, PROCESS, carry, judgeCall, judged, layout, plantsPack, processLib, rule, scenePiece, type Assets } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { BELT, BELT_STEPS, GRANT2, GRANT_STEPS, type Scene } from './scenes.ts';

prebuild(() => { logicBin(); });

/** Each planted library of process@1 under `s`, linked as planted_process@1, and the reference library's run of it. */
function tried(s: Scene, steps: number, item: string, code: string) {
  const L = processLib();
  layout(processWrites(s));
  const own = sceneProgram(s, PLANTED_MODULE);
  const runs = L.iface.planted.map((id) => {
    const assets: Assets = carry({ ...L.assets }, own);
    const plants = plantsPack(L.program(id), false, '1.0.0', assets);
    const [reply] = onHost([judgeCall(scenePiece(s, item, PLANTED_MODULE, [{ name: PLANTED, asset: id }], assets, [plants]), steps)]);
    return { id, reply: reply!, rule: reply!['ok'] === true ? rule(judged(reply!, item), code) : null };
  });
  const ref = sceneProgram(s, INTERFACE);
  const [control] = onHost([judgeCall(scenePiece(s, item, INTERFACE, [L.ref], carry({ ...L.assets }, ref)), steps)]);
  return { runs, control: rule(judged(control!, item), code) };
}

describe(`${AC[6]} the planted libraries and the interface's pack`, () => {
  it(`${AC[6]} the planted library that drops a case when the belt end blocks fails process.conserve, naming the step, the kind and a gap of 1`, () => {
    const r = beltRun();
    expect([r.pB(0, 1199), r.P], 'by the belt\'s geometry belt B\'s lead is at its end from step 1,199, blocked from tick 1,200').toEqual([1200, 1200]);
    const { runs, control } = tried(BELT, BELT_STEPS, 'belt', 'process.conserve');
    const planted = runs.find((x) => x.rule?.verdict === 'FAIL');
    expect(planted, `a planted library of process@1 fails process.conserve under the blocked belt: ${show(runs.map((x) => ({ id: x.id, rule: x.rule ?? x.reply })) as never)}`).toBeDefined();
    const first = planted!.rule!.fails[0]!;
    expect([first['step'], first['kind'], first['gap']], `its first fail names step 1,200, kind case and a gap of 1: ${show(first)}`).toEqual([1200, 'case', 1]);
    expect(control.verdict, 'the reference library passes process.conserve on the same run').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[6]} a planted library that grants a third request on a resource of capacity 2 fails process.busy, naming the resource and the step`, () => {
    expect(GRANT2.build.filter((b) => b.op === 'resource'), 'one resource of capacity 2').toEqual([{ op: 'resource', capacity: 2 }]);
    const { runs, control } = tried(GRANT2, GRANT_STEPS, 'grant2', 'process.busy');
    const planted = runs.find((x) => x.rule?.verdict === 'FAIL');
    expect(planted, `a planted library of process@1 fails process.busy with three requests on capacity 2: ${show(runs.map((x) => ({ id: x.id, rule: x.rule ?? x.reply })) as never)}`).toBeDefined();
    const first = planted!.rule!.fails[0]!;
    expect([first['resource'], first['step']], `its first fail names resource 0 and step 0: ${show(first)}`).toEqual([0, 0]);
    expect(control.verdict, 'the reference library passes process.busy on the same run').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[6]} the interface's pack is refused without its planted library`, () => {
    const L = processLib();
    const entry = (planted: string[]): JsonObject => ({ ...(L.pack['interfaces'] as JsonObject)[PROCESS] as JsonObject, planted });
    const copy = (version: string, planted: string[]): JsonObject => ({ call: 'pack_check', pack: { name: 'processcopy', version, origin: 'installed', libs: {}, interfaces: { [PROCESS]: entry(planted) } }, assets: L.assets });
    const [without, withIt] = onHost([copy('1.0.0', []), copy('1.0.1', L.iface.planted)]);
    const r = refusedOf(without!, 'the pack check of processcopy@1.0.0, process@1 without its planted libraries');
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'processcopy@1.0.0']);
    expect(r.refusals.some((x) => x['interface'] === PROCESS || x['interface'] === `processcopy.${PROCESS}`), `a refusal names the interface: ${show(r.refusals as never)}`).toBe(true);
    expect([withIt!['ok'], withIt!['installed'], withIt!['pack']], `the same pack with process@1's planted libraries installs: ${show(withIt)}`).toEqual([true, true, 'processcopy@1.0.1']);
  }, TIMEOUT);
});
