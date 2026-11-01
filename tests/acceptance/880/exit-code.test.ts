// #880.dcc31bd2: with the hub's `packages/hub/dist/deep-confirm` replaced by a script that prints nothing and exits 0,
// a yes with authority from `deep inbox` is refused, naming the helper's path, and its ask stays open. The hub runs
// without DEEP_HUB_TEST_CONFIRM, from a copy of the built hub whose helper the test replaces (README: The copy of the
// hub), so this checkout's build is never touched.

import { afterEach, expect, test } from 'vitest';
import { cleanup, deep, expectCountedOnce, expectOpen, expectRefusedNaming, installHelper, plantExitZero, ready, setMode } from './helpers.ts';

afterEach(cleanup, 60_000);

test('#880.dcc31bd2 with deep-confirm replaced by a script that prints nothing and exits 0, a yes with authority from deep inbox is refused naming the helper\'s path, and its ask stays open', async () => {
  const { rig, hub, asks: [ask] } = await ready(['release v1']);

  plantExitZero(rig);
  const r = await deep(rig, ['inbox', 'answer', ask!, 'approve']);
  await expectOpen(hub, ask!, 'a yes with authority from deep inbox, the helper replaced by a script that prints nothing and exits 0');
  expectRefusedNaming(r, rig.helper, 'the helper replaced by an exit-0 script');

  // The helper setup recorded, put back: the same answer counts, so what refused it was the helper at that path.
  installHelper(rig, rig.built);
  setMode(rig, { mode: 'sign' });
  const again = await deep(rig, ['inbox', 'answer', ask!, 'approve']);
  expect(again.code, `with the helper setup recorded back in place, the same answer counts and exits 0: ${again.stdout} ${again.stderr}`).toBe(0);
  await expectCountedOnce(hub, ask!, 'approve', 'the recorded helper back in place');
}, 600_000);
