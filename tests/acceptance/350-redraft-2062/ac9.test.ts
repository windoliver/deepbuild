// AC9 (#350), redrafted blind (REDRAFT.md): with A using B's output, removing B detaches A's use before B's handlers
// stop; a host that stops B first fails, naming the edge.
//
// The two packages, the edge, the judge (`judgeDetach`) and the twin (`stop-provider-first`) are the landed draft's, and
// so is how B is removed: `disable` together with your yes to each ask raised while that removal waits. A's use is
// required, so a hub that asks before removing the provider of a required use gets its answer, and a hub that asks
// nothing removes B as before; whether it asks is #103's criterion, not this one's. What changed is what the rows state:
// B's keeps the feed's schema and digest, A's states both (design: Composition, Declared edges), and A's code no longer
// marks as optional a use its row declares required. Each wait is for its event, bounded by a deadline, never for time.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ExtensionHost, Plant, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { d1Digest } from '../../../packages/contracts/src/index.ts';
import { alive, host, installAndLoad, openWorld, pkg, releaseEntry, report, tempDir, tracked, ulid, YOU, type World } from '../350/helpers.ts';
import { EDGE, judgeDetach } from '../350/judges.ts';
import { shownPlanHash, withPlans } from '../plans.ts';

const hosts: ExtensionHost[] = [];
// Registered after helpers.ts's own, so it runs first: these hosts close before their worlds and folders go.
afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
});

/**
 * helpers.ts's `openHost`, plus the world's asks core (raised asks given a plan, as tests/acceptance/plans.ts does).
 * `nextAsk()` is the event of the host's next raised ask.
 */
async function openHostWithAsks(w: World, release: ReleaseEntry[], plant?: Plant): Promise<{ h: ExtensionHost; nextAsk(): Promise<void> }> {
  const { openExtensionHost } = await host();
  const core = withPlans(w.asks);
  let ring = (): void => undefined;
  const asks: Asks = { ...core, raise: async (...given: Parameters<Asks['raise']>) => { const ask = await core.raise(...given); ring(); return ask; } };
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release, now: Date.now, asks,
    ...(plant ? { plant } : {}),
  });
  hosts.push(h);
  await h.ready();
  return { h, nextAsk: () => new Promise<void>((resolve) => { ring = resolve; }) };
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
async function remove(w: World, h: ExtensionHost, nextAsk: () => Promise<void>, id: string): Promise<number> {
  const before = new Set(await open(w.asks));
  const answered = new Set<string>();
  const removal = h.disable(id).then(() => 'removed' as const);
  removal.catch(() => undefined);
  const answering = async (): Promise<number> => {
    for (;;) {
      const asked = nextAsk(); // before the inbox is read, so an ask raised after that read still ends the wait below
      for (const ask of await open(w.asks)) {
        if (before.has(ask) || answered.has(ask)) continue;
        answered.add(ask);
        await yes(w.asks, ask);
      }
      if ((await Promise.race([removal, asked])) === 'removed') return answered.size;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    // deadline: a removal that never finishes fails here, saying so, instead of hanging
    timer = setTimeout(() => reject(Error(`disable(${id}) hasn't finished 20 s after it began; asks answered: ${answered.size}`)), 20_000);
  });
  return Promise.race([answering(), late]).finally(() => clearTimeout(timer));
}

/** The processes have all ended within 5 s. */
const gone = (pids: number[], what: string): Promise<unknown> => vi.waitFor(() => expect(pids.filter(alive), `${what}: its processes still run`).toEqual([]), { timeout: 5_000 });

/** A (fixtures/user, REDRAFT.md), as helpers.ts's `pkg` makes a package: its `.fixture` suffix dropped, its rows and probe settings written, its digest stamped. */
async function packageA(rows: Record<string, unknown>, probe: Record<string, unknown>): Promise<string> {
  const from = (name: string): string => readFileSync(join(fileURLToPath(new URL('./fixtures/user/', import.meta.url)), name), 'utf8');
  const dir = tempDir('pkg-user');
  writeFileSync(join(dir, 'index.ts'), from('index.ts.fixture'));
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  const manifest = { ...(JSON.parse(from('deepbuild.json')) as Record<string, unknown>), ...rows };
  const write = (): void => writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  write();
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  write();
  expect(packageDigest(dir), 'writing packageDigest into deepbuild.json\'s digest doesn\'t change it (#348)').toBe(manifest.digest);
  return dir;
}

describe('AC9 #350.bff15b51 with A using B\'s output, removing B detaches A\'s use before B\'s handlers stop; a host that stops B first fails, naming the edge', () => {
  const FEED_1 = 'ext.b.feed@1';
  /** B's reading's schema, as fixtures/provider declares it in code: B's row keeps its d1 digest for minor 0, and A's use states it. */
  const FEED = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
  /** The scenario: A (first-party, in the hub) reads B's feed back to back; B (sandboxed) is removed once A has made 100 reads, and A reads on until 50 reads after. */
  async function scenario(plant?: Plant): Promise<{ outcomes: string[]; bPids: number[]; asked: number }> {
    const signs = tempDir('signs');
    const probe = { reading: join(signs, 'reading'), removed: join(signs, 'removed'), ms: 50_000 };
    const b = await pkg('provider', { manifest: { provides: [{ interface: FEED_1, kind: 'reading', minor: 0, schema: FEED, digests: { 0: d1Digest(FEED) } }] } });
    const a = await packageA({ uses: [{ interface: FEED_1, minor: 0, schema: FEED, digest: d1Digest(FEED) }] }, probe);
    const w = await openWorld();
    const { h, nextAsk } = await openHostWithAsks(w, [await releaseEntry(a)], plant);
    await installAndLoad(h, b);
    await installAndLoad(h, a);
    const loads = await h.loaded();
    expect(Object.fromEntries(loads.map((l) => [l.id, l.place])), 'A in the hub, B in the sandbox').toEqual({ 'deepbuild/a': 'hub', 'test/b': 'sandbox' });
    const bPids = await tracked(w, loads.find((l) => l.id === 'test/b')!.run);
    const reading = report<{ outcomes: string[] }>(h, 'ext.a.report');
    await vi.waitFor(() => expect(existsSync(probe.reading), 'A has made 100 reads').toBe(true), { timeout: 20_000 });
    const asked = await remove(w, h, nextAsk, 'test/b');
    writeFileSync(probe.removed, '');
    const { outcomes } = await reading;
    return { outcomes, bPids, asked };
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
