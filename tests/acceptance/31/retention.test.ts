// #31 AC14 #31.ab1f7997: on a controlled clock, a snapshot no open claim, open ask or kept evidence cites is gone from DeepBuild's
// store 30 days after it was written, a later claim runs again what would have carried from it, and one whose evidence
// sits behind a decision stays. The store is real (a bare git repo): the readings are git's own.
import { describe, expect, it } from 'vitest';
import type { Checkouts } from '../../../packages/gate/src/index.ts';
import { DAY, inStore, makeRepo, mustFail, openWorld, presenceKind, SEEDED, spec, storeHolds, storeRefs, write, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const NOW = 1_800_000_000_000;
/** A snapshot of one more edit, written at the clock's time. */
async function snap(service: Checkouts, repo: string, word: string): Promise<string> {
  write(repo, { 'src/cart.ts': `// ${word}\n` });
  return (await service.snapshot(repo)).commit;
}
const none = { open_claims: [], open_asks: [], kept_evidence: [] };

describe('AC14 #31.ab1f7997 snapshots leave the store 30 days after they were written, unless something cites them', () => {
  it('AC14 an uncited snapshot is there at 29 days and gone at 31, its ref and its objects with it; the ones cited stay', async () => {
    await withWorld(async (w) => {
      let clock = NOW;
      const repo = makeRepo(SEEDED);
      const service = await w.service({ now: () => clock });
      const uncited = await snap(service, repo, 'uncited');
      const blob = inStore(w.store, repo, ['rev-parse', `${uncited}:src/cart.ts`]);
      const claimed = await snap(service, repo, 'claimed');
      const asked = await snap(service, repo, 'asked');
      const evidenced = await snap(service, repo, 'evidenced');
      const cited = { open_claims: [claimed], open_asks: [asked], kept_evidence: [{ snapshot: evidenced, behind_decision: false }] };

      clock = NOW + 29 * DAY;
      expect((await service.prune(cited)).removed, 'nothing is 30 days old').toEqual([]);
      expect(storeHolds(w.store, uncited)).toBe(true);

      clock = NOW + 31 * DAY;
      expect((await service.prune(cited)).removed, 'only the one nothing cites').toEqual([uncited]);
      expect(storeHolds(w.store, uncited), `snapshot ${uncited}`).toBe(false);
      expect(storeHolds(w.store, blob), 'what nothing else holds is pruned').toBe(false);
      expect(storeRefs(w.store), 'no ref holds it').not.toContain(uncited);
      for (const kept of [claimed, asked, evidenced]) {
        expect(storeHolds(w.store, kept), `snapshot ${kept}`).toBe(true);
        expect(storeRefs(w.store), 'a ref holds it').toContain(kept);
      }

      // The claim closes, the ask closes and the evidence leaves: at the next prune each goes.
      expect((await service.prune(none)).removed.sort()).toEqual([claimed, asked, evidenced].sort());
      for (const gone of [claimed, asked, evidenced]) expect(storeHolds(w.store, gone), `snapshot ${gone}`).toBe(false);
    });
  }, 120_000);

  it('AC14 a snapshot whose evidence sits behind a decision is still there at 60 days', async () => {
    await withWorld(async (w) => {
      let clock = NOW;
      const repo = makeRepo(SEEDED);
      const service = await w.service({ now: () => clock });
      const decided = await snap(service, repo, 'decided');
      clock = NOW + 60 * DAY;
      const { removed } = await service.prune({ ...none, kept_evidence: [{ snapshot: decided, behind_decision: true }] });
      expect(removed).toEqual([]);
      expect(storeHolds(w.store, decided), `snapshot ${decided}`).toBe(true);
    });
  }, 120_000);

  it('AC14 a later claim whose check would have carried from a snapshot runs it again once that snapshot is gone', async () => {
    await withWorld(async (w) => {
      let clock = NOW;
      const repo = makeRepo(SEEDED);
      const kind = presenceKind();
      const service = await w.service({ now: () => clock, kinds: [kind] });
      const check = { check: 'presence', spec: spec('presence', 'src/cart.ts', ['src/**']), deadline: 60_000, on_base: 'passes' as const, own: [] };
      const claim = (id: string, earlier: Awaited<ReturnType<Checkouts['runClaim']>>[]) => service.runClaim({ claim: `claim:${id}`, worktree: repo, onto: 'main', checks: [check], earlier });
      write(repo, { 'src/cart.ts': '// edit\n' });
      const first = await claim('one', []);
      expect(kind.calls.length, 'the first claim runs it').toBe(1);

      // An edit outside the check's declared inputs: the result carries while its snapshot is there.
      write(repo, { 'README.md': 'one\n' });
      const carried = await claim('two', [first]);
      expect(carried.checks[0]!.carried, 'it carries from the kept snapshot').toBe(true);
      expect(kind.calls.length, 'and doesn\'t run').toBe(1);

      clock = NOW + 31 * DAY;
      await service.prune(none);
      expect(storeHolds(w.store, first.snapshot), `snapshot ${first.snapshot}`).toBe(false);
      write(repo, { 'README.md': 'two\n' });
      const again = await claim('three', [first]);
      expect(again.checks[0]!.carried, 'a result whose snapshot is gone never carries').toBe(false);
      expect(kind.calls.length, 'it ran again').toBe(2);
      expect(again.verdict).toBe('PASS');
    });
  }, 120_000);

  it('AC14 (wrong program) a store that keeps every snapshot fails, naming the snapshot', async () => {
    await withWorld(async (w) => {
      let clock = NOW;
      const repo = makeRepo(SEEDED);
      const service = await w.service({ now: () => clock, plant: 'keeps-every-snapshot' });
      const uncited = await snap(service, repo, 'uncited');
      clock = NOW + 31 * DAY;
      await service.prune(none);
      const held = storeHolds(w.store, uncited);
      await mustFail('keeps-every-snapshot', () => expect(held, `snapshot ${uncited} is gone at 31 days`).toBe(false), [uncited]);
    });
  }, 120_000);

  it('AC14 (wrong program) a store that drops the decision\'s fails, naming the snapshot', async () => {
    await withWorld(async (w) => {
      let clock = NOW;
      const repo = makeRepo(SEEDED);
      const service = await w.service({ now: () => clock, plant: 'drops-decisions' });
      const decided = await snap(service, repo, 'decided');
      clock = NOW + 60 * DAY;
      await service.prune({ ...none, kept_evidence: [{ snapshot: decided, behind_decision: true }] });
      const held = storeHolds(w.store, decided);
      await mustFail('drops-decisions', () => expect(held, `snapshot ${decided} stays behind its decision`).toBe(true), [decided]);
    });
  }, 120_000);
});
