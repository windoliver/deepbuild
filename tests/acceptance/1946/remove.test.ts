// AC1 #1946.a67b553d and the first two clauses of AC3 #1946.525c8ef7: Remove it after a setup that enabled a user
// service as you and installed a package as root, on dh-ubuntu.
//
// One world (README, The worlds): a throwaway user there whose sudo needs its password, lingering on, and an agent's
// session for the root plan. helpers.ts's setupAndRemove: the host's checks are drafted after a probe (draftMachine of
// packages/checks-host, nothing asked of the host) and must pass; the setup is a remote run as you that writes and
// enables dh1946-<id>-web.service, listening on 127.0.0.1:<port> (run.start with its changes), and a root plan the agent
// proposes that installs the test package dh1946-<id>-pkg, approved and run with `deep host run` and your password; the
// checks must then fail at the service's address; then `deep host remove dh-ubuntu`, each root plan it raises approved
// and run with your password, and the checks run again.
// AC1 (judgeChecks): the host's checks pass again after Remove it.
// AC3 (judgeGrants): the service is undone as you, with no root step naming it, and the package in one root plan, as
// the host and the record (host.undone with its grant) both show. The planted Remove remove-undoes-all-as-root
// (DEEP_HUB_PLANT on that world's hub and every deep command) must fail it, the host's checks failing, naming the service.
import { beforeAll, describe, expect, test } from 'vitest';
import { AC, judgeChecks, judgeGrants, openWorld, proof, redact, setupAndRemove, type Flow } from './helpers.ts';

let flow: Flow;
beforeAll(async () => {
  const w = await openWorld('deep-ubuntu', { agent: true });
  flow = await setupAndRemove(w);
  proof('setup-and-remove.json', { seen: flow.seen, answered: w.answered });
}, 3_600_000);

describe(AC[1], () => {
  test('the host\'s checks, drafted after a probe before setup and failing after it, pass again after Remove it', () => {
    const failures = judgeChecks(flow);
    proof('ac1-checks.json', { failures, before: flow.before, after_setup: flow.afterSetup, after_remove: flow.afterRemove, checks: flow.checks });
    expect(failures.map(redact), 'the host\'s checks pass after Remove it').toEqual([]);
  });
});

describe(AC[3], () => {
  test('Remove it disables the user service as you, with no root step naming it, and removes the package in one root plan', () => {
    const failures = judgeGrants(flow);
    proof('ac3-grants.json', { failures });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  });

  test('the planted Remove that runs every undo as root leaves the service enabled for your user and fails the host\'s checks, naming the service', async () => {
    const w = await openWorld('deep-ubuntu', { agent: true, plant: 'remove-undoes-all-as-root' });
    const planted = await setupAndRemove(w);
    const failures = judgeGrants(planted).map(redact);
    proof('ac3-plant-remove-undoes-all-as-root.json', { failures, seen: planted.seen });
    expect(failures.filter((f) => f.includes(`${planted.unit} is still enabled for your user`)), `the judge finds ${planted.unit} still enabled: ${JSON.stringify(failures)}`).not.toEqual([]);
    expect(failures.filter((f) => f.includes('the host\'s checks fail') && f.includes(planted.unit)), `the judge fails the host's checks, naming ${planted.unit}: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, 3_600_000);
});
