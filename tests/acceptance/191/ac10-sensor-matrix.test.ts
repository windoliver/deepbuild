// Criterion 10: the sensor matrix at 120 Hz. A sensor box of half extent 0.5 m on a static, a kinematic and a dynamic
// body, crossed along +x at 2 m/s from 2 m away by a sphere of radius 0.25 m on a dynamic body, on a kinematic body, and by
// a character capsule, writes one sensor_enter at step 75 and one sensor_exit at step 165, each within one step; a
// character placed inside at step 300 and out at 360 writes its enter at 300 and exit at 360; a body active inside from
// the start writes its enter at step 1 and, set inactive at step 240, its exit at 240; a planted wrapper on the backend's
// default pair filter, which skips kinematic–static pairs, writes nothing in the static-sensor × kinematic and
// static-sensor × character cells and fails, naming each cell.
import { describe, expect, test } from 'vitest';
import {
  AC, CELLS, CHARACTER_CAP, TIMEOUT, backendOf, caught, cell, cellFailures, kitCall, kitReport, named, needsCharacter, none,
  physics, prebuild, resultOf, show, type BackendInfo, type KitReport,
} from './helpers.ts';

prebuild(['shipped']);

/**
 * Everything wrong with the matrix on a backend: each cell's rows at the issue's steps; a cell that needs a character
 * controller reads excluded_by_caps on a backend whose caps have none (never a pass), and passes on one that claims one.
 */
function matrixFailures(k: KitReport, caps: BackendInfo): string[] {
  const controller = caps.caps.includes(CHARACTER_CAP);
  return CELLS.flatMap((name) => {
    const r = k.results.find((x) => x.fixture === name);
    if (!r) return [`no result for ${name}`];
    if (needsCharacter(name) && !controller) {
      return r.result === 'excluded_by_caps' && r.caps.includes(CHARACTER_CAP) ? [] : [`${name} reads ${r.result} (caps ${show(r.caps)}) on a backend without a ${CHARACTER_CAP}, not excluded_by_caps`];
    }
    return cellFailures(r);
  });
}

describe(`${AC[10]} the sensor matrix: one enter and one exit per crossing, at its analytic step`, () => {
  test(`${AC[10]} on Rapier every cell writes its enter and exit at the issue's steps; the character and place cells read excluded_by_caps without a character controller`, () => {
    const [info, report] = physics([{ call: 'backend' }, kitCall()]);
    const caps = backendOf(info!, 'backend');
    console.log(`${caps.backend}'s caps ${caps.caps.includes(CHARACTER_CAP) ? 'claim' : 'have no'} ${CHARACTER_CAP}: the character and place cells ${caps.caps.includes(CHARACTER_CAP) ? 'run' : 'read excluded_by_caps'}`);
    none(matrixFailures(kitReport(report!, 'behavior_kit on rapier3d'), caps), 'the sensor matrix on rapier3d');
  }, TIMEOUT);

  test(`${AC[10]} a planted wrapper on the default pair filter writes nothing in static × kinematic and static × character, and fails naming each cell`, () => {
    const [info, report] = physics([{ call: 'backend' }, kitCall()], { planted: 'pair_filter_default' });
    const caps = backendOf(info!, 'backend (planted pair filter)');
    const k = kitReport(report!, 'behavior_kit with --planted pair_filter_default');
    const silent = [cell('static', 'kinematic'), ...(caps.caps.includes(CHARACTER_CAP) ? [cell('static', 'character')] : [])];
    for (const name of silent) {
      const r = resultOf(k, name, 'planted pair filter');
      const rows = Array.isArray(r.raw['occurrences']) ? r.raw['occurrences'] : null;
      expect(rows, `${name} lists its sensor rows: ${show(r.raw)}`).not.toBeNull();
      expect(rows!.length, `${name} writes nothing under the default pair filter`).toBe(0);
      expect([r.result, r.what.includes(name)], `${name} reads fail, naming the cell: ${show(r.raw)}`).toEqual(['fail', true]);
    }
    expect(k.verdict, 'the kit fails').toBe('fail');
    const failures = matrixFailures(k, caps);
    caught(failures, 'the planted default pair filter');
    for (const name of silent) named(failures, [name], 'the planted pair filter\'s failure');
  }, TIMEOUT);
});
