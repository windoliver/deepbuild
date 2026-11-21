// #191.8c7c5edf, redrafted under #1931 (REDRAFT.md). Criterion 1: Rapier 0.36.1 passes every fixture on macOS arm64 and
// in the physics crate's wasm32 build, each within its tolerance, and the kit's report lists each fixture's measured
// value beside its answer.
// The frozen file held every fixture's world to g = 9.81 m/s², 120 Hz and 4 substeps. #1931 puts a world holding
// `inverse_square` or `lennard_jones` at `substeps: 1` and refuses it at any other value, so here such a world is held
// to 1 substep and every other world to the kit's 4, as before. Every other line the frozen file asserts with is kept.
// Added: that rule's planted mismatches (`worldTwins`), and `BLOCKED:` first on a host that isn't macOS arm64.
import { describe, expect, test } from 'vitest';
import {
  CELLS, CHARACTER_CAP, EXPECTED, G, RATE, REFERENCE, TIMEOUT, WASM32, backendOf, bake, blocked, caught, cellFailures, fixturesOf, isObject,
  kitCall, kitReport, named, needsCharacter, none, one, passFailures, physics, prebuild, resultOf, show, statesOf, wasm32,
  type BackendInfo, type FixtureData, type JsonObject, type KitReport,
} from '../191/helpers.ts';
import { CRITERIA as AC } from './criteria.ts';

prebuild(['shipped']);

/** The laws #1931's Scope and the design's Force paragraph run at one substep: "A world holding `inverse_square` or `lennard_jones` runs at `substeps: 1`". */
const ONE_SUBSTEP_LAWS: readonly string[] = ['inverse_square', 'lennard_jones'];
/** The laws a world document's forces name: a force's `kind` is `{<law>: {fields}}`, or the law's name alone (the base's reader takes both). */
function lawsOf(w: JsonObject): string[] {
  return Object.values(isObject(w['forces']) ? w['forces'] : {}).flatMap((f) => {
    const kind = isObject(f) ? f['kind'] : undefined;
    return typeof kind === 'string' ? [kind] : isObject(kind) ? Object.keys(kind) : [];
  });
}
/**
 * Everything wrong with where one fixture's world runs: at g = 9.81 m/s² and 120 Hz, and at the kit's 4 substeps unless
 * it holds a law that runs at one substep, and then at 1.
 */
function worldFailures(d: FixtureData): string[] {
  const w = d.world;
  const rate = w['step_rate'] ?? RATE;
  const substeps = w['substeps'] ?? 4;
  const gravity = Array.isArray(w['gravity']) ? Math.hypot(...(w['gravity'] as number[])) : G;
  const held = [...new Set(lawsOf(w).filter((law) => ONE_SUBSTEP_LAWS.includes(law)))];
  const due = held.length ? 1 : 4;
  if (rate !== RATE || substeps !== due || Math.abs(gravity - G) > 1e-9) return [`fixture ${d.name}'s world isn't at g = 9.81 m/s², 120 Hz and ${held.length ? `1 substep (it holds ${held.join(' and ')})` : '4 substeps'}: ${show({ step_rate: rate ?? null, substeps: substeps ?? null, gravity: w['gravity'] ?? null })}`];
  return [];
}

/**
 * Everything wrong with the reference backend's report: every fixture the issue lists passes within the issue's tolerance,
 * each sensor cell's own rows sit at the issue's steps, a fixture needing a character controller reads excluded_by_caps
 * exactly when the caps lack one, the interface's data agrees with the report, and nothing else fails.
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
    out.push(...worldFailures(d));
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

/** #1931's three laws with the fields its criteria give them (`min_distance` is its suite's 0.1 m; the issue gives it no default). */
const LAWS: Record<string, JsonObject> = {
  inverse_square: { point: [0, 0, 0], k: -4 * Math.PI ** 2, min_distance: 0.1 },
  lennard_jones: { epsilon: 1, sigma: 0.5, cutoff: 1.25 },
  magnetic: { field: [0, 0, 3], charge: 2 },
};
/**
 * The world rule's planted mismatches: the same judge on the interface's own free-fall fixture with its world moved.
 * It passes that world as the kit holds it, a world holding `inverse_square` or `lennard_jones` at 1 substep and one
 * holding `magnetic` at the kit's 4; it catches a rate, a gravity or substeps the issues and the design don't give.
 */
