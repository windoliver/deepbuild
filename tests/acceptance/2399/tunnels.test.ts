// #2399 AC2: 100 tunnels asked for to one host no credential names leave one `sandbox.denied` with the operation
// `egress-host`, and a tunnel to a second such host adds one more. A planted supervisor that keeps one refusal per
// operation records none for the second host and fails, naming the host. A tunnel is asked for as a proxy's client
// asks: `CONNECT <host>:443` to the run's filter port, from outside the run. Neither host is a credential's: the
// world's two credentials name localhost:<port> and 127.0.0.1:<port>.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, downWorld, type Up, upWorld } from '../1106/helpers.ts';
import { type Denied, denied, filterOf, gained, names, ofFilter, settled, show, TIMES, tunnel } from './helpers.ts';

afterEach(cleanup, 60_000);

const FIRST = 'dh2399-first.invalid';
const SECOND = 'dh2399-second.invalid';
const PLANT = 'egress-refusal-once-per-operation';

/** AC2's reading of what the record gained for one host: null when it is exactly one egress-host naming the host. */
function hostProblem(which: string, host: string, tunnels: number, run: string, now: Denied[]): string | null {
  const ours = now.filter(names('egress-host', host));
  if (ours.length === 0) return `no sandbox.denied for the run ${run} names the ${which} host ${host}:443 with the operation egress-host, after ${tunnels} tunnel${tunnels === 1 ? '' : 's'} asked for to it (the record gained ${show(now)})`;
  if (ours.length !== 1) return `${tunnels} tunnels asked for to the ${which} host ${host}:443 left ${ours.length} sandbox.denied events for the run ${run}, not one`;
  if (now.filter(ofFilter(host)).length !== 1) return `the tunnels to the ${which} host ${host}:443 left other sandbox.denied events for the run ${run} beside its one: ${show(now)}`;
  return null;
}

async function scenario(plant?: string): Promise<{ u: Up; answers: (number | string)[]; marked: boolean[]; problems: string[] }> {
  const u = await upWorld(plant);
  const f = await filterOf(u.port);
  const start = await denied(u.client, u.run);
  const answers: (number | string)[] = [];
  for (let i = 0; i < TIMES; i++) answers.push(await tunnel(f, `${FIRST}:443`));
  // On a planted program the marker may never be recorded: wait less for it, and read the record as it stands.
  const marked = [await settled(u.client, f, u.run, plant ? 10_000 : 60_000)];
  const afterFirst = await denied(u.client, u.run);
  answers.push(await tunnel(f, `${SECOND}:443`));
  marked.push(await settled(u.client, f, u.run, plant ? 10_000 : 60_000));
  const afterSecond = await denied(u.client, u.run);
  const problems = [
    hostProblem('first', FIRST, TIMES, u.run, gained(start, afterFirst)),
    hostProblem('second', SECOND, 1, u.run, gained(afterFirst, afterSecond)),
  ].filter((p): p is string => p !== null);
  return { u, answers, marked, problems };
}

describe('AC2 #2399.c1245384 100 tunnels asked for to one host no credential names leave one sandbox.denied with the operation egress-host, and a tunnel to a second such host adds one more; a planted supervisor that keeps one refusal per operation records none for the second host and fails, naming the host', () => {
  it('AC2 100 tunnels asked for to one host no credential names are each refused and leave one sandbox.denied (egress-host, that host), and one tunnel to a second such host adds exactly one more, naming it', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario();
      u = s.u;
      expect(s.answers.filter((a) => a !== 403), `each of the ${TIMES + 1} tunnels is refused with a 403, as now`).toEqual([]);
      expect(s.marked, 'a refusal of a target not seen before, sent after each step, is in the record').toEqual([true, true]);
      expect(s.problems).toEqual([]);
    } finally {
      await downWorld(u);
    }
  }, 600_000);

  it(`AC2 (wrong program) a supervisor that keeps one refusal per operation (DEEP_HUB_PLANT=${PLANT}) fails the reading, naming the second host`, async () => {
    let u: Up | undefined;
    try {
      const s = await scenario(PLANT);
      u = s.u;
      expect(s.problems.length, 'the reading passes on a supervisor that records no refusal for a second host').toBeGreaterThan(0);
      expect(s.problems.join(' | '), 'and names that host').toContain(`names the second host ${SECOND}:443`);
    } finally {
      await downWorld(u);
    }
  }, 600_000);
});
