// AC24: loop facts from the session's own tool calls, in a dynamic `/loop` session (no interval: the agent paces
// itself with ScheduleWakeup, as the /loop skill of Claude Code 2.1.304 tells it to: `delaySeconds`, `reason`,
// `prompt` and `noop`). The session, through deep-hook into `deep hub run`:
//   turn 1  you type `/loop check the build`; the agent schedules a wake-up in 60 s and stops
//   turn 2  the wake-up's prompt (its transcript entry: turnOrigin scheduled); a build, another wake-up in 60 s, stop
//   turn 3  the next wake-up's prompt; the build is green, the agent schedules none and stops
//   turn 4  you ask for a background subagent; the agent starts one (Agent, run in the background) and stops
//   turn 5  the subagent's report arrives as a prompt (its entry: origin.handback); the agent stops
// Each stop's loop reading is on its agent.stop, `data.loop`: `{ state: 'looping', due }` with `due` the time its next
// prompt is due in ms since the epoch, or null while it waits on a background subagent's report; `{ state:
// 'none_left' }` for a loop turn that ended with nothing scheduled or running. The stop's own time is its `ts`.
import { afterAll, describe, expect, it } from 'vitest';
import { AC24, cleanup, failureOf, kindOf, makeHome, Session, settle, shown, startHub, type Ev, type Hub } from './helpers.ts';

afterAll(cleanup, 60_000);

const LOOP = '/loop check the build';
const REPORT = '<agent-message from="a2711031fe8c87e48">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:\n  The flaky cart test passed 20 times in a row.\n</agent-message>';
/** How far a due time may sit from its stop plus the delay: the wake-up is scheduled a moment before the stop. */
const SLACK_MS = 5000;

async function wakeUp(s: Session): Promise<void> {
  await s.call('ScheduleWakeup', { delaySeconds: 60, reason: 'The build takes about a minute.', prompt: LOOP, noop: false }, { response: 'Wakeup scheduled.' });
}
async function dynamicLoop(hub: Hub): Promise<{ s: Session; stops: Ev[]; asks: Ev[] }> {
  const s = new Session(hub.home);
  await s.start();
  await s.prompt(LOOP, 'human');
  await wakeUp(s);
  await s.stop('Self-pacing: the build is running, I will look again in 60 s.');
  await s.prompt(LOOP, 'scheduled');
  await s.call('Bash', { command: 'npm run build', description: 'Build' }, { response: { stdout: 'building…', stderr: '', interrupted: false, isImage: false } });
  await wakeUp(s);
  await s.stop('Still building; next look in 60 s.');
  await s.prompt(LOOP, 'scheduled');
  await s.call('Bash', { command: 'npm run build', description: 'Build' }, { response: { stdout: 'built in 41 s', stderr: '', interrupted: false, isImage: false } });
  await s.stop('The build is green. The loop is done.');
  await s.prompt('Start a background subagent that runs the cart tests 20 times, and tell me when it reports.', 'human');
  await s.call('Agent', { description: 'Run the cart tests 20 times', prompt: 'Run npm test -- cart 20 times and report.', subagent_type: 'general-purpose', run_in_background: true }, {
    response: { isAsync: true, status: 'async_launched', agentId: 'a2711031fe8c87e48', description: 'Run the cart tests 20 times', prompt: 'Run npm test -- cart 20 times and report.' },
  });
  await s.stop('I started a subagent in the background; I will report when it finishes.');
  await s.prompt(REPORT, 'handback');
  await s.stop('The subagent reports the cart test passed 20 times in a row.');
  const events = await settle(hub, (all) => kindOf(all, s.id, 'agent.stop').length >= 5 && kindOf(all, s.id, 'agent.stop').every((e) => e.data.loop !== undefined), { minMs: 3000, timeoutMs: 45_000 });
  return { s, stops: kindOf(events, s.id, 'agent.stop'), asks: kindOf(events, s.id, 'user.ask') };
}

/** The loop readings the test and its wrong program share, each naming the turn it reads. */
function loopReadings(stops: Ev[]): void {
  expect(stops.length, `the five turns' stops are recorded: ${stops.map(shown).join('; ')}`).toBe(5);
  const at = (turn: number) => stops[turn - 1]!;
  // The loop's last wake-up turn first: it is the one a reader of prompt origins alone gets wrong.
  expect(at(3).data.loop?.state, `turn 3 started from a wake-up and scheduled none, so it reads as a loop with none left: ${shown(at(3))}`).toBe('none_left');
  for (const turn of [1, 2]) {
    const stop = at(turn);
    expect(stop.data.loop?.state, `turn ${turn} scheduled a wake-up in 60 s, so its stop reads looping: ${shown(stop)}`).toBe('looping');
    expect(typeof stop.data.loop.due, `turn ${turn}'s next prompt has a due time: ${shown(stop)}`).toBe('number');
    expect(Math.abs(stop.data.loop.due - (stop.ts + 60_000)), `turn ${turn}'s next prompt is due 60 s after its stop (${stop.ts}): ${shown(stop)}`).toBeLessThanOrEqual(SLACK_MS);
  }
  expect(at(4).data.loop?.state, `turn 4 started a background subagent, so it reads looping until the report: ${shown(at(4))}`).toBe('looping');
  expect(at(4).data.loop.due, `turn 4 waits on the subagent's report, not on a time: ${shown(at(4))}`).toBeNull();
  expect(at(5).data.loop?.state, `turn 5 handled the report with nothing left running, so it reads as a loop with none left: ${shown(at(5))}`).toBe('none_left');
}
function origins(asks: Ev[]): void {
  expect(asks.map((e) => e.data.from), `the prompts' origins, turn by turn: ${asks.map(shown).join('; ')}`).toEqual(['person', 'scheduled', 'scheduled', 'person', 'subagent']);
}

describe(`${AC24} a dynamic /loop session's loop state comes from its own tool calls`, () => {
  it(`${AC24} wake-up turns read looping with the next prompt due 60 s after the stop, each wake-up's prompt is scheduled, the turn that schedules none reads none left, and a background subagent keeps it looping until its report arrives as subagent`, async () => {
    const hub = await startHub(makeHome());
    const { stops, asks } = await dynamicLoop(hub);
    origins(asks);
    loopReadings(stops);
  }, 180_000);

  it(`${AC24} (wrong program) an adapter that reads loop state from prompt origins alone (DEEP_HUB_PLANT=loop-from-origins) reads the last wake-up turn as looping and fails this test, naming the turn`, async () => {
    const hub = await startHub(makeHome(), 'loop-from-origins');
    const { stops, asks } = await dynamicLoop(hub);
    origins(asks);
    const failure = await failureOf(() => loopReadings(stops));
    expect(failure, 'the planted adapter must fail the loop readings').not.toBeNull();
    expect(failure, 'the failure names the turn').toMatch(/turn 3\b/);
    expect(stops[2]?.data.loop?.state, `the plant reads turn 3, a scheduled prompt's turn, as looping: ${shown(stops[2])}`).toBe('looping');
  }, 180_000);
});
