// #2043, the agent and event lookups (README). Each line is written to a running hub's socket as a new connection's
// first line, and judged against how the same hub answers a line it has no entry for.
//
// #2043.3139319d: "A new fixture line, valid against `hook.request@3`, with agent `pi` and event `constructor`, is sent
// as a connection's first line to a running hub. The hub answers it as it answers an event the adapter doesn't map, and
// answers a `PreToolUse` line on a new connection afterwards. The hub on the merge base ends and fails this test, naming
// the line"
// #2043.630d1d3d: "Lines with agent `constructor`, `toString`, `hasOwnProperty`, `valueOf` and `__proto__` are each
// refused at `/agent` as an unknown agent is. Lines with agent `pi` or `paseo` and each of those five names as the event
// are each answered. That is 15 lines and 15 answers, and the hub's process id is unchanged"
import { readFileSync } from 'node:fs';
import { validate } from '@deepbuild/contracts';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildDeepHook, cleanup, fromHere, hookRequest, makeHome, newSession, nextSeq, startHub, ulid, type Hub, type Line } from '../16/helpers.ts';
import { answered, fate, healthNow, ID, NAMES, send, shown, swapped } from './helpers.ts';

beforeAll(() => buildDeepHook(), 600_000);
afterEach(cleanup, 60_000);

const FIXTURE_TEXT = readFileSync(new URL('./fixtures/pi-constructor.jsonl', import.meta.url), 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT) as Line;
const NAMED = `the fixture line fixtures/pi-constructor.jsonl (agent ${FIXTURE.agent}, event ${FIXTURE.event}, id ${FIXTURE.id})`;
/** An event no adapter maps, and an agent no adapter is for. */
const NO_EVENT = 'no_such_event_2047';
const NO_AGENT = 'no-such-agent-2047';

/** The fixture's line for another agent and event, with a fresh id, seq and session. */
function like(agent: string, event: string): Line {
  const id = ulid();
  return { ...FIXTURE, agent, event, id, seq: nextSeq(), payload: { ...FIXTURE.payload, session_id: `${agent}-${id}` } };
}

it(`${ID.fixture} the fixture line pi/constructor, a connection's first line, is answered as an event pi doesn't map, and a PreToolUse line on a new connection is answered afterwards`, async () => {
  expect(FIXTURE_TEXT.endsWith('\n') && FIXTURE_TEXT.indexOf('\n') === FIXTURE_TEXT.length - 1, `${NAMED} is one line`).toBe(true);
  expect(validate('hook.request@3', FIXTURE), `${NAMED} is valid against hook.request@3`).toEqual({ ok: true });
  expect([FIXTURE.agent, FIXTURE.event]).toEqual(['pi', 'constructor']);

  const home = makeHome();
  const hub: Hub = await startHub({ home });
  // How this hub answers an event pi's adapter doesn't map.
  const ref = like('pi', NO_EVENT);
  const reference = await send(hub, JSON.stringify(ref));

  const got = await send(hub, FIXTURE_TEXT);
  expect(swapped(got.lines, [[FIXTURE.id, '<id>']]), `${NAMED} is answered as pi's unmapped event ${NO_EVENT} is (${shown(reference)}); it got ${shown(got)}; ${fate(hub)}`)
    .toBe(swapped(reference.lines, [[ref.id, '<id>']]));
  expect(answered(got, FIXTURE.id), `${NAMED} is answered with an ack and a reply: ${shown(got)}; ${fate(hub)}`).toBe(true);

  const after = fromHere(hookRequest(newSession(home, 'claude-code'), 'PreToolUse'));
  const next = await send(hub, JSON.stringify(after));
  expect(answered(next, after.id), `after ${NAMED}, a PreToolUse line (id ${after.id}) on a new connection is answered: ${shown(next)}; ${fate(hub)}`).toBe(true);
}, 120_000);

it(`${ID.fifteen} agents constructor, toString, hasOwnProperty, valueOf and __proto__ are each refused at /agent as an unknown agent is; pi and paseo with each as the event are each answered; 15 lines, 15 answers, the hub's process id unchanged`, async () => {
  const home = makeHome();
  const hub: Hub = await startHub({ home });

  // How this hub refuses an agent no adapter is for, and answers each agent's unmapped event.
  const unknown = like(NO_AGENT, 'PreToolUse');
  const unknownGot = await send(hub, JSON.stringify(unknown));
  expect(unknownGot.error?.path, `the unknown agent ${NO_AGENT} is refused at /agent: ${shown(unknownGot)}`).toBe('/agent');
  const unmapped: Record<string, { id: string; lines: Line[] }> = {};
  for (const agent of ['pi', 'paseo']) {
    const line = like(agent, NO_EVENT);
    unmapped[agent] = { id: line.id, lines: (await send(hub, JSON.stringify(line))).lines };
  }

  const wrong: string[] = [];
  let answers = 0;
  for (const name of NAMES) {
    const line = like(name, 'PreToolUse');
    const got = await send(hub, JSON.stringify(line));
    if (got.end === 'reply') answers++;
    const expected = swapped(unknownGot.lines, [[unknown.id, '<id>'], [NO_AGENT, '<agent>']]);
    const actual = swapped(got.lines, [[line.id, '<id>'], [name, '<agent>']]);
    if (got.error?.path !== '/agent' || actual !== expected) wrong.push(`agent ${name} (id ${line.id}): ${shown(got)}, not refused at /agent as ${NO_AGENT} is: ${expected}`);
  }
  for (const agent of ['pi', 'paseo']) {
    for (const name of NAMES) {
      const line = like(agent, name);
      const got = await send(hub, JSON.stringify(line));
      if (got.end === 'reply') answers++;
      const expected = swapped(unmapped[agent]!.lines, [[unmapped[agent]!.id, '<id>']]);
      if (!answered(got, line.id) || swapped(got.lines, [[line.id, '<id>']]) !== expected) wrong.push(`agent ${agent}, event ${name} (id ${line.id}): ${shown(got)}, not answered as ${agent}'s ${NO_EVENT} is: ${expected}`);
    }
  }
  const after = await healthNow(hub);

  expect(wrong, `each of the 15 lines is refused or answered as the criterion says; ${fate(hub)}`).toEqual([]);
  expect(answers, `the 15 lines get 15 answers; ${fate(hub)}`).toBe(15);
  expect(typeof after === 'string' ? after : after.pid, `the hub's process id is unchanged after the 15 lines; ${fate(hub)}`).toBe(hub.pid);
}, 180_000);
