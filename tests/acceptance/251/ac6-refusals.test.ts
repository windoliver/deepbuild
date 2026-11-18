// #251.2e102906: "A vehicle body in a 2D world, with a follow channel or with a ninth wheel is refused at check, naming
// the field; on a test backend whose caps() list no vehicle controller, a world with one is refused, naming the body and
// the backend; and no Rapier type appears in the physics crate's public items; and a planted check that counts only
// the wheels passes the 2D world and fails, naming the field"
//
// `check` (#2009's call) of the car's world (README: The car) admits it with no error; the same world with `dimensions:
// 2`, with `follow` on the vehicle body, or with a ninth wheel is refused with an error issue that names the body (its
// `ids`, or a path under `bodies/kart`) and the field: `bodies/kart/kind` or `dimensions` for the 2D world (the caps'
// own refusal of a 2D world, which names no body, doesn't count), `bodies/kart/follow`, and a path under
// `bodies/kart/vehicle/wheels`. On `--backend no_vehicle_controller` (the test-backends build) the world is refused by an
// error naming `kart` and the backend as that process's `backend` call names it, while Rapier's caps list
// `vehicle_controller`. The public items: rustdoc's JSON of `deep-canvas-physics` and `deep-physics-rapier`, scanned by
// #2009's api.ts, name no Rapier type, and the interface holds `drive_vehicle`; #2009's `test-leaks-rapier` build shows the
// scan catches a leak. `check_counts_wheels_only` refuses a ninth wheel and nothing else of a vehicle body.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, SETTLED_Y, TIMEOUT, VEHICLE_CAP, ask, backendOf, carWorld, caught, checkCall, errorsOf, itemNames, kart, leaks, naming, none,
  onTest, prebuild, prebuildBuilds, rustdoc, show, vehicleField, wheel, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
prebuildBuilds(['test']);

const ID = CRITERIA[6];
const car = (extra: JsonObject = {}): JsonObject => kart([0, SETTLED_Y, 0], extra);
const VARIANTS: { name: string; world: JsonObject; field: RegExp; says: string }[] = [
  { name: 'in a 2D world', world: carWorld(car(), { dimensions: 2 }), field: /^\/?(bodies\/kart\/kind|dimensions)$/, says: 'dimensions (or bodies/kart/kind)' },
  { name: 'with a follow channel', world: carWorld(car({ follow: 'items/marker/at/pos/0' })), field: /^\/?bodies\/kart\/follow$/, says: 'bodies/kart/follow' },
  { name: 'with a ninth wheel', world: carWorld(car({ vehicle: vehicleField({ mid: wheel('rl', { at: [0, -0.15, 0] }) }) })), field: /^\/?bodies\/kart\/vehicle\/wheels(\/.*)?$/, says: 'bodies/kart/vehicle/wheels' },
];
const namesKart = (i: JsonObject): boolean => (Array.isArray(i['ids']) && i['ids'].includes('kart')) || (typeof i['path'] === 'string' && /^\/?bodies\/kart(\/|$)/.test(i['path']));

/** Each variant refused at check by an error naming the vehicle body and its field. */
function fieldFailures(planted?: Planted): string[] {
  const replies = ask(VARIANTS.map((v) => checkCall(v.world)), planted, 'the vehicle body\'s variants');
  return VARIANTS.flatMap((v, i) => {
    const errors = errorsOf(replies[i], `the vehicle body ${v.name}`);
    return errors.some((e) => namesKart(e) && typeof e['path'] === 'string' && v.field.test(e['path'])) ? []
      : [`the vehicle body ${v.name} isn't refused naming the body and the field ${v.says}: ${show(errors)}`];
  });
}

describe(`${ID} a vehicle body is refused at check in a 2D world, with a follow channel or a ninth wheel, and on a backend without a vehicle controller; no Rapier type crosses the interface`, () => {
  it(`${ID} the car is admitted; in a 2D world, with a follow channel or with a ninth wheel it is refused at check, naming the field`, () => {
    const [ok] = ask([checkCall(carWorld(car()))], undefined, 'the car');
    expect(errorsOf(ok, 'the car on level ground'), 'the car on four wheels in a 3D world is admitted').toEqual([]);
    none(fieldFailures(), 'each variant refused naming the field');
  }, TIMEOUT);

  it(`${ID} on a test backend whose caps() list no vehicle controller, a world with one is refused, naming the body and the backend`, () => {
    const [rapier] = onTest([{ call: 'backend' }], { build: 'test' });
    expect(backendOf(rapier!, 'backend (Rapier, test build)').caps, `Rapier's caps() list ${VEHICLE_CAP}`).toContain(VEHICLE_CAP);
    const [info, checked] = onTest([{ call: 'backend' }, checkCall(carWorld(car()))], { backend: 'no_vehicle_controller' });
    const b = backendOf(info!, 'backend (no_vehicle_controller)');
    expect(b.caps, `no_vehicle_controller's caps() list no ${VEHICLE_CAP}`).not.toContain(VEHICLE_CAP);
    const errors = errorsOf(checked, 'the car on no_vehicle_controller');
    expect(errors.filter((e) => namesKart(e) && JSON.stringify(e).includes(b.backend)).length, `an error names the body kart and the backend ${b.backend}: ${show(errors)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} no Rapier type appears in the physics crates' public items, and the backend interface holds drive_vehicle`, () => {
    const found: string[] = [];
    for (const crate of ['deep-canvas-physics', 'deep-physics-rapier']) {
      const doc = rustdoc(crate);
      for (const l of leaks(doc)) found.push(`${crate}: public ${l.kind} ${l.item} names ${l.names}`);
      if (crate === 'deep-canvas-physics') expect(itemNames(doc).has('drive_vehicle'), 'the backend interface\'s public items hold drive_vehicle (the scan reaches the vehicle\'s interface)').toBe(true);
    }
    none(found, 'no public item of the physics crates names a Rapier type');
    caught(leaks(rustdoc('deep-physics-rapier', ['test-leaks-rapier'])).map((l) => l.item), 'the scan catches #2009\'s planted leak (test-leaks-rapier)');
  }, TIMEOUT);

  it(`${ID} (twin: check_counts_wheels_only) a check that counts only the wheels passes the 2D world and fails, naming the field`, () => {
    const failures = fieldFailures('check_counts_wheels_only');
    caught(failures, 'check_counts_wheels_only');
    naming(failures, /^the vehicle body in a 2D world isn't refused naming the body and the field dimensions/, 'check_counts_wheels_only\'s failure names the field');
    expect(failures.some((f) => f.includes('ninth wheel')), `the planted check still refuses the ninth wheel, which it counts: ${failures.join(' | ')}`).toBe(false);
  }, TIMEOUT);
});
