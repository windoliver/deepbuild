import { afterEach, describe, expect, it } from 'vitest';
import {
  addGuard, allEvents, apply, canon, DAY, expectState, heldTargets, lines, load, loadedTargets, openWorld, removeRoots,
  said, startSession, T0,
} from './helpers.ts';

afterEach(removeRoots);

const RELEASE = 'step:shop-release';
const SHIP = 'playbook:shop-ship';
const JOURNEYS = 'step:shop-journeys';

describe('AC4 a step spec applied on day 1 is held at the day-3 session start by a guard rule added on day 2', () => {
  it('AC4 in force in the day-1 and day-2 sessions; after a block rule on `npm publish` is added on day 2, the day-3 session leaves it out and shows it held, naming the rule; a spec the rule does not deny still loads', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', text: 'release builds, then npm publish --tag next; the journeys run with npx playwright test' }]);
    const ev1 = [{ at: said(S1, 'm1'), quote: 'npm publish --tag next' }];
    const specs = [
      await apply(w, { target: RELEASE, diff: lines('+ run: npm run build', '+ run: npm publish --tag next', '+ check: shop.e2e'), evidence: ev1, scope: 'repo:shop' }, 'you'),
      await apply(w, { target: SHIP, diff: lines('+ run: npm version patch', '+ run: npm publish --tag next'), evidence: ev1, scope: 'repo:shop' }, 'you'),
      await apply(w, { target: JOURNEYS, diff: lines('+ run: npx playwright test --project=shop', '+ check: shop.journeys'), evidence: ev1, scope: 'repo:shop' }, 'you'),
    ];
    for (const id of specs) await expectState(w, id, 'applied', 'AC4 a step spec you applied on day 1');
    const day1 = await load(w, S1);
    for (const t of [RELEASE, SHIP, JOURNEYS]) expect(loadedTargets(day1), `AC4 the day-1 session loads ${t}`).toContain(t);
    expect(day1.held, 'AC4 nothing is held on day 1').toEqual([]);

    w.clock.set(T0 + DAY);
    const S2 = await startSession(w, 'shop', [{ id: 'm1', text: 'never publish from a session, I publish myself; just log every playwright run' }]);
    const day2 = await load(w, S2);
    for (const t of [RELEASE, SHIP, JOURNEYS]) expect(loadedTargets(day2), `AC4 the day-2 session, started before the rule, loads ${t}`).toContain(t);
    await addGuard(w, 'no-npm-publish', {
      match: 'run:npm publish', scope: 'all_repos', mode: 'block',
      reason: 'Publishing a package needs the person, not a session.', next_step: 'Ask the person to publish.', fail_closed: true,
    }, [{ at: said(S2, 'm1'), quote: 'never publish from a session' }]);
    await addGuard(w, 'log-playwright', {
      match: 'run:npx playwright', scope: 'all_repos', mode: 'watch',
      reason: 'Each playwright run is recorded.', next_step: 'Nothing to do.', fail_closed: false,
    }, [{ at: said(S2, 'm1'), quote: 'just log every playwright run' }]);

    w.clock.set(T0 + 2 * DAY);
    const S3 = await startSession(w, 'shop', [{ id: 'm1', text: 'ship the next release' }]);
    const about = (await allEvents(w.record)).filter((e) => ['learn.proposed', 'learn.applied', 'learn.widened', 'learn.rolled_back'].includes(e.kind)
      && [RELEASE, SHIP, JOURNEYS].includes(String((e.data as { target?: unknown }).target)) && e.ts >= T0 + DAY);
    expect(about.map((e) => e.id), 'AC4 the test appends no learned change about the step specs after day 1').toEqual([]);

    const day3 = await load(w, S3);
    for (const t of [RELEASE, SHIP]) {
      expect(heldTargets(day3), `AC4 the day-3 session shows ${t} held`).toContain(t);
      expect(loadedTargets(day3), `AC4 the day-3 session leaves ${t} out`).not.toContain(t);
      const reason = day3.held.find((h) => h.target === t)?.reason ?? '';
      expect(reason, `AC4 the hold of ${t} names the rule`).toContain('no-npm-publish');
    }
    expect(loadedTargets(day3), 'AC4 the journeys step spec, which only a watch rule matches, still loads on day 3').toContain(JOURNEYS);
    expect(heldTargets(day3), 'AC4 the journeys step spec is not held').not.toContain(JOURNEYS);

    await w.record.rebuild();
    expect(canon(await load(w, S3)), 'AC4 after a rebuild the day-3 session loads exactly the same').toBe(canon(day3));
    await w.record.close();
  });
});
