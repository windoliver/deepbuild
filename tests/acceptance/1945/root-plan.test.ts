// AC1 #1945.5592231a and AC2 #1945.a62d8bc1: a root plan an agent proposes and you approve, run by `deep host run` in
// your own terminal with your sudo password typed only at its prompt.
//
// One world on deep-fedora (README, The worlds): a throwaway user there whose sudo needs its password (lingering off),
// a chat channel every ask goes to, and an agent's session (fixtures/agent.mjs through the real deep-hook and its own
// deep mcp). The agent writes each plan's script in its folder on the host and proposes it with deep_root_plan; you
// approve it with `deep inbox answer` and run it with `deep host run <ask>` in a pseudo-terminal, typing the password
// once sudo's prompt shows.
//
// AC1 (helpers.ts's judgePassword): after a plan ran with the password typed, and the agent and the channel had their
// chances to be handed anything, the password, in every form passwordForms lists, is in none of: the record (events.read
// and every file of the hub's), a log (the hub's output, every deep command's, every other file of the world, and on the
// host every file written since the user was made and the journal since then), what the agent was handed, or what the
// channel sent. Each place must first hold a control value, so a search that reaches nothing fails.
// AC2 (judgeLocked): the plan's script changed by one byte where the agent wrote it, after your yes, is refused by
// `deep host run` before anything of it runs as root, naming the hash the plan locked and the one it found; with the
// byte put back it runs as root from a copy in a folder only root can write, and the record holds the run with exit 0
// and its output's SHA-256 as evidence. The planted `deep` root-plan-runs-agent-path (DEEP_HUB_PLANT on the command)
// must fail the same judge for running the changed script.
import { beforeAll, describe, expect, test } from 'vitest';
import { AC, judgeLocked, judgePassword, openWorld, proof, redact, Session, type World } from './helpers.ts';

let w: World;
let s: Session;
beforeAll(async () => {
  w = await openWorld('deep-fedora', { user: 'test', channel: true, noToolWait: true });
  s = new Session(w, `${w.tmp}/work`);
  await s.start();
}, 1_800_000);

describe(AC[1], () => {
  test('the sudo password you type at the prompt of `deep host run` reaches neither the record, a log, the agent nor the channel', async () => {
    const { failures, seen } = await judgePassword(w, s);
    proof('ac1-password.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds the password nowhere it searched, and each place held its control').toEqual([]);
  }, 1_800_000);
});

describe(AC[2], () => {
  test('a root plan\'s script changed by one byte where the agent wrote it is refused before anything runs as root, naming both hashes; unchanged, it runs from a copy only root can write, its output and exit code the run\'s evidence', async () => {
    const { failures, seen } = await judgeLocked(w, s, 'A');
    proof('ac2-root-plan.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('the planted `deep` that runs the script from the agent\'s path runs the changed script and fails the judge', async () => {
    const { failures, seen } = await judgeLocked(w, s, 'C', 'root-plan-runs-agent-path');
    proof('ac2-plant-root-plan-runs-agent-path.json', { failures, seen });
    const words = failures.map(redact);
    expect(words.filter((f) => /ran the changed script \(variant D/.test(f)), `the judge fails the planted deep for running the changed script as root: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 1_800_000);
});
