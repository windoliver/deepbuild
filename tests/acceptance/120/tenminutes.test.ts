// AC7 #120.557a037b: a turn or wait that runs 10 minutes without a line you can read gets one at its next hook after
// each 10 minutes: the ask, the step, the time so far and the time left; in the Claude Code terminal, through the route
// #80 found, it also gets one every 10 minutes while a single call still runs. A planted line that waits for the turn's
// stop shows none during a 25-minute turn of short calls and fails this test.
//
// Time moves on with the hub's test clock (README: Time): a 25-minute turn of short calls is a turn whose hooks come
// at hub times 0, 10.5, 21 and 25 minutes. A line is the reply's `systemMessage`, what the chat shows. The planted
// wrong program is `DEEP_HUB_PLANT=line-at-stop` (README: Open interfaces): a hub that only speaks at the turn's stop.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC7, awaitEvent, bash, begin, cleanup, firedShown, hasDuration, hubWithSetup, lineOf, makeHome, MINUTE, moveOn, newSession, notificationAfter, ran, stop, waitFor, type Fired,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'line-at-stop';
const ASK = 'Run the full e2e suite and fix what fails.';
const shard = (n: number) => bash(`npm run e2e -- --shard ${n}`);
const minutesIn = (line: string | undefined) => `${JSON.stringify(line)}`;

/** The line at a hook after 10 minutes: the ask, the step, the time so far and the time left. */
function tenMinuteLine(ac: string, line: string | undefined, fired: Fired, at: string, step: string): void {
  expect(line, `${ac} ${at}: the hook's reply carries a line you can read (systemMessage); it carried ${firedShown(fired)}`).toBeDefined();
  expect(line, `${ac} ${at}: the line names the ask (${JSON.stringify(ASK)}): ${minutesIn(line)}`).toMatch(/e2e suite|fix what fails/i);
  expect(line, `${ac} ${at}: the line names the step (the running command, ${step}): ${minutesIn(line)}`).toContain(step);
  expect(hasDuration(line), `${ac} ${at}: the line says the time so far (a duration): ${minutesIn(line)}`).toBe(true);
  expect(line, `${ac} ${at}: the line says the time left: ${minutesIn(line)}`).toMatch(/left|remain/i);
}

/** The 25-minute turn of short calls; `plant` selects the planted hub. */
async function turnOfShortCalls(plant?: string): Promise<void> {
  const h = makeHome();
  let hub = await hubWithSetup(h, { plant });
  const s = newSession(h);
  const { claude } = await begin(h, s, ASK, plant ? { DEEP_HUB_PLANT: plant } : {});
  const first = await claude.open(s, 'Bash', shard(1));
  await claude.close(s, first.call, 'Bash', shard(1), ran('shard 1 passed'));
  await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === first.call, 'shard 1\'s tool.after');
  // 10.5 minutes into the turn with no line yet: the next hook gets one.
  hub = await moveOn(hub, 10.5 * MINUTE);
  const second = await claude.open(s, 'Bash', shard(2));
  tenMinuteLine(AC7, lineOf(second.fired), second.fired, 'the hook 10.5 minutes into the turn', 'shard 2');
  await claude.close(s, second.call, 'Bash', shard(2), ran('shard 2 passed'));
  await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === second.call, 'shard 2\'s tool.after');
  // 21 minutes in, 10.5 after the last line: another.
  hub = await moveOn(hub, 10.5 * MINUTE);
  const third = await claude.open(s, 'Bash', shard(3));
  tenMinuteLine(AC7, lineOf(third.fired), third.fired, 'the hook 21 minutes into the turn', 'shard 3');
  await claude.close(s, third.call, 'Bash', shard(3), ran('shard 3 passed'));
  await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === third.call, 'shard 3\'s tool.after');
  // 25 minutes in, 4 after the last line: none (one after each 10 minutes, not at every hook).
  hub = await moveOn(hub, 4 * MINUTE);
  const fourth = await claude.open(s, 'Bash', shard(4));
  expect(lineOf(fourth.fired), `${AC7} the hook 25 minutes in, 4 minutes after the last line, carries no new 10-minute line: ${firedShown(fourth.fired)}`).toBeUndefined();
  await claude.close(s, fourth.call, 'Bash', shard(4), ran('shard 4 passed'));
  await stop(claude, s, 'All four shards pass.');
  await claude.end();
}

describe(`${AC7} A turn or wait that runs 10 minutes without a line you can read gets one at its next hook after each 10 minutes: the ask, the step, the time so far and the time left; in the Claude Code terminal, through the route #80 found, it also gets one every 10 minutes while a single call still runs. A planted line that waits for the turn's stop shows none during a 25-minute turn of short calls and fails this test`, () => {
  it(`${AC7} a 25-minute turn of short calls gets a line at its next hook after 10 and after 20 minutes (the ask, the step, the time so far, the time left) and none 4 minutes after the last`, async () => {
    await turnOfShortCalls();
  }, 180_000);

  it(`${AC7} a single call still running gets a FileChanged notification after each 10 minutes it runs`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, ASK);
    const { call } = await claude.open(s, 'Bash', bash('npm run e2e'));
    await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === call, 'the call\'s tool.before');
    for (const minutes of [10.5, 21]) {
      const before = Date.now();
      hub = await moveOn(hub, 10.5 * MINUTE);
      const notice = await waitFor(() => notificationAfter(claude, before), 15_000, `the notification ${minutes} minutes in`).catch(() => undefined);
      expect(notice, `${AC7} ${minutes} minutes into the call a FileChanged hook's reply carries a line (systemMessage); FileChanged hooks fired: ${JSON.stringify(claude.fileChanges.map((f) => ({ path: f.path, shown: f.fired?.shown })))}`).toBeDefined();
      const line = notice!.fired!.shown![0]!;
      expect(line, `${AC7} the notification names the call (npm run e2e): ${JSON.stringify(line)}`).toMatch(/e2e|Bash/);
      expect(hasDuration(line), `${AC7} the notification says how long it has run: ${JSON.stringify(line)}`).toBe(true);
    }
    await claude.close(s, call, 'Bash', bash('npm run e2e'), ran('passed'));
    await claude.end();
  }, 180_000);

  it(`${AC7} (wrong program) a planted line that waits for the turn's stop (DEEP_HUB_PLANT=${PLANT}) shows none during the 25-minute turn and fails this test at its first 10-minute hook`, async () => {
    let failure = '';
    try { await turnOfShortCalls(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `${AC7} the 25-minute turn must fail on ${PLANT} at the hook 10.5 minutes in, with no line`).toMatch(/the hook 10\.5 minutes into the turn: the hook's reply carries a line you can read/);
  }, 180_000);
});
