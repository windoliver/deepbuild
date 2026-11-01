// AC9, redrafted blind (README): with A using B's output, removing B detaches A's use before B's handlers stop; a host
// that stops B first fails, naming the edge.
//
// The scenario, timings, judgment (`judgeDetach`) and twin (`stop-provider-first`) are the original's in
// staged.test.ts. What changed: the host is opened with the world's asks core, and removing B is `disable` together
// with your yes to each ask raised while that removal waits. A's use stays required (the manifest row is the original's),
// so a hub that asks before removing the provider of a required use (#103, design: Composition, Declared edges) gets
// its answer, and a hub that asks nothing removes B as before. Whether it asks is #103's criterion, not this one's.
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost, Plant, ReleaseEntry } from '../../../../packages/extension-host/src/index.ts';
import type { Asks } from '../../../../packages/asks/src/index.ts';
import { d1Digest } from '../../../../packages/contracts/src/index.ts';
import { alive, host, installAndLoad, openWorld, pkg, releaseEntry, report, sleep, tracked, ulid, YOU, type World } from '../helpers.ts';
import { EDGE, judgeDetach } from '../judges.ts';
import { shownPlanHash, withPlans } from '../../plans.ts';

const hosts: ExtensionHost[] = [];
// Registered after helpers.ts's own, so it runs first: these hosts close before their worlds and folders go.
afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
});

/** helpers.ts's `openHost`, plus the world's asks core (raised asks given a plan, as tests/acceptance/plans.ts does). */
async function openHostWithAsks(w: World, release: ReleaseEntry[], plant?: Plant): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release, now: Date.now, asks: withPlans(w.asks),
    ...(plant ? { plant } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

/** Your answer on the trusted path, as tests/acceptance/103/helpers.ts `answer` gives it: the option whose decision is allow. */
async function yes(asks: Asks, ask: string): Promise<void> {
  const card = await asks.card(ask);
  const option = card.options.find((o: { decision?: string }) => o.decision === 'allow') ?? card.options[0]!;
  await asks.answer(YOU, ask, { option: option.id, plan_hash: await shownPlanHash(asks, ask), token: `click-${ulid(Date.now())}` });
}

/** The asks in your inbox still open. */
const open = async (asks: Asks): Promise<string[]> => (await asks.inbox()).filter((r) => r.status !== 'closed').map((r) => r.ask);

/**
 * Removing `id` as you would: `disable`, and while it hasn't finished, your yes to each ask raised since it began (in
 * this world only the removal raises asks; a card carries no question text to match a name on). Returns how many you
 * answered; fails if the removal hasn't finished 20 s after it began.
 */
async function remove(w: World, h: ExtensionHost, id: string): Promise<number> {
  const before = new Set(await open(w.asks));
  let finished = false;
  const removal = h.disable(id).finally(() => { finished = true; });
  const answered = new Set<string>();
  const end = Date.now() + 20_000;
  while (!finished) {
    for (const ask of await open(w.asks)) {
      if (before.has(ask) || answered.has(ask)) continue;
      answered.add(ask);
      await yes(w.asks, ask);
    }
    if (Date.now() > end) throw Error(`disable(${id}) hasn't finished 20 s after it began; open asks: ${JSON.stringify(await w.asks.inbox())}`);
    await Promise.race([removal.catch(() => undefined), sleep(50)]);
  }
  await removal;
  return answered.size;
}

/** staged.test.ts's `gone`: the processes have all ended within 5 s. */
async function gone(pids: number[], what: string): Promise<void> {
  for (let i = 0; i < 100 && pids.some(alive); i++) await sleep(50);
  expect(pids.filter(alive), `${what}: its processes still run`).toEqual([]);
}

describe('AC9 #350.bff15b51 with A using B\'s output, removing B detaches A\'s use before B\'s handlers stop; a host that stops B first fails, naming the edge', () => {
  /** B's reading's schema, as fixtures/provider declares it; A's use pins its d1 digest. */
  const FEED = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
  /** The scenario: A (first-party, in the hub) reads B's feed back to back for 3 s; B (sandboxed) is removed 0.8 s in. */
  async function scenario(plant?: Plant): Promise<{ w: World; outcomes: string[]; bPids: number[]; asked: number }> {
    const b = await pkg('provider');
    const a = await pkg('user', { manifest: { uses: [{ interface: 'ext.b.feed@1', minor: 0, digest: d1Digest(FEED) }] }, probe: { ms: 3_000 } });
    const w = await openWorld();
    const h = await openHostWithAsks(w, [await releaseEntry(a)], plant);
    await installAndLoad(h, b);
    await installAndLoad(h, a);
    const loads = await h.loaded();
    expect(Object.fromEntries(loads.map((l) => [l.id, l.place])), 'A in the hub, B in the sandbox').toEqual({ 'deepbuild/a': 'hub', 'test/b': 'sandbox' });
    const bPids = await tracked(w, loads.find((l) => l.id === 'test/b')!.run);
    const reading = report<{ outcomes: string[] }>(h, 'ext.a.report');
    await sleep(800);
    const asked = await remove(w, h, 'test/b');
    const { outcomes } = await reading;
    return { w, outcomes, bPids, asked };
  }

  it('AC9 A reads B\'s value until its use is detached and reads missing after, never through a stopped B; B\'s process is gone after', async () => {
    const { outcomes, bPids, asked } = await scenario();
    expect(judgeDetach(outcomes), `A's reads: ${outcomes.length}; asks you answered yes to on B's removal: ${asked}`).toEqual([]);
    await gone(bPids, 'B, removed');
  }, 120_000);

  it('AC9 (wrong program) a host that stops B first fails, naming the edge', async () => {
    const { outcomes } = await scenario('stop-provider-first');
    const problems = judgeDetach(outcomes);
    expect(problems.some((p) => p.startsWith(`the edge ${EDGE}`) && p.includes('after B\'s handlers stopped')), JSON.stringify(problems)).toBe(true);
  }, 120_000);
});
