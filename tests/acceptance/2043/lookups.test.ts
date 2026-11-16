// #2043 AC1 and AC2: a hook line whose agent or event is a name every object has is refused or answered as any other
// unknown agent or unmapped event is, and the hub runs on. Each line goes to a running hub's socket as a new
// connection's first line (README, The surface under test).
//
// #2043.cbf38aec: "A new fixture line, valid against `hook.request@3`, with agent `pi` and event `constructor`, is sent
// as a connection's first line to a running hub. The hub answers it as it answers an event the adapter doesn't map, and
// answers a `PreToolUse` line on a new connection afterwards. The hub on the merge base ends and fails this test, naming
// the line"
// #2043.ccd54552: "Lines with agent `constructor`, `toString`, `hasOwnProperty`, `valueOf` and `__proto__` are each
// refused at `/agent` as an unknown agent is. Lines with agent `pi` or `paseo` and each of those five names as the event
// are each answered. That is 15 lines and 15 answers, and the hub's process id is unchanged"
import { readFileSync } from 'node:fs';
import { validate } from '@deepbuild/contracts';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildDeepHook, cleanup, fromHere, hookRequest, makeHome, newSession, nextSeq, startHub, ulid, type Hub, type Line } from '../16/helpers.ts';
import { alike, exchange, fate, ID, isAnswer, isRefusal, must, NAMES, pidNow, shown, type Exchange } from './helpers.ts';

beforeAll(() => buildDeepHook(), 600_000);
afterEach(cleanup, 60_000);

/** AC1's fixture: one hook.request@3 line, agent pi, event constructor. */
const FIXTURE_FILE = new URL('./fixtures/pi-constructor.jsonl', import.meta.url);
const FIXTURE_TEXT = readFileSync(FIXTURE_FILE, 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT) as Line;
const NAMED = `fixtures/pi-constructor.jsonl (agent ${FIXTURE.agent}, event ${FIXTURE.event}, id ${FIXTURE.id})`;
/** An event name no adapter's facts map. */
const UNMAPPED = 'no_such_event';
/** An agent name no adapter maps. */
const UNKNOWN = 'no-such-agent';

/** The fixture's line for another agent and event: a new ID, seq and session, its payload otherwise as written. */
function lineFrom(agent: string, event: string): Line {
  const id = ulid();
  return { ...FIXTURE, agent, event, id, seq: nextSeq(), payload: { ...FIXTURE.payload, session_id: `${agent}-${id}` } };
}
/** How the hub answers an event the agent's adapter doesn't map: the judge's reference, read on the same hub. */
async function unmapped(hub: Hub, agent: string): Promise<{ id: string; got: Exchange }> {
  const line = lineFrom(agent, UNMAPPED);
  const got = await exchange(hub.socket, JSON.stringify(line));
  if (!isAnswer(got, line.id as string)) throw Error(`BLOCKED: the hub doesn't answer ${agent}'s unmapped event ${UNMAPPED} with an ack and a reply, so there is nothing to judge against: ${shown(got)}`);
  return { id: line.id as string, got };
}
/** How the hub refuses an agent no adapter maps: the judge's reference, read on the same hub. */
async function unknownAgent(hub: Hub, home: string): Promise<{ id: string; got: Exchange; line: Line }> {
  const line = fromHere(hookRequest(newSession(home, 'claude-code'), 'PreToolUse')) as unknown as Line;
  line.agent = UNKNOWN;
  const got = await exchange(hub.socket, JSON.stringify(line));
  const error = got.lines.find((l) => 'error' in l)?.error as Line | undefined;
  if (!isRefusal(got) || error?.path !== '/agent') throw Error(`BLOCKED: the hub doesn't refuse the unknown agent ${UNKNOWN} at /agent, so there is nothing to judge against: ${shown(got)}`);
  return { id: line.id as string, got, line };
}

