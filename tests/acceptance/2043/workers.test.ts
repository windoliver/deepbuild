// #2043 AC3 and AC4: a parser worker that throws on a line, or ends while it holds one, costs that line a refusal and
// nothing more; the hub runs on and its pool keeps its workers. The worker's fault is planted through a test-only
// variable, the wrong pools through DEEP_HUB_PLANT (README, Surface choices).
//
// #2043.d1e23f18: "With a parser worker planted to throw on one line, that line's connection gets a refusal, the next
// 100 lines on new connections are answered, and the hub's process id is unchanged. A planted pool that listens to its
// workers for messages only ends the hub and fails this test"
// #2043.43f43d35: "With a parser worker planted to exit while it holds a line, that line is refused and the pool holds
// the same count of workers afterwards. A planted pool that leaves the line waiting fails this test under its timeout,
// naming the line"
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildDeepHook, cleanup, control, fromHere, health, hookRequest, makeHome, newSession, sleep, startHub, ulid, type Hub, type Session } from '../16/helpers.ts';
import { exchange, fate, ID, isAnswer, isRefusal, must, pidNow, shown } from './helpers.ts';

beforeAll(() => buildDeepHook(), 600_000);
afterEach(cleanup, 60_000);

/** How long a line waits for its refusal, and the pool for its count, before the judge fails. */
const WAIT_MS = 10_000;

/** A PreToolUse line whose ID the planted worker's variable names, so it alone carries the marker. */
function markedLine(): { session: Session; id: string; home: string } {
  const home = makeHome();
  return { home, session: newSession(home, 'claude-code'), id: ulid() };
}
const lineOf = (session: Session, id: string) => ({ ...fromHere(hookRequest(session, 'PreToolUse')), id });

/** AC3's judge on a hub whose parser worker throws on the line `id`. */
async function judgeThrow(hub: Hub, session: Session, id: string): Promise<void> {
  const got = await exchange(hub.socket, JSON.stringify(lineOf(session, id)), WAIT_MS);
  await must(isRefusal(got), async () => `the line ${id}, on which the parser worker throws, gets a refusal on its connection: it got ${shown(got)}; ${await fate(hub)}`);
  const wrong: string[] = [];
  for (let i = 0; i < 100; i++) {
    const line = fromHere(hookRequest(session, 'PreToolUse'));
    const next = await exchange(hub.socket, JSON.stringify(line), WAIT_MS);
    if (!isAnswer(next, line.id)) wrong.push(`line ${i + 1} (id ${line.id}): ${shown(next)}`);
  }
  await must(wrong.length === 0, async () => `the next 100 lines on new connections are answered: ${wrong.length} weren't:\n${wrong.slice(0, 5).join('\n')}\n${await fate(hub)}`);
  const pid = await pidNow(hub);
  await must(pid === hub.pid, async () => `the hub's process id is unchanged (${hub.pid}): hub.health after the 101 lines reads ${pid}; ${await fate(hub)}`);
}

/** AC4's judge on a hub whose parser worker exits while it holds the line `id`. */
async function judgeExit(hub: Hub, session: Session, id: string): Promise<void> {
  const cli = await control(hub);
  const before = (await health(cli)).parsers as unknown;
  const got = await exchange(hub.socket, JSON.stringify(lineOf(session, id)), WAIT_MS);
  await must(isRefusal(got), async () => `the line ${id}, held by a parser worker that exited, is refused within ${WAIT_MS / 1000} s: it got ${shown(got)}; ${await fate(hub, 0)}`);
  expect(Number.isSafeInteger(before) && (before as number) >= 1, `hub.health's parsers, the count of workers the pool holds, reads a whole number of at least 1 before the line: ${JSON.stringify(before)}`).toBe(true);
  // The replacement may still be starting as the refusal goes out: the count is read again until it is back, or the time is up.
  let after: unknown;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try { after = (await health(cli)).parsers; } catch (error) { after = `no hub.health (${(error as Error).message})`; }
    if (after === before || Date.now() > deadline) break;
    await sleep(100);
  }
  cli.close();
  expect(after, `the pool holds the same count of workers after the line ${id} as before it (${String(before)}); within ${WAIT_MS / 1000} s hub.health's parsers read ${JSON.stringify(after)}`).toBe(before);
}

it(`${ID.ac3} AC3 a parser worker that throws on one line: that line's connection gets a refusal, the next 100 lines on new connections are answered, and the hub's process id is unchanged`, async () => {
  const { home, session, id } = markedLine();
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_PARSER_THROW: id } });
  await judgeThrow(hub, session, id);
}, 180_000);

it(`${ID.ac3} AC3 (wrong program) a pool that listens to its workers for messages only ends the hub and fails this test`, async () => {
  const { home, session, id } = markedLine();
  const hub = await startHub({ home, plant: 'parser-pool-messages-only', env: { DEEP_HUB_TEST_PARSER_THROW: id } });
  await expect(judgeThrow(hub, session, id)).rejects.toThrow(/gets a refusal on its connection/);
  const exit = await Promise.race([hub.proc.exit, sleep(WAIT_MS).then(() => undefined)]);
  expect(exit, `the planted pool ends the hub's process ${hub.pid}`).toBeDefined();
}, 180_000);

it(`${ID.ac4} AC4 a parser worker that exits while it holds a line: that line is refused, and the pool holds the same count of workers afterwards`, async () => {
  const { home, session, id } = markedLine();
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_PARSER_EXIT: id } });
  await judgeExit(hub, session, id);
}, 120_000);

it(`${ID.ac4} AC4 (wrong program) a pool that leaves the line waiting fails this test under its timeout, naming the line`, async () => {
  const { home, session, id } = markedLine();
  const hub = await startHub({ home, plant: 'parser-pool-leaves-line-waiting', env: { DEEP_HUB_TEST_PARSER_EXIT: id } });
  await expect(judgeExit(hub, session, id)).rejects.toThrow(new RegExp(`the line ${id}, held by a parser worker that exited, is refused within 10 s: .*still waiting at the timeout`));
}, 120_000);
