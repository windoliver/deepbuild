// AC21 #19.0694d419 `deep off`, `deep on`, `deep hub stop` and `deep setup --undo`, each run by a process an agent
// double-forked so launchd adopted it, change nothing until the OS confirms you, each saying why; confirmed, `deep off`
// makes the next hook reply watch-only within a second.
// AC22 #19.a4f7c68a `deep hub use --root <a dev hub's folder>`, run by a process an agent double-forked, changes nothing
// until the OS confirms you: cancelled, the worktree's next session still reaches the installed hub; confirmed, the dev hub.
//
// The OS confirmation is stubbed at its boundary (DEEP_HUB_TEST_CONFIRM, #24) for every process that might ask: the
// hubs and every `deep`. launchctl and systemctl are stand-ins that log their calls.

import { afterEach, it } from 'vitest';
import { ON_MACOS, cleanup } from './helpers.ts';
import { authorityCommandsWaitForYou, hubUseWaitsForYou } from './scenarios.ts';

afterEach(cleanup, 60_000);

it('AC21 #19.0694d419 double-forked `deep off`, `deep hub stop` and `deep setup --undo`, the prompt cancelled, leave the next hook reply gated, the hub running and setup\'s files in place, each exiting 3 and saying why; a confirmed one `deep off` makes the next reply watch-only within a second, and a cancelled `deep on` after it leaves it watch-only', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: the criterion is macOS's (launchd adopting a double-forked process); this is ${process.platform}`);
  await authorityCommandsWaitForYou();
}, 900_000);

it('AC22 #19.a4f7c68a double-forked `deep hub use --root <dev hub folder>`, the prompt cancelled, leaves the worktree\'s next session on the installed hub and says why; confirmed, the next session reaches the dev hub', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: the criterion is macOS's (launchd adopting a double-forked process); this is ${process.platform}`);
  await hubUseWaitsForYou();
}, 600_000);
