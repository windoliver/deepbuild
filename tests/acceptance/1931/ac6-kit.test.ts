// Criterion 6: the kit's report lists each of the three fixtures' measured values beside its answer and tolerance, on
// macOS arm64 and in the physics crate's wasm32 build. A test backend that wraps Rapier and claims these laws in its
// caps() with the fixtures taken out of the kit is refused before any fixture runs, naming the law, as #191 refuses a
// claimed feature with no fixture.
import { describe, expect, test } from 'vitest';
import {
  AC, CLAIMS_LAWS, FIXTURES, GYRATION, GYRATION_RADIUS, GYRATION_STEPS, ION_SPEED, KIT_WITHOUT, LAWS, ORBIT, ORBIT_PERIOD, ORBIT_RADIUS,
  ORBIT_STEPS, PAIR, PAIR_STEPS, PRINTED, REFERENCE, REST, REST_WITHIN, SPEED_WITHIN, TIMEOUT, WASM32, WITHIN, Y_HIGH, Y_LOW, apartOf, ask,
  askWasm32, bake, fixtureNamed, fixturesOf, gyrationBody, gyrationDataFailures, gyrationOf, kitCall, manifestOf, numberOf, orbitDataFailures,
  orbitOf, orbitParts, pairBodies, pairDataFailures, passFailures, prebuild, rowOf, show, yOf,
  type Asked, type Fixture, type JsonObject, type KitResult, type Manifest,
} from './helpers.ts';

