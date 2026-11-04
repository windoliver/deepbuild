// The runner records a review job's answering model as the one with the most output tokens in its usage, never the
// first one its output lists. The job is real, through the runner (#159); its recorded output is Claude Code's,
// whose result lists the haiku its own small calls used (40 output tokens) before the sonnet that reviewed (3,000).
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import type { Plant } from '../../../../packages/runner/src/index.ts';
import { reviewJob, world } from './helpers.ts';

afterAll(cleanup, 30_000);

async function answering(plant?: Plant): Promise<void> {
  const w = await world(plant ? { plant } : {});
  try {
    const job = await reviewJob(w, 'haiku-then-sonnet', { model: 'claude-sonnet-4-5' });
    if (job.model !== 'claude-sonnet-4-5') {
      throw new Error(`the review job recorded ${String(job.model)}${job.model === 'claude-haiku-4-5' ? ', the first model its usage lists,' : ''} not claude-sonnet-4-5, the model with the most output tokens`);
    }
    expect(job.kind).toBe('review');
  } finally {
    await w.close();
  }
}

describe('#87 a review job\'s answering model is the one with the most output tokens in its usage', () => {
  it('a Claude Code review job whose usage lists claude-haiku-4-5 with 40 output tokens first and claude-sonnet-4-5 with 3,000 records claude-sonnet-4-5', async () => {
    await answering();
  }, 300_000);

  it('(wrong program) a runner that takes the first model listed records the other, and fails', async () => {
    await expect(answering('first-model-listed')).rejects.toThrow(/recorded claude-haiku-4-5, the first model its usage lists/);
  }, 300_000);
});
