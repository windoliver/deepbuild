// Criterion 6: a candidate test backend that wraps Rapier and keeps Rapier's caps(), soft bodies included, is refused
// before any fixture runs, naming soft bodies as a claimed feature with no fixture; with soft bodies taken out of its
// caps() it runs the kit and passes; and a planted kit that runs only the fixtures it has admits the first and fails.
import { describe, expect, test } from 'vitest';
import {
  AC, SOFT_CAP, TIMEOUT, backendOf, caught, kitCall, kitReport, named, none, physics, prebuild, show, strs, type KitReport,
} from './helpers.ts';

prebuild(['test']);

/** Everything wrong with a candidate's report when its caps claim soft bodies: it must be refused before any fixture runs, naming them. */
function refusedFailures(k: KitReport): string[] {
  const out: string[] = [];
  if (k.admitted) out.push(`${k.backend} was admitted though its caps claim ${SOFT_CAP}, which no fixture covers`);
  if (k.verdict !== 'refused') out.push(`${k.backend}'s kit verdict is ${k.verdict}, not refused`);
  if (k.results.length) out.push(`${k.results.length} fixtures ran on ${k.backend} before its refusal (${k.results.map((r) => r.fixture).slice(0, 5).join(', ')}…)`);
  const features = k.refused && Array.isArray(k.refused['features']) ? strs(k.refused['features'], 'refused.features') : [];
  if (!features.includes(SOFT_CAP)) out.push(`${k.backend}'s refusal doesn't name ${SOFT_CAP} as a claimed feature with no fixture: ${show(k.refused)}`);
  return out;
}

describe(`${AC[6]} a candidate whose caps() claim a feature no fixture covers is refused before its kit runs`, () => {
  test(`${AC[6]} rapier_caps, keeping Rapier's caps with soft bodies, is refused before any fixture runs, naming ${SOFT_CAP}`, () => {
    const [rapierInfo] = physics([{ call: 'backend' }], { build: 'test' });
    const rapier = backendOf(rapierInfo!, 'backend (Rapier)');
    expect(rapier.caps, `Rapier's caps claim ${SOFT_CAP}`).toContain(SOFT_CAP);
    const [info, report] = physics([{ call: 'backend' }, kitCall()], { backend: 'rapier_caps' });
    const own = backendOf(info!, 'backend (rapier_caps)');
    expect(own.reference, 'rapier_caps is a candidate, not the reference implementation').toBe(false);
    expect([...own.caps].sort(), 'rapier_caps keeps Rapier\'s caps').toEqual([...rapier.caps].sort());
    none(refusedFailures(kitReport(report!, 'behavior_kit on rapier_caps')), 'rapier_caps');
  }, TIMEOUT);

  test(`${AC[6]} no_soft_bodies, the same with ${SOFT_CAP} taken out of its caps, runs the kit and passes`, () => {
    const [info, report] = physics([{ call: 'backend' }, kitCall()], { backend: 'no_soft_bodies' });
    expect(backendOf(info!, 'backend (no_soft_bodies)').caps, `no_soft_bodies leaves ${SOFT_CAP} out`).not.toContain(SOFT_CAP);
    const k = kitReport(report!, 'behavior_kit on no_soft_bodies');
    const failures: string[] = [];
    if (!k.admitted) failures.push(`no_soft_bodies was refused: ${show(k.refused)}`);
    if (k.verdict !== 'pass') failures.push(`no_soft_bodies' kit verdict is ${k.verdict}, not pass`);
    if (k.results.length === 0) failures.push('no fixture ran');
    for (const r of k.results) if (r.result === 'fail') failures.push(`${r.fixture} fails: ${r.what}`);
    if (!k.results.some((r) => r.result === 'pass')) failures.push('no fixture passed');
    none(failures, 'no_soft_bodies');
  }, TIMEOUT);

  test(`${AC[6]} a planted kit that runs only the fixtures it has admits rapier_caps, and this check fails naming ${SOFT_CAP}`, () => {
    const k = kitReport(physics([kitCall()], { backend: 'rapier_caps', planted: 'kit_admits_unfixtured' })[0]!, 'behavior_kit on rapier_caps with --planted kit_admits_unfixtured');
    expect(k.admitted, 'the planted kit admits rapier_caps').toBe(true);
    const failures = refusedFailures(k);
    caught(failures, 'the planted kit that admits a candidate claiming an unfixtured feature');
    named(failures, [SOFT_CAP], 'the planted kit\'s failure');
  }, TIMEOUT);
});
