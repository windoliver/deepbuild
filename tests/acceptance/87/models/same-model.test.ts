// A review answered by the model that made the change doesn't count; one by another model of its family counts and
// says so; one by another family counts plainly. The answering model is the one the runner read from the review
// job's own output, never the one the job was launched for. Each review is a real job through the runner (#159),
// launched for gpt-5-codex, whose recorded output names the model that answered.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import type { ModelPlant } from '../../../../packages/checks-review/src/index.ts';
import type { Plant } from '../../../../packages/runner/src/index.ts';
import { AT, changeSession, claimVerdict, review, reviewJob, shown, world } from './helpers.ts';

afterAll(cleanup, 30_000);

const CHANGE_MODEL = 'claude-opus-4-1';

/** The criterion's three reviews of a change made on claude-opus-4-1, each launched for gpt-5-codex; throws, naming
 *  what went wrong, where a review is counted or noted otherwise than the criterion says. */
async function threeReviews(o: { runner?: Plant; check?: ModelPlant } = {}): Promise<void> {
  const { reviewJobRun } = await review();
  const change = await changeSession(CHANGE_MODEL);
  const w = await world(o.runner ? { plant: o.runner } : {});
  try {
    // Answered by the model that made the change.
    const same = await reviewJob(w, 'opus');
    const first = reviewJobRun(same, change, AT, o.check);
    const ind = first.independence;
    if (!ind) throw new Error(`a finished review job has no independence reading: ${JSON.stringify(first)}`);
    if (ind.answered !== 'claude-opus-4-1') {
      throw new Error(`the review recorded ${ind.answered}${ind.answered === 'gpt-5-codex' ? ', the model it was launched for,' : ''} not claude-opus-4-1, the model its output names`);
    }
    if (ind.counted) throw new Error(`a review answered by ${ind.answered}, the model that made the change, counted: ${JSON.stringify(ind)}`);
    expect(ind.reason).toBe('review not independent: same model');
    expect(first.run.outcome, 'the review\'s run').toBe('uncounted');
    const v = claimVerdict(first.run);
    expect(v.outcome, `with no other review: ${shown(v)}`).not.toBe('PASS');
    expect(v.outcome, `with no other review: ${shown(v)}`).toBe('INCONCLUSIVE');

    // Answered by another model of the same family.
    const family = reviewJobRun(await reviewJob(w, 'sonnet'), change, AT, o.check);
    if (!family.independence?.counted || family.run.outcome === 'uncounted') {
      throw new Error(`a review answered by claude-sonnet-4-5, another model of the change's family, didn't count: ${JSON.stringify(family.independence)}; its claim would be ${claimVerdict(family.run).outcome}`);
    }
    expect(family.independence.answered).toBe('claude-sonnet-4-5');
    expect(family.independence.note, 'its verdict line').toBe('same-family review');
    expect(family.independence.reason).toBeNull();

    // Answered by a model of another family.
    const other = reviewJobRun(await reviewJob(w, 'codex'), change, AT, o.check);
    expect(other.independence, 'a review answered by gpt-5-codex').toMatchObject({ answered: 'gpt-5-codex', counted: true, reason: null, note: null });
    expect(other.run.outcome).not.toBe('uncounted');
  } finally {
    await w.close();
  }
}

describe('#87 a review by the model that made the change is uncounted; another model of its family counts, noted', () => {
  it('a change made on claude-opus-4-1, reviewed by a job launched for gpt-5-codex whose output names claude-opus-4-1, records claude-opus-4-1 and is uncounted, "review not independent: same model", the claim INCONCLUSIVE; answered by claude-sonnet-4-5 it counts with "same-family review"; by gpt-5-codex it counts with no note', async () => {
    await threeReviews();
  }, 300_000);

  it('(wrong program) a check that records the model it asked for counts the first review, and fails', async () => {
    // The model asked for reaches the record through the runner's own planted switch (#159): the job's record then
    // names the model it was launched for.
    await expect(threeReviews({ runner: 'records-launched-model' })).rejects.toThrow(/recorded gpt-5-codex, the model it was launched for/);
  }, 300_000);

  it('(wrong program) a check that drops same-family reviews leaves the second claim INCONCLUSIVE, and fails', async () => {
    await expect(threeReviews({ check: 'drops-same-family' })).rejects.toThrow(/claude-sonnet-4-5, another model of the change's family, didn't count/);
  }, 300_000);
});
