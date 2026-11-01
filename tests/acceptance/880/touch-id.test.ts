// #880.e0afc5f5: on the reference Mac, a manual run: Touch ID accepted gives a counted answer within 2 s of the touch;
// Touch ID cancelled leaves the ask open with "the prompt was cancelled". A person runs it (README: Criterion 4, the
// manual run): it uses the real deep-confirm and the real Secure Enclave, and shows Touch ID twice. Without the opt-in a
// person sets, or off a reference Mac, it is skipped as INCONCLUSIVE, never passed. No automated run shows Touch ID.

import { execFileSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { cleanup, deep, expectCountedOnce, expectOpen, ready, shown, sleep, type Ran, type Rig } from './helpers.ts';

afterEach(cleanup, 60_000);

const OPT_IN = 'DEEP_880_TOUCH_ID';
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
const TOUCH_TO_COUNT_MS = 2000;

/** Why this machine isn't a reference Mac, or null. */
function notReference(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
  return REFERENCE_MACS.includes(model) ? null : `not a reference Mac (${model}; the reference Macs are ${REFERENCE_MACS.join(' and ')})`;
}

/**
 * `deep inbox answer`, watching for the helper's process: the time it was last seen running is when the touch was
 * taken and signed (the helper exits right after), so the command's exit minus it bounds touch-to-counted from above
 * the hub's side. The screen capture shows the touch itself.
 */
async function answerWatched(rig: Rig, ask: string): Promise<Ran & { helperLastSeen: number | null }> {
  let lastSeen: number | null = null;
  let done = false;
  const watch = (async () => {
    while (!done) {
      const listed = execFileSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8' });
      if (listed.split('\n').some((l) => l.startsWith(rig.helper))) lastSeen = Date.now();
      await sleep(20);
    }
  })();
  const r = await deep(rig, ['inbox', 'answer', ask, 'approve']);
  done = true;
  await watch;
  return { ...r, helperLastSeen: lastSeen };
}

test('#880.e0afc5f5 on the reference Mac, Touch ID accepted counts the answer within 2 s of the touch; cancelled leaves the ask open with "the prompt was cancelled"', async (ctx) => {
  if (process.env[OPT_IN] !== '1') ctx.skip(`INCONCLUSIVE: a manual run on the reference Mac; a person sets ${OPT_IN}=1, records the screen, and touches or cancels when asked (README: Criterion 4)`);
  const problem = notReference();
  if (problem) ctx.skip(`INCONCLUSIVE: ${problem}`);

  const { rig, hub, asks: [accept, cancel] } = await ready(['release v1', 'release v2'], { realHelper: true });

  console.log(`\n>>> ${new Date().toISOString()} Touch ID will ask to answer ${accept}. TOUCH THE SENSOR to accept.\n`);
  const accepted = await answerWatched(rig, accept!);
  console.log(`>>> helper last seen ${accepted.helperLastSeen ? new Date(accepted.helperLastSeen).toISOString() : 'never'}; deep inbox answer exited ${new Date(accepted.end).toISOString()}`);
  expect(accepted.code, `Touch ID accepted: deep inbox answer ${accept} approve exits 0: ${shown(accepted)}`).toBe(0);
  await expectCountedOnce(hub, accept!, 'approve', 'Touch ID accepted');
  expect(accepted.helperLastSeen, 'the hub ran deep-confirm beside its code, which showed Touch ID').not.toBeNull();
  const afterTouch = accepted.end - accepted.helperLastSeen!;
  expect(afterTouch, `the answer counted ${afterTouch} ms after the helper took the touch; within ${TOUCH_TO_COUNT_MS} ms`).toBeLessThanOrEqual(TOUCH_TO_COUNT_MS);

  console.log(`\n>>> ${new Date().toISOString()} Touch ID will ask to answer ${cancel}. Press CANCEL.\n`);
  const cancelled = await answerWatched(rig, cancel!);
  expect(cancelled.code, `Touch ID cancelled: deep inbox answer ${cancel} approve exits 3: ${shown(cancelled)}`).toBe(3);
  expect(`${cancelled.stdout}\n${cancelled.stderr}`, `Touch ID cancelled: the refusal says "the prompt was cancelled": ${shown(cancelled)}`).toContain('the prompt was cancelled');
  await expectOpen(hub, cancel!, 'Touch ID cancelled');
}, 900_000);
