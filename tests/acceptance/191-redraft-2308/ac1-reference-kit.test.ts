// #191.8c7c5edf, redrafted under #2308 (REDRAFT.md). Criterion 1: Rapier 0.36.1 passes every fixture on macOS arm64 and
// in the physics crate's wasm32 build, each within its tolerance, and the kit's report lists each fixture's measured
// value beside its answer.
// The frozen test holds every fixture of the kit to a world at 120 Hz. #2308's Scope puts five more in the kit, "small
// twins of its rest, bounce and slide fixtures, the edge and the dominoes", "at `step_rate: 480`, `contact_hz: 240` and
// `length_unit: 0.01`". Here those five, where the kit holds them, are held to that world, to #2308's answers and
// tolerances and to a pass on both targets, and every other fixture to 120 Hz as before. That the kit holds the five
// is tests/acceptance/2308/'s to require, not this file's. The rest is the frozen test's, line for line.
import { describe, expect, test } from 'vitest';
import {
  CELLS, CHARACTER_CAP, EXPECTED, G, RATE, REFERENCE, TIMEOUT, WASM32, backendOf, bake, bound, cellFailures, fixturesOf, isObject,
  kitCall, kitReport, named, needsCharacter, none, one, passFailures, physics, prebuild, resultOf, show, showTolerance, statesOf, toleranceOf, wasm32,
  type BackendInfo, type FixtureData, type JsonObject, type KitReport, type KitResult, type Side, type Tolerance,
} from '../191/helpers.ts';
import { HELD, bounce, dominoes, edge, slide, stack, type Small } from '../2308/helpers.ts';
import { CRITERIA as AC } from './criteria.ts';

prebuild(['shipped']);

/** #2308's world for its five fixtures: its Scope's rate, contact frequency and solver length, and its first criterion's "4 substeps". */
const SMALL_RATE = 480;
const SMALL_CONTACT_HZ = 240;
const SMALL_LENGTH_UNIT = 0.01;
/** The side of #2308's 1 cm cubes and the thickness of its dominoes, m. */
const SIDE_M = 0.01;
const THICK_M = 0.0075;
/**
 * #2308's five fixtures as its own suite names and holds them (`../2308/helpers.ts`: each one's world, and in `HELD` its
 * answer and tolerance), so the two suites read one surface. `side` is #2308's wording of each; `right` is the reading
 * its opening gives the world that holds ("Together they hold: …"), and `wrong` a reading it gives a world that doesn't,
 * both in the fixture's measure, m. The two readings are used only for this file's planted mismatches.
 */
interface SmallFixture { fixture: Small; side: Side; right: number; wrong: number }
const SMALL: SmallFixture[] = [
  // "It has dropped 0.5 mm before its centre is 1.6 sides past the edge"; "the cube drops at 1.35 sides past the edge";
  // the wrapper that ignores `length_unit` "has not dropped until 2.09 sides past".
  { fixture: edge(), side: 'at_most', right: 1.35 * SIDE_M, wrong: 2.09 * SIDE_M },
  // "The top one's centre within 2% of a side of 4.5 sides up"; "five 1 cm dice end 0.92% of a side low"; the wrapper
  // that ignores `solver.contact_hz` "leaves the stack more than half a side low" (half a side is the least of those).
  { fixture: stack(), side: 'both', right: 0.0092 * SIDE_M, wrong: 0.5 * SIDE_M },
  // "First bounces to 0.025 m within 3%"; "the bounce reads 0.4% high"; at the defaults it "reads 16.1% low".
  { fixture: bounce(), side: 'both', right: 0.025 * 1.004, wrong: 0.025 * (1 - 0.161) },
  // "Slides from 0.700 m/s to rest in 0.05 m within 3%"; "the slide 0.4% short"; #2308 gives no wrong reading, so 4%
  // long of a 3% answer, as the frozen mismatch is 2% off a 1% answer.
  { fixture: slide(), side: 'both', right: 0.05 * 0.996, wrong: 0.05 * 1.04 },
  // "No two neighbours are more than 0.05 of a thickness inside each other"; they "end 0.01 of a thickness inside each
  // other"; the wrapper that ignores `solver.contact_hz` "leaves two more than 0.2 of a thickness inside each other".
  { fixture: dominoes(), side: 'at_most', right: 0.01 * THICK_M, wrong: 0.2 * THICK_M },
];
const isSmall = (name: string): boolean => SMALL.some((s) => s.fixture.name === name);

