// AC4: the third replaced attempt on an issue raises one ask, and the run goes on with its other issues.
import { expect, test } from 'vitest';
import { asksBesides, MIN, named, names, sleep, waitUntil, World } from './helpers.ts';

const STUCK = 100;
const OTHER = 101;
const SCOPE = 'work through #100 and #101 with Claude Code, one at a time';

test(named(4), async () => {
  // Every attempt on #100 ends its turn with nothing changed in its worktree, so it counts as replaced; #101 is worked.
  const w = await World.open({ issues: [{}, {}], plan: { [STUCK]: { launches: ['replaced'] } } });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  const { ask } = await w.approve(asked);

  const raised = await waitUntil(async () => (await asksBesides(w, ask)).find((e) => names(JSON.stringify(e.data), STUCK)), 30 * MIN, 2000);
  const tries = () => w.on(STUCK).map((l) => `attempt ${l.launch} ${l.agent} at ${new Date(l.started).toISOString()}`).join('; ');
  expect(raised, `three replaced attempts on #${STUCK} raise an ask naming it (attempts: ${tries()})`).toBeDefined();
  expect(w.on(STUCK).length, `the ask comes at the third replaced attempt (attempts: ${tries()})`).toBe(3);
  expect(raised!.ts, 'after the third attempt started').toBeGreaterThan(w.on(STUCK)[2]!.started);

  const went = await waitUntil(() => w.merged(OTHER) && w.state(OTHER) === 'closed', 30 * MIN, 2000);
  expect(went, `the other issue, #${OTHER}, goes on: its change lands (${w.on(OTHER).length} attempts on it)`).toBe(true);
  await sleep(60_000);
  expect(w.on(STUCK).length, `no fourth attempt starts on #${STUCK} while its ask is open (attempts: ${tries()})`).toBe(3);
  expect((await asksBesides(w, ask)).filter((e) => names(JSON.stringify(e.data), STUCK)).length, `one ask, not one per attempt, for #${STUCK}`).toBe(1);
}, 75 * MIN);
