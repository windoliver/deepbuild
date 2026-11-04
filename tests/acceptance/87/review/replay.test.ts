// AC "A replay of 20 recorded Codex review rounds gives the same send-backs with no click". The twenty rounds are ten
// claims' two rounds each (fixtures/codex-rounds.ts, written by this job: no recorded corpus exists at the base): round
// 1 reviews base..A, round 2 re-reviews B since A with round 1's items open. Each round's recorded answer is played
// back as the second model's; the review gives the items the round sent back, and every round ends on its own, passed
// or failed, with no one's input. The replay runs twice and gives the same send-backs both times.
import { describe, expect, it } from 'vitest';
import { CLAIMS, type SentItem } from './fixtures/codex-rounds.ts';
import { history, items, type Item, recorded, reviewSpec, runReview, shown } from './helpers.ts';

const asItems = (sent: SentItem[]): Item[] => items(sent.map((i) => ({ rule: i.rule, sites: i.sites.map(([file, line, quote]) => ({ file, line, quote })) })));

async function replay(): Promise<Map<string, Item[]>> {
  const got = new Map<string, Item[]>();
  for (const c of CLAIMS) {
    const h = history(c.base, c.commits);
    let since = null as Parameters<typeof reviewSpec>[2];
    for (const [n, round] of c.rounds.entries()) {
      const id = `${c.id} round ${n + 1}`;
      const reviewer = recorded(round.answer);
      const result = await runReview(reviewer.reviewer, reviewSpec(h.sha.base!, h.sha[round.reviews]!, since), h.checkout);
      expect(reviewer.requests.length, `${id}: the second model is asked once`).toBe(1);
      expect(['passed', 'failed'], `${id} ends on its own: ${shown(result)}`).toContain(result.outcome);
      expect(items(result.sendBack?.items), `${id}: ${shown(result)}`).toEqual(asItems(round.sent));
      got.set(id, items(result.sendBack?.items));
      since = { commit: h.sha[round.reviews]!, items: [...(since?.items ?? []), ...(result.sendBack?.items ?? [])] };
    }
  }
  return got;
}

describe('AC a replay of 20 recorded Codex review rounds gives the same send-backs with no click', () => {
  it('each of the twenty rounds sends back what it sent when recorded, the same on a second replay', async () => {
    expect(CLAIMS.flatMap((c) => c.rounds).length).toBe(20);
    const first = await replay();
    const second = await replay();
    expect(first.size).toBe(20);
    expect([...second.entries()]).toEqual([...first.entries()]);
  }, 300_000);
});
