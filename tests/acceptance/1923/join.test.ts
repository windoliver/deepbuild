// AC2: "A second deep_job with the same key while the first is running joins it and starts no call, and cancelling
// the joining request leaves the job running for the first; a planted runner that starts a second call, or that
// cancels the job when the joiner cancels, fails, naming the key"
//
// asserts: through a real hub with test/hosted installed (hosted-upper@1.0.0 calling the test provider, under your
// standing rule), three `deep mcp`s, each an agent's: A's deep_job on "abc" reaches the provider, which holds its
// answer; B's same deep_job (the same key) is still unanswered 3 s later; B's request is cancelled with MCP's
// notifications/cancelled, and 3 s later the tool's request to the provider is still open and A is still unanswered;
// C's same deep_job is unanswered 3 s later too. Once the provider answers, A is done with "ABC" by hash, C is done
// with "ABC" and a receipt naming the key with joined: true, B has no done reply, and the provider got one call in all
// (helpers.ts judgeJoin). The same judge fails the planted runner job-second-call, naming the key and the second
// call, and the planted runner job-joiner-cancels-job, naming the key and the cancel.
import { describe, expect, it } from 'vitest';
import { judgeJoin, proof, type HubPlant } from './helpers.ts';

async function planted(plant: HubPlant, about: RegExp): Promise<void> {
  const { failures, seen, key } = await judgeJoin(plant);
  proof(`ac2-planted-${plant}.json`, { failures, seen });
  expect(key, `the planted runner ${plant}'s job reached the provider with its key: ${JSON.stringify(failures)}`).toBeTruthy();
  expect(failures.filter((f) => f.includes(key!) && about.test(f)).length, `the judge fails the planted runner ${plant}, naming the key ${key}: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
}

describe('#1923.d2c84e1d A second deep_job with the same key while the first is running joins it and starts no call, and cancelling the joining request leaves the job running for the first; a planted runner that starts a second call, or that cancels the job when the joiner cancels, fails, naming the key', () => {
  it('a second deep_job with the same key joins the running job and starts no call; cancelling it leaves the job running for the first, which gets its output', async () => {
    const { failures, seen } = await judgeJoin();
    proof('ac2-join.json', { failures, seen });
    expect(failures).toEqual([]);
  }, 900_000);

  it('the planted runner that starts a second call for the same key fails, naming the key', async () => {
    await planted('job-second-call', /second call/);
  }, 900_000);

  it('the planted runner that cancels the job when the joiner cancels fails, naming the key', async () => {
    await planted('job-joiner-cancels-job', /^cancelling the joining request/);
  }, 900_000);
});
