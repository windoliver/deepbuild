// AC22 #41.bff357be, the mechanical part only: "Shown to you: screenshots of the first-launch Set up screen, the screen
// that names which side is older on a version mismatch, and the update check line, taken by the check run from the app
// at the reference window, are attached to the PR and shown to you in the session. Whether they look right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it."
// This suite takes the three screenshots from the app into a folder ($DA41_SCREENS, a temp folder otherwise) for the PR
// and the session, checks each is the reference window and, by the text the window shows (never the picture), the screen
// it names; then the run fails INCONCLUSIVE until docs/evidence/41/taste.json records a person's call on exactly these
// screenshots. Attaching them and showing them is the delivering session's step, not this test's.
//
// Surface assumed (the issue and design name no screenshot surface, so this is the one the tests pin):
//   `deep-app --screenshot <png>`: opens the app's window as a launch shows it for this HOME, at the reference window
//     (1512 x 982 points at 2x) in the appearance DEEP_APP_APPEARANCE gives (light here), waits until it has settled,
//     writes it as a PNG to <png> (3024 x 1964 pixels), prints one JSON line `{"screenshot": <png>, "window": {"size":
//     [1512, 982], "scale": 2}, "text": [<every string the window shows>]}` and quits with exit 0.
//   `deep-app --check-for-updates --screenshot <png>`: the same, of the window once its Check for updates has run and
//     shows its line (DEEP_UPDATE_URL as in update-line.test.ts).
//   Where the window can't be captured on this machine, it exits 3 with a stderr line starting `BLOCKED:` and the
//     reason, and this test fails BLOCKED with it, never a pass.
//   The three screens, by the homes these tests make: a home with nothing of DeepBuild shows the first launch's Set up
//   button (a string "Set up"); a set-up home whose running hub is older than the app (the stand-in hub of
//   compat.test.ts, a hello with no contract and no features) shows the screen naming the hub as older
//   (/\bhub\b.*\bolder\b/i); a set-up home after a Check for updates with the network down shows the couldn't-check line.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBinary, childEnv, cleanup, failsWith, makeHome, onMac, parseObject, pngSize, rootOf, run, setUpHome, sha, shown,
  standInHub, tasteCall, tempDir, updateServer, type Home,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const BUILD = 3_600_000;

/** One screenshot from the app: its PNG at the reference window and the strings the window showed. */
async function screenshot(h: Home, name: string, o: { checkForUpdates?: boolean; env?: Record<string, string> } = {}): Promise<{ png: string; text: string[] }> {
  const app = await appBinary();
  const png = join(h.tmp, name);
  const args = [...(o.checkForUpdates ? ['--check-for-updates'] : []), '--screenshot', png];
  const r = await run(app, args, { env: childEnv(h, o.env), cwd: h.tmp, timeoutMs: 300_000 });
  const blocked = r.stderr.split('\n').find((l) => l.startsWith('BLOCKED:'));
  if (r.code === 3 && blocked) throw Error(`${blocked} (deep-app ${args.join(' ')})`);
  const line = parseObject(r.stdout.trim().split('\n').at(-1) ?? '');
  if (r.code !== 0 || !line) expect.fail(`#41 AC22 deep-app ${args.join(' ')} must write the window as a PNG and print one JSON line: ${shown(r)}`);
  if (!existsSync(png)) expect.fail(`#41 AC22 deep-app ${args.join(' ')} must write ${png}: it didn't (${shown(r)})`);
  if (JSON.stringify(line.window) !== JSON.stringify({ size: [1512, 982], scale: 2 })) expect.fail(`#41 AC22 ${name} must be taken at the reference window, 1512 x 982 points at 2x: it says ${JSON.stringify(line.window)}`);
  const size = pngSize(png);
  if (!size || size[0] !== 3024 || size[1] !== 1964) expect.fail(`#41 AC22 ${name} must be the reference window at 2x, 3024 x 1964 pixels: it is ${size ? size.join(' x ') : 'not a PNG'}`);
  if (!Array.isArray(line.text) || !line.text.every((t: unknown) => typeof t === 'string')) expect.fail(`#41 AC22 deep-app ${args.join(' ')} must list the strings the window shows: ${JSON.stringify(line)}`);
  return { png, text: line.text as string[] };
}

describe('AC22 #41.bff357be the three screenshots, shown to you', () => {
  it('AC22 #41.bff357be the check run from the app takes the Set up screen, the older-hub screen and the update check line at the reference window, and stays INCONCLUSIVE until a taste call on them is recorded', async () => {
    onMac();
    const where = process.env.DA41_SCREENS ?? join(tempDir(), 'screens');
    mkdirSync(where, { recursive: true });
    const screens: Record<string, string> = {};
    const keep = (s: { png: string }, name: string) => { copyFileSync(s.png, join(where, name)); screens[name] = sha(readFileSync(s.png)); };

    const fresh = makeHome();
    const setUp = await screenshot(fresh, 'set-up.png');
    if (!setUp.text.some((t) => t.trim() === 'Set up')) expect.fail(`#41 AC22 on first launch the window must show the Set up button: it shows ${JSON.stringify(setUp.text)}`);
    keep(setUp, 'set-up.png');

    const older = setUpHome();
    const hub = await standInHub(join(rootOf(older.home), 'hub.sock'), { features: [] });
    const mismatch = await screenshot(older, 'version-mismatch.png');
    await hub.close();
    if (!mismatch.text.some((t) => /\bhub\b.*\bolder\b/i.test(t))) expect.fail(`#41 AC22 with an older running hub the window must show the screen naming the hub as older: it shows ${JSON.stringify(mismatch.text)}`);
    keep(mismatch, 'version-mismatch.png');

    const offline = setUpHome();
    const server = await updateServer('0.0.1');
    await server.close();
    const line = await screenshot(offline, 'update-check.png', { checkForUpdates: true, env: { DEEP_UPDATE_URL: server.url } });
    if (!line.text.some((t) => /couldn['’]?t check|could not check/i.test(t))) expect.fail(`#41 AC22 after Check for updates with the network down the window must show the couldn't-check line: it shows ${JSON.stringify(line.text)}`);
    keep(line, 'update-check.png');

    expect(new Set(Object.values(screens)).size, 'three different screens').toBe(3);
    tasteCall(screens, where);
  }, BUILD);

  it('AC22 #41.bff357be the verdict passes only with a person\'s recorded call on exactly these screenshots: none, one on other screenshots or one naming nobody is INCONCLUSIVE, and a call that they look wrong fails', async () => {
    const screens = { 'set-up.png': sha('a'), 'version-mismatch.png': sha('b'), 'update-check.png': sha('c') };
    const file = join(tempDir(), 'taste.json');
    const record = (o: object) => writeFileSync(file, JSON.stringify({ criterion: '#41.bff357be', by: 'a person', at: '2026-11-07', screens, ...o }));
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: no taste call is recorded/);
    record({ call: 'looks right', screens: { ...screens, 'update-check.png': sha('other bytes') } });
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: the taste call .* is on other screenshots/);
    record({ call: 'looks right', by: '' });
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: the taste call .* names no person/);
    record({ call: 'looks right', criterion: '#41.1d9debfb' });
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: .* is not a taste call on #41\.bff357be/);
    record({ call: 'looks wrong', note: 'the fix line is cut off' });
    await failsWith(() => tasteCall(screens, 'out', file), /^#41 AC22 the recorded taste call says the screenshots don't look right/);
    record({ call: 'looks right' });
    tasteCall(screens, 'out', file);
  });
});