/**
 * Everything wrong with one of #2308's five results read as a pass on the reference backend, as `passFailures` reads
 * #191's: the result is `pass`, a measured value is listed beside the answer, the answer and the tolerance are #2308's
 * (as `HELD` holds them), and the measured value lies within that tolerance on #2308's side.
 */
function smallFailures(r: KitResult, s: SmallFixture): string[] {
  const out: string[] = [];
  const at = `${r.backend} ${r.fixture}`;
  const held = HELD[s.fixture.name]!;
  const want: Tolerance = { unit: held.tolerance[0], value: held.tolerance[1] };
  if (r.result !== 'pass') out.push(`${at} reads ${r.result}, not pass: ${show(r.raw)}`);
  if (r.measured === null) out.push(`${at} lists no measured value beside its answer: ${show(r.raw)}`);
  if (r.answer === null) { out.push(`${at} lists no answer: ${show(r.raw)}`); return out; }
  if (Math.abs(r.answer - held.answer) > held.room + 1e-15) out.push(`${at}: the answer ${r.answer} isn't #2308's ${held.answer}`);
  let t: Tolerance | null = null;
  try { t = toleranceOf(r.tolerance, `${at}.tolerance`); } catch (err) { out.push((err as Error).message.split('\n')[0]!); }
  if (t && (t.unit !== want.unit || Math.abs(t.value - want.value) > 1e-12)) out.push(`${at}: tolerance ${show(r.tolerance ?? null)}, #2308's is ${showTolerance(want)}`);
  if (r.measured !== null) {
    const b = bound(want, r.answer);
    const ok = s.side === 'at_most' ? r.measured <= r.answer + b + 1e-12 : Math.abs(r.measured - r.answer) <= b + 1e-12;
    if (!ok) out.push(`${at}: measured ${r.measured} is outside ${s.side === 'at_most' ? 'at most ' : ''}${r.answer} ± ${b}`);
  }
  return out;
}

/**
 * Everything wrong with the reference backend's report: every fixture the issue lists passes within the issue's tolerance,
 * each sensor cell's own rows sit at the issue's steps, a fixture needing a character controller reads excluded_by_caps
 * exactly when the caps lack one, the interface's data agrees with the report, and nothing else fails. Redrafted: each
 * of #2308's five the report lists passes within #2308's tolerance, and its world is #2308's, not the 120 Hz of the rest.
 */
