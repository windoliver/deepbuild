// AC1 #1454.67866115: In the real app, answering a card on a live fixture session reaches that session, and the record shows
// the answer once.
//
// A live fixture session: an agent stand-in with its hooks and its own `deep mcp` on a real hub, holding `deep_ask` open.
// The real `deep-app` shows its row, and a press from outside its process presents the card and picks an option. The answer
// counts when `deep_ask` (or `deep_wait`, past its 40 s) hands it to the session, and when the hub's `events.read` shows one
// `ask.answered` for it, from the card. A label on the window proves nothing here.
//
// An accessibility press isn't hardware, so the design makes it answer only after the OS confirms you. The test goes through
// that gate both ways: the OS says no, and nothing counts; then yes (README, Pinned 2). So the wrong program this fails on,
// beside the base, is an app that takes any press as you (`plant-card-skips-confirm`).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerFailures, App, appBinary, MINUTES, named, pressOption, raise, sessionWorld, settled, sleep, t26, t806, unconfirmedFailures, useCleanup, type Asked, type Feature,
} from './helpers.ts';

useCleanup();
/** The stand-in for the OS prompt: `confirmed` in this file is you, anything else a cancelled prompt (README, Pinned 2). */
const CONFIRM = 'DEEP_APP_TEST_CONFIRM';
const QUESTION = 'Which header colour on the login page?';

/** The app with the stand-in. The base has no such feature: its plain app runs, so its own failure is the one shown. */
async function confirmable(...plants: Feature[]): Promise<{ binary: string; missing?: string }> {
  try {
    return { binary: await appBinary('test-confirm', ...plants) };
  } catch (error) {
    return { binary: await appBinary(), missing: (error as Error).message };
  }
}

interface Run { ask: Asked; unconfirmed: string[]; answered: string[]; left: string[]; missing?: string | undefined }
async function answerOnCard(...plants: Feature[]): Promise<Run> {
  const world = await sessionWorld();
  const { binary, missing } = await confirmable(...plants);
  const file = join(t806.tempDir(), 'os-confirm');
  writeFileSync(file, 'cancelled\n');
  // The app first: `deep_ask` holds its call open for 40 s, and a first launch can take longer than that.
  const app = await App.launch({ home: world.home, binary, env: { [CONFIRM]: file } });
  try {
    const ask = await raise(world, QUESTION);
    const pressed = await pressOption(app, ask);
    if (pressed.length) return { ask, unconfirmed: [], answered: pressed, left: [], missing };
    // A cancelled prompt leaves the ask open and the card armed. Give a wrong program time to send it.
    await sleep(3000);
    const unconfirmed = unconfirmedFailures(ask, await t26.events(world.hub));
    writeFileSync(file, 'confirmed\n');
    const again = unconfirmed.length ? { pressed: true } : await app.press(ask.pick.label, 'AXButton');
    const reached = await Promise.race([ask.wait(), sleep(60_000).then(() => undefined)]);
    const answered = [
      ...(again.pressed ? [] : [`the card left with the OS's no, so the same option takes no second press: ${JSON.stringify(again)}`]),
      ...answerFailures(ask, await t26.events(world.hub), reached),
    ];
    const left = await settled(async () => (named(await app.tree()).some((n) => n.name.includes(QUESTION)) ? [`the window still shows "${QUESTION}", answered`] : []));
    return { ask, unconfirmed, answered, left, missing };
  } finally {
    await app.stop();
  }
}

describe('#1454 an answer on the real app\'s card reaches its session', () => {
  it('AC1 #1454.67866115 in the real app, answering a card on a live fixture session reaches that session, and the record shows the answer once', async () => {
    const run = await answerOnCard();
    expect([...run.unconfirmed, ...run.answered, ...run.left], run.missing ?? 'the run built the stand-in').toEqual([]);
    expect(run.missing, 'the stand-in for the OS prompt exists').toBeUndefined();
  }, 10 * MINUTES);

  it('AC1 #1454.67866115 wrong program: an app that takes a press from no hardware as you fails, naming the ask', async () => {
    const run = await answerOnCard('plant-card-skips-confirm');
    expect(run.missing, 'the planted build exists').toBeUndefined();
    expect(run.unconfirmed.join('\n')).toContain(`${run.ask.handle} was answered green though the OS didn't confirm you`);
  }, 10 * MINUTES);

  it('AC1 #1454.67866115 the stand-in for the OS prompt is in no shipped build: the plain app holds no word of it', async () => {
    const plain = readFileSync(await appBinary());
    expect(plain.includes(CONFIRM), `target/debug/deep-app, built with no feature, reads ${CONFIRM}, so an agent's process could answer for you`).toBe(false);
    const { binary, missing } = await confirmable();
    expect(missing, 'the stand-in for the OS prompt exists').toBeUndefined();
    expect(readFileSync(binary).includes(CONFIRM), `the test-confirm build reads ${CONFIRM}`).toBe(true);
  }, 10 * MINUTES);
});
