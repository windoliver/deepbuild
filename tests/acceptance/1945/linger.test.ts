// AC3 #1945.fcdd3d22: lingering is the first host change a remote run needs.
//
// Each world (README, The worlds) has a throwaway user on the host whose lingering is off; you start the host's first
// remote run with run.start (#1942's, as you), and the approver says yes to the asks that name the host.
// - On dh-ubuntu (helpers.ts's judgeLinger): the run's first line, written from inside it, says lingering was on as it
//   started; the record holds that host change (host.changed, enable-linger, its undo disable-linger) and
//   `deep host changes dh-ubuntu` shows it with its undo; then every connection to the host is cut and refused, and
//   with no SSH session of your user there for 60 s the run beats on, its unit and your user manager alive.
// - On dh-ubuntu again, with a polkit rule of the test's that makes lingering need an admin for that user
//   (judgeRootLinger): the run brings a root plan, an authority ask that defaults to no, whose plan turns lingering on
//   (enable-linger) with its undo (disable-linger); lingering stays off until you approve it and run it with
//   `deep host run`, typing the user's sudo password at the prompt; then it is on.
// - On dh-fedora, the planted hub host-skips-lingering (DEEP_HUB_PLANT) must fail judgeLinger for losing the run when
//   the last session closed, naming the host.
import { describe, expect, test } from 'vitest';
import { AC, judgeLinger, judgeRootLinger, openWorld, proof, redact } from './helpers.ts';

describe(AC[3], () => {
  test('on a host where your lingering is off, the first remote run turns it on before it starts, as a host change recorded and shown with its undo, and runs on with every SSH session of yours there closed', async () => {
    const w = await openWorld('deep-ubuntu', { user: 'test' });
    const { failures, seen } = await judgeLinger(w);
    proof('ac3-linger.json', { host: w.alias, failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('on a host whose policy needs root for lingering, the change comes as a root plan', async () => {
    const w = await openWorld('deep-ubuntu', { user: 'test', policy: true, approve: (created) => !/root/i.test(String(created.data.question)) });
    const { failures, seen } = await judgeRootLinger(w);
    proof('ac3-linger-root-plan.json', { host: w.alias, failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('the planted setup that skips lingering loses the run when the last session closes and fails the judge, naming the host', async () => {
    const w = await openWorld('deep-fedora', { user: 'test', plant: 'host-skips-lingering' });
    const { failures, seen } = await judgeLinger(w);
    proof('ac3-plant-host-skips-lingering.json', { host: w.alias, failures, seen });
    const words = failures.map(redact);
    expect(words.filter((f) => f.startsWith(`${w.alias} lost `)), `the judge fails the planted setup for losing the run, naming ${w.alias}: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 1_800_000);
});
