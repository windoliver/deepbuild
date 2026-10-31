// Criterion 2's scenario (#880.64e218e8), shared with plants.test.ts: valid signatures by the key recorded at setup,
// captured for an earlier ask and for the same ask at an older revision, replayed by a helper with the recorded code
// identity, are refused naming the ask; a fresh one counts. README: The contract per criterion, 2.

import { expect } from 'vitest';
import { captures, commit, deep, expectChallenge, expectCountedOnce, expectOpen, expectRefusedNaming, ready, setMode, signsSince } from './helpers.ts';

export async function replayedSignatures(plant?: string): Promise<void> {
  const { rig, hub, asks: [a1, a2] } = await ready(['release v1', 'release v2'], plant ? { plant } : {});

  // 1. The earlier ask, answered with a fresh signature over the hub's own challenge; the helper keeps a copy (capture 0).
  setMode(rig, { mode: 'capture' });
  let since = Date.now();
  const first = await deep(rig, ['inbox', 'answer', a1!, 'approve']);
  const c1 = expectChallenge(signsSince(rig, since)[0]?.challenge, a1!, `${a1} answered`);
  expect(first.code, `deep inbox answer ${a1} approve, signed by the key recorded at setup over the hub's own challenge, counts and exits 0: ${first.stdout} ${first.stderr}`).toBe(0);
  await expectCountedOnce(hub, a1!, 'approve', 'signed by the recorded key over its own challenge');

  // 2. The second ask at its first revision: signed and kept (capture 1), and the prompt reported cancelled.
  setMode(rig, { mode: 'capture-cancel' });
  since = Date.now();
  const cancelled = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  const c2 = expectChallenge(signsSince(rig, since)[0]?.challenge, a2!, `${a2} at its first revision`);
  expect(c2.nonce, 'each confirmation gets a fresh nonce').not.toBe(c1.nonce);
  expect(cancelled.code, `a cancelled prompt leaves ${a2} undecided: exit 3: ${cancelled.stdout} ${cancelled.stderr}`).toBe(3);
  await expectOpen(hub, a2!, 'the prompt cancelled');
  expect(captures(rig).map((c) => c.challenge.ask), 'the helper kept a signature for each ask').toEqual([a1, a2]);

  // 3. The signature captured for the earlier ask, returned for this one.
  setMode(rig, { mode: 'replay', capture: 0 });
  since = Date.now();
  const replayedOther = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  await expectOpen(hub, a2!, `answered with the valid signature captured for the earlier ask ${a1}`);
  expectRefusedNaming(replayedOther, a2!, `the signature captured for ${a1}`);
  expect(signsSince(rig, since).length, 'the hub asked the helper (with the recorded identity) to sign').toBeGreaterThan(0);

  // 4. Scope: a signature over an earlier nonce for the same ask at the same revision.
  setMode(rig, { mode: 'replay', capture: 1 });
  const replayedNonce = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  await expectOpen(hub, a2!, `answered with the signature captured for it moments ago, over an earlier nonce`);
  expectRefusedNaming(replayedNonce, a2!, 'a signature over an earlier nonce');

  // 5. The worktree the ask is pinned to moves on, so the ask is at a newer revision; the signature captured at the
  //    older one is returned.
  commit(rig, 'second');
  since = Date.now();
  const replayedOld = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  await expectOpen(hub, a2!, `answered with the signature captured for it at an older revision`);
  expectRefusedNaming(replayedOld, a2!, 'a signature captured at an older revision');
  const c5 = expectChallenge(signsSince(rig, since)[0]?.challenge, a2!, `${a2} after its worktree moved on`);
  expect(c5.revision, `the hub's challenge for ${a2} moved with its revision once its worktree moved on (design: Asks stay current)`).not.toBe(c2.revision);

  // 6. A fresh signature over the hub's own challenge, by the same helper and key, counts: what refused 3 to 5 was
  //    what the signatures covered.
  setMode(rig, { mode: 'sign' });
  const fresh = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  expect(fresh.code, `deep inbox answer ${a2} approve with a fresh signature exits 0: ${fresh.stdout} ${fresh.stderr}`).toBe(0);
  await expectCountedOnce(hub, a2!, 'approve', 'a fresh signature at its current revision');
}
