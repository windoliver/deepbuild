// #2307.ac8e941b: "The slope, the weak brake and the sleeping drive join the physics behavior kit's data (#191), each
// once, and Rapier 0.36.1 passes them through the kit. A test backend whose `caps()` list no vehicle controller reads
// `excluded_by_caps` on the three"
//
// #191's calls (its README: The surface under test), as #251's and #2306's suites read their fixtures.
// `behavior_fixtures` holds the three once each, named as README: Fixture names says, each with the issue's answer for
// it (matched within half a unit of its last printed digit, as #191's suite reads answers) and its tolerance, each
// naming the cap `vehicle_controller`, each world at 120 Hz and 4 substeps holding one vehicle body: on a static body
// with a turned pose for the slope and the weak brake, with sleep off for the slope, and with sleep on for the
// sleeping drive. `behavior_kit` on Rapier (#191's release build) passes the three, each measured within its tolerance
// of its answer. On #251's `--backend no_vehicle_controller` (the test-backends build) the kit admits the backend and
// reads excluded_by_caps on each of the three.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, VEHICLE_CAP, backendOf, fmt, isObject, kitFixtures, kitReport, prebuildBuilds, run, show,
  type JsonObject, type JsonValue, type KitFixture,
} from './helpers.ts';

prebuildBuilds(['release', 'test']);

const ID = CRITERIA[7];
/** An answer as printed and its tolerance; what the fixture's world holds. */
interface Form { printed: string; tolerance: JsonObject }
interface Want { name: string; forms: Form[]; slope: boolean; sleep: 'off' | 'on' | 'either' }
const FIXTURES: Want[] = [
  // Criterion 1: less than 1 mm along the slope over the 10 s.
  { name: 'vehicle_slope', forms: [{ printed: '0', tolerance: { m: 0.001 } }], slope: true, sleep: 'off' },
  // Criterion 2: 4 × (9.81 × sin 20° − 1) = 9.42 m/s at 4 s within 1%.
  { name: 'vehicle_weak_brake', forms: [{ printed: '9.42', tolerance: { relative: 0.01 } }], slope: true, sleep: 'either' },
  // Criterion 5: 4.00 m/s at 2 s within 2% from sleep on level ground, or 8.59 m/s at 2 s within 2% on the 10° slope.
  { name: 'vehicle_sleeping_drive', forms: [{ printed: '4.00', tolerance: { relative: 0.02 } }, { printed: '8.59', tolerance: { relative: 0.02 } }], slope: false, sleep: 'on' },
];
const NAMES = FIXTURES.map((f) => f.name);
/** An answer as printed admits the exact value within half a unit of its last decimal; one printed without decimals is that number. */
const printedAs = (x: number, printed: string): boolean => Math.abs(x - Number(printed)) <= (printed.includes('.') ? 0.5 * 10 ** -printed.split('.')[1]!.length : 0) + 1e-12;
/** Within a tolerance of the answer: relative, or in metres. */
function within(measured: number, answer: number, t: JsonValue): boolean {
  if (!isObject(t)) return false;
  if (typeof t['relative'] === 'number') return Math.abs(measured - answer) <= Math.abs(answer) * t['relative'];
  if (typeof t['m'] === 'number') return Math.abs(measured - answer) <= t['m'] + 1e-12;
  return false;
}
/** A pose's `rot` turns its body: a quaternion other than `[0, 0, 0, 1]`, or degrees other than `[0, 0, 0]`. */
function turned(body: JsonValue | undefined): boolean {
  const rot = isObject(body) && isObject(body['pose']) ? body['pose']['rot'] : undefined;
  if (!Array.isArray(rot) || !rot.every((x) => typeof x === 'number')) return false;
  return rot.length === 4 ? rot.slice(0, 3).some((x) => x !== 0) : rot.some((x) => x !== 0);
}
/** Everything about a fixture's data that isn't what the criterion says of it. */
function dataFailures(f: KitFixture, want: Want): string[] {
  const out: string[] = [];
  if (!want.forms.some((x) => printedAs(f.answer, x.printed) && JSON.stringify(f.tolerance) === JSON.stringify(x.tolerance))) {
    out.push(`${f.name}: its answer ${f.answer} and tolerance ${show(f.tolerance)} aren't the issue's (${want.forms.map((x) => `${x.printed} within ${show(x.tolerance)}`).join(', or ')})`);
  }
  if (!f.caps.includes(VEHICLE_CAP)) out.push(`${f.name}: its caps ${show(f.caps)} don't name ${VEHICLE_CAP}`);
  const w = f.world;
  if ((w['step_rate'] ?? 120) !== 120 || (w['substeps'] ?? 4) !== 4) out.push(`${f.name}: its world isn't at 120 Hz and 4 substeps: ${show({ step_rate: w['step_rate'] ?? null, substeps: w['substeps'] ?? null })}`);
  const bodies = isObject(w['bodies']) ? w['bodies'] : {};
  const car = f.vehicle === null ? undefined : bodies[f.vehicle];
  if (!isObject(car)) return [...out, `${f.name}: its world doesn't hold one vehicle body`];
  if (want.slope && !Object.values(bodies).some((b) => isObject(b) && b['kind'] === 'static' && turned(b))) out.push(`${f.name}: its world holds no static body with a turned pose for the vehicle to stand on`);
  const solver = isObject(w['solver']) && isObject(w['solver']['sleep']) ? w['solver']['sleep'] : {};
  const sleeps = car['sleep'] !== false && solver['on'] !== false;
  if (want.sleep === 'off' && sleeps) out.push(`${f.name}: its vehicle body isn't set with sleep off`);
  if (want.sleep === 'on' && !sleeps) out.push(`${f.name}: its vehicle body's sleep is off, so it is never asleep when driven`);
  return out;
}

