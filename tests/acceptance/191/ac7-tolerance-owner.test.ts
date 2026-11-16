// Criterion 7: a test backend that declares its own 5% tolerance for free fall in its manifest still fails the 1% free
// fall fixture with a 2% error, naming the fixture and the interface's tolerance, since the kit reads tolerances only
// from the interface.
import { describe, expect, test } from 'vitest';
import {
  AC, TIMEOUT, backendOf, failFailures, kitCall, kitReport, none, physics, prebuild, resultOf, show, toleranceOf,
} from './helpers.ts';

prebuild(['test']);
const BACKEND = 'loose_tolerance';

describe(`${AC[7]} the kit reads tolerances only from the interface, never from a backend's manifest`, () => {
  test(`${AC[7]} ${BACKEND}, declaring 5% for free fall and falling 2% off, fails free_fall naming the fixture and the interface's 1%`, () => {
    const [info, report] = physics([{ call: 'backend' }, kitCall()], { backend: BACKEND });
    const manifest = backendOf(info!, `backend (${BACKEND})`);
    const declared = toleranceOf(manifest.tolerances['free_fall'], `${BACKEND}'s manifest: tolerances.free_fall`);
    expect(declared, `${BACKEND}'s manifest declares its own 5% for free fall`).toEqual({ unit: 'relative', value: 0.05 });
    const r = resultOf(kitReport(report!, `behavior_kit on ${BACKEND}`), 'free_fall', BACKEND);
    const failures = failFailures(r, BACKEND);
    const t = toleranceOf(r.tolerance, 'free_fall.tolerance');
    if (t.unit !== 'relative' || t.value !== 0.01) failures.push(`free_fall names tolerance ${show(r.tolerance ?? null)}, not the interface's 1%`);
    if (!/\b1(\.0+)?\s?%|0\.01\b/.test(r.what)) failures.push(`free_fall's fail text doesn't name the interface's 1%: ${JSON.stringify(r.what)}`);
    const off = r.measured === null || r.answer === null ? null : Math.abs(r.measured - r.answer) / r.answer;
    if (off === null || off < 0.015 || off > 0.025) failures.push(`free_fall measured ${show(r.measured)} against ${show(r.answer)}: ${off === null ? 'no error' : `${(off * 100).toFixed(2)}%`} off, not the twin's 2%`);
    none(failures, `${BACKEND} on free_fall`);
  }, TIMEOUT);
});
