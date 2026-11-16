// AC5: your "no" to a call (its Send back, with a note) starts an attempt on that issue, with no further question. The
// call is on a change that reaches a release, so it waits for you, held, with nothing landed to revert (README:
// readings): what a "no" does there is another attempt, by every reading of when Send back reverts.
import { expect, test } from 'vitest';
import { FIRST, MIN, named, openCallsOf, said, sendBackOf, sleep, startsOf, waitUntil, World } from './helpers.ts';

const N = 100;

test(named(5), async () => {
  const w = await World.open({ issues: [{ reaches: 'release' }], atOnce: 'one' });
  await w.startRun();
  const call = await waitUntil(async () => openCallsOf(await w.events(), N)[0], FIRST, 2000);
  expect(call, `#${N}'s taste call is raised within ${FIRST / MIN} minutes of the approval (${await w.about(N)})`).toBeDefined();
  await sleep(30_000);
  expect(w.merged(N), `#${N}'s change reaches a release, so it waits for you, held (AC2)`).toBe(false);

  // Your "no": the call's Send back, with a note.
  const no = sendBackOf(call!);
  expect(no, `${call!.handle} offers Send back: ${JSON.stringify(call!.data.options)}`).toBeDefined();
  const at = Date.now();
  const refused = await w.answer(call!.handle, no!, 'Make the pay button green.').then(() => null, (error: Error) => error.message);
  expect(refused, `your "no" to ${call!.handle} counts on the trusted path`).toBeNull();
  const answered = await waitUntil(async () => (await w.events()).find((e) => e.kind === 'ask.answered' && e.subject === call!.handle), MIN, 1000);
  expect(answered, `the record holds your answer to ${call!.handle}`).toBeDefined();

  // It starts an attempt on #N, and asks nothing more.
  const again = await waitUntil(() => w.on(N).find((l) => l.started > at), 5 * MIN, 2000);
  expect(again, `your "no" starts an attempt on #${N}: a session starts on it after your answer (${w.starts(N).join('; ')})`).toBeDefined();
  expect(startsOf(await w.events(), N).filter((e) => e.log_pos > answered!.log_pos).length, `the record holds the attempt's start on #${N} after your answer`).toBeGreaterThan(0);
  await sleep(60_000);
  const asked = (await w.events()).filter((e) => e.kind === 'ask.created' && e.log_pos > answered!.log_pos);
  expect(asked.map(said), 'your "no" raises no second ask').toEqual([]);
}, 60 * MIN);
