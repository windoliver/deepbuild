// AC24 #19.44419f7e After a confirmed `deep off`, the next stop isn't held, while an agent's `pkill -f vite`, its Edit
// of `.deepbuild/done.yaml` and its write of `hooks = false` into its own config are each still denied, naming the guard.
//
// Every call reaches the hub (its acknowledgement is read off a forwarded socket), so the denial is the hub's after
// `deep off`, not deep-hook's floor with the hub away.

import { afterAll, it } from 'vitest';
import { cleanup } from './helpers.ts';
import { offKeepsTheGuards } from './scenarios.ts';

afterAll(cleanup, 60_000);

it('AC24 #19.44419f7e after a confirmed `deep off` the next stop isn\'t held, while `pkill -f vite`, an Edit of .deepbuild/done.yaml and a Codex apply_patch writing `hooks = false` into ~/.codex/config.toml are each still denied by the hub, naming a fail_closed guard', async () => {
  await offKeepsTheGuards();
}, 600_000);
