// Models are compared by canonical ID: a context suffix ([1m]), a date suffix, a cloud prefix (us.anthropic.) and a
// Bedrock version suffix (-v1:0) are dropped before the comparison and before the family lookup. Both reviews are
// real jobs through the runner (#159) whose recorded output names the model as its route spells it.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import type { ModelPlant } from '../../../../packages/checks-review/src/index.ts';
import { AT, changeSession, review, reviewJob, world } from './helpers.ts';

afterAll(cleanup, 30_000);

/** The criterion's two reviews of a change made on claude-opus-4-1-20250805[1m]; throws, naming what went wrong. */
async function spelledReviews(plant?: ModelPlant): Promise<void> {
  const { reviewJobRun } = await review();
  const change = await changeSession('claude-opus-4-1-20250805[1m]');
  const w = await world();
  try {
    const bedrock = reviewJobRun(await reviewJob(w, 'bedrock-opus'), change, AT, plant);
    if (!bedrock.independence || bedrock.independence.counted) {
      throw new Error(`a review answered by us.anthropic.claude-opus-4-1-20250805-v1:0 of a change made on claude-opus-4-1-20250805[1m], the same model, counted: ${JSON.stringify(bedrock.independence)}`);
    }
    expect(bedrock.independence.reason).toBe('review not independent: same model');
    expect(bedrock.run.outcome).toBe('uncounted');

    const dated = reviewJobRun(await reviewJob(w, 'sonnet-dated'), change, AT, plant);
    const ind = dated.independence;
    if (!ind?.counted || ind.note !== 'same-family review' || /model unknown/.test(`${ind.reason ?? ''} ${ind.note ?? ''}`)) {
      throw new Error(`a review answered by claude-sonnet-4-5-20250929 was read as ${JSON.stringify(ind)}, not counted as a same-family review`);
    }
    expect(dated.run.outcome).not.toBe('uncounted');
  } finally {
    await w.close();
  }
}

describe('#87 models are compared, and their family looked up, by canonical ID', () => {
  it('a change made on claude-opus-4-1-20250805[1m], reviewed by a job whose output names us.anthropic.claude-opus-4-1-20250805-v1:0, is uncounted, "review not independent: same model"; a review answered by claude-sonnet-4-5-20250929 counts with "same-family review", never "model unknown"', async () => {
    await spelledReviews();
  }, 300_000);

  it('(wrong program) a check that compares the raw names counts the first review, and fails', async () => {
    await expect(spelledReviews('raw-names')).rejects.toThrow(/the same model, counted/);
  }, 300_000);

  it('(wrong program) a check that looks up the raw name\'s family reads the second as unknown, and fails', async () => {
    await expect(spelledReviews('raw-family')).rejects.toThrow(/claude-sonnet-4-5-20250929 was read as .*not counted as a same-family review/);
  }, 300_000);
});
