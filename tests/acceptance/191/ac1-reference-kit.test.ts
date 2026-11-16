// Criterion 1: Rapier 0.36.1 passes every fixture on macOS arm64 and in the physics crate's wasm32 build, each within
// its tolerance, and the kit's report lists each fixture's measured value beside its answer.
import { describe, expect, test } from 'vitest';
import {
  AC, CELLS, CHARACTER_CAP, EXPECTED, G, RATE, REFERENCE, TIMEOUT, WASM32, backendOf, bake, cellFailures, fixturesOf, isObject,
  kitCall, kitReport, needsCharacter, none, one, passFailures, physics, prebuild, resultOf, show, statesOf, wasm32,
  type BackendInfo, type FixtureData, type JsonObject, type KitReport,
} from './helpers.ts';

prebuild(['shipped']);

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
    const w = d.world;
    const rate = w['step_rate'] ?? RATE;
    const substeps = w['substeps'] ?? 4;
    const gravity = Array.isArray(w['gravity']) ? Math.hypot(...(w['gravity'] as number[])) : G;
    if (rate !== RATE || substeps !== 4 || Math.abs(gravity - G) > 1e-9) out.push(`fixture ${d.name}'s world isn't at g = 9.81 m/s², 120 Hz and 4 substeps: ${show({ step_rate: rate ?? null, substeps: substeps ?? null, gravity: w['gravity'] ?? null })}`);
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

describe(`${AC[1]} Rapier 0.36.1 passes every fixture on macOS arm64 and on wasm32, measured beside each answer`, () => {
  test(`${AC[1]} macOS arm64: the reference backend passes every fixture within the issue's tolerance, listing each measured value beside its answer`, () => {
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
  }, TIMEOUT);

  test(`${AC[1]} wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within the issue's tolerance`, () => {
    const [fixtures, info, report] = wasm32([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()]);
    const data = fixturesOf(fixtures!, 'behavior_fixtures on wasm32');
    const caps = backendOf(info!, 'backend on wasm32');
    const k = kitReport(report!, 'behavior_kit on wasm32');
    none(reportFailures(k, caps, data, WASM32), 'the reference report on wasm32');
  }, TIMEOUT);
});
