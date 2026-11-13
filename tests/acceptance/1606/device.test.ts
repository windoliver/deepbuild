// #1606 AC5 and AC9: the real app's device key, after it paired and answered on its card, and after it moved an older
// app's key. The real `deep-app`, built with its two stand-ins (the OS prompt's, #1454's `test-confirm`, and the OS
// store's, `test-secrets`; README, Surfaces), against a real hub in a temp home, with a live fixture session (#26's
// agent stand-in and its own `deep mcp`) asking a taste question through `deep_ask`. The card is pressed from outside
// the app's process, as #1454's tests press it (probe.swift: the press a screen reader sends), so the OS stand-in
// saying `confirmed` is what lets it count. These need Accessibility for the process running them, or read BLOCKED.
// AC5's wrong program is the app planted to keep its key in a file (Cargo feature `plant-key-in-file`).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { answerFailures, App, pressOption, probeBinary, raise, t26, t806 } from '../1454/helpers.ts';
import { AC, appEnv, appWith, cleanup, hubWorld, keyHolders, olderAppKey, pairedDevices, setupFinished, sleep, within, type AppFeature, type World } from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(() => t806.cleanup(), 60_000);

const QUESTION = 'Which header colour on the settings page?';

/** A hub of this suite's with a live fixture session on it: #26's agent stand-in, its hooks and its own deep mcp. */
async function sessionWorld(): Promise<{ w: World; s: t26.World }> {
  await probeBinary();
  const w = await hubWorld({ files: setupFinished });
  const tmp = dirname(w.home);
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const agent = t26.Agent.start(w.home, wt.path);
  const session = agent.session(wt.path);
  const hub: t26.Hub = { pid: w.hub.pid, home: w.home, socket: w.hub.socket, child: w.hub.proc.child, output: () => w.hub.proc.stderr() };
  await agent.establish(hub, session);
  await t26.initialize(agent);
  return { w, s: { tmp, home: w.home, wt, agent, session, hub } };
}

/** The session asks; the card in the real app is pressed with the OS stand-in saying yes; what's wrong with the answer. */
async function answerOnCard(w: t26.World, app: App): Promise<string[]> {
  const ask = await raise(w, QUESTION);
  const pressed = await pressOption(app, ask);
  if (pressed.length) return pressed;
  const reached = await Promise.race([ask.wait(), sleep(60_000).then(() => undefined)]);
  return answerFailures(ask, await t26.events(w.hub), reached);
}

/** The app pairs and answers once on its card; then the files under ~/.deepbuild holding a paired device's private key. */
async function pairedAndAnswered(...plants: AppFeature[]): Promise<{ root: string; answered: string[]; holders: string[]; missing?: string | undefined }> {
  const { binary, missing } = await appWith(...plants);
  const { w, s } = await sessionWorld();
  const app = await App.launch({ home: w.home, binary, env: appEnv(w, 'confirmed') });
  try {
    const answered = await answerOnCard(s, app);
    const devices = pairedDevices(w.root);
    if (!devices.size) answered.push('the app paired no device with the hub, so no answer of its could have counted');
    return { root: w.root, answered, holders: keyHolders(w.root, devices), missing };
  } finally {
    await app.stop();
  }
}

describe(`${AC[5]} After the app has paired and answered once, no file under ~/.deepbuild holds the device's private key`, () => {
  it(`${AC[5]} after the real app paired and its card's answer counted once, no file under ~/.deepbuild holds the device's private key`, async () => {
    const run = await pairedAndAnswered();
    expect([...run.answered, ...run.holders]).toEqual([]);
    expect(run.missing, 'the app was built with its stand-ins (README, Surfaces)').toBeUndefined();
  }, 1_800_000);

  it(`${AC[5]} wrong program: an app that keeps its key in a file (plant-key-in-file) fails, naming the path`, async () => {
    const run = await pairedAndAnswered('plant-key-in-file');
    expect(run.answered, 'the planted app still pairs and answers').toEqual([]);
    expect(run.holders.join('\n')).toContain(`${join(run.root, 'app', 'device.json')} holds the private key of`);
  }, 1_800_000);
});

describe(`${AC[9]} After the move, an answer on the card in the real app still counts once`, () => {
  it(`${AC[9]} after the app moves an older app's key out of ~/.deepbuild/app/device.json at its start, an answer on its card counts once, signed with that key`, async () => {
    const { binary, missing } = await appWith();
    const { w, s } = await sessionWorld();
    const older = await olderAppKey(w);
    const before = [...pairedDevices(w.root).values()];
    const app = await App.launch({ home: w.home, binary, env: appEnv(w, 'confirmed') });
    const failures: string[] = [];
    try {
      if (!(await within(120_000, () => !existsSync(older.file)))) failures.push(`${older.file} is still there two minutes after the app started: the app didn't move the key`);
      else {
        failures.push(...(await answerOnCard(s, app)));
        const paired = [...pairedDevices(w.root).values()].filter((d) => !before.includes(d));
        if (paired.length) failures.push(`the app paired ${paired.join(', ')} after the move, so its answer wasn't signed with the key it moved (${older.device.id})`);
      }
    } finally {
      await app.stop();
    }
    expect(failures).toEqual([]);
    expect(missing, 'the app was built with its stand-ins (README, Surfaces)').toBeUndefined();
  }, 1_800_000);
});
