// A pull request's review rounds (#1862; #87: review rounds converge). Each round that counted is review.read@1 in
// the record: the commit it read, the items it sent back and the earlier items that commit left open. The next round
// on the pull request takes them as its spec's `since`, so it reads only what changed since that commit and sends no
// open item again. When a claim on the pull request passes, how each sent-back item ended is review.settled@1.
import { itemOutcomes, type ReviewSpec, type SendBackItem } from '@deepbuild/checks-review';

interface ReviewRoundsOptions {
  raw(query: string, params?: readonly (string | number | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Record<string, unknown>, extra?: { subject?: string }): Promise<void>;
  /** The hub's object store, which reads each repo's objects: where the rounds' commits are read. */
  objects: string;
}
interface Round { claim: string; commit: string; sent: SendBackItem[]; open: SendBackItem[] }

export class ReviewRounds {
  constructor(private readonly o: ReviewRoundsOptions) {}
  private async of(pr: string): Promise<Round[]> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'review.read' AND json_extract(data, '$.pr') = ? ORDER BY log_pos`, [pr])) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Round);
  }
  /** What a claim's review on `pr` reads from: the commit the last round of an earlier claim read, with every item still open after it. */
  async since(pr: string, claim: string): Promise<ReviewSpec['since']> {
    const last = (await this.of(pr)).filter((r) => r.claim !== claim).at(-1);
    return last ? { commit: last.commit, items: [...last.open, ...last.sent] } : null;
  }
  /** A round of `claim` on `pr` counted: the commit it read, what it sent back and what stays open. */
  async read(pr: string, claim: string, commit: string, round: { sent: SendBackItem[]; open: SendBackItem[] }): Promise<void> {
    await this.o.appendCore('review.read', { pr, claim, commit, sent: round.sent, open: round.open }, { subject: claim });
  }
  /** `claim` on `pr` settled, on the commit its last round read: how each item the rounds sent back ended. */
  async settled(pr: string, claim: string): Promise<void> {
    const rounds = await this.of(pr);
    const commit = rounds.at(-1)?.commit;
    if (!commit || !rounds.some((r) => r.sent.length)) return;
    const outcomes = await itemOutcomes(this.o.objects, rounds.map((r) => ({ commit: r.commit, items: r.sent })), commit);
    await this.o.appendCore('review.settled', { pr, claim, commit, outcomes }, { subject: claim });
  }
}