function worldTwins(ff: FixtureData): void {
  const moved = (parts: JsonObject): FixtureData => ({ ...ff, world: { ...ff.world, ...parts } });
  const bodies = Object.keys(isObject(ff.world['bodies']) ? ff.world['bodies'] : {});
  const holding = (law: string, substeps: number): FixtureData => moved({ substeps, forces: { twin: { kind: { [law]: LAWS[law]! }, applies_to: bodies } } });
  none(worldFailures(ff), 'the world judge on the interface\'s own free_fall world');
  caught(worldFailures(moved({ step_rate: 60 })), 'the free_fall world at 60 Hz');
  caught(worldFailures(moved({ gravity: [0, 0, 0] })), 'the free_fall world at g = 0');
  caught(worldFailures(moved({ substeps: 1 })), 'the free_fall world, holding no force, at 1 substep');
  for (const law of ONE_SUBSTEP_LAWS) {
    none(worldFailures(holding(law, 1)), `the world judge on a world holding ${law} at 1 substep`);
    const at4 = worldFailures(holding(law, 4));
    caught(at4, `a world holding ${law} at 4 substeps`);
    named(at4, [ff.name, '1 substep', law], `a world holding ${law} at 4 substeps`);
  }
  none(worldFailures(holding('magnetic', 4)), 'the world judge on a world holding magnetic at the kit\'s 4 substeps');
  caught(worldFailures(holding('magnetic', 1)), 'a world holding magnetic, and neither position law, at 1 substep');
}

describe(`${AC[1]} Rapier 0.36.1 passes every fixture on macOS arm64 and on wasm32, measured beside each answer`, () => {
  test(`${AC[1]} macOS arm64: the reference backend passes every fixture within the issue's tolerance, listing each measured value beside its answer, each world at 4 substeps or, holding inverse_square or lennard_jones, at 1 (redraft 1931)`, () => {
    if (`${process.platform}-${process.arch}` !== 'darwin-arm64') blocked(`this leg is judged on a macOS arm64 host, not ${process.platform}-${process.arch}`);
    expect(`${process.platform}-${process.arch}`, 'this leg runs on macOS arm64').toBe('darwin-arm64');
    const [fixtures, info, report] = physics([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()]);
    const data = fixturesOf(fixtures!, 'behavior_fixtures');
    const caps = backendOf(info!, 'backend');
    expect(caps.reference, `${REFERENCE} is the reference implementation: ${show(info)}`).toBe(true);
    const k = kitReport(report!, 'behavior_kit on rapier3d');
    console.log(k.results.map((r) => `${r.fixture}: measured ${r.measured} against ${r.answer} ${show(r.tolerance ?? null)} → ${r.result}`).join('\n'));
    none(reportFailures(k, caps, data, 'aarch64-apple-darwin'), 'the reference report on macOS arm64');
    const ff = data.find((x) => x.name === 'free_fall');
    expect(ff, 'the interface holds a free_fall fixture').toBeDefined();
    none(freeFallAgrees(k, data, one(bake(ff!.world, RATE))), 'the kit measures free fall from the bake');
    const wrong = resultOf(k, 'free_fall', 'report');
    // The comparison's planted mismatch: the same judge on the result with its measured value 2% off.
    const twin = { ...wrong, measured: wrong.answer! * 1.02 };
    expect(passFailures(twin, EXPECTED[0]!, ff).length, 'the pass judge catches a measured value 2% off a 1% answer').toBeGreaterThan(0);
    worldTwins(ff!);
  }, TIMEOUT);

  test(`${AC[1]} wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within the issue's tolerance, each world at 4 substeps or, holding inverse_square or lennard_jones, at 1 (redraft 1931)`, () => {
    const [fixtures, info, report] = wasm32([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()]);
    const data = fixturesOf(fixtures!, 'behavior_fixtures on wasm32');
    const caps = backendOf(info!, 'backend on wasm32');
    const k = kitReport(report!, 'behavior_kit on wasm32');
    none(reportFailures(k, caps, data, WASM32), 'the reference report on wasm32');
    const ff = data.find((x) => x.name === 'free_fall');
    expect(ff, 'the interface holds a free_fall fixture on wasm32').toBeDefined();
    worldTwins(ff!);
  }, TIMEOUT);
});
