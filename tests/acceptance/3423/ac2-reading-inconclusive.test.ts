// AC2 #3423.88a9d39c: "A record whose maker is an agent and whose call says right leaves its criterion INCONCLUSIVE
// before the deadline and reads as a default after it. A planted lane that reads it as a person's call fails, naming
// the record"
//
// A scratch repository holds two records on the same pictures, both saying right: one made by an agent with a taste
// deadline, one by a person. `verdict` (README.md) gives the agent's INCONCLUSIVE with the reading as the recommended
// answer before the deadline, and reads it as a default at and after it; the person's is a PASS, so the difference is
// the maker alone. `lane` lists the agent's as a reading, never a call; a lane planted to read it as a person's call
// (README.md, Twins: agent-read-as-person) fails the second test, which names the record.
import { describe, expect, it } from 'vitest';
import { AC, PERSON, TIMEOUT, agent, entryFor, fixtureRepo, record, recordPath, reply, taste } from './helpers.ts';

const READING = recordPath(9301);
const CALL = recordPath(9302);
const DEADLINE = '2026-11-19T00:00:00Z';

function repo() {
  return fixtureRepo([{
    [READING]: record(9301, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-r'), deadline: DEADLINE }),
    [CALL]: record(9302, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: PERSON }),
  }]).dir;
}

describe(`${AC[2]} an agent's call that says right is a reading`, () => {
  it(`${AC[2]} it leaves its criterion INCONCLUSIVE before the deadline and reads as a default after it; a person's is the call`, () => {
    const dir = repo();
    const before = reply(taste(['verdict', '--root', dir, '--record', READING, '--now', '2026-11-18T12:00:00Z']), `verdict on ${READING} before its deadline`);
    expect({ verdict: before['verdict'], reads_as: before['reads_as'], recommended: before['recommended'] },
      `${READING} before its deadline ${DEADLINE}`).toEqual({ verdict: 'INCONCLUSIVE', reads_as: 'reading', recommended: 'right' });
    const after = reply(taste(['verdict', '--root', dir, '--record', READING, '--now', '2026-11-20T12:00:00Z']), `verdict on ${READING} after its deadline`);
    expect({ reads_as: after['reads_as'], recommended: after['recommended'] }, `${READING} after its deadline ${DEADLINE} reads as a default you can overrule`)
      .toEqual({ reads_as: 'default', recommended: 'right' });
    const person = reply(taste(['verdict', '--root', dir, '--record', CALL, '--now', '2026-11-18T12:00:00Z']), `verdict on ${CALL}`);
    expect({ verdict: person['verdict'], reads_as: person['reads_as'] }, `${CALL}, a person's call on the same pictures`).toEqual({ verdict: 'PASS', reads_as: 'call' });
  }, TIMEOUT);

  it(`${AC[2]} the lane reads the agent's record as a reading, not as a person's call`, () => {
    const dir = repo();
    const r = taste(['lane', '--root', dir]);
    const lane = reply(r, 'lane on the scratch repository');
    const reading = entryFor(lane, READING);
    expect({ maker: reading['maker'], reads_as: reading['reads_as'], whose: reading['whose'] },
      `the lane reads ${READING}, made by an agent, as a person's call`).toEqual({ maker: 'agent', reads_as: 'reading', whose: null });
    const call = entryFor(lane, CALL);
    expect({ maker: call['maker'], reads_as: call['reads_as'], whose: call['whose'] }, `the lane's entry for ${CALL}`).toEqual({ maker: 'person', reads_as: 'call', whose: 'person-a' });
    expect(r.status, `lane exits 0 on records that each name their maker:\n${r.out.slice(0, 1500)}`).toBe(0);
  }, TIMEOUT);
});
