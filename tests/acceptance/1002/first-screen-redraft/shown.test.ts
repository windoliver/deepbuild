// #1002.1f6f1740, shown to you, from the real window: the app offering Set up again with the reason, and the count reading
// setup didn't finish, once for the settings file and once for the hub, captured from that one window at the reference
// window, light, into $DA1002_SCREENS (a temp folder without it). Whether they look right is one taste call, a person's,
// in TASTE.json; without it the test fails INCONCLUSIVE, never passes. The judges only say the screen is the right
// state; nothing reads a picture for how it looks. A kept folder holding a recorded call's files, from this same app, stands.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { breakSettings, cleanup, fixSettings, makeHome, settingsFile, tempDir, type Home } from '../helpers.ts';
import { appBinary, inconclusive, kept, pngSize, REFERENCE, sha256File, tasteCall, type Seen, type Taste } from './window.ts';
import { namesTheFile, namesTheHub, offeredFailures, open, pressSetUp, SETUP_MS } from './helpers.ts';

afterAll(cleanup, 60_000);

const TASTE = fileURLToPath(new URL('./TASTE.json', import.meta.url));
const SHOTS = ['set-up-again-hub.png', 'set-up-again-settings.png'];

async function shot(h: Home, judge: (s: Seen) => string[], o: { hub?: 'dead' }, name: string, out: string): Promise<void> {
  const app = await open(h, o);
  await app.sizeTo(REFERENCE);
  const { seen, failures } = await app.settled(judge);
  await app.stop();
  if (failures.length) expect.fail(`#1002 the window to show you isn't the state it should be: ${failures.join('\n')}`);
  const [w, h2] = pngSize(seen.picture);
  if (w !== REFERENCE.width * REFERENCE.scale || h2 !== REFERENCE.height * REFERENCE.scale) inconclusive(`${name} is ${w} × ${h2} px, not the reference window's, so this Mac can't take it`);
  copyFileSync(seen.picture, join(out, name));
}

describe('#1002 the real window after a setup that stopped, shown to you', () => {
  it('#1002.1f6f1740 screenshots of the real window offering Set up again with the reason and the count reading setup didn\'t finish, taken at the reference window, stay INCONCLUSIVE until a taste call on them is recorded', async () => {
    const out = process.env.DA1002_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const app = sha256File(await appBinary());
    const taste = JSON.parse(readFileSync(TASTE, 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries([...SHOTS, 'run.json'].filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const run = join(out, 'run.json');
    const ran = existsSync(run) ? (JSON.parse(readFileSync(run, 'utf8')) as { app?: string }).app : undefined;
    if (!kept(taste, files(), ran, app)) {
      const settings = makeHome();
      breakSettings(settings.home);
      const first = await open(settings);
      await pressSetUp(first);
      await first.settled(namesTheFile, SETUP_MS);
      await first.stop();
      await shot(settings, (s) => offeredFailures(s, { file: settingsFile(settings.home) }), {}, 'set-up-again-settings.png', out);

      const hub = makeHome();
      fixSettings(hub.home);
      const stopped = await open(hub, { hub: 'dead' });
      await pressSetUp(stopped);
      await stopped.settled(namesTheHub, SETUP_MS);
      await stopped.stop();
      await shot(hub, (s) => offeredFailures(s, 'hub'), { hub: 'dead' }, 'set-up-again-hub.png', out);
      writeFileSync(run, `${JSON.stringify({ app, issue: 1002 })}\n`);
    }
    const got = files();
    expect(Object.keys(got).sort(), `the run wrote every picture to ${out}`).toEqual([...SHOTS, 'run.json'].sort());
    console.log(`#1002 pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    tasteCall(taste, got);
  }, 25 * 60_000);
});
