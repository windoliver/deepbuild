// #994 AC5, the screenshots shown to you: the count with the hub not answering (`deep-replica --first-screen`, the app's
// first screen for a home with no hub), the not notified ask row (the replica, window.rs) and a notification (the real
// bundle, run only with DA994_NOTIFICATION=1, since it posts to your Notification Center and macOS may ask you whether
// the app may). They are written to $DA994_SCREENS (a temp folder otherwise) to attach to the PR. Whether they look right
// is one taste call, a person's, recorded in docs/evidence/994/taste.json on exactly these screenshots; without it the
// test fails INCONCLUSIVE, never passes. No code judges a picture.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC5, HUB_NOT_ANSWERING, cleanup, firstScreen, onMac, openAsk, pngSize, setUpWorld, sleep, startApp, stopHub, tempDir, type Line,
} from './helpers.ts';
import { REPO, parseObject, run, shown } from '../27/helpers.ts';

afterAll(cleanup, 60_000);

const CRITERION = AC5.split(' ')[1]!;
const TASTE = join(REPO, 'docs/evidence/994/taste.json');
/** The reference window, 1512 x 982 points at 2x. */
const REFERENCE = '3024 x 1964';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}`); };
const atReference = (path: string) => {
  const [w, h] = pngSize(path);
  if (`${w} x ${h}` !== REFERENCE) expect.fail(`#994 ${path} must be the reference window, ${REFERENCE} pixels: it is ${w} x ${h}`);
};

async function hubNotAnsweringShot(where: string): Promise<void> {
  const { home, hub } = await setUpWorld();
  await stopHub(hub);
  const screen = await firstScreen(home, join(tempDir(), 'out'));
  if (!screen.names.some((n) => HUB_NOT_ANSWERING.test(n))) expect.fail(`#994 the count should say the hub isn't answering: ${JSON.stringify(screen.names.slice(0, 40))}`);
  copyFileSync(screen.png, join(where, 'hub-not-answering.png'));
}

async function rowShot(where: string): Promise<void> {
  const r = await run('cargo', ['test', '--locked', '-q', '-p', 'deep-replica', '--test', 'acceptance_994_window'], { env: { ...process.env, DA994_SCREENS: where }, cwd: REPO, timeoutMs: 1_800_000 });
  if (r.code !== 0) throw Error(`BLOCKED: the replica didn't draw the not notified row: ${shown(r)}`);
}

/** The real bundle, on the OS's own setting, posts one ask; the screen is captured while Notification Center holds it. */
async function notificationShot(where: string): Promise<void> {
  if (process.env.DA994_NOTIFICATION !== '1') inconclusive('no notification was shot: run with DA994_NOTIFICATION=1 on a Mac where the bundle may notify');
  const bundle = await run('sh', [join(REPO, 'scripts/app-bundle')], { env: process.env, cwd: REPO, timeoutMs: 1_800_000 });
  if (bundle.code !== 0) throw Error(`BLOCKED: scripts/app-bundle failed: ${shown(bundle)}`);
  const binary = join(bundle.stdout.trim().split('\n').at(-1)!, 'Contents/MacOS/deep-app');
  const { home, repo, hub } = await setUpWorld();
  const app = await startApp(home, undefined, { binary });
  await sleep(5000);
  const ask = await openAsk(hub, repo);
  await sleep(3000);
  const held = await run(binary, ['--notification-center'], { env: { ...process.env, HOME: home }, cwd: REPO });
  const lines = held.stdout.split('\n').flatMap((l) => { const v = parseObject(l); return v ? [v as Line] : []; });
  if (!lines.some((l) => l.tag === ask.session)) inconclusive(`Notification Center holds nothing for ${ask.handle}: has macOS allowed the bundle to notify? ${shown(held)}; the app's log ends ${app.log().slice(-400)}`);
  const file = join(where, 'notification.png');
  const shot = await run('screencapture', ['-x', file], { env: process.env, cwd: REPO });
  if (shot.code !== 0 || !existsSync(file)) inconclusive(`screencapture took no screenshot: ${shown(shot)}`);
}

describe(`${AC5} one taste call on the app's own screenshots`, () => {
  it(`${AC5} the hub not answering count, the not notified row and a notification stay INCONCLUSIVE until a taste call on them is recorded`, async () => {
    onMac();
    const where = process.env.DA994_SCREENS ?? join(tempDir(), 'screens');
    mkdirSync(where, { recursive: true });
    await hubNotAnsweringShot(where);
    await rowShot(where);
    atReference(join(where, 'hub-not-answering.png'));
    atReference(join(where, 'not-notified-row.png'));
    await notificationShot(where);
    const screens = Object.fromEntries(['hub-not-answering.png', 'not-notified-row.png', 'notification.png'].map((name) => [name, sha(join(where, name))]));
    const these = `these screenshots in ${where}: ${JSON.stringify(screens)}`;
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded at ${TASTE} on ${these}`);
    const call = parseObject(readFileSync(TASTE, 'utf8'));
    if (!call || call.criterion !== CRITERION || typeof call.by !== 'string' || !call.by.trim()) inconclusive(`${TASTE} isn't a person's taste call on ${CRITERION}`);
    for (const [name, digest] of Object.entries(screens)) if (call!.screens?.[name] !== digest) inconclusive(`the taste call at ${TASTE} is on other screenshots than ${these}`);
    expect(call!.call, 'your taste call').toBe('looks right');
  }, 1_800_000);
});
