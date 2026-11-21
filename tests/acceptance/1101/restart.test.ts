// AC4 (#1101.96f7bd58): With the hub stopped at 4 s into a hold and started again, the push hasn't run and its ask is
// open. A planted hub that runs held steps on restart fails, naming the step.
//
// A real hub on its test clock holds the agent's `git push origin main`; it is allowed on its card, and the agent runs
// the same call again right after the yes. At 4 s on the hub's clock the hub is stopped (SIGTERM to its PID) and started
// again on the same home, its clock going on from there. Then the record, the inbox and the card are read, the agent
// runs the call again, and again once the clock is past where the hold would have ended (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, cleanup, clock, held, hubLists, ID, inconclusive, MINUTE, openOnCard, PLANT, PUSH, ranTries, remoteHas, restart, SECOND,
  settleTries, stepTo, stopHub, world, type World,
} from './helpers.ts';

const worlds: World[] = [];
/** The push allowed, the hub stopped at 4 s and started again (with `plant` given to the hub when it lists it): the failures. */
async function stoppedAt4(plant?: string): Promise<{ step: string; failures: string[] }> {
  const w = await world(plant ? { plant } : {});
  worlds.push(w);
  const a = await Agent.start(w);
  const h = await held(w, a, PUSH);
  const start = (await allowOnCard(w, h)).ts;
  const step = `the step \`${PUSH.command}\` (${h.ask})`;
  await attempt(w, a, PUSH);
  if ((await clock(w)) >= start + 9 * SECOND) inconclusive(`the hub's clock was past 9 s into the hold of ${step} before it could be stopped at 4 s`);
  const stoppedAt = await stepTo(w, start + 4 * SECOND);
  await restart(w);
  const failures: string[] = [];
  const open = await openOnCard(w, h.ask);
  if (open) failures.push(`${step}: its ask isn't open after the hub started again: ${open}`);
  // The agent runs the same call again once the hub is back, and again past where the hold would have ended.
  await attempt(w, a, PUSH);
  await stepTo(w, start + 12 * SECOND);
  await attempt(w, a, PUSH);
  await settleTries(w, 20 * SECOND);
  for (const t of ranTries(w, PUSH)) failures.push(`${step} ran ${((t.at - start) / 1000).toFixed(1)} s after its yes, ${t.at < stoppedAt ? 'inside its hold, before the hub stopped at 4 s' : 'after the hub, stopped at 4 s into its hold, started again'}`);
  if (!ranTries(w, PUSH).length && await remoteHas(w, 'main')) failures.push(`${step}: a git process pushed main to origin though the hub was stopped at 4 s into its hold`);
  return { step: PUSH.command, failures };
}

let clean: ReturnType<typeof stoppedAt4> | undefined;
const cleanRun = (): ReturnType<typeof stoppedAt4> => (clean ??= stoppedAt4());

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC4 ${ID.restart}`, () => {
  it(`${ID.restart} with the hub stopped at 4 s into a hold and started again, the push hasn't run and its ask is open`, async () => {
    const { failures } = await cleanRun();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.restart} a planted hub that runs held steps on restart (${PLANT.runsOnRestart}) fails, naming the step`, async () => {
    const { failures } = await cleanRun();
    expect(failures, `the clean restart already fails, so the plant can't be told from it: ${failures.join('\n')}`).toEqual([]);
    const caught = await stoppedAt4(PLANT.runsOnRestart);
    expect(caught.failures.filter((f) => f.includes(`\`${caught.step}\``) && / ran /.test(f)), `the hub that runs held steps on restart wasn't caught, naming \`${caught.step}\` (${hubLists(PLANT.runsOnRestart) ? 'the hub lists the plant' : 'the hub doesn\'t list the plant'}): ${JSON.stringify(caught.failures)}`).not.toEqual([]);
  }, 180 * MINUTE);
});
