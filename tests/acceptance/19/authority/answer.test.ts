// AC2 #19.2c46147f An answer typed into `deep` from inside an agent's process tree is refused and says why.
// AC19 #19.1a7ba6d9 On macOS, an authority answer typed into `deep` by a process an agent double-forked, so launchd
// adopted it and the peer check finds no agent above it, counts only once the OS confirms you.
//
// The OS confirmation is stubbed at its boundary (DEEP_HUB_TEST_CONFIRM, #24); the agent is the Claude Code stand-in
// whose hooks ran setup's entries, so the hub knows its process; the authority ask is seeded through the asks core.

import { afterEach, it } from 'vitest';
import { ON_MACOS, cleanup } from './helpers.ts';
import { agentAnswerRefused, doubleForkedAnswer } from './scenarios.ts';

afterEach(cleanup, 60_000);

it('AC2 #19.2c46147f `deep inbox answer`, run by the agent\'s Bash tool inside its process tree, is refused with exit 3 and says why (it runs inside that agent session\'s process tree), even with the OS confirming you; the ask stays open until you answer it', async () => {
  await agentAnswerRefused();
}, 600_000);

it('AC19 #19.1a7ba6d9 an authority answer typed into `deep inbox answer` by a process the agent double-forked (launchd adopted it) never counts with the LocalAuthentication prompt cancelled, and counts once when confirmed', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: the criterion is macOS's (launchd adopting a double-forked process); this is ${process.platform}`);
  await doubleForkedAnswer();
}, 600_000);
