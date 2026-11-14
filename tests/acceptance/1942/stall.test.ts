// AC4 #1942.a60bd93f: with two remote runs streaming from one host, stalling one run's connection for 60 s leaves the
// other's stream within its 500 ms lag, and only the stalled one reconnects; a host link that drops every connection
// to the host on one stall fails this test, naming the run.
//
// helpers.ts's judgeStall (README, How AC4 stalls a run's connection): runs A and B on dh-ubuntu, each followed with
// `deep run follow`; A's connection (the relay connection carrying its 4 KB lines) is stalled both ways for 60 s. B's
// connection must stay open and keep carrying B, each of B's lines written meanwhile must arrive within 500 ms, and A
// must come back on a new connection before the stall ends. The planted hub host-link-drops-every-connection
// (DEEP_HUB_PLANT) must fail the same judge, naming B's run as reconnected.
//
// A lag past 500 ms read while the load average is above the core count, with nothing else failing, is a reading, not
// a result: the test skips as INCONCLUSIVE with it (the repo's rule for timing under load); every other failure fails.
import { describe, expect, test } from 'vitest';
import { AC, CORES, judgeStall, loaded, loadNow, openWorld, proof, redact } from './helpers.ts';

describe(AC[4], () => {
  test('stalling run A\'s connection for 60 s: run B stays on its connection within its 500 ms lag, and A alone reconnects', async (ctx) => {
    const w = await openWorld('deep-ubuntu', { approve: true });
    const { failures, lagOnly, seen } = await judgeStall(w);
    proof(w, 'ac4-stall.json', { failures, seen, answered: w.answered });
    const words = failures.map((f) => redact(f, w.host.ssh));
    if (lagOnly && loaded()) ctx.skip(`INCONCLUSIVE (a reading only: load ${loadNow().toFixed(1)} above ${CORES} cores): ${words.join('; ')}`);
    expect(words, 'the judge finds nothing wrong').toEqual([]);
  }, 600_000);

  test('the planted host link that drops every connection to the host on one stall fails the judge, naming the run it reconnected', async () => {
    const w = await openWorld('deep-ubuntu', { approve: true, plant: 'host-link-drops-every-connection' });
    const { failures, seen } = await judgeStall(w);
    proof(w, 'ac4-plant-drops-every-connection.json', { failures, seen });
    const words = failures.map((f) => redact(f, w.host.ssh));
    const B = String(seen.runs?.B ?? 'run B');
    expect(words.filter((f) => f.includes(B) && /reconnected|stalled with A/.test(f)), `the judge fails the planted link, naming ${B} as reconnected with A's stall: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 600_000);
});
