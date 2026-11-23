// Criterion 5: the turntable joins the physics behavior kit's data (#191) once, and Rapier 0.36.1 passes it through
// the kit on macOS arm64 and in the wasm32 build.
//
// On each target, down one process: the kit's data (`behavior_fixtures`), its report (`behavior_kit`) and this suite's
// own bake of the same world in a scene whose channel rises as the kit's ramp does. The data holds `turntable` once,
// with the world, the steps, the ramp, the answer and the tolerance of README: The fixture in the behavior kit; its
// one row reads `pass` on the reference backend; and the row's `measured` is this suite's reading of that bake, so
// the kit measures the run and not its answer.
import { describe, expect, test } from 'vitest';
import {
  AC, FAST, REFERENCE, TIMEOUT, TURNTABLE, WASM32, WITHIN_FAST, ask, askWasm32, kitCall, kitFailures, prebuild, rideRead,
  show, turntableBake, type Asked,
} from './helpers.ts';

prebuild(['release']);

const CALLS = [{ call: 'behavior_fixtures' }, kitCall(), turntableBake(FAST)];

/** Everything wrong with the turntable in the kit on one target: its data, its row, and the report's backend and target. */
function turntableFailures(run: Asked, target: string): string[] {
  const [fixtures, report, baked] = [run.replies[0]!, run.replies[1]!, run.replies[2]!];
  const read = rideRead(baked, FAST, WITHIN_FAST, `the turntable baked on ${target}`);
  const kit = kitFailures(fixtures, report, 'pass', read.measured, REFERENCE, `the behavior kit on ${target}`);
  if (kit.row) console.log(`${target}: the kit's ${TURNTABLE.name} measures ${show(kit.row.measured)} m against ${show(kit.row.answer)} ${show(kit.row.tolerance)}: ${kit.row.result}; this suite's bake reads ${show(read.measured)} m`);
  const out = [...kit.failures, ...read.failures];
  if (report['backend'] !== REFERENCE) out.push(`the kit's report names backend ${show(report['backend'])}, not ${REFERENCE}`);
  if (report['target'] !== target) out.push(`the kit's report names target ${show(report['target'])}, not ${target}`);
  return out;
}

describe(`${AC[5]} the turntable joins the behavior kit's data once, and Rapier 0.36.1 passes it on macOS arm64 and on wasm32`, () => {
  test(`${AC[5]} macOS arm64: the kit's data holds the turntable once, and the reference backend passes it within 0.06 m of 1 m`, () => {
    expect(`${process.platform}-${process.arch}`, 'INCONCLUSIVE: this leg runs on macOS arm64, and this machine is another').toBe('darwin-arm64');
    const run = ask(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const failures = turntableFailures(run, 'aarch64-apple-darwin');
    expect(failures, `the turntable in the behavior kit on macOS arm64:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} wasm32: the physics crate built for wasm32-unknown-unknown holds the turntable once and passes it within 0.06 m of 1 m`, () => {
    const run = askWasm32(CALLS);
    expect(run.problem, `${run.what} answers`).toBe('');
    const failures = turntableFailures(run, WASM32);
    expect(failures, `the turntable in the behavior kit on wasm32:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
