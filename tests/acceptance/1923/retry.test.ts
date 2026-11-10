// AC1: "A test job tool's paid call records its submission key before the request leaves the machine and the
// provider's task ID when it answers; after a hub kill between the two, a retry with the same key makes no second call
// and leaves the job BLOCKED with an unblock ask naming the provider and the key; a planted tool that resubmits on
// retry fails, naming the second call"
//
// asserts: through a real hub with test/hosted installed (its paid tool hosted-upper@1.0.0 calling the test provider
// on 127.0.0.1, under your standing rule), a deep_job run on "abc" reaches the provider once, carrying a submission
// key that a file under the hub's jobs folder already held, with the provider, when the request arrived; once the
// provider answers, that journal holds the key with the provider's task ID, and the key is the one the job's receipt
// names. A run on "xyz" is held at the provider; the hub is SIGKILLed by its PID after the request arrived and before
// the answer, and started again; the same deep_job twice then makes no second call at the provider, answers BLOCKED
// with no output both times, naming one unblock ask whose words name the provider's host and the key
// (helpers.ts judgeRetry). The same judge fails the planted tool hosted-resubmit@1.0.0, which records its key only
// with the answer, naming the second call its retry makes.
import { describe, expect, it } from 'vitest';
import { judgeRetry, PLANTED_TOOL, proof } from './helpers.ts';

describe('#1923.404a0625 A test job tool\'s paid call records its submission key before the request leaves the machine and the provider\'s task ID when it answers; after a hub kill between the two, a retry with the same key makes no second call and leaves the job BLOCKED with an unblock ask naming the provider and the key; a planted tool that resubmits on retry fails, naming the second call', () => {
  it('the key is recorded before the request leaves and the task ID when the provider answers; after a hub kill between the two, the retry makes no second call and is BLOCKED with one unblock ask naming the provider and the key', async () => {
    const { failures, seen } = await judgeRetry(false);
    proof('ac1-retry.json', { failures, seen });
    expect(failures).toEqual([]);
  }, 900_000);

  it('the planted tool that resubmits on retry fails, naming the second call', async () => {
    const { failures, seen } = await judgeRetry(true);
    proof(`ac1-planted-tool-${PLANTED_TOOL}.json`, { failures, seen });
    expect(failures.filter((f) => f.includes('second call')).length, `the judge fails the planted tool ${PLANTED_TOOL}, naming the second call: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
  }, 900_000);
});
