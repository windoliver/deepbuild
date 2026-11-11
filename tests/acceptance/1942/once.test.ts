// AC5 #1942.be821b2d: dropping the SSH link right after a remote start is sent, the run starts once on the host, read
// back by its token; a host link that resends on reconnect starts it twice and fails, naming the token.
//
// helpers.ts's judgeOnce (README, How AC5 drops the link): with every byte from dh-fedora held back 1 s at the relay,
// a run is started there as you (run.start); the moment the host shows it started (its first line in once.starts), with
// its start's reply still held, every connection to the host is cut and the delay lifted. The host must hold one start
// of it, a user unit holding its token, and the hub one run.started and an end `passed` whose stdout evidence is the
// run's output once. The planted hub host-link-resends-on-reconnect (DEEP_HUB_PLANT) must fail the same judge with the
// run started twice, naming the token.
import { describe, expect, test } from 'vitest';
import { AC, judgeOnce, openWorld, proof, redact } from './helpers.ts';

describe(AC[5], () => {
  test('a remote start whose link drops right after it is sent runs once on the host, read back by its token, and ends as it ran', async () => {
    const w = await openWorld('deep-fedora', { approve: true });
    const { failures, token, seen } = await judgeOnce(w);
    proof(w, 'ac5-once.json', { failures, token: token ? `${token.slice(0, 8)}…` : null, seen, answered: w.answered });
    expect(failures.map((f) => redact(f, w.host.ssh)), 'the judge finds nothing wrong').toEqual([]);
  }, 600_000);

  test('the planted host link that resends on reconnect starts the run twice and fails the judge, naming the token', async () => {
    const w = await openWorld('deep-fedora', { approve: true, plant: 'host-link-resends-on-reconnect' });
    const { failures, token, seen } = await judgeOnce(w);
    proof(w, 'ac5-plant-resends-on-reconnect.json', { failures, seen });
    const words = failures.map((f) => redact(f, w.host.ssh));
    expect(token, `the planted run started on the host with a token: ${JSON.stringify(words)}`).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(words.filter((f) => /started [2-9] times/.test(f) && f.includes(token)), `the judge fails the planted link for starting the run twice, naming its token: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 600_000);
});
