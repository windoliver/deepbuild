// AC2 #1946.fa254d06: a sudo rule DeepBuild writes for a root plan names the script's sha256 digest, shows in the plan
// as a host change with its undo, and is taken out by Remove it.
//
// Each world is on dh-fedora (README, The worlds: its sudo checks command digests; deep-ubuntu's sudo-rs can't parse
// them), a throwaway user there whose sudo needs its password, and an agent's session. helpers.ts's judgeSudoRule: the
// agent writes a script and proposes it with deep_root_plan and sudo_rule true; its plan must show a step changing a
// file under /etc/sudoers.d/ with an undo; approved and run with `deep host run` and your password, the record must hold
// the rule as a host change as root with its undo, and the rule must name the script's sha256 digest. As your user,
// `sudo -n <the path the rule allows>` must run the unchanged script as root; with one byte of it changed, sudo must
// refuse it and nothing of it may run; then `deep host remove dh-fedora`, its root plan approved and run with your
// password, must leave no rule for that path. The planted hub sudo-rule-names-path (DEEP_HUB_PLANT on that world's hub
// and every deep command) must fail it for running the changed script.
import { describe, expect, test } from 'vitest';
import { AC, judgeSudoRule, openWorld, proof, redact } from './helpers.ts';

describe(AC[2], () => {
  test('the sudo rule for a root plan names its script\'s digest, so sudo refuses the script changed by one byte; the plan shows it with its undo, and Remove it takes it out', async () => {
    const w = await openWorld('deep-fedora', { agent: true });
    const { failures, seen } = await judgeSudoRule(w, 'A');
    proof('ac2-sudo-rule.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('the planted rule that names only the path runs the changed script and fails the judge', async () => {
    const w = await openWorld('deep-fedora', { agent: true, plant: 'sudo-rule-names-path' });
    const { failures, seen } = await judgeSudoRule(w, 'C');
    proof('ac2-plant-sudo-rule-names-path.json', { failures, seen });
    const words = failures.map(redact);
    expect(words.filter((f) => f.startsWith('sudo ran the changed script (variant D')), `the judge fails the planted rule for running the changed script: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 1_800_000);
});
