// #12 AC7: a release runs `scripts/preflight` itself: `npm run release:check` starts the same entry point with
// `DEEP_PREFLIGHT=release`, which runs every lane the local run runs and adds the release-only lanes the local run
// prints as skipped; a release check that leaves out a local lane fails this test.
//
// The fixture runs `scripts/preflight` as a person would, then `npm run release:check` through the real npm. Every
// lane's checks are the fixture's stand-ins, which record DEEP_PREFLIGHT as they run.
import { afterAll, expect, it } from 'vitest';
import { AC7, MINUTE, clearLog, declaredPreflightBudget, fixture, makeBox, needNode, npmRun, passed, preflight, ranLog, removeBoxes, report, shown, skipped, started } from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

it(`${AC7} npm run release:check starts scripts/preflight with DEEP_PREFLIGHT=release, running every lane the local run runs and the release-only lanes it prints as skipped`, () => {
  needNode(AC7);
  const box = makeBox('ac7');
  fixture(box, { budgets: { base: { tasks: [] }, change: { preflight: declaredPreflightBudget(), tasks: [] } } });

  const local = preflight(box, 10 * MINUTE);
  expect(local.status, `${AC7} the local run passes, so the release run's lanes are not held back by a failure: ${shown(local)}`).toBe(0);
  const localRan = started(local.out), localSkipped = skipped(local.out);
  expect(localSkipped.length, `${AC7} the local run prints the release-only lanes as skipped: ${shown(local)}`).toBeGreaterThan(0);
  expect(ranLog(box).every(({ preflight: mode }) => mode !== 'release'), `${AC7} the local run is not a release run`).toBe(true);

  clearLog(box);
  const release = npmRun(box, 'release:check', 10 * MINUTE);
  const releaseRan = started(release.out), releaseSkipped = skipped(release.out);
  const left = localRan.filter((lane) => !releaseRan.includes(lane) || releaseSkipped.includes(lane));
  expect(left, `${AC7} the release check runs every lane the local run runs: ${shown(release)}`).toEqual([]);
  const notAdded = localSkipped.filter((lane) => !releaseRan.includes(lane));
  expect(notAdded, `${AC7} the release check runs the lanes the local run printed as skipped: ${shown(release)}`).toEqual([]);
  const unfinished = [...localRan, ...localSkipped].filter((lane) => !passed(release.out, lane) && !report(release.out, lane));
  expect(unfinished, `${AC7} each lane of the release check ends in a result: ${shown(release)}`).toEqual([]);
  const runs = ranLog(box);
  expect(runs.length, `${AC7} the release check ran the lanes' checks: ${shown(release)}`).toBeGreaterThan(0);
  expect(runs.filter(({ preflight: mode }) => mode !== 'release').map(({ tool, args }) => `${tool} ${args.join(' ')}`), `${AC7} every check of the release run ran with DEEP_PREFLIGHT=release: ${shown(release)}`).toEqual([]);
}, 15 * MINUTE);
