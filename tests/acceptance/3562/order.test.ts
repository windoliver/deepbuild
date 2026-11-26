// #3562 AC3: three sessions stop green one after another while a journey runs, each with one slow check. The three
// start in the order they stopped, in each of 20 runs. A host that gives a freed slot to whichever waiting run asks
// next fails, naming the check that started out of turn.
//
// Through a running hub (`deep hub run`, two check slots, a stepped clock), the real deep-hook and Claude Code
// payloads (README). One hub and four sessions make all 20 runs. A run: the first session's turn ends green and its
// journey starts; the second, third and fourth sessions each change src/cart.ts and stop green, one after another,
// each stop's fast lane ended and its reply in (or 30 s waited for it) before the next; then the test ends the first
// session's journey, and each journey that starts, one at a time, so each freed slot goes to one waiting check. Slow
// runs hold one of the two slots (#907), so the three start one by one, and the order is read at each start.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC3, allEvents, begin, blocked, cleanup, endRun, finishedOf, journeyRunning, judged, replied, repliedLate, SECOND, settle, shown, START_WAIT_MS, stop, stopHub,
  turn, type Ev, type Judged, type Play, type Player, type Sent,
} from './helpers.ts';
import { outOfTurn } from './readings.ts';

afterEach(cleanup, 60_000);

const RUNS = 20;
/** How long the 20 runs may take before the test gives up, naming how many it made: under its own limit, so it never ends as a bare timeout. */
const BUDGET_MS = 3_600_000;

interface Stopped { p: Player; sent: Sent; stop: Judged; inTime: boolean }

/** One run of the criterion's scenario on the hub: it ends at the first check that starts out of turn. */
async function oneRun(play: Play, run: number): Promise<void> {
  const [first, ...three] = play.players;
  const of = `run ${run} of ${RUNS}`;
  // A journey runs.
  const going = await journeyRunning(play, first!);
  // Three sessions stop green one after another, each with one slow check.
  const stopped: Stopped[] = [];
  for (const p of three) {
    await turn(p);
    const sent = stop(p);
    const judgedStop = await judged(play, sent);
    stopped.push({ p, sent, stop: judgedStop, inTime: (await replied(sent)) !== undefined });
  }
  const claims = new Set(stopped.map((s) => s.stop.claim));
  const starts = (e: readonly Ev[]): Ev[] => e.filter((x) => x.kind === 'run.started' && x.data.lane === 'slow' && claims.has(String(x.data.claim)));
  let events = await allEvents(play.hub);
  if (finishedOf(events, going.run)) blocked(`${of}: the first session's journey ended while the three sessions stopped, though this test had not ended it; ${shown(going.run)}`);
  // A reply that came with its line, but only after the next session had stopped, leaves the stops in no order this run can vouch for.
  const slow = stopped.find((s) => repliedLate(s.sent, s.inTime));
  if (slow) blocked(`${of}: the ${slow.p.name} session's reply came more than 30 s after its fast lane ended, after the next session had stopped, so the three did not stop one after another on this machine; this run says nothing`);
  expect(starts(events).map((x) => shown(x)), `${of}: the first session's journey still holds the one slot slow runs may hold, so none of the three waiting checks may have started`).toEqual([]);

  // Each freed slot goes to the check that stopped first among those still waiting.
  const waiting = stopped.map((s) => ({ journey: s.p.journey, claim: s.stop.claim }));
  let running = going.run;
  for (let n = 0; n < stopped.length; n++) {
    endRun(running);
    events = await settle(play.hub, (e) => starts(e).length > n, START_WAIT_MS);
    expect(outOfTurn(waiting, starts(events), n), `${of}, ${START_WAIT_MS / SECOND} s at most after the slot freed`).toBeUndefined();
    running = starts(events)[n]!;
  }
  // The last journey ends too, and every Stop hook is back, so the next run starts with every slot free.
  endRun(running);
  events = await settle(play.hub, (e) => finishedOf(e, running) !== undefined, START_WAIT_MS);
  if (!finishedOf(events, running)) blocked(`${of}: ${String(running.data.check)} did not end within ${START_WAIT_MS / SECOND} s of this test ending it`);
  await Promise.all(stopped.map((s) => s.sent.hook));
  console.log(`AC3 ${of}: stopped ${stopped.map((s) => `${s.p.journey} at ${s.sent.at}${s.inTime ? '' : ' (no reply within 30 s of its fast lane)'}`).join(', ')}; started ${starts(events).map((x) => shown(x)).join('; ')}`);
}

describe(`${AC3} places start in the order the queue holds them`, () => {
  it(`${AC3} three sessions stop green one after another while a journey runs, each with one slow check: the three start in the order they stopped, in each of ${RUNS} runs`, async () => {
    const play = await begin(['first', 'second', 'third', 'fourth']);
    try {
      // deadline: bounds the whole test under its own limit, so a machine too slow for 20 runs is named, never a bare timeout
      const endBy = Date.now() + BUDGET_MS;
      let made = 0;
      for (let run = 1; run <= RUNS; run++) {
        if (Date.now() > endBy) blocked(`${made} of ${RUNS} runs were made in ${BUDGET_MS / 60_000} minutes on this machine, each in order; the criterion asks for ${RUNS}, so this run says nothing`);
        await oneRun(play, run);
        made += 1;
      }
      expect(made, `all ${RUNS} runs were made, each with the three checks started in the order their sessions stopped`).toBe(RUNS);
    } finally {
      await stopHub(play.hub);
    }
  }, 5_400_000);
});
