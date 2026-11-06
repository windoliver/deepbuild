// #994 scope, blind redraft of the hub's end: with notifications off, an ask's deadline counts only time it was seen.
// Every wait here is counted on the hub (README beside this file): a pause is rounds of a call through the hub, and a
// default's time is the record's, on the hub's clock, so nothing leans on how soon the hub's background beat runs.
// Written blind from the issue, the design and the base commit 58862789.
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, cleanup, connectAsApp, control, openAsk, setUpWorld, sleep, startSteppingHub, type Hub, type Line } from '../helpers.ts';

/** One ceiling for a test at a load of 100; a right program ends far sooner. */
const LOAD_100_MS = 3_600_000;
afterAll(cleanup, 300_000);

const WAIT = '10m';
const WAIT_MS = 600_000;
/** openAsk raises a choice. Its notice equals its wait, so the design's two bounds on a late first showing are one time. */
const askSettings = (config: Line) => { config.asks = { ...(config.asks ?? {}), deadline: { choice: WAIT }, notice: { choice: WAIT } }; };
/** Past the deadline of an ask raised just before it, with room to spare. */
const PAST_DEADLINE_MS = WAIT_MS * 1.5;
/** Small against the wait, so a default that came too soon has a time that shows it. */
const STEP_MS = WAIT_MS / 10;
/** Longer than the 1 s beat; each round then calls through the hub's own event loop, so a slower hub gets a longer round. */
const ROUND_MS = 1100;
/** Rounds that leave a hub that wrongly takes the default the time to do it. */
const HOLD_ROUNDS = 20;
/** Rounds of stepping before an ask that hasn't taken its default fails: 24 waits of hub clock. */
const END_ROUNDS = 240;

const stepClock = async (hub: Hub, ms: number) => Number((await control(hub, (conn) => conn.call('test.clock', { advance_ms: ms }))).now);
const hubTime = (hub: Hub) => stepClock(hub, 0);
const defaulted = async (hub: Hub, ask: string) => (await allEvents(hub)).find((e) => e.kind === 'ask.defaulted' && e.subject === ask);
const milliseconds = (ts: number) => (ts > 1e14 ? Math.round(ts / 1e6) : ts);
/** What `probe` first finds in `n` rounds. */
async function inRounds<T>(n: number, probe: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let round = 0; round < n; round++) {
    await sleep(ROUND_MS);
    const found = await probe();
    if (found) return found;
  }
  return undefined;
}
/** The clock steps until the ask takes its default: it may first show late, and a late showing moves its deadline. */
const stepsToDefault = (hub: Hub, ask: string) => inRounds(END_ROUNDS, async () => {
  await stepClock(hub, STEP_MS);
  return defaulted(hub, ask);
});

describe('#994 scope: with notifications off, an ask\'s deadline counts only time it was seen', () => {
  it('#994 scope: with notifications denied, an unseen ask doesn\'t take its default past its deadline, and after allowed is reported and its wait has passed it does', async () => {
    const { repo, hub } = await setUpWorld(startSteppingHub, askSettings);
    const app = await connectAsApp(hub);
    await app.report('denied');
    const ask = await openAsk(hub, repo);
    await stepClock(hub, PAST_DEADLINE_MS);
    const early = await inRounds(HOLD_ROUNDS, () => defaulted(hub, ask.handle));
    if (early) expect.fail(`#994 ${ask.handle} was never seen, with notifications denied, so its deadline must not run out: ${JSON.stringify(early).slice(0, 400)}`);

    const allowedFrom = await hubTime(hub);
    await app.report('allowed');
    const ended = await stepsToDefault(hub, ask.handle);
    if (!ended) expect.fail(`#994 ${ask.handle}: with notifications allowed again and its wait past, it should take its default; ${END_ROUNDS} rounds passed without one`);
    const after = milliseconds(ended.ts) - allowedFrom;
    if (after < WAIT_MS) expect.fail(`#994 ${ask.handle} took its default ${after} ms of hub clock after allowed was reported; its wait is ${WAIT_MS} ms, and the time it wasn't seen doesn't count`);
    app.close();
  }, LOAD_100_MS);

  it('#994 scope (the control): with notifications allowed throughout, the same ask takes its default', async () => {
    const { repo, hub } = await setUpWorld(startSteppingHub, askSettings);
    const app = await connectAsApp(hub);
    await app.report('allowed');
    const raisedFrom = await hubTime(hub);
    const ask = await openAsk(hub, repo);
    await stepClock(hub, PAST_DEADLINE_MS);
    const ended = await stepsToDefault(hub, ask.handle);
    if (!ended) expect.fail(`#994 ${ask.handle}: allowed, it should take its default at its deadline; ${END_ROUNDS} rounds passed without one`);
    const after = milliseconds(ended.ts) - raisedFrom;
    if (after < WAIT_MS) expect.fail(`#994 ${ask.handle} took its default ${after} ms of hub clock after it was raised, before its ${WAIT_MS} ms wait`);
    app.close();
  }, LOAD_100_MS);
});