function reportFailures(k: KitReport, caps: BackendInfo, data: FixtureData[], target: string): string[] {
  const out: string[] = [];
  if (k.backend !== REFERENCE) out.push(`the report names backend ${k.backend}, not ${REFERENCE}`);
  if (k.target !== target) out.push(`the report names target ${k.target}, not ${target}`);
  if (!k.admitted) out.push(`the reference backend wasn't admitted: ${show(k.refused)}`);
  if (k.verdict !== 'pass') out.push(`the kit's verdict is ${k.verdict}, not pass`);
  const byName = new Map(data.map((d) => [d.name, d]));
  const controller = caps.caps.includes(CHARACTER_CAP);
  for (const e of EXPECTED) {
    const r = k.results.find((x) => x.fixture === e.name);
    if (!r) { out.push(`no result for fixture ${e.name}`); continue; }
    out.push(...passFailures(r, e, byName.get(e.name)));
  }
  for (const name of CELLS) {
    const r = k.results.find((x) => x.fixture === name);
    if (!r) { out.push(`no result for sensor cell ${name}`); continue; }
    if (needsCharacter(name) && !controller) {
      if (r.result !== 'excluded_by_caps') out.push(`${name} needs a character controller, which ${REFERENCE}'s caps lack, yet reads ${r.result}`);
      if (!r.caps.includes(CHARACTER_CAP)) out.push(`${name}'s result names caps ${show(r.caps)}, not ${CHARACTER_CAP}`);
    } else out.push(...cellFailures(r));
  }
  for (const s of SMALL) {
    // Redrafted: one of #2308's five is held to #2308's words where the report lists it; one the data lists and the
    // report doesn't fails below, as any fixture does.
    const r = k.results.find((x) => x.fixture === s.fixture.name);
    if (r) out.push(...smallFailures(r, s));
  }
  for (const r of k.results) {
    const d = byName.get(r.fixture);
    if (!d) { out.push(`result ${r.fixture} has no fixture in the interface's data`); continue; }
    if (r.answer !== d.answer || JSON.stringify(r.tolerance) !== JSON.stringify(d.tolerance)) out.push(`${r.fixture}: the report's answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)} aren't the interface's ${d.answer} ${show(d.tolerance)}`);
    if (r.result === 'fail') out.push(`${r.fixture} fails on the reference backend: ${show(r.raw)}`);
    const excludable = d.caps.some((c) => !caps.caps.includes(c));
    if (r.result === 'excluded_by_caps' && !excludable) out.push(`${r.fixture} reads excluded_by_caps though ${REFERENCE}'s caps hold every cap it names (${show(d.caps)})`);
    if (r.result === 'pass' && excludable) out.push(`${r.fixture} passes though it names a cap ${REFERENCE}'s caps lack (${show(d.caps)}): a fixture its caps exclude never passes`);
  }
  for (const d of data) {
    const w = d.world;
    const rate = w['step_rate'] ?? RATE;
    const substeps = w['substeps'] ?? 4;
    const gravity = Array.isArray(w['gravity']) ? Math.hypot(...(w['gravity'] as number[])) : G;
    if (isSmall(d.name)) {
      // Redrafted: #2308's five are at its rate, contact frequency and solver length (30 Hz and 1 m when unwritten).
      const solver = isObject(w['solver']) ? w['solver'] : {};
      const hz = solver['contact_hz'] ?? 30;
      const unit = solver['length_unit'] ?? 1;
      const length = typeof unit === 'number' && Math.abs(unit - SMALL_LENGTH_UNIT) <= 1e-12;
      if (rate !== SMALL_RATE || substeps !== 4 || Math.abs(gravity - G) > 1e-9 || hz !== SMALL_CONTACT_HZ || !length) out.push(`fixture ${d.name}'s world isn't at g = 9.81 m/s², 480 Hz and 4 substeps with contacts at 240 Hz and a solver length of 0.01 m: ${show({ step_rate: rate ?? null, substeps: substeps ?? null, gravity: w['gravity'] ?? null, solver: w['solver'] ?? null })}`);
    } else if (rate !== RATE || substeps !== 4 || Math.abs(gravity - G) > 1e-9) out.push(`fixture ${d.name}'s world isn't at g = 9.81 m/s², 120 Hz and 4 substeps: ${show({ step_rate: rate ?? null, substeps: substeps ?? null, gravity: w['gravity'] ?? null })}`);
    if (!k.results.some((r) => r.fixture === d.name)) out.push(`fixture ${d.name} has no result in the report`);
  }
  return out;
}

