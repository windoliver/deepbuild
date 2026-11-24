// #2043, a parser worker that fails on a line (README). The worker's fault is planted through the test-only variables
// the base's parser worker reads, each naming a text only the marked line carries: its id.
//
// #2043.a1a91749: "With a parser worker planted to throw on one line, that line's connection gets a refusal, the next
// 100 lines on new connections are answered, and the hub's process id is unchanged. A planted pool that listens to its
// workers for messages only ends the hub and fails this test"
// #2043.e52db1b5: "With a parser worker planted to exit while it holds a line, that line is refused and the pool holds
// the same count of workers afterwards. A planted pool that leaves the line waiting fails this test under its timeout,
// naming the line"
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildDeepHook, cleanup, fromHere, hookRequest, makeHome, newSession, startHub, ulid, type Hub } from '../16/helpers.ts';
import { answered, fate, healthNow, ID, LINE_MS, refused, send, shown } from './helpers.ts';

beforeAll(() => buildDeepHook(), 600_000);
afterEach(cleanup, 60_000);

it(`${ID.throws} a parser worker planted to throw on one line: that line's connection gets a refusal, the next 100 lines on new connections are answered, and the hub's process id is unchanged`, async () => {
  const home = makeHome();
  const session = newSession(home, 'claude-code');
  const marked = ulid();
  const hub: Hub = await startHub({ home, env: { DEEP_HUB_TEST_PARSER_THROW: marked } });

  const got = await send(hub, JSON.stringify({ ...fromHere(hookRequest(session, 'PreToolUse')), id: marked }));
  expect(refused(got), `the line ${marked}, on which the parser worker throws, gets a refusal on its connection: it got ${shown(got)}; ${fate(hub)}`).toBe(true);

  const wrong: string[] = [];
  for (let i = 1; i <= 100; i++) {
    const line = fromHere(hookRequest(session, 'PreToolUse'));
    const next = await send(hub, JSON.stringify(line));
    if (!answered(next, line.id)) wrong.push(`line ${i} (id ${line.id}): ${shown(next)}`);
  }
  const after = await healthNow(hub);
  expect(wrong, `the next 100 lines on new connections are each answered; ${fate(hub)}`).toEqual([]);
  expect(typeof after === 'string' ? after : after.pid, `the hub's process id is unchanged after the 101 lines; ${fate(hub)}`).toBe(hub.pid);
}, 240_000);

it(`${ID.exits} a parser worker planted to exit while it holds a line: that line is refused, and the pool holds the same count of workers afterwards`, async () => {
  const home = makeHome();
  const session = newSession(home, 'claude-code');
  const marked = ulid();
  const hub: Hub = await startHub({ home, env: { DEEP_HUB_TEST_PARSER_EXIT: marked } });

  const before = await healthNow(hub);
  const count = typeof before === 'string' ? before : before.parsers;
  expect(Number.isSafeInteger(count) && (count as number) >= 1, `hub.health's parsers, the count of workers the pool holds, is a whole number of at least 1 before the line: ${JSON.stringify(count)}`).toBe(true);

  const got = await send(hub, JSON.stringify({ ...fromHere(hookRequest(session, 'PreToolUse')), id: marked }));
  expect(refused(got), `the line ${marked}, held by a parser worker that exited, is refused within ${LINE_MS / 1000} s: it got ${shown(got)}; ${fate(hub)}`).toBe(true);

  const after = await healthNow(hub);
  expect(typeof after === 'string' ? after : after.parsers, `the pool holds the same count of workers after the line ${marked} as before it`).toBe(count);
}, 120_000);