prebuild(['release', 'test']);
const CALLS: JsonObject[] = [{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()];
/** How near the kit's reading of a bake and this suite's reading of the same bake must be: the same states, read twice. */
const SAME = 1e-6;

interface Read { fixtures: Record<string, Fixture>; rows: Record<string, KitResult> }
/**
 * Everything wrong with the reference backend's report on the three fixtures: each held once in the interface's data
 * with its criterion's world, answer, tolerance and law; Rapier's caps() claiming each law; and each row a pass on
 * `target`, its measured values beside the interface's answer and tolerance and within the criterion's bounds.
 */
function reportFailures(run: Asked, target: string, read: Read): string[] {
  const [data, info, report] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
  const out: string[] = [];
  const manifest = manifestOf(info, 'backend');
  if (typeof manifest === 'string') out.push(manifest);
  else {
    if (manifest.backend !== REFERENCE || !manifest.reference) out.push(`the build's backend is ${manifest.backend}, reference ${String(manifest.reference)}, not the reference ${REFERENCE}`);
    for (const law of LAWS) if (!manifest.caps.includes(law)) out.push(`${REFERENCE}'s caps() ${show(manifest.caps)} don't claim the law ${law}`);
  }
  if (report['target'] !== target) out.push(`the report names target ${show(report['target'])}, not ${target}`);
  const judges: Record<string, { data: (f: Fixture) => string[]; answer: number; within: number }> = {
    [ORBIT]: { data: orbitDataFailures, answer: ORBIT_RADIUS, within: WITHIN },
    [GYRATION]: { data: gyrationDataFailures, answer: GYRATION_RADIUS, within: WITHIN },
    [PAIR]: { data: pairDataFailures, answer: REST, within: REST_WITHIN },
  };
  for (const name of FIXTURES) {
    const [f, r] = [fixtureNamed(data, name, 'behavior_fixtures'), rowOf(report, name, 'behavior_kit')];
    if (typeof f === 'string') { out.push(f); continue; }
    read.fixtures[name] = f;
    out.push(...judges[name]!.data(f));
    if (typeof r === 'string') { out.push(r); continue; }
    read.rows[name] = r;
    console.log(`${target} ${name}: measured ${String(r.measured)} against ${String(r.answer)} ${show(r.tolerance ?? null)} → ${r.result}${name === ORBIT ? `; period ${show(r.raw['period'])} s` : ''}${name === GYRATION ? `; speed ${show(r.raw['speed'])} m/s; y ${show(r.raw['y'])} m` : ''}`);
    out.push(...passFailures(r, f, REFERENCE, judges[name]!.answer, judges[name]!.within));
  }
  // The orbit's second measured value, its period, and the gyration's, its speed and its side.
  const [orbit, gyration] = [read.rows[ORBIT], read.rows[GYRATION]];
  if (orbit) {
    const period = numberOf(orbit, 'period');
    if (period === null || !(Math.abs(period - ORBIT_PERIOD) <= WITHIN * ORBIT_PERIOD)) out.push(`${ORBIT}: the row's period is ${show(orbit.raw['period'])}, not ${ORBIT_PERIOD.toFixed(3)} s within 1%`);
  }
  if (gyration) {
    const [speed, y] = [numberOf(gyration, 'speed'), yOf(gyration)];
    if (speed === null || !(Math.abs(speed - ION_SPEED) <= SPEED_WITHIN * ION_SPEED)) out.push(`${GYRATION}: the row's speed is ${show(gyration.raw['speed'])}, not ${ION_SPEED} m/s within 0.1%`);
    if (!y || !(y[0] >= Y_LOW - PRINTED && y[1] <= Y_HIGH + PRINTED && y[0] < y[1])) out.push(`${GYRATION}: the row's y is ${show(gyration.raw['y'])}, not the lowest and highest y of a path between −1.000 m and 0 m`);
  }
  return out;
}

/**
 * The kit measures the bake, not its answer: each fixture's own world, baked here, read by this suite's judges, gives
 * the numbers its row lists. Everything that differs.
 */
function measuredFailures(read: Read): string[] {
  const out: string[] = [];
  const [orbit, gyration, pair] = [read.fixtures[ORBIT], read.fixtures[GYRATION], read.fixtures[PAIR]];
  const [parts, ion, two] = [orbit ? orbitParts(orbit) : null, gyration ? gyrationBody(gyration) : null, pair ? pairBodies(pair) : null];
  if (!orbit || !gyration || !pair || !parts || !ion || !two) return ['a fixture\'s world or its bodies can\'t be read, so nothing was baked to compare'];
  const run = ask([bake(orbit.world, ORBIT_STEPS, [parts.body]), bake(gyration.world, GYRATION_STEPS, [ion]), bake(pair.world, PAIR_STEPS, two)]);
  expect(run.problem, `${run.what} answers`).toBe('');
  const differs = (name: string, key: string, listed: number | null | undefined, here: number, room = SAME): void => {
    if (listed === null || listed === undefined || !(Math.abs(listed - here) <= room)) out.push(`${name}: the row lists ${key} ${show(listed ?? null)}; its own world baked here reads ${here}`);
  };
  const o = orbitOf(run.replies[0]!, parts.body, parts.point, `${ORBIT}'s own world`);
  if (typeof o === 'string') out.push(o);
  else {
    differs(ORBIT, 'measured', read.rows[ORBIT]?.measured, o.r[o.far]!);
    // The moment of the return is taken between two steps, so the two readings may differ by how each draws that line.
    if (o.returned === null) out.push(`${ORBIT}'s own world, baked here, never comes back to its start line`);
    else differs(ORBIT, 'period', read.rows[ORBIT] ? numberOf(read.rows[ORBIT], 'period') : null, o.returned, 1e-4);
  }
  const g = gyrationOf(run.replies[1]!, ion, `${GYRATION}'s own world`);
  if (typeof g === 'string') out.push(g);
  else {
    const row = read.rows[GYRATION];
    differs(GYRATION, 'measured', row?.measured, g.radius);
    differs(GYRATION, 'speed', row ? numberOf(row, 'speed') : null, g.speeds[g.worst]!);
    const y = row ? yOf(row) : null;
    differs(GYRATION, 'y[0]', y?.[0], g.y[0]);
    differs(GYRATION, 'y[1]', y?.[1], g.y[1]);
  }
  const apart = apartOf(run.replies[2]!, two[0], two[1], `${PAIR}'s own world`);
  if (typeof apart === 'string') out.push(apart);
  else differs(PAIR, 'measured', read.rows[PAIR]?.measured, apart[PAIR_STEPS]!);
  return out;
}

describe(`${AC[6]} the kit's report lists the three force-law fixtures' measured values beside their answers and tolerances, and a claimed law with no fixture is refused`, () => {
  test(`${AC[6]} macOS arm64: ${REFERENCE} passes ${FIXTURES.join(', ')}, each row listing its measured values beside the interface's answer and tolerance, measured from its own world's bake`, () => {
    expect(`${process.platform}-${process.arch}`, 'BLOCKED: this leg is judged on a macOS arm64 host').toBe('darwin-arm64');
    const run = ask(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read: Read = { fixtures: {}, rows: {} };
    const failures = reportFailures(run, 'aarch64-apple-darwin', read);
    expect(failures, `the three fixtures on ${REFERENCE}, macOS arm64:\n  ${failures.join('\n  ')}`).toEqual([]);
    const measured = measuredFailures(read);
    expect(measured, `the kit's rows against its own worlds baked here:\n  ${measured.join('\n  ')}`).toEqual([]);
    // The pass judge's own wrong answers: the same rows measuring the 1.067 m and the 0.500 m the planted laws of
    // criteria 1 and 4 measure, and a radius 2% off its 1%.
    const twins: [string, number, number, number][] = [[ORBIT, 1.067, ORBIT_RADIUS, WITHIN], [GYRATION, GYRATION_RADIUS * 1.02, GYRATION_RADIUS, WITHIN], [PAIR, 0.5, REST, REST_WITHIN]];
    for (const [name, wrong, answer, within] of twins) {
      expect(passFailures({ ...read.rows[name]!, measured: wrong }, read.fixtures[name]!, REFERENCE, answer, within).length, `the pass judge catches ${name} measuring ${wrong} m`).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  test(`${AC[6]} wasm32: the physics crate built for ${WASM32} passes the three fixtures, each row listing its measured values beside the interface's answer and tolerance`, () => {
    const run = askWasm32(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const failures = reportFailures(run, WASM32, { fixtures: {}, rows: {} });
    expect(failures, `the three fixtures on ${REFERENCE}, wasm32:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[6]} the test backend ${CLAIMS_LAWS}, Rapier claiming the three laws, passes the three fixtures, and with them taken out of the kit (${KIT_WITHOUT}) it is refused before any fixture runs, naming each law`, () => {
    const whole = ask(CALLS, { backend: CLAIMS_LAWS });
    expect(whole.problem, `${whole.what} answers: the test-backends build holds the test backend ${CLAIMS_LAWS}`).toBe('');
    const without = ask(CALLS, { backend: CLAIMS_LAWS, planted: KIT_WITHOUT });
    expect(without.problem, `${without.what} answers: the kit with the fixtures taken out runs`).toBe('');
    const failures: string[] = [];

    // It wraps Rapier as a candidate under its own name, and its caps() claim the three laws.
    const manifest = manifestOf(whole.replies[1]!, `backend (${CLAIMS_LAWS})`);
    if (typeof manifest === 'string') failures.push(manifest);
    else {
      const m = manifest as Manifest;
      if (m.backend !== CLAIMS_LAWS || m.reference) failures.push(`${CLAIMS_LAWS}'s manifest names ${m.backend}, reference ${String(m.reference)}: not a candidate under its own name`);
      for (const law of LAWS) if (!m.caps.includes(law)) failures.push(`${CLAIMS_LAWS}'s caps() ${show(m.caps)} don't claim the law ${law}`);
    }
    // With the fixtures in the kit it is admitted and runs them: every law it claims has its fixture, and each passes.
    if (whole.replies[2]!['admitted'] !== true) failures.push(`with the fixtures in the kit ${CLAIMS_LAWS} isn't admitted: ${show(whole.replies[2]!['refused'] ?? whole.replies[2]!)}`);
    for (const name of FIXTURES) {
      const r = rowOf(whole.replies[2]!, name, `behavior_kit on ${CLAIMS_LAWS}`);
      if (typeof r === 'string') failures.push(r);
      else if (r.result !== 'pass' || r.backend !== CLAIMS_LAWS) failures.push(`${name} reads ${r.result} on ${r.backend}, not pass on ${CLAIMS_LAWS}: ${r.what}`);
    }

    // The kit with the fixtures taken out holds every other fixture and none of the three.
    const [all, rest] = [fixturesOf(whole.replies[0]!, `behavior_fixtures (${CLAIMS_LAWS})`), fixturesOf(without.replies[0]!, `behavior_fixtures (${KIT_WITHOUT})`)];
    if (typeof all === 'string' || typeof rest === 'string') failures.push(...[all, rest].filter((x): x is string => typeof x === 'string'));
    else {
      const [kept, wanted] = [rest.map((f) => f.name), all.map((f) => f.name).filter((n) => !(FIXTURES as readonly string[]).includes(n))];
      if (JSON.stringify(kept) !== JSON.stringify(wanted)) failures.push(`${KIT_WITHOUT} doesn't hold the kit's fixtures less ${FIXTURES.join(', ')}: it holds ${kept.length} fixtures where ${wanted.length} are due (${kept.filter((n) => !wanted.includes(n)).join(', ') || 'none'} over, ${wanted.filter((n) => !kept.includes(n)).join(', ') || 'none'} missing)`);
    }
    // And on it the same backend is refused before any fixture runs, naming each law it claims.
    const report = without.replies[2]!;
    console.log(`${CLAIMS_LAWS} with ${KIT_WITHOUT}: admitted ${show(report['admitted'])}, verdict ${show(report['verdict'])}, refused ${show(report['refused'])}`);
    if (report['ok'] !== true || report['admitted'] !== false || report['verdict'] !== 'refused') failures.push(`with the fixtures taken out ${CLAIMS_LAWS} isn't refused: admitted ${show(report['admitted'])}, verdict ${show(report['verdict'])}`);
    const results = Array.isArray(report['results']) ? report['results'] : null;
    if (!results || results.length !== 0) failures.push(`${results ? results.length : 'unlisted'} fixtures ran on ${CLAIMS_LAWS} before its refusal`);
    const refused = report['refused'];
    const features = typeof refused === 'object' && refused !== null && !Array.isArray(refused) && Array.isArray(refused['features']) ? refused['features'].map(String) : [];
    for (const law of LAWS) if (!features.includes(law)) failures.push(`the refusal doesn't name the law ${law} as a claimed feature with no fixture: ${show(refused)}`);
    expect(failures, `${CLAIMS_LAWS}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
