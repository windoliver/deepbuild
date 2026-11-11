// #2011.a8a76103: 50 capsules on dynamic bodies on a 20,000-triangle level built as a compound of convex pieces keep
// step_p95 under 2 ms in the app and in the wasm32 build in headless Chrome on the reference Mac; the same level as one
// mesh shape, under 2 ms in the app and over it in headless Chrome, fails on the web host, naming web, the step and the
// shape pair; the planted check `times_only_app` passes it and so is caught; and with no reference Mac configured, the
// web budget is BLOCKED with one unblock ask, never PASS.
//
// Timing verdicts are the check's own, by the five-run rule on the reference Mac (scripts/benchmark.mjs judgeLimit). A
// host the rule reads INCONCLUSIVE where this criterion wants PASS or FAIL (a loaded machine, or one off the reference
// Macs) fails the test as INCONCLUSIVE, never passes it; everything the check reports apart from the verdict is judged
// before that.
import { describe, expect, it } from 'vitest';
import {
  BUDGET_STEPS, BUDGET_TIMEOUT, CRITERIA, budget, capsuleLevelPair, caught, hostOf, hostTriple, inconclusive, isObject, levelWorld,
  none, reportFailures, show, timedFailures, verdictsOf, type BudgetRequest, type JsonObject, type JsonValue,
} from './helpers.ts';

const both = { app: true, web: true };
const request = (level: 'compound' | 'mesh', reference_mac = both): BudgetRequest => ({ world: levelWorld(level), steps: BUDGET_STEPS, reference_mac });

/** Everything but the verdicts: both hosts timed where they say, the report's own verdict and limit. */
function timed(report: JsonObject, triple: string): string[] {
  const f = [...reportFailures(report), ...timedFailures(report, 'app', BUDGET_STEPS, triple), ...timedFailures(report, 'web', BUDGET_STEPS, triple)];
  const [app, web] = [field(report, 'app', 'runs'), field(report, 'web', 'runs')];
  if (app !== undefined && JSON.stringify(app) === JSON.stringify(web)) f.push(`the web host's runs are the app's (${show(app)}): the web host wasn't timed on its own`);
  return f;
}

/** `report.hosts[host][key]`, or undefined when the report lacks it. */
function field(report: JsonObject, host: 'app' | 'web', key: string): JsonValue | undefined {
  const h = report['hosts'];
  const x = isObject(h) ? h[host] : undefined;
  return isObject(x) ? x[key] : undefined;
}

/** The mesh level's web host names, in its slowest step, a capsule's shape use and the level's. */
function meshPairFailures(report: JsonObject): string[] {
  const s = field(report, 'web', 'slowest');
  const pair = isObject(s) ? s['pair'] : undefined;
  return capsuleLevelPair(pair) ? [] : [`the web host's slowest step names ${show(pair)}, not a capsule's shape use and the mesh level's (level/shapes/0), the pair with the most narrow-phase tests`];
}

describe(`${CRITERIA[2]} budget.step_p95 is held in the app and in the wasm32 build in headless Chrome on the reference Mac`, () => {
  it(`${CRITERIA[2]} 50 capsules on the 20,000-triangle level built as a compound of convex pieces keep step_p95 under 2 ms in the app and in headless Chrome`, () => {
    const triple = hostTriple();
    const report = budget(request('compound'));
    none(timed(report, triple), 'both hosts are timed on this Mac, the app\'s release build natively and the release wasm32 build in headless Chrome');
    const { failures, inconclusive: readings } = verdictsOf(report, { app: 'PASS', web: 'PASS' });
    none(failures, 'the compound level keeps step_p95 under 2 ms on both hosts');
    inconclusive('the compound level on both hosts', readings);
    expect(report['verdict'], 'the compound level passes').toBe('PASS');
  }, BUDGET_TIMEOUT);

  it(`${CRITERIA[2]} the same level as one mesh shape, under 2 ms in the app and over it in headless Chrome, fails on the web host, naming web, the step and the shape pair`, () => {
    const triple = hostTriple();
    const report = budget(request('mesh'));
    none(timed(report, triple), 'both hosts are timed on this Mac, the app\'s release build natively and the release wasm32 build in headless Chrome');
    none(meshPairFailures(report), 'the web host\'s slowest step names the capsule–level pair');
    const { failures, inconclusive: readings } = verdictsOf(report, { app: 'PASS', web: 'FAIL' });
    none(failures, 'the mesh level is under 2 ms in the app and over it in headless Chrome');
    inconclusive('the mesh level on both hosts', readings);
    expect(report['verdict'], 'the mesh level fails').toBe('FAIL');
    const web = hostOf(report, 'web');
    const s = web['slowest'] as JsonObject;
    const pair = s['pair'] as JsonObject[];
    const capsule = pair.find((u) => u['body'] !== 'level')!['body'] as string;
    const what = String(web['what'] ?? '');
    const missing = [['the host', 'web'], ['the step', String(s['step'])], ['the capsule', capsule], ['the level', 'level']].filter(([, w]) => !what.includes(w!));
    expect(missing, `the web host's failure names web, the step ${show(s['step'])} and the pair ${capsule}–level: ${show(web['what'])}`).toEqual([]);
  }, BUDGET_TIMEOUT);

  it(`${CRITERIA[2]} a planted check that times only the app passes the mesh level and is caught`, () => {
    const triple = hostTriple();
    const plant = budget(request('mesh'), 'times_only_app');
    const f = [...timed(plant, triple), ...meshPairFailures(plant)];
    try { f.push(...verdictsOf(plant, { app: 'PASS', web: 'FAIL' }).failures); } catch (e) { f.push(String(e)); }
    caught(f, 'times_only_app (the judge that passes the real check finds its web host untimed in headless Chrome, or passing)');
  }, BUDGET_TIMEOUT);

  it(`${CRITERIA[2]} with no reference Mac configured for the web, its budget is BLOCKED with one unblock ask, never PASS`, () => {
    const triple = hostTriple();
    const report = budget(request('compound', { app: true, web: false }));
    none([...reportFailures(report), ...timedFailures(report, 'app', BUDGET_STEPS, triple)], 'the app host, which has a reference Mac, is timed');
    const web = hostOf(report, 'web');
    expect(web['verdict'], 'the web budget is BLOCKED').toBe('BLOCKED');
    expect(web['runs'], 'the web host is never timed without its reference Mac').toEqual([]);
    const asks = report['asks'] as JsonObject[];
    expect(asks.length, `one unblock ask: ${show(asks)}`).toBe(1);
    expect(asks[0]!['kind'], 'the ask is an unblock ask').toBe('unblock');
    expect(asks[0]!['host'], 'the ask names the web host').toBe('web');
    expect(typeof asks[0]!['what'] === 'string' && asks[0]!['what'].length > 0, `the ask says what unblocks it: ${show(asks[0])}`).toBe(true);
    expect(report['verdict'], 'the check is BLOCKED, never PASS').toBe('BLOCKED');
  }, BUDGET_TIMEOUT);
});