describe(`${ID} the slope, the weak brake and the sleeping drive join the behavior kit: Rapier passes them and a backend without a vehicle controller excludes them`, () => {
  it(`${ID} the three join the kit's data once each, and Rapier 0.36.1 passes them through the kit`, () => {
    const r = run([{ call: 'behavior_fixtures' }, { call: 'backend' }, { call: 'behavior_kit' }]);
    expect(r.problem, 'deep-physics answers behavior_fixtures, backend and behavior_kit').toBe('');
    const f: string[] = [];
    if (!backendOf(r.replies[1]!, 'backend (Rapier)').caps.includes(VEHICLE_CAP)) f.push(`Rapier's caps() don't list ${VEHICLE_CAP}`);
    for (const want of FIXTURES) {
      const found = kitFixtures(r.replies[0], want.name);
      if (found.length !== 1) f.push(`${want.name}: the kit's data holds it ${found.length} times, not once`);
      else f.push(...dataFailures(found[0]!, want));
    }
    const k = kitReport(r.replies[2]!, 'behavior_kit on Rapier');
    for (const want of FIXTURES) {
      const rows = k.results.filter((x) => x.fixture === want.name);
      if (rows.length !== 1) { f.push(`${want.name}: the kit's report holds it ${rows.length} times on Rapier, not once`); continue; }
      const x = rows[0]!;
      if (x.result !== 'pass') f.push(`${want.name}: reads ${x.result} on Rapier: ${x.what}`);
      else if (x.measured === null || x.answer === null || !within(x.measured, x.answer, x.tolerance ?? null)) f.push(`${want.name}: passes on Rapier measuring ${x.measured === null ? 'nothing' : fmt(x.measured)}, outside ${show(x.tolerance)} of ${show(x.answer)}`);
    }
    expect(f, `the three fixtures in the kit's data and on Rapier:\n  ${f.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a test backend whose caps() list no vehicle controller reads excluded_by_caps on the three`, () => {
    const r = run([{ call: 'backend' }, { call: 'behavior_kit' }], { backend: 'no_vehicle_controller' });
    expect(r.problem, 'deep-physics --backend no_vehicle_controller, in the test-backends build, answers backend and behavior_kit').toBe('');
    expect(backendOf(r.replies[0]!, 'backend (no_vehicle_controller)').caps, `no_vehicle_controller's caps() list no ${VEHICLE_CAP}`).not.toContain(VEHICLE_CAP);
    const k = kitReport(r.replies[1]!, 'behavior_kit on no_vehicle_controller');
    expect(k.admitted, `the kit admits no_vehicle_controller: ${show(k.refused)}`).toBe(true);
    const f = NAMES.flatMap((n) => {
      const rows = k.results.filter((x) => x.fixture === n);
      return rows.length === 1 && rows[0]!.result === 'excluded_by_caps' ? [] : [`${n} reads ${rows.map((x) => x.result).join(', ') || 'nothing'} on no_vehicle_controller, not excluded_by_caps`];
    });
    expect(f, `the three fixtures on a backend without a vehicle controller:\n  ${f.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
