// AC2: a change with its taste call open that reaches a release, or the published page, isn't reversible, so it stays
// held for the person, while a reversible change beside it lands. A planted lander that lets the release's change
// through fails the same judgement, naming the change.
import { expect, test } from 'vitest';
import { FIRST, heldFailures, MIN, named, openCallsOf, PLANT, sleep, waitUntil, World } from './helpers.ts';

const LANDS = 100;
const RELEASE = 101;
const PAGE = 102;

test(named(2), async () => {
  // #101's change touches a file the repo's release ships; #102's adds a page to the folder the Pages site is built from.
  const w = await World.open({ issues: [{}, { reaches: 'release' }, { reaches: 'page' }], atOnce: 'three' });
  await w.startRun();
  const landed = await waitUntil(() => w.mergeOf(LANDS), FIRST, 2000);
  expect(landed, `#${LANDS}'s reversible change, its taste call open, lands within ${FIRST / MIN} minutes of the approval, so the lander lands such changes (${await w.about(LANDS)})`).toBeDefined();
  // Each of the two waits for you, its call raised; then 90 s more, past a round of landings.
  const waiting = await waitUntil(async () => { const events = await w.events(); return [RELEASE, PAGE].every((n) => openCallsOf(events, n).length > 0); }, 10 * MIN, 2000);
  expect(waiting, `#${RELEASE}'s and #${PAGE}'s changes wait for you: each one's taste call is raised (${await w.about(RELEASE)} | ${await w.about(PAGE)})`).toBe(true);
  await sleep(90_000);
  expect([...await heldFailures(w, RELEASE, 'a release'), ...await heldFailures(w, PAGE, 'the published page')], 'a change that reaches a release, or the published page, stays held').toEqual([]);
  await w.close();

  // The planted lander lets a change that reaches a release through: the same judgement fails, naming the change.
  const p = await World.open({ issues: [{ reaches: 'release' }], atOnce: 'one', plant: PLANT.landsUnreversible });
  await p.startRun();
  await waitUntil(() => p.mergeOf(100), FIRST, 2000);
  const failures = await heldFailures(p, 100, 'a release');
  expect(failures.length, 'the planted lander that lets a change reaching a release through fails the judgement; a pass proves nothing').toBeGreaterThan(0);
  expect(failures.join('\n'), 'its failure names the change: its issue').toContain('#100');
  for (const pr of p.prs(100)) expect(failures.join('\n'), 'its failure names the change: its pull request').toContain(`PR #${pr}`);
}, 90 * MIN);
