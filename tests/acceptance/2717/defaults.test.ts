// #2717.6803fbfb: "`deep_kinds` lists the vehicle body with every field of its `vehicle` and each default the world
// reader takes when the field is left out, and a defaults run builds the car with every field left out and reads those
// values back."
//
// This file holds the second clause, the defaults run: #1974's `deep-show kinds --defaults`, whose report (one JSON
// object) names, under `lists`, the entry `body@1.vehicle` it built (README: The surface under test).
//
// The first test runs it on the full build. "Builds the car": the entry's `world` is the world document it built,
// whose one body of kind vehicle is #251's car (1,000 kg, four wheels at the corners of a 2.5 m wheelbase and a 1.6 m
// track, 2 Hz springs with rest 0.3 m and travel 0.2 m), and its `built`, the IDs of the bodies the build made, holds
// the car's. "With every field left out": that document writes none of `damping_ratio`, `grip`, `steers`, `drives`,
// `brakes` and `steer_max`, at any wheel, and writes the five fields that have no default. "Reads those values back":
// the entry's `read`, the car's `vehicle` as the world reader took it, holds at every wheel the default deep_kinds
// prints for each field left out, which is the issue's (0.3, 1, false, false, true, and 35 for `steer_max`), and
// every written field as written. The run's verdict is PASS.
//
// The second test holds the read-back to the reader, not to the listing. `--planted
// vehicle_reader_takes_other_defaults` plants a world reader that takes 0.6, 2, true, true, false and 30 where the
// listing says 0.3, 1, false, false, true and 35, and changes nothing else. The run still builds the same car with
// every field left out; the check that passes the real program fails on its report at each of the six fields and at
// no other; what it reads back is the planted reader's value at every wheel; and its verdict is FAIL. A run that only
// prints the listing's defaults again, building nothing, reads 0.3 back here and passes: this test fails on it. So
// does a run that builds the car with the fields written.
//
// The base fails both: its defaults run names no body kind (its report has no `lists`), and it knows no such plant.

import { describe, expect, it } from 'vitest';
import {
  DEFAULTED, DESIGN, ID, PLANT, PLANTED, TIMEOUT, builtEntry, builtFailures, carOf, defaultsRun, leftOutFailures, listedDefaults, outline, physicsLists,
  readFailures, useFullBuild, type JsonObject,
} from './helpers.ts';

const build = useFullBuild();

describe(`${ID} a defaults run builds the car with every field left out and reads the listed defaults back`, () => {
  it(`${ID} a defaults run builds the car with every field left out and reads those values back`, () => {
    const bin = build();
    // "Those values": the defaults deep_kinds prints, read from the listing itself.
    const listed = listedDefaults(physicsLists(bin));
    expect.soft(listed.missing, 'deep_kinds prints a default for each field the run leaves out, for the run to read back').toEqual([]);

    const ran = defaultsRun(bin);
    expect(ran.report, `${ran.what} answers one report holding its verdict word: ${ran.seen}`).toBeDefined();
    const report = ran.report as JsonObject;
    expect.soft(report['verdict'], `the defaults run passes: ${outline(report)}`).toBe('PASS');
    const entry = builtEntry(report);
    expect(typeof entry === 'string' ? entry : '', `the run's report names the vehicle body it built: ${outline(report)}`).toBe('');
    if (typeof entry === 'string') throw Error(`BLOCKED: ${entry}`);

    const { car, failures } = carOf(entry);
    expect(failures, 'the world the run built holds the car').toEqual([]);
    if (!car) throw Error('BLOCKED: the entry holds no car to read');
    expect(leftOutFailures(car), 'the built document leaves out every field with a default, and writes the others').toEqual([]);
    expect(builtFailures(entry, car), 'the world\'s build made the car').toEqual([]);
    expect(readFailures(entry, car, DESIGN, 'the issue\'s and the design\'s default'), 'the world reader took the issue\'s default for each field left out, at every wheel').toEqual([]);
    expect(readFailures(entry, car, listed.defaults, 'the default deep_kinds prints'), 'the run reads back the default deep_kinds prints for each field left out, at every wheel').toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${PLANT}) a world reader that takes other values for the fields left out fails the run, which reads the reader's values back`, () => {
    const bin = build();
    const ran = defaultsRun(bin, PLANT);
    expect(ran.report, `${ran.what} answers one report holding its verdict word: ${ran.seen}`).toBeDefined();
    const report = ran.report as JsonObject;
    const entry = builtEntry(report);
    expect(typeof entry === 'string' ? entry : '', `the planted run's report names the vehicle body it built: ${outline(report)}`).toBe('');
    if (typeof entry === 'string') throw Error(`BLOCKED: ${entry}`);

    const { car, failures } = carOf(entry);
    expect(failures, 'the world the planted run built holds the car').toEqual([]);
    if (!car) throw Error('BLOCKED: the entry holds no car to read');
    expect(leftOutFailures(car), 'the planted run builds the same document: every field with a default left out').toEqual([]);

    // The check that passes the real program is run on the twin's report: it fails at each field left out, and only there.
    const caught = readFailures(entry, car, DESIGN, 'the issue\'s and the design\'s default');
    const uncaught = DEFAULTED.map((f) => f.path).filter((path) => !caught.some((c) => c.startsWith(`${path}:`)));
    expect(uncaught, `the read-back check fails on the planted reader at every field left out; its failures:\n  ${caught.join('\n  ')}`).toEqual([]);
    expect(caught.filter((c) => !DEFAULTED.some((f) => c.startsWith(`${f.path}:`))), 'the plant changes the reader\'s defaults and nothing else').toEqual([]);
    // What the run reads back is the reader's own value, not the listing's.
    expect(readFailures(entry, car, PLANTED, 'the planted world reader\'s default'), 'the run reads back the value the planted world reader took for each field left out, at every wheel').toEqual([]);
    expect(report['verdict'], `the run over the planted world reader fails: ${outline(report)}`).toBe('FAIL');
  }, TIMEOUT);
});