/** The kit's free-fall measure against the drop its own world shows when baked here: the kit measures the bake, not its answer. */
function freeFallAgrees(k: KitReport, data: FixtureData[], baked: JsonObject): string[] {
  const d = data.find((x) => x.name === 'free_fall');
  const r = k.results.find((x) => x.fixture === 'free_fall');
  if (!d || !r || r.measured === null) return ['no free_fall fixture or measured value to compare'];
  const bodies = Object.entries(isObject(d.world['bodies']) ? d.world['bodies'] : {}).filter(([, b]) => isObject(b) && b['kind'] === 'dynamic');
  if (bodies.length !== 1) return [`free_fall's world has ${bodies.length} dynamic bodies, one expected`];
  const states = statesOf(baked, bodies[0]![0], 'the free_fall world baked 120 steps');
  const drop = states[0]!.pos[1] - states[RATE]!.pos[1];
  return Math.abs(drop - r.measured) <= 1e-6 * Math.max(1, Math.abs(drop)) ? [] : [`the kit measured ${r.measured} m; its own world baked here drops ${drop} m in 1 s`];
}

/** Which of #2308's five the kit's data holds, for the run's record: none of them is required here. */
const smallHeld = (data: FixtureData[]): string =>
  `#2308's fixtures in the kit's data: ${SMALL.map((s) => s.fixture.name).filter((n) => data.some((d) => d.name === n)).join(', ') || 'none'} (each held to #2308's words where the kit holds it)`;

/** What a planted kit does otherwise with one of #2308's five: its row's measured value, its row's result, its tolerance, its world. */
interface Plant { measured?: number | null; result?: KitResult['result']; tolerance?: JsonObject; world?: JsonObject }
/**
 * A planted kit: this report and its data with #2308's five beside them (in place of the kit's own, where it holds them),
 * each as #2308's suite holds it and reading `pass` at the reading #2308's opening gives, but for what `plant` says.
 */
function withSmall(k: KitReport, data: FixtureData[], plant: (s: SmallFixture) => Plant = () => ({})): { k: KitReport; data: FixtureData[] } {
  const rows: KitResult[] = [];
  const more: FixtureData[] = [];
  for (const s of SMALL) {
    const [held, p] = [HELD[s.fixture.name]!, plant(s)];
    const tolerance = p.tolerance ?? { [held.tolerance[0]]: held.tolerance[1] };
    rows.push({ backend: k.backend, fixture: s.fixture.name, measured: p.measured === undefined ? s.right : p.measured, answer: held.answer, tolerance, caps: [], result: p.result ?? 'pass', what: '', raw: {} });
    more.push({ name: s.fixture.name, world: p.world ?? s.fixture.world, measure: null, answer: held.answer, tolerance, caps: [] });
  }
  return { k: { ...k, results: [...k.results.filter((r) => !isSmall(r.fixture)), ...rows] }, data: [...data.filter((d) => !isSmall(d.name)), ...more] };
}
/** One of #2308's worlds as a kit that isn't #2308's would hold it: left at 120 Hz, at other substeps, or with a solver field unwritten. */
function wrongWorlds(w: JsonObject): [string, JsonObject][] {
  const solver = isObject(w['solver']) ? w['solver'] : {};
  const without = (key: string): JsonObject => ({ ...w, solver: Object.fromEntries(Object.entries(solver).filter(([name]) => name !== key)) });
  return [['left at 120 Hz', { ...w, step_rate: RATE }], ['at 8 substeps', { ...w, substeps: 8 }], ['with no contact_hz', without('contact_hz')], ['with no length_unit', without('length_unit')]];
}

