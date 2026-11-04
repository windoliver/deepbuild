// AC1 #992.45c71d36: a session whose permission prompt was denied with Esc, then ten minutes with no hook, reads quiet in
// `deep status` after the quiet period, not needs you. On the merge base it still reads needs you, naming the session.
// Each case runs on this suite's stand-in session (fixtures/sessions, written from Claude Code's hooks reference) and
// then on the corpus's recording of it, which the implementation adds (README: What the implementation must provide).
import { afterAll, describe, expect, test } from 'vitest';
import { AC1, cleanup, deepStatus, hookOf, label, MOVED_ON, mustRecord, mustTag, nothingAfter, type Recorded, replay, standIn, statusOf, statusWithin, stepClock, TEN_MINUTES } from './helpers.ts';

afterAll(cleanup);

/** Real time the hub gets, after its clock steps past the quiet period, to read the transcript's tail and say so. */
const READ_WITHIN = 35_000;

/** The recording is the criterion's case: a PermissionRequest tagged permission-denied-esc, then no hook that moves on. */
function denied(r: Recorded): number {
  const at = mustTag(r, 'permission-denied-esc', 'PermissionRequest');
  nothingAfter(r, at, (l) => MOVED_ON.includes(hookOf(l)) || (hookOf(l) === 'Notification' && l.payload.notification_type === 'idle_prompt'), 'a prompt denied with Esc and then silence');
  return at;
}

async function deniedThenQuiet(r: Recorded): Promise<void> {
  denied(r);
  const rp = await replay(r);
  const before = statusOf(await deepStatus(rp.h), rp.session);
  await stepClock(rp.hub, TEN_MINUTES);
  const after = await statusWithin(rp.h, rp.session, READ_WITHIN, (s) => s.state === 'quiet');
  expect(after.state, `${label(r)}: session ${rp.session}, its permission prompt denied with Esc and then 10 minutes with no hook, reads ${after.state ?? 'no row'}${after.why ? ` (${after.why})` : ''} in deep status, not quiet (right after the replay it read ${before.state ?? 'no row'}${before.why ? ` (${before.why})` : ''}):\n${after.text}`).toBe('quiet');
}

describe(AC1, () => {
  test(`${AC1}: a session whose permission prompt was denied with Esc, then 10 minutes with no hook, reads quiet in deep status, not needs you`, async () => {
    await deniedThenQuiet(standIn('permission-denied-esc'));
    await deniedThenQuiet(mustRecord('permission-denied-esc', 'a permission prompt denied with Esc'));
  }, 240_000);
});
