// AC "Over a replay of recorded review rounds, each sent-back finding is recorded as fixed or left, with the commit
// that decided it; a check that counts a finding fixed when the later commit changed only another file fails this
// test, naming the finding."
// Over the ten recorded claims (fixtures/codex-rounds.ts), each item a round sent back is recorded as fixed, by the
// first later commit that changes a line it cites, or left, by the commit the claim settled on, its last. In claim
// client-token, commit B changes only src/config.ts, at the same line number as the item's site in src/client.ts, so
// that item is left; in claim session-load, B fixes the item and a later C changes the file elsewhere, so B decides it.
import { describe, expect, it } from 'vitest';
import { CLAIMS } from './fixtures/codex-rounds.ts';
import { history, review } from './helpers.ts';

describe('AC each sent-back finding is recorded as fixed or left, with the commit that decided it', () => {
  it('over the recorded rounds, every sent-back item ends fixed or left as recorded, decided by the recorded commit', async () => {
    const r = await review();
    let total = 0;
    for (const c of CLAIMS) {
      const h = history(c.base, c.commits);
      const sent = c.rounds.map((round) => ({
        commit: h.sha[round.reviews]!,
        items: round.sent.map((i) => ({ rule: i.rule, sites: i.sites.map(([file, line, quote]) => ({ file, line, quote })) })),
      }));
      const settled = h.sha[c.commits[c.commits.length - 1]!.label]!;
      const ended = await r.itemOutcomes(h.checkout, sent, settled);
      const sentCount = sent.reduce((n, s) => n + s.items.length, 0);
      expect(ended.length, `${c.id}: one outcome per sent-back item: ${JSON.stringify(ended)}`).toBe(sentCount);
      for (const want of c.outcomes) {
        const name = `${want.rule} at ${want.site[0]}:${want.site[1]} in claim ${c.id}`;
        const got = ended.find((o) => o.rule === want.rule && o.sites.some((s) => s.file === want.site[0] && s.line === want.site[1]));
        expect(got, `${name} has an outcome: ${JSON.stringify(ended)}`).toBeDefined();
        expect({ ended: got!.ended, commit: got!.commit }, `${name} ended ${want.ended}, decided by commit ${want.by}`).toEqual({ ended: want.ended, commit: h.sha[want.by] });
        total += 1;
      }
    }
    expect(total, 'the recorded rounds sent back eleven items').toBe(11);
  }, 300_000);
});
