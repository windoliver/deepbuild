// #2306.174ffd09: "The weight, the beam, the slab and the platform join the physics behavior kit's data (#191), each
// once, and Rapier 0.36.1 passes the four through the kit. A test backend whose `caps()` list no vehicle controller
// reads `excluded_by_caps` on the four, never a pass"
//
// #191's calls (its README: The surface under test), as #251's ac7 reads its five: `behavior_fixtures` holds the four
// fixtures once each, named as README: Fixture names says, each with one of the issue's answers for it (matched within
// half a unit of the last printed digit, as #191's suite reads answers) and its tolerance, each naming the cap
// `vehicle_controller`, each world holding a vehicle body and the body the vehicle stands on (dynamic for the weight, the
// beam and the slab, with the beam's hinge; kinematic for the platform). `behavior_kit` on Rapier (the shipped build)
// passes the four, each measured within its tolerance of its answer. On #251's `--backend no_vehicle_controller` (the
// test-backends build) the kit admits the backend and reads excluded_by_caps on each of the four.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, VEHICLE_CAP, backendOf, fixturesOf, fmt, isObject, kitReport, none, onTest, prebuildBuilds, show, type JsonObject,
  type JsonValue,
} from './helpers.ts';
import type { FixtureData } from '../191/helpers.ts';

prebuildBuilds(['shipped', 'test']);

const ID = CRITERIA[7];
/** An answer as printed, its tolerance, and what the fixture's world holds beside the vehicle. */
interface Form { printed: string; tolerance: JsonObject }
interface Want { name: string; forms: Form[]; under: 'dynamic' | 'kinematic'; joint?: 'hinge' }
const FIXTURES: Want[] = [
  // 10,791 N, or the same times the step's length, 1/120 s: 89.925 N·s.
  { name: 'vehicle_weight', forms: [{ printed: '10791', tolerance: { relative: 0.01 } }, { printed: '89.925', tolerance: { relative: 0.01 } }], under: 'dynamic' },
  { name: 'vehicle_beam', forms: [{ printed: '15', tolerance: { deg: 0.1 } }], under: 'dynamic', joint: 'hinge' },
  { name: 'vehicle_slab', forms: [{ printed: '4.00', tolerance: { relative: 0.02 } }, { printed: '-4.00', tolerance: { relative: 0.02 } }], under: 'dynamic' },
  { name: 'vehicle_platform', forms: [{ printed: '0', tolerance: { m: 0.02 } }], under: 'kinematic' },
];
const NAMES = FIXTURES.map((f) => f.name);
/** An answer as printed admits the exact value within half a unit of its last digit. */
const printedAs = (x: number, printed: string): boolean => Math.abs(x - Number(printed)) <= 0.5 * 10 ** -((printed.split('.')[1] ?? '').length);
/** Within a tolerance of the answer: relative, or in metres or degrees. */
function within(measured: number, answer: number, t: JsonValue): boolean {
  if (!isObject(t)) return false;
  if (typeof t['relative'] === 'number') return Math.abs(measured - answer) <= Math.abs(answer) * t['relative'];
  for (const unit of ['m', 'deg']) if (typeof t[unit] === 'number') return Math.abs(measured - answer) <= (t[unit] as number) + 1e-12;
  return false;
}
const kinds = (d: FixtureData): string[] => (isObject(d.world['bodies']) ? Object.values(d.world['bodies']).map((b) => (isObject(b) ? String(b['kind']) : '')) : []);
const jointKinds = (d: FixtureData): string[] => (isObject(d.world['joints']) ? Object.values(d.world['joints']).map((j) => (isObject(j) ? String(j['kind']) : '')) : []);

describe(`${ID} the weight, the beam, the slab and the platform join the behavior kit: Rapier passes them and a backend without a vehicle controller excludes them`, () => {
  it(`${ID} the four join the kit's data once each, and Rapier 0.36.1 passes the four through the kit`, () => {
    const [fixtures, info, report] = onTest([{ call: 'behavior_fixtures' }, { call: 'backend' }, { call: 'behavior_kit' }], { build: 'shipped' });
    const data = fixturesOf(fixtures!, 'behavior_fixtures');
    expect(backendOf(info!, 'backend (Rapier)').caps, `Rapier's caps() list ${VEHICLE_CAP}`).toContain(VEHICLE_CAP);
    const f: string[] = [];
    for (const want of FIXTURES) {
      const found = data.filter((d) => d.name === want.name);
      if (found.length !== 1) { f.push(`${want.name}: the kit's data holds it ${found.length} times, not once`); continue; }
      const d = found[0]!;
      if (!want.forms.some((x) => printedAs(d.answer, x.printed) && JSON.stringify(d.tolerance) === JSON.stringify(x.tolerance))) {
        f.push(`${want.name}: its answer ${d.answer} and tolerance ${show(d.tolerance)} aren't the issue's (${want.forms.map((x) => `${x.printed} within ${show(x.tolerance)}`).join(', or ')})`);
      }
      if (!d.caps.includes(VEHICLE_CAP)) f.push(`${want.name}: its caps ${show(d.caps)} don't name ${VEHICLE_CAP}`);
      const k = kinds(d);
      if (!k.includes('vehicle')) f.push(`${want.name}: its world holds no vehicle body`);
      if (!k.includes(want.under)) f.push(`${want.name}: its world holds no ${want.under} body for the vehicle to stand on (its bodies' kinds: ${k.join(', ')})`);
      if (want.joint && !jointKinds(d).includes(want.joint)) f.push(`${want.name}: its world holds no ${want.joint} joint`);
    }
    const k = kitReport(report!, 'behavior_kit on Rapier');
    for (const want of FIXTURES) {
      const r = k.results.filter((x) => x.fixture === want.name);
      if (r.length !== 1) { f.push(`${want.name}: the kit's report holds it ${r.length} times on Rapier`); continue; }
      const x = r[0]!;
      if (x.result !== 'pass') f.push(`${want.name}: reads ${x.result} on Rapier: ${x.what}`);
      else if (x.measured === null || x.answer === null || !within(x.measured, x.answer, x.tolerance ?? null)) f.push(`${want.name}: passes on Rapier measuring ${x.measured === null ? 'nothing' : fmt(x.measured)}, outside ${show(x.tolerance)} of ${show(x.answer)}`);
    }
    none(f, 'the four fixtures in the kit\'s data and on Rapier');
  }, TIMEOUT);

  it(`${ID} a test backend whose caps() list no vehicle controller reads excluded_by_caps on the four, never a pass`, () => {
    const [info, report] = onTest([{ call: 'backend' }, { call: 'behavior_kit' }], { backend: 'no_vehicle_controller' });
    expect(backendOf(info!, 'backend (no_vehicle_controller)').caps, `no_vehicle_controller's caps() list no ${VEHICLE_CAP}`).not.toContain(VEHICLE_CAP);
    const k = kitReport(report!, 'behavior_kit on no_vehicle_controller');
    expect(k.admitted, `the kit admits no_vehicle_controller: ${show(k.refused)}`).toBe(true);
    none(NAMES.flatMap((n) => {
      const r = k.results.filter((x) => x.fixture === n);
      return r.length === 1 && r[0]!.result === 'excluded_by_caps' ? [] : [`${n} reads ${r.map((x) => x.result).join(', ') || 'nothing'} on no_vehicle_controller, not excluded_by_caps`];
    }), 'the four fixtures on a backend without a vehicle controller');
  }, TIMEOUT);
});
