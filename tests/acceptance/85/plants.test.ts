// The wrong programs the Proof names, planted around the real asks core (plants.ts). Each test first runs its
// criterion's scenario on the real program, which must pass, then on the plant, which must fail, naming what the
// criterion says it names.

import { expect, test } from 'vitest';
import { STOPS } from './helpers.ts';
import { closesOnAnyReply, continuesAfterRefusal, continuesAfterTyped, continuesTwice, keyedOnCause, taskPerSession } from './plants.ts';
import { droppedOnce, lateStop, refusalStop, sharedTask, threadTask, typedOrNewer } from './scenarios.ts';

test('#85.828d7241 fails on a core that raises one task per stopped session instead of one per cause, naming the five sessions', async () => {
  await sharedTask(STOPS.signIn(), 'a revoked sign-in');
  await expect(sharedTask(STOPS.signIn(), 'a revoked sign-in', taskPerSession)).rejects.toThrow(/the 5 sessions stopped by one cause share one task, open in your inbox/);
}, 60_000);

test('#85.0fa0b6d4 fails on a core that raises one task per stopped session, naming the five sessions', async () => {
  await sharedTask(STOPS.vpn(), 'a VPN you must reconnect');
  await expect(sharedTask(STOPS.vpn(), 'a VPN you must reconnect', taskPerSession)).rejects.toThrow(/the 5 sessions stopped by one cause share one task, open in your inbox/);
}, 60_000);

test('#85.243cc63a fails on a core that raises one task per stopped session, naming the five sessions', async () => {
  await sharedTask(STOPS.spend(), 'a spend limit');
  await expect(sharedTask(STOPS.spend(), 'a spend limit', taskPerSession)).rejects.toThrow(/the 5 sessions stopped by one cause share one task, open in your inbox/);
}, 60_000);

test('#85.0840911e fails on a core that continues twice, naming the second drop', async () => {
  await droppedOnce();
  await expect(droppedOnce(continuesTwice)).rejects.toThrow(/the continued turn dropped again \(stop [0-9A-Z]+\): no second automatic continue; it resumes once/);
}, 60_000);

test('#85.65bcfca8 fails on a core that continues after a refusal, naming the refusal', async () => {
  await refusalStop();
  await expect(refusalStop(continuesAfterRefusal)).rejects.toThrow(/the refusal \(stop [0-9A-Z]+\) gets no automatic continue/);
}, 60_000);

test('#85.d96aabec fails on a rule keyed only on the cause, which continues the 9-hour-old stop, naming it', async () => {
  await lateStop();
  await expect(lateStop(keyedOnCause)).rejects.toThrow(/stop [0-9A-Z]+, 9 hours old by its stamp when it reached the hub, starts no automatic continue/);
}, 60_000);

test('#85.348d7b85 fails on a core that continues a stop though a prompt you typed reached the session since, naming the stop', async () => {
  await typedOrNewer();
  await expect(typedOrNewer(continuesAfterTyped)).rejects.toThrow(/stop [0-9A-Z]+, followed by a prompt you typed, starts no automatic continue/);
}, 60_000);

test("#85.e12ca936 fails on a core whose thread check closes the task on any bot reply, right or wrong, naming the wrong reply", async () => {
  await threadTask();
  await expect(threadTask(closesOnAnyReply)).rejects.toThrow(/the bot replied wrong: task ask:[0-9A-Za-z]+ stays open/);
}, 60_000);