describe(`${AC[1]} Rapier 0.36.1 passes every fixture on macOS arm64 and on wasm32, measured beside each answer (redraft 2308)`, () => {
  test(`${AC[1]} macOS arm64: the reference backend passes every fixture within its issue's tolerance, #2308's five in #2308's world where the kit holds them, listing each measured value beside its answer (redraft 2308)`, () => {
    expect(`${process.platform}-${process.arch}`, 'this leg runs on macOS arm64').toBe('darwin-arm64');
    const [fixtures, info, report] = physics([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()]);
    const data = fixturesOf(fixtures!, 'behavior_fixtures');
    const caps = backendOf(info!, 'backend');
    expect(caps.reference, `${REFERENCE} is the reference implementation: ${show(info)}`).toBe(true);
    const k = kitReport(report!, 'behavior_kit on rapier3d');
    console.log(k.results.map((r) => `${r.fixture}: measured ${r.measured} against ${r.answer} ${show(r.tolerance ?? null)} → ${r.result}`).join('\n'));
    console.log(smallHeld(data));
    none(reportFailures(k, caps, data, 'aarch64-apple-darwin'), 'the reference report on macOS arm64');
    const ff = data.find((x) => x.name === 'free_fall');
    expect(ff, 'the interface holds a free_fall fixture').toBeDefined();
    none(freeFallAgrees(k, data, one(bake(ff!.world, RATE))), 'the kit measures free fall from the bake');
    const wrong = resultOf(k, 'free_fall', 'report');
    // The comparison's planted mismatch: the same judge on the result with its measured value 2% off.
    const twin = { ...wrong, measured: wrong.answer! * 1.02 };
    expect(passFailures(twin, EXPECTED[0]!, ff).length, 'the pass judge catches a measured value 2% off a 1% answer').toBeGreaterThan(0);
    // The redraft's planted mismatches: the same judge on this report with #2308's five beside it. As #2308 reads the
    // world that holds, nothing is wrong with them. Each wrong kit is caught, in a failure that names its fixture.
    const judged = (p: { k: KitReport; data: FixtureData[] }): string[] => reportFailures(p.k, caps, p.data, 'aarch64-apple-darwin');
    none(judged(withSmall(k, data)), 'this report with #2308\'s five beside it, each as #2308 reads it');
    for (const s of SMALL) {
      const name = s.fixture.name;
      const only = (p: Plant) => (x: SmallFixture): Plant => (x === s ? p : {});
      named(judged(withSmall(k, data, only({ measured: s.wrong }))), [name, `measured ${s.wrong} is outside`], `a kit that passes ${name} at ${s.wrong} m`);
      named(judged(withSmall(k, data, only({ measured: null }))), [name, 'lists no measured value'], `a kit that lists no measured value for ${name}`);
      named(judged(withSmall(k, data, only({ result: 'excluded_by_caps' }))), [name, 'reads excluded_by_caps, not pass'], `a kit that leaves ${name} out on ${REFERENCE}`);
      named(judged(withSmall(k, data, only({ measured: s.wrong, tolerance: { m: 1 } }))), [name, 'tolerance {"m":1}, #2308\'s is'], `a kit that passes ${name} within a tolerance of its own`);
      for (const [how, world] of wrongWorlds(s.fixture.world)) named(judged(withSmall(k, data, only({ world }))), [`fixture ${name}'s world isn't at`, '480 Hz'], `a kit that holds ${name} ${how}`);
    }
    // Only #2308's five are let off 120 Hz: one of #191's own fixtures moved into #2308's world is still caught.
    const moved = data.map((d) => (d.name === 'free_fall' ? { ...d, world: { ...d.world, step_rate: SMALL_RATE, solver: { contact_hz: SMALL_CONTACT_HZ, length_unit: SMALL_LENGTH_UNIT } } } : d));
    named(reportFailures(k, caps, moved, 'aarch64-apple-darwin'), ['fixture free_fall\'s world isn\'t at', '120 Hz'], 'a kit that runs free_fall at 480 Hz');
  }, TIMEOUT);

  test(`${AC[1]} wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within its issue's tolerance, #2308's five in #2308's world where the kit holds them (redraft 2308)`, () => {
    const [fixtures, info, report] = wasm32([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()]);
    const data = fixturesOf(fixtures!, 'behavior_fixtures on wasm32');
    const caps = backendOf(info!, 'backend on wasm32');
    const k = kitReport(report!, 'behavior_kit on wasm32');
    console.log(smallHeld(data));
    none(reportFailures(k, caps, data, WASM32), 'the reference report on wasm32');
  }, TIMEOUT);
});
