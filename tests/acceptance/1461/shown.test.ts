// AC28: Shown to you. Screenshots of the window with two asks, with none, with the hub stopped and on first launch, in
// light and dark, at both windows, taken by the check run from the real app, with a recording of answering two asks and
// opening a session, attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// As #1458's AC13 redraft takes its pictures: the real `deep-app` (built with `test-confirm`, so the recording's presses on
// the card count once a file says the OS confirmed you) against a real hub in a temp home, read from outside its process;
// each picture taken only once its state is on the window's tree. Pictures go to $DA1461_SCREENS (a temp folder without
// it) with run.json, the app's SHA-256. Then TASTE.json is read: no call, or one on other files, is INCONCLUSIVE;
// `looks_wrong` fails, quoting its note; `looks_right` on exactly these files passes. A kept folder holding exactly a
// recorded call's files, from this same app binary, stands, so the run doesn't take them again. "Attached to the PR and
// shown to you" is the implementing agent's; no test can see it. Nothing here judges a picture.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { App, inconclusive, Recorder, settled, sha256File } from '../1454/helpers.ts';
import { makeHome, stopHub } from '../16/helpers.ts';
import {
  appBin, axFlat, axTree, blocked, cleanup, HUB_DOWN, ID, makeWorld, MIN, placeAt, REFERENCE, SMALL, sleep, SUITE, tempDir,
  type SessionSpec, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const STATES = ['two-asks', 'no-ask', 'hub-stopped', 'first-launch'] as const;
type State = (typeof STATES)[number];
const WINDOWS = [SMALL, REFERENCE] as const;
const LOOKS = ['light', 'dark'] as const;
type Look = (typeof LOOKS)[number];
const file = (state: State, win: { width: number; height: number }, look: Look): string => `${state}-${win.width}x${win.height}-${look}.png`;
const RECORDING = 'answering.gif';
const expected = (): string[] => [...STATES.flatMap((s) => WINDOWS.flatMap((w) => LOOKS.map((l) => file(s, w, l)))), RECORDING, 'run.json'].sort();

const TWO: SessionSpec[] = [
  { key: 'a', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 'b', project: 'shop', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'c', project: 'docs', title: 'Release notes', state: 'finished' },
  { key: 'd', project: 'docs', title: 'API guide' },
];
const NONE: SessionSpec[] = TWO.map((s) => ({ key: s.key, project: s.project, title: s.title, ...(s.state ? { state: s.state } : {}) }));

/** What says each state is on the real window's tree: undefined when it is, else what's missing. */
type Labels = { id: string | null; text: string }[];
const labels = async (pid: number): Promise<Labels> => (await axTree(pid)).flatMap((w) => axFlat(w.tree)).map((n) => ({ id: n.identifier, text: `${n.title ?? ''} ${n.description ?? ''} ${n.value ?? ''}` }));
const ON: Record<State, (l: Labels) => string | undefined> = {
  'two-asks': (l) => (l.filter((n) => /^ask:[^:]+$/.test(n.id ?? '')).length === 2 ? undefined : 'no two ask rows'),
  'no-ask': (l) => (l.some((n) => n.text.includes('Nothing needs you')) ? undefined : 'no "Nothing needs you"'),
  'hub-stopped': (l) => (l.some((n) => n.text.includes(HUB_DOWN)) ? undefined : `no "${HUB_DOWN}"`),
  'first-launch': (l) => (l.some((n) => n.text.includes('Set up')) ? undefined : 'no "Set up"'),
};

async function take(app: App, state: State, look: Look, out: string, failures: string[]): Promise<void> {
  for (const win of WINDOWS) {
    await placeAt(app.pid, win);
    await app.front();
    const missing = await settled(async () => { const why = ON[state](await labels(app.pid)); return why ? [why] : []; }, 30_000);
    if (missing.length) { failures.push(`${state} at ${win.width}×${win.height}, ${look}: ${missing[0]}`); continue; }
    await sleep(800);
    const name = file(state, win, look);
    const picture = await app.capture(name.replace(/\.png$/, ''));
    if (picture.width !== win.width * 2 || picture.height !== win.height * 2) inconclusive(`AC28: ${name} is ${picture.width} × ${picture.height} px, not ${win.width * 2} × ${win.height * 2}: this Mac's screen can't take it at 2×`);
    copyFileSync(picture.path, join(out, name));
  }
}

async function pictures(binary: string, out: string): Promise<string[]> {
  const failures: string[] = [];
  const launch = async (home: string, look: Look, steps: (app: App) => Promise<void>, env: Record<string, string> = {}): Promise<void> => {
    const app = await App.launch({ home, binary, env: { DEEP_APP_APPEARANCE: look, ...env } });
    try { await steps(app); } finally { await app.stop(); }
  };
  for (const look of LOOKS) {
    const fresh = makeHome();
    mkdirSync(join(fresh, '.deepbuild'), { recursive: true });
    await launch(fresh, look, (app) => take(app, 'first-launch', look, out, failures));
    const none = await makeWorld(NONE);
    await launch(none.home, look, (app) => take(app, 'no-ask', look, out, failures));
    const two: World = await makeWorld(TWO);
    await launch(two.home, look, async (app) => {
      await take(app, 'two-asks', look, out, failures);
      await stopHub(two.hub);
      await take(app, 'hub-stopped', look, out, failures);
    });
  }
  // The recording: answering two asks through the card, then opening a session, at the reference window in light.
  const world = await makeWorld(TWO);
  const confirm = join(tempDir(), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  await launch(world.home, 'light', async (app) => {
    await placeAt(app.pid, REFERENCE);
    const ready = await settled(async () => { const why = ON['two-asks'](await labels(app.pid)); return why ? [why] : []; }, 30_000);
    if (ready.length) { failures.push(`the recording: ${ready[0]}`); return; }
    const recorder = new Recorder((await app.mainWindow()).id, join(tempDir(), 'frames'));
    for (const ask of world.asks) {
      await sleep(1500);
      const press = await app.press(ask.options[0]!.label, 'AXButton');
      if (!press.pressed) failures.push(`the recording: the card's option "${ask.options[0]!.label}" for ${ask.handle} took no press`);
    }
    await sleep(1500);
    if (!(await app.press('Release notes', 'AXButton')).pressed) failures.push('the recording: the session row "Release notes" took no press');
    await sleep(1500);
    await recorder.stop(join(out, RECORDING));
  }, { DEEP_APP_TEST_CONFIRM: confirm });
  return failures;
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));

describe(`AC28 ${ID.shown} shown to you`, () => {
  it(`AC28 ${ID.shown}: the check run takes the window with two asks, with none, with the hub stopped and on first launch, in light and dark at both windows, and a recording, from the real app, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    if (process.platform !== 'darwin') blocked(`the app draws on macOS only; this is ${process.platform}`);
    const out = process.env.DA1461_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = await appBin('confirm');
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      expect(await pictures(binary, out), 'each state is on the real window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1461, criterion: 'AC28', app })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture and the recording to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC28: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC28: no taste call is recorded for these pictures (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC28: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC28: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 240 * MIN);
});
