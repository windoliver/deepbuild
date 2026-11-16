// #251.9fb00bb4: "The sag, brake, drive, turn and contact fixtures join the physics behavior kit's data (#191), each
// once, and Rapier 0.36.1 passes the five through the kit; a test backend whose caps() list no vehicle controller reads
// excluded_by_caps on the five, never a pass; and a planted kit report that counts them as passed is refused, naming the
// fixture"
//
// #191's calls (its README: The surface under test): `behavior_fixtures` holds the five vehicle fixtures once each, named
// as README: Fixture names says, with the issue's answers (matched within half a unit of the last printed digit, as
// #191's suite reads them) and tolerances, each naming the cap `vehicle_controller` and each world holding a vehicle
// body. `behavior_kit` on Rapier (the shipped build) passes the five, each measured within its tolerance of its answer.
// On `--backend no_vehicle_controller` (the test-backends build) the kit admits the backend and reads excluded_by_caps on
// each of the five. With `--planted kit_counts_excluded_passed` on that backend the kit's report counts the five as
// passed, and the report is refused: `ok: false`, or a verdict other than pass, naming a vehicle fixture outside its
// results.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, VEHICLE_CAP, backendOf, fixturesOf, fmt, isObject, kitReport, naming, none, onTest, prebuildBuilds, show,
  type JsonObject, type KitReport,
} from './helpers.ts';

prebuildBuilds(['shipped', 'test']);

const ID = CRITERIA[7];
interface Want { name: string; printed: string; tolerance: JsonObject }
const FIXTURES: Want[] = [
  { name: 'vehicle_sag', printed: '0.0621', tolerance: { relative: 0.02 } },
  { name: 'vehicle_brake', printed: '12.5', tolerance: { relative: 0.03 } },
  { name: 'vehicle_drive', printed: '4.00', tolerance: { relative: 0.02 } },
  { name: 'vehicle_turn', printed: '9.330', tolerance: { relative: 0.03 } },
  { name: 'vehicle_contacts', printed: '0.4515', tolerance: { steps: 1 } },
];
const NAMES = FIXTURES.map((f) => f.name);
/** An answer as printed admits the exact value within half a unit of its last digit. */
const printedAs = (x: number, printed: string): boolean => Math.abs(x - Number(printed)) <= 0.5 * 10 ** -((printed.split('.')[1] ?? '').length);
/** Within a tolerance of the answer: relative, or one step of 120 Hz for a time. */
function within(measured: number, answer: number, t: JsonObject): boolean {
  if (typeof t['relative'] === 'number') return Math.abs(measured - answer) <= Math.abs(answer) * t['relative'];
  if (typeof t['steps'] === 'number') return Math.abs(measured - answer) <= t['steps'] / 120 + 1e-12;
  return false;
}

describe(`${ID} the vehicle's five fixtures join the behavior kit: Rapier passes them, a backend without a vehicle controller excludes them, and a report counting excluded ones as passed is refused`, () => {
  it(`${ID} the sag, brake, drive, turn and contact fixtures join the kit's data once each, and Rapier 0.36.1 passes the five through the kit`, () => {
    const [fixtures, info, report] = onTest([{ call: 'behavior_fixtures' }, { call: 'backend' }, { call: 'behavior_kit' }], { build: 'shipped' });
    const data = fixturesOf(fixtures!, 'behavior_fixtures');
    expect(backendOf(info!, 'backend (Rapier)').caps, `Rapier's caps() list ${VEHICLE_CAP}`).toContain(VEHICLE_CAP);
    const f: string[] = [];
    for (const want of FIXTURES) {
      const found = data.filter((d) => d.name === want.name);
      if (found.length !== 1) { f.push(`${want.name}: the kit's data holds it ${found.length} times, not once`); continue; }
      const d = found[0]!;
      if (!printedAs(d.answer, want.printed)) f.push(`${want.name}: its answer is ${d.answer}, not the issue's ${want.printed}`);
      if (JSON.stringify(d.tolerance) !== JSON.stringify(want.tolerance)) f.push(`${want.name}: its tolerance is ${show(d.tolerance)}, not ${show(want.tolerance)}`);
      if (!d.caps.includes(VEHICLE_CAP)) f.push(`${want.name}: its caps ${show(d.caps)} don't name ${VEHICLE_CAP}`);
      const bodies = isObject(d.world['bodies']) ? Object.values(d.world['bodies']) : [];
      if (!bodies.some((b) => isObject(b) && b['kind'] === 'vehicle')) f.push(`${want.name}: its world holds no vehicle body`);
    }
    const k: KitReport = kitReport(report!, 'behavior_kit on Rapier');
    for (const want of FIXTURES) {
      const r = k.results.filter((x) => x.fixture === want.name);
      if (r.length !== 1) { f.push(`${want.name}: the kit's report holds it ${r.length} times on Rapier`); continue; }
      const x = r[0]!;
      if (x.result !== 'pass') f.push(`${want.name}: reads ${x.result} on Rapier: ${x.what}`);
      else if (x.measured === null || !within(x.measured, Number(want.printed), want.tolerance)) f.push(`${want.name}: passes on Rapier measuring ${x.measured === null ? 'nothing' : fmt(x.measured)}, outside ${show(want.tolerance)} of ${want.printed}`);
    }
    none(f, 'the five vehicle fixtures in the kit\'s data and on Rapier');
  }, TIMEOUT);

  it(`${ID} a test backend whose caps() list no vehicle controller reads excluded_by_caps on the five, never a pass`, () => {
    const [info, report] = onTest([{ call: 'backend' }, { call: 'behavior_kit' }], { backend: 'no_vehicle_controller' });
    expect(backendOf(info!, 'backend (no_vehicle_controller)').caps, `no_vehicle_controller's caps() list no ${VEHICLE_CAP}`).not.toContain(VEHICLE_CAP);
    const k = kitReport(report!, 'behavior_kit on no_vehicle_controller');
    expect(k.admitted, `the kit admits no_vehicle_controller: ${show(k.refused)}`).toBe(true);
    none(NAMES.flatMap((n) => {
      const r = k.results.filter((x) => x.fixture === n);
      return r.length === 1 && r[0]!.result === 'excluded_by_caps' ? [] : [`${n} reads ${r.map((x) => x.result).join(', ') || 'nothing'} on no_vehicle_controller, not excluded_by_caps`];
    }), 'the five vehicle fixtures on a backend without a vehicle controller');
  }, TIMEOUT);

  it(`${ID} (twin: kit_counts_excluded_passed) a planted kit report that counts them as passed is refused, naming the fixture`, () => {
    const [report] = onTest([{ call: 'behavior_kit' }], { backend: 'no_vehicle_controller', planted: 'kit_counts_excluded_passed' });
    const r = report!;
    const results = Array.isArray(r['results']) ? r['results'].filter(isObject) : [];
    const counted = results.filter((x) => NAMES.includes(String(x['fixture'])));
    expect(counted.every((x) => x['result'] === 'pass'), `the planted report counts the vehicle fixtures it holds as passed: ${show(counted)}`).toBe(true);
    const refused = r['ok'] === false || (typeof r['verdict'] === 'string' && r['verdict'] !== 'pass');
    expect(refused, `the report counting excluded fixtures as passed is refused (ok false, or a verdict other than pass): ${show({ ...r, results: null })}`).toBe(true);
    const outside = JSON.stringify({ ...r, results: null });
    naming(NAMES.filter((n) => outside.includes(n)), /^vehicle_/, 'the refusal names a vehicle fixture outside the report\'s results');
  }, TIMEOUT);
});
