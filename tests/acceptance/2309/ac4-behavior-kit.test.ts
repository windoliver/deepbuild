// Criterion 4: the resting stack joins the physics behavior kit's data (#191) once, and Rapier 0.36.1 passes it through
// the kit on macOS arm64 and in the wasm32 build.
import { describe, expect, test } from 'vitest';
import {
  AC, FIXTURE, REFERENCE, SINK_SAME_HZ, TIMEOUT, WASM32, dataFailures, fixtureBake, fixtureSink, kitCall, kitReport, none, physics,
  prebuild, rowFailures, stackFixture, wasm32, type JsonObject, type KitResult,
} from './helpers.ts';

prebuild(['release']);

/** The fixture's data and the kit's row for it, from one runner's replies; everything wrong with either, and the row. */
function read(fixtures: JsonObject, report: JsonObject, baked: (call: JsonObject) => JsonObject, target: string): { failures: string[]; row: KitResult | undefined } {
  const f = stackFixture(fixtures, `behavior_fixtures on ${target}`);
  const failures = dataFailures(f);
  const k = kitReport(report, `behavior_kit on ${target}`);
  if (k.backend !== REFERENCE || k.target !== target) failures.push(`the report names backend ${k.backend} on ${k.target}, not ${REFERENCE} on ${target}`);
  const rows = k.results.filter((r) => r.fixture === FIXTURE);
  if (rows.length !== 1) return { failures: [...failures, `the kit's report holds ${FIXTURE} ${rows.length} times, once expected`], row: undefined };
  const row = rows[0]!;
  failures.push(...rowFailures(row, f, REFERENCE));
  console.log(`${target}: ${FIXTURE} measured ${row.measured} m against ${row.answer} m ${JSON.stringify(row.tolerance)} → ${row.result}`);
  // The kit measures the bake, not its answer: the fixture's own world, baked here for its own steps, ends its top as low.
  if (row.measured !== null) {
    const low = fixtureSink(baked(fixtureBake(f)), f, `${FIXTURE}'s world baked ${f.steps} steps on ${target}`);
    if (Math.abs(low - row.measured) > 1e-5) failures.push(`the kit measured ${row.measured} m; its own world baked here ends ${f.top} ${low} m below where it was built`);
  }
  return { failures, row };
}

describe(`${AC[4]} the resting stack is in the behavior kit's data once, and Rapier 0.36.1 passes it natively and on wasm32`, () => {
  test(`${AC[4]} macOS arm64: ${FIXTURE} is held once, with the issue's stack, 5.87 mm and 0.3 mm, and ${REFERENCE} passes it`, () => {
    expect(`${process.platform}-${process.arch}`, 'this leg runs on macOS arm64').toBe('darwin-arm64');
    const [fixtures, report] = physics([{ call: 'behavior_fixtures' }, kitCall()]);
    const { failures, row } = read(fixtures!, report!, (call) => physics([call])[0]!, 'aarch64-apple-darwin');
    none(failures, `${FIXTURE} on macOS arm64`);
    // The judge's own wrong answer: the same row measuring the 6.90 mm of a static contact at the same frequency.
    const f = stackFixture(fixtures!, 'behavior_fixtures');
    expect(rowFailures({ ...row!, measured: SINK_SAME_HZ }, f, REFERENCE).length, 'the pass judge catches a top 6.90 mm low').toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${AC[4]} wasm32: the physics crate built for wasm32-unknown-unknown holds ${FIXTURE} once and passes it`, () => {
    const [fixtures, report] = wasm32([{ call: 'behavior_fixtures' }, kitCall()]);
    none(read(fixtures!, report!, (call) => wasm32([call])[0]!, WASM32).failures, `${FIXTURE} on wasm32`);
  }, TIMEOUT);
});
