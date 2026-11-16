// Criterion 4: a test fixture naming a cap that a test backend wrapping Rapier leaves out of its caps() reads
// excluded_by_caps on that backend, which passes the rest, and passes on Rapier; and a planted kit that runs the excluded
// fixture anyway reads a fail there and fails this, naming the fixture and the cap.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, backendOf, caught, fixturesOf, kitCall, kitReport, named, none, physics, prebuild, resultOf, show,
  type FixtureData, type KitReport,
} from './helpers.ts';

prebuild(['test']);
const BACKEND = 'drops_cap';
const FIXTURE = 'test_capped';

/**
 * Everything wrong with a backend's report under the caps rule: the test fixture reads excluded_by_caps, naming the cap
 * the backend left out; every fixture that names a cap the backend lacks reads excluded_by_caps; every other one passes.
 */
function excludedFailures(k: KitReport, caps: string[], data: FixtureData[], dropped: string): string[] {
  const out: string[] = [];
  for (const r of k.results) {
    const d = data.find((x) => x.name === r.fixture);
    const missing = (d?.caps ?? r.caps).filter((c) => !caps.includes(c));
    if (missing.length) {
      if (r.result !== 'excluded_by_caps') out.push(`${r.fixture} names cap ${missing.join(', ')}, which ${k.backend}'s caps leave out, yet reads ${r.result}: ${r.what}`);
    } else if (r.result !== 'pass') out.push(`${r.fixture} reads ${r.result} on ${k.backend}, whose caps hold every cap it names: ${r.what}`);
  }
  const t = k.results.find((r) => r.fixture === FIXTURE);
  if (!t) out.push(`the report holds no ${FIXTURE}`);
  else if (t.result !== 'excluded_by_caps' || !t.caps.includes(dropped)) out.push(`${FIXTURE} (cap ${dropped}) reads ${t.result} naming caps ${show(t.caps)} on ${k.backend}: ${t.what}`);
  if (k.verdict !== 'pass') out.push(`${k.backend}'s kit verdict is ${k.verdict}, not pass (an excluded fixture is neither a pass nor a fail)`);
  return out;
}

/** The cap the test backend leaves out: in Rapier's caps, not in its own; the test fixture names it. */
function droppedCap(rapier: string[], own: string[], data: FixtureData[]): string {
  const dropped = rapier.filter((c) => !own.includes(c));
  const fixture = data.find((d) => d.name === FIXTURE);
  expect(fixture, `the test build's kit holds the test fixture ${FIXTURE}`).toBeDefined();
  const cap = dropped.find((c) => fixture!.caps.includes(c));
  expect(cap, `${BACKEND} leaves out of Rapier's caps (${show(rapier)}) a cap ${FIXTURE} names (${show(fixture!.caps)}); it leaves out ${show(dropped)}`).toBeDefined();
  return cap!;
}

describe(`${AC[4]} a fixture whose cap a backend's caps() leave out reads excluded_by_caps there and passes on Rapier`, () => {
  test(`${AC[4]} ${FIXTURE} reads excluded_by_caps on ${BACKEND}, which passes the rest, and passes on Rapier`, () => {
    const [fixtures, rapierInfo, rapierKit] = physics([{ call: 'behavior_fixtures' }, { call: 'backend' }, kitCall()], { build: 'test' });
    const data = fixturesOf(fixtures!, 'behavior_fixtures (test build)');
    const rapier = backendOf(rapierInfo!, 'backend (Rapier, test build)');
    const [ownInfo, ownKit] = physics([{ call: 'backend' }, kitCall()], { backend: BACKEND });
    const own = backendOf(ownInfo!, `backend (${BACKEND})`);
    const cap = droppedCap(rapier.caps, own.caps, data);
    none(excludedFailures(kitReport(ownKit!, `behavior_kit on ${BACKEND}`), own.caps, data, cap), `${BACKEND}'s report`);
    const onRapier = resultOf(kitReport(rapierKit!, 'behavior_kit on Rapier (test build)'), FIXTURE, 'Rapier');
    expect(onRapier.result, `${FIXTURE} passes on Rapier: ${show(onRapier.raw)}`).toBe('pass');
  }, TIMEOUT);

  test(`${AC[4]} a planted kit that runs ${FIXTURE} anyway on ${BACKEND} reads a fail there, and this check fails naming the fixture and the cap`, () => {
    const [fixtures, rapierInfo] = physics([{ call: 'behavior_fixtures' }, { call: 'backend' }], { build: 'test' });
    const data = fixturesOf(fixtures!, 'behavior_fixtures (test build)');
    const rapier = backendOf(rapierInfo!, 'backend (Rapier, test build)');
    const [ownInfo, planted] = physics([{ call: 'backend' }, kitCall()], { backend: BACKEND, planted: 'kit_runs_excluded' });
    const own = backendOf(ownInfo!, `backend (${BACKEND}, planted kit)`);
    const cap = droppedCap(rapier.caps, own.caps, data);
    const k = kitReport(planted!, `behavior_kit on ${BACKEND} with --planted kit_runs_excluded`);
    expect(resultOf(k, FIXTURE, 'planted kit').result, `the planted kit runs ${FIXTURE} anyway, and it reads fail there`).toBe('fail');
    const failures = excludedFailures(k, own.caps, data, cap);
    caught(failures, 'the planted kit that runs an excluded fixture');
    named(failures, [FIXTURE, cap], 'the planted kit\'s failure');
  }, TIMEOUT);
});
