// AC1: On a fixture forge that enforces required statuses, a status with the right context from an agent's credential
// leaves the commit unmergeable, and the same status from the gate identity makes it mergeable. A rule that reads the
// context alone fails, naming the poster.
//
// The rules are DeepBuild's (`deep gate rules`), put on the forge by maya as you would put them. The agent's status is
// posted with a token of the agents' app that can post statuses: AC1 reads the rule, not the credential (AC2 does), so
// the status has to land. The gate's is the hub's own: a PASS on the pull request's head, posted by #46's poster with
// whatever identity the hub posts with. The wrong program is the plant `rule-reads-context-alone`.
import { describe, expect, it } from 'vitest';
import { AC, CONTEXT, failureOf, GATE_APP, must, SHOP, waitFor, World } from './helpers.ts';

const LONG = 600_000;
let poster = '';

async function scenario(plant?: string): Promise<void> {
  const w = await World.open(plant ? { plant } : {});
  await w.applyRules();
  const agentToken = await w.mint('agents', { metadata: 'read', statuses: 'write' });
  poster = w.loginOf(w.agents);
  const posted = await w.api('POST', `/repos/${SHOP}/statuses/${w.head}`, { state: 'success', context: CONTEXT, description: 'PASS' }, agentToken);
  if (posted.status !== 201) throw Error(`BLOCKED: the fixture forge must take the agents' app's status: ${posted.status} ${JSON.stringify(posted.json)}`);
  const before = await w.pullState();
  must(before !== 'clean', `pull request #${w.pr} is mergeable on a ${CONTEXT} status posted by ${poster}, not by the gate identity`);
  must(before === 'blocked', `pull request #${w.pr} reads ${before}, not blocked, with only ${poster}'s ${CONTEXT} status on its head`);

  const status = await w.gatePass();
  must(status.app === w.gate.id, `the PASS's ${CONTEXT} status on ${w.head} was posted by ${status.creator}, not by the gate identity (${w.loginOf(w.gate)}, app ${GATE_APP.id})`);
  must(status.state === 'success', `the gate identity's status on a PASS is success: ${status.state}`);
  const after = await waitFor(async () => { const s = await w.pullState(); return s === 'clean' ? s : undefined; }, 15_000, 'clean').catch(async () => w.pullState());
  must(after === 'clean', `pull request #${w.pr} reads ${after}, not mergeable, with the gate identity's green ${CONTEXT} on its head`);
}

describe(`${AC[1]} Only the gate identity's ${CONTEXT} makes a commit mergeable on a forge that enforces required statuses`, () => {
  it(`${AC[1]} the agents' ${CONTEXT} leaves pull request #1 blocked; the gate identity's, from a PASS, makes it clean`, async () => {
    await scenario();
  }, LONG);

  it(`${AC[1]} (planted rule-reads-context-alone) a rule that reads the context alone fails, naming the poster`, async () => {
    const failure = await failureOf(() => scenario('rule-reads-context-alone'));
    expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
    expect(failure).toContain(`is mergeable on a ${CONTEXT} status posted by ${poster}`);
    expect(poster).toBe('deepbuild-agents[bot]');
  }, LONG);
});
