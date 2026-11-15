// #2399 AC3: #1106's third criterion runs unchanged and passes, and each of its three attempts sent a second time
// leaves the count of events as it was. A planted supervisor that records no refusal from the filter fails #1106's
// criterion, naming the placement. #1106's criterion is its own test, tests/acceptance/1106/refusals.test.ts, run
// as that file has it in a Vitest of its own (helpers.ts, run1106). The second sends are this file's: the same
// three attempts that test makes (SHOP_API_KEY's stand-in in the Authorization header to the other credential's
// host; in a query string, and in a form body, to its own host), each sent once, then once more.
import { afterEach, describe, expect, it } from 'vitest';
import { call, type Call, cleanup, downWorld, type Up, upWorld, type World } from '../1106/helpers.ts';
import { AC3_1106, denied, filterOf, gained, run1106, settled, show } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'egress-refusals-unrecorded';
/** #1106's three attempts, as its refusals.test.ts makes them, and the words its reading names each placement by. */
const ATTEMPTS: { name: string; to: (w: World) => string; put: 'header' | 'query' | 'body'; method: 'GET' | 'POST'; place: (w: World) => string }[] = [
  { name: 'second-host', to: (w) => w.other.host, put: 'header', method: 'GET', place: (w) => `to the second allowed host ${w.other.host}` },
  { name: 'query', to: (w) => w.shop.host, put: 'query', method: 'GET', place: () => 'in a query string' },
  { name: 'body', to: (w) => w.shop.host, put: 'body', method: 'POST', place: () => 'in a form body' },
];

describe('AC3 #2399.19cd984b #1106\'s third criterion runs unchanged and passes, and each of its three attempts sent a second time leaves the count of events as it was; a planted supervisor that records no refusal from the filter fails #1106\'s criterion, naming the placement', () => {
  it('AC3 #1106\'s third criterion, its own test file unchanged, passes', async () => {
    const ran = await run1106();
    expect(ran.failed, `tests/acceptance/1106/refusals.test.ts, "${AC3_1106} ...", fails:\n${ran.failures || ran.output.slice(-3000)}`).toBe(0);
    expect(ran.passed, `it ran, and passed (exit ${ran.code}):\n${ran.output.slice(-3000)}`).toBe(1);
    expect(ran.code).toBe(0);
  }, 600_000);

  it('AC3 each of #1106\'s three attempts is refused and recorded once, and each sent a second time is refused again and leaves the count of the run\'s sandbox.denied events as it was', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const { w, port } = u;
      const f = await filterOf(port);
      const start = await denied(u.client, u.run);
      const send = async (suffix: string): Promise<Record<string, Call>> => {
        const got: Record<string, Call> = {};
        for (const a of ATTEMPTS) got[a.name] = await call(port, { variable: 'SHOP_API_KEY', to: a.to(w), put: a.put, method: a.method, attempt: `${a.name}${suffix}` });
        return got;
      };
      const refused = (got: Record<string, Call>, suffix: string): string[] => ATTEMPTS.filter((a) => got[a.name]!.status === 200 || got[a.name]!.upstream
        || [w.shop, w.other].some((api) => api.seen.some((r) => r.attempt === `${a.name}${suffix}`))).map((a) => `the stand-in sent ${a.place(w)} wasn't refused: ${JSON.stringify({ ...got[a.name], chain: undefined, trust: undefined })}`);

      expect(refused(await send(''), ''), 'each of the three attempts is refused').toEqual([]);
      expect(await settled(u.client, f, u.run), 'a refusal of a target not seen before, sent after the three, is in the record').toBe(true);
      const first = await denied(u.client, u.run);
      const recorded = gained(start, first);
      expect(recorded.length, `the three attempts leave three sandbox.denied events for the run ${u.run}, one for each placement and host: ${show(recorded)}`).toBe(3);
      expect(new Set(recorded.map((d) => `${d.operation} ${d.target}`)).size, `each with its own operation and target: ${show(recorded)}`).toBe(3);

      expect(refused(await send('-again'), '-again'), 'each of the three attempts, sent a second time, is refused again').toEqual([]);
      expect(await settled(u.client, f, u.run), 'a refusal of a target not seen before, sent after the second three, is in the record').toBe(true);
      const second = await denied(u.client, u.run);
      const more = gained(first, second);
      expect(second.length, `the three attempts sent a second time leave the count of the run's sandbox.denied events at ${first.length}; the record gained ${show(more)}`).toBe(first.length);
    } finally {
      await downWorld(u);
    }
  }, 600_000);

  it(`AC3 (wrong program) a supervisor that records no refusal from the filter (DEEP_HUB_PLANT=${PLANT}) fails #1106's third criterion, its own test file unchanged, naming each placement`, async () => {
    const ran = await run1106(PLANT);
    const said = `${ran.failures}\n${ran.output}`;
    if (/names no planted program/.test(said)) throw Error(`BLOCKED: #1106's test couldn't start its hub: DEEP_HUB_PLANT=${PLANT} names no planted program`);
    expect(ran.failed, `#1106's third criterion passes on a supervisor that records no refusal from the filter (exit ${ran.code}):\n${ran.output.slice(-3000)}`).toBe(1);
    expect(ran.passed).toBe(0);
    expect(said, 'it fails at its own reading of the record, not before it').toContain('no event in the record names the run');
    for (const place of ['to the second allowed host 127.0.0.1:', 'in a query string', 'in a form body']) {
      expect(said, `and names the placement: the stand-in sent ${place}`).toContain(`refuses the stand-in sent ${place}`);
    }
  }, 600_000);
});