it(`${ID.ac1} AC1 the fixture line pi/constructor, a connection's first line, is answered as an event pi doesn't map, and a PreToolUse line on a new connection is answered afterwards`, async () => {
  expect(FIXTURE_TEXT.indexOf('\n'), `${NAMED} is one line, ending in a newline`).toBe(FIXTURE_TEXT.length - 1);
  expect(validate('hook.request@3', FIXTURE), `${NAMED} is valid against hook.request@3`).toEqual({ ok: true });
  expect([FIXTURE.agent, FIXTURE.event], `${NAMED} names agent pi and event constructor`).toEqual(['pi', 'constructor']);

  const home = makeHome();
  const hub = await startHub({ home });
  const reference = await unmapped(hub, 'pi');

  const got = await exchange(hub.socket, FIXTURE_TEXT);
  const expected = alike(reference.got, [[reference.id, FIXTURE.id as string]]);
  await must(JSON.stringify([got.lines, got.closed]) === JSON.stringify([expected.lines, expected.closed]), async () =>
    `the hub answers the line ${NAMED} as it answers pi's unmapped event ${UNMAPPED} (${shown(expected)}): it sent ${shown(got)}; ${await fate(hub)}`);

  const after = fromHere(hookRequest(newSession(home, 'claude-code'), 'PreToolUse'));
  const next = await exchange(hub.socket, JSON.stringify(after));
  await must(isAnswer(next, after.id), async () =>
    `after the line ${NAMED}, the PreToolUse line ${after.id} on a new connection is answered with its ack and a reply: it got ${shown(next)}; ${await fate(hub)}`);
}, 120_000);

it(`${ID.ac2} AC2 agents constructor, toString, hasOwnProperty, valueOf and __proto__ are each refused at /agent as an unknown agent is; pi and paseo with each as the event are each answered: 15 lines, 15 answers, the hub's process id unchanged`, async () => {
  const home = makeHome();
  const hub = await startHub({ home });
  const refused = await unknownAgent(hub, home);
  const mapped = { pi: await unmapped(hub, 'pi'), paseo: await unmapped(hub, 'paseo') };

  const lines: Array<{ label: string; line: Line; expected: Exchange }> = [];
  for (const name of NAMES) {
    const line = { ...refused.line, agent: name, id: ulid(), seq: nextSeq() };
    lines.push({ label: `agent ${name}`, line, expected: alike(refused.got, [[refused.id, line.id], [UNKNOWN, name]]) });
  }
  for (const agent of ['pi', 'paseo'] as const) {
    for (const name of NAMES) {
      const line = lineFrom(agent, name);
      lines.push({ label: `agent ${agent}, event ${name}`, line, expected: alike(mapped[agent].got, [[mapped[agent].id, line.id as string]]) });
    }
  }
  expect(lines.length, 'the criterion\'s 15 lines').toBe(15);

  const wrong: string[] = [];
  let answers = 0;
  for (const { label, line, expected } of lines) {
    const got = await exchange(hub.socket, JSON.stringify(line));
    if (got.end === 'answered') answers++;
    if (JSON.stringify([got.lines, got.closed]) !== JSON.stringify([expected.lines, expected.closed])) {
      wrong.push(`${label} (id ${line.id}): expected ${shown(expected)}, got ${shown(got)}`);
    }
  }
  const pid = await pidNow(hub);
  console.log(`AC2 ${answers} answers to 15 lines; hub.health's pid after them: ${pid} (the hub started as ${hub.pid})`);
  await must(wrong.length === 0, async () =>
    `each line is refused as the unknown agent ${UNKNOWN} is, or answered as its agent's unmapped event ${UNMAPPED} is; ${wrong.length} of 15 weren't:\n${wrong.join('\n')}\n${await fate(hub)}`);
  expect(answers, 'the 15 lines got 15 answers').toBe(15);
  await must(pid === hub.pid, async () => `the hub's process id is unchanged (${hub.pid}): hub.health after the 15 lines reads ${pid}; ${await fate(hub)}`);
}, 180_000);
