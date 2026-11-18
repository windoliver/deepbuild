// #2650 AC3: a retry of an action call 10,000 calls after the first gets the first call's result and runs nothing
// again; a retry with other input is still refused; and a planted host that forgets the request and runs it again
// fails, naming the request ID. The call is a change, as the issue's first comment says AC3's must be: a read writes
// nothing to the record, so a read retried past the bound runs again. Calls reach the host as deep-actions makes them
// once the hub's gate let them through: an agent's call, with its request ID (README, The surface under test).
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import { AC3, MINUTE } from './helpers.ts';
import { agentCall, call, done, installAndLoad, openHost, openWorld, pkg, requestId, ulid } from './host.ts';
import { judgeRetry, type Retried } from './judges.ts';

const TALLY = 'test/tally';
const ADD = 'ext.tally.add';
const LATER = 10_000;

/** The first call, 10,000 calls after it with request IDs of their own, then the retry and the retry with other input. */
async function retried(plant?: Plant): Promise<Retried> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  await installAndLoad(h, await pkg('tally'));
  const caller = agentCall(ulid());
  const request = requestId();
  const first = await call(h, TALLY, ADD, { n: 0 }, caller, request);
  expect(first.status, `the first call ran: ${JSON.stringify(first)}`).toBe('done');
  for (let i = 1; i <= LATER; i++) {
    const r = await call(h, TALLY, ADD, { n: i }, caller, requestId());
    if (r.status !== 'done') expect.fail(`call ${i} after the first wasn't run: ${JSON.stringify(r)}`);
  }
  const retry = await call(h, TALLY, ADD, { n: 0 }, caller, request);
  const other = await call(h, TALLY, ADD, { n: 1 }, caller, request);
  const runs = (await done(call(h, TALLY, 'ext.tally.runs', {}, caller, requestId()), 'how often add ran')).add as number;
  const entered = (await w.events('action.entered')).filter((e) => (e.data as { request?: unknown }).request === request).length;
  return { request, later: LATER, first, retry, other, runs, entered };
}

describe(`${AC3} A retry of an action call 10,000 calls after the first gets the first call's result and runs nothing again. A retry with other input is still refused. A planted host that forgets the request and runs it again fails, naming the request ID`, () => {
  it(`${AC3} the retry 10,000 calls after the first gets its result and runs nothing; the same ID with other input is refused`, async () => {
    const s = await retried();
    console.log(`#2650 AC3: request ${s.request}, first ${JSON.stringify(s.first)}, retry ${JSON.stringify(s.retry)}, other ${JSON.stringify(s.other)}, runs ${s.runs}, entered ${s.entered}`);
    expect(judgeRetry(s)).toEqual([]);
  }, 90 * MINUTE);

  it(`${AC3} (wrong program) forgets-request-runs-again, a host that forgets the request and runs it again, fails, naming the request ID`, async () => {
    const s = await retried('forgets-request-runs-again');
    const problems = judgeRetry(s);
    expect(problems.length, `the planted host's retry ran again or got another result: ${JSON.stringify(s)}`).toBeGreaterThan(0);
    for (const problem of problems) expect(problem, 'each problem names the request ID').toContain(s.request);
  }, 90 * MINUTE);
});
