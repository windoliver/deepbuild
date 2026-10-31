import { describe, expect, it } from 'vitest';
import {
  ANCHOR, DOC, SHARED_LABEL, evictionFailures, evictionPlan, labelBoard, presented, scenario, shape, shareFailures, sharedRuns, show, showRun,
  useEvidence, useRelease,
} from './helpers.ts';

useRelease('deep-text', 'deep-show');
const evidence = useEvidence();

/** Two boards showing the one label, `ink` in DOC.a and `muted` in DOC.b, then the cache's runs of that label. */
function shared(planted?: string): ReturnType<typeof sharedRuns> {
  const replies = showRun(scenario(evidence(), [
    show(DOC.a, labelBoard('ink')),
    show(DOC.b, labelBoard('muted')),
    { call: 'shaped_runs', text: SHARED_LABEL },
  ]), planted);
  presented(replies[0]!, 'the first board');
  presented(replies[1]!, 'the second board');
  return sharedRuns(replies[2]!, 'shaped_runs');
}

describe('AC4 the cache stays inside its byte bound, evicts the least recently used, and is shared by every document', () => {
  it('AC4 over a run of 100,000 distinct strings the cache stays inside its byte bound and evicts the least recently used', () => {
    const plan = evictionPlan();
    const { replies } = shape(plan.inputs);
    expect(evictionFailures(plan, replies), 'the cache over 100,000 distinct strings').toEqual([]);
  }, 1_800_000);

  it('AC4 the planted cache that evicts the oldest run fails, naming the run it dropped though it was used recently', () => {
    const plan = evictionPlan();
    const { replies } = shape(plan.inputs, 'evicts_oldest');
    const failures = evictionFailures(plan, replies);
    expect(failures.length, 'the planted cache fails the check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the anchor, evicted though used recently').toContain(`the anchor ${JSON.stringify(ANCHOR.slice(0, 40))}`);
  }, 1_800_000);

  it('AC4 two documents showing the same label share one run, shaped once', () => {
    expect(shareFailures(shared()), 'the label\'s runs').toEqual([]);
  }, 1_800_000);

  it('AC4 the planted cache per document fails, naming the runs and the times the label was shaped', () => {
    const failures = shareFailures(shared('run_per_document'));
    expect(failures.length, 'the planted cache per document fails the check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the runs and the shapings').toMatch(/holds 2 runs of .* for two documents|shaped 2 times for two documents/);
  }, 1_800_000);
});
