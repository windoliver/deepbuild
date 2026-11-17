// Criterion 2: five 1 m cubes of density 1,000 kg/m³ and friction 0.5 set one on another at 120 Hz and 4 substeps with
// `contact_hz: 80` each move slower than 1 mm/s throughout the sixth second, and so do ten. At the default 30 Hz the top
// of five ends 5.87 mm below 4.5 m within 0.3 mm. A planted wrapper that holds a contact with a static body at the same
// frequency as any other ends 6.90 mm low and fails, naming the top body.
import { describe, expect, test } from 'vitest';
import {
  AC, FIXTURE, SINK, SINK_SAME_HZ, SINK_WITHIN, TIMEOUT, bake, caught, cube, failFailures, kitCall, kitReport, named, none, physics,
  prebuild, restFailures, shownSpeeds, sink, sinkOfFive, speeds, stackFixture, stackWorld, topFailures, show,
} from './helpers.ts';

prebuild(['release']);
const LIMIT = 0.001;

describe(`${AC[2]} stacks rest at the bound, and the top of five ends 5.87 mm low at the default`, () => {
  for (const n of [5, 10]) {
    test(`${AC[2]} ${n} cubes at contact_hz 80 (120 Hz, 4 substeps) each move slower than 1 mm/s throughout the sixth second`, () => {
      const what = `the stack of ${n} at 80 Hz`;
      const [baked] = physics([bake(stackWorld(n, { contactHz: 80 }))]);
      console.log(`${what}, largest speed in the sixth second: ${shownSpeeds(speeds(baked!, n, what))}`);
      none(restFailures(baked!, n, LIMIT, what), what);
    }, TIMEOUT);
  }

  test(`${AC[2]} at the default 30 Hz the top of five ends 5.87 mm below 4.5 m within 0.3 mm`, () => {
    const what = 'the stack of five at the default';
    // The printed answers are the closed form's: 2 × (4 + 3 + 2 + 1) × g ÷ (2π × 30)² + 5 × g ÷ (2π × 60)².
    expect(sinkOfFive(30, 2), 'the worked answer at the default').toBeCloseTo(SINK, 5);
    expect(sinkOfFive(30, 1), 'the worked answer with a static contact at the same frequency').toBeCloseTo(SINK_SAME_HZ, 5);
    const [baked] = physics([bake(stackWorld(5))]);
    console.log(`${what}: ${cube(5)} ends ${(sink(baked!, 5, what) * 1000).toFixed(3)} mm below 4.5 m; worked answer ${(sinkOfFive(30, 2) * 1000).toFixed(3)} mm`);
    none(topFailures(baked!, what), what);
  }, TIMEOUT);

  test(`${AC[2]} a planted wrapper holding a static contact at the same frequency ends the top 6.90 mm low and fails, naming ${cube(5)}; the kit's ${FIXTURE} fails naming its top body`, () => {
    const what = 'the stack of five at the default, static contacts at the same frequency';
    const [baked, fixtures, report] = physics([bake(stackWorld(5)), { call: 'behavior_fixtures' }, kitCall()], 'static_contact_same_hz');
    const low = sink(baked!, 5, what);
    console.log(`planted static_contact_same_hz: ${cube(5)} ends ${(low * 1000).toFixed(3)} mm below 4.5 m`);
    expect(Math.abs(low - SINK_SAME_HZ) <= SINK_WITHIN, `the planted wrapper ends the top 6.90 mm low within 0.3 mm (it ends ${low * 1000} mm low)`).toBe(true);
    const failures = topFailures(baked!, what);
    caught(failures, 'the planted wrapper that holds a static contact at the same frequency');
    named(failures, [cube(5)], 'the planted wrapper that holds a static contact at the same frequency');
    // The kit holds the same stack (criterion 4): under the wrapper its row fails, naming the backend, the fixture and its top body.
    const f = stackFixture(fixtures!, 'behavior_fixtures');
    const r = kitReport(report!, 'behavior_kit under the planted wrapper').results.filter((x) => x.fixture === FIXTURE);
    expect(r.length, `the kit's report holds ${FIXTURE} once`).toBe(1);
    const row = r[0]!;
    const kit = failFailures(row, row.backend);
    if (row.raw['body'] !== f.top || !row.what.includes(f.top)) kit.push(`${FIXTURE}'s fail names body ${show(row.raw['body'])}, not its top body ${f.top}: ${JSON.stringify(row.what)}`);
    if (row.measured === null || Math.abs(row.measured - SINK_SAME_HZ) > SINK_WITHIN) kit.push(`${FIXTURE}'s fail measures ${show(row.measured)} m, not the 6.90 mm (0.0069 m) the wrapper ends low`);
    none(kit, `${FIXTURE} under the planted wrapper`);
  }, TIMEOUT);
});
