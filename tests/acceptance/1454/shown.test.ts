// AC7 #1454.f1f3739d: Shown to you: screenshots of the real app after an answer, with ⌘K open, an installed panel and a canvas,
// taken by the check run at the reference window, with a recording of one card answered, are attached to the PR and shown to
// you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it.
//
// The run drives each path on the real app and takes each picture only once that path's own judge says the state is there, so
// a picture of the wrong screen can't be called right. It writes them to $DA1454_SCREENS (a temp folder without it), with the
// hub's record beside each one (the issue's Proof) and `run.json`, the SHA-256 of the app they came from. "Attached to the PR
// and shown to you" is the implementing agent's; no test can see it. Then it reads TASTE.json in this folder: no call, or one
// on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting it; `looks_right` on exactly these files passes. A real
// window's pixels can differ run to run, so a kept folder that holds every file of a recorded call, from this same app
// binary, stands: the run doesn't take those pictures again (README: The taste call).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAUDE, expectPresented, sessionId, showFigure } from '../806/figure.ts';
import {
  App, appBinary, canvasFailures, figureWorld, inconclusive, install, MINUTES, ocr, openCommands, panelFailures, pressOption, raise, Recorder, REFERENCE, sessionWorld, settled, sha256File, sleep, SUITE, t26, t806, tasteFailure, useCleanup, type Ev, type Picture, type Taste,
} from './helpers.ts';

useCleanup();
const TASTE = join(SUITE, 'TASTE.json');
/** Only the criterion's own: it names no appearance, so the run keeps one (README, The taste call). */
const LIGHT = { DEEP_APP_APPEARANCE: 'light' };
const SHOTS = ['after-answer', 'commands', 'panel', 'canvas'] as const;
const expected = (): string[] => [...SHOTS.flatMap((s) => [`${s}.png`, `${s}.record.json`]), 'answer-recording.gif', 'run.json'].sort();

function atReference(picture: Picture, what: string): void {
  const want = [REFERENCE.width * REFERENCE.scale, REFERENCE.height * REFERENCE.scale];
  if (picture.width !== want[0] || picture.height !== want[1]) inconclusive(`AC7: the ${what} picture is ${picture.width} × ${picture.height} px, not the reference window's ${want[0]} × ${want[1]}, so this Mac can't take it`);
}
/** The window, and the hub's record beside it: what's in the record, by kind, writer and subject, no words of anyone's. */
async function shot(app: App, hub: t26.Hub, name: string, out: string): Promise<void> {
  await sleep(800);
  const picture = await app.capture(name);
  atReference(picture, name);
  copyFileSync(picture.path, join(out, `${name}.png`));
  const record = (await t26.events(hub)).map((e: Ev) => ({ log_pos: e.log_pos, kind: e.kind, writer: e.writer, subject: e.subject ?? null }));
  writeFileSync(join(out, `${name}.record.json`), `${JSON.stringify(record, null, 1)}\n`);
}

/** One card answered, recorded from the row's press to its leaving, then the window after the answer. */
async function answerShots(out: string, binary: string): Promise<string[]> {
  const world = await sessionWorld();
  const confirm = join(t806.tempDir(), 'os-confirm');
  writeFileSync(confirm, 'confirmed\n');
  const app = await App.launch({ home: world.home, binary, env: { ...LIGHT, DEEP_APP_TEST_CONFIRM: confirm } });
  try {
    const ask = await raise(world, 'Which header colour on the login page?');
    const recorder = new Recorder((await app.mainWindow()).id, join(t806.tempDir(), 'frames'));
    const pressed = await pressOption(app, ask);
    const reached = pressed.length ? undefined : await Promise.race([ask.wait(), sleep(60_000).then(() => undefined)]);
    await sleep(1500);
    const kept = await recorder.stop(join(out, 'answer-recording.gif'));
    if (pressed.length) return pressed;
    if (reached !== ask.pick.id) return [`the card's answer didn't reach the session (it got ${String(reached)}), so there is no picture after an answer`];
    if (kept.distinct < 3) return [`the recording of one card answered holds ${kept.distinct} different frames of ${kept.frames}: it shows no card coming or going`];
    await shot(app, world.hub, 'after-answer', out);
    return [];
  } finally {
    await app.stop();
  }
}
async function commandShots(out: string, binary: string): Promise<string[]> {
  const world = await sessionWorld();
  await install(world.home, 'board');
  const app = await App.launch({ home: world.home, binary, env: LIGHT });
  try {
    const failures = await openCommands(app);
    if (failures.length) return failures;
    await shot(app, world.hub, 'commands', out);
    return [];
  } finally {
    await app.stop();
  }
}
async function panelShots(out: string, binary: string): Promise<string[]> {
  const world = await sessionWorld();
  await install(world.home, 'board');
  const app = await App.launch({ home: world.home, binary, env: LIGHT });
  try {
    const failures = await settled(async () => panelFailures(await ocr(await app.capture('panel-state')), { refused: false }), 20_000);
    if (failures.length) return failures;
    await shot(app, world.hub, 'panel', out);
    return [];
  } finally {
    await app.stop();
  }
}
async function canvasShots(out: string, binary: string): Promise<string[]> {
  const f = await figureWorld();
  const app = await App.launch({ home: f.home, binary, env: LIGHT });
  try {
    const shown = await showFigure(f, CLAUDE, t806.t393.DOC.a);
    const sha = await expectPresented(f, CLAUDE, shown.reply);
    const failures = await canvasFailures(app, f.home, sha, sessionId(CLAUDE));
    if (failures.length) return failures;
    await shot(app, f.hub, 'canvas', out);
    return [];
  } finally {
    await app.stop();
  }
}

describe('#1454 shown to you', () => {
  it('AC7 #1454.f1f3739d the check run takes the screenshots and the recording at the reference window, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right', async () => {
    const out = process.env.DA1454_SCREENS ?? t806.tempDir();
    mkdirSync(out, { recursive: true });
    const plain = await appBinary();
    // The answer's picture needs the OS's stand-in; the base has none, and fails on the answer, named.
    const binary = await appBinary('test-confirm').catch(() => plain);
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(TASTE, 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const kept = (): boolean => {
      const run = join(out, 'run.json');
      if (!existsSync(run) || (JSON.parse(readFileSync(run, 'utf8')) as { app?: string }).app !== app) return false;
      return JSON.stringify(files()) === JSON.stringify(Object.fromEntries(Object.entries(taste.files ?? {}).sort()));
    };
    if (!kept()) {
      const missing = [
        ...await answerShots(out, binary), ...await commandShots(out, binary), ...await panelShots(out, binary), ...await canvasShots(out, binary),
      ];
      expect(missing, 'each state is on the real window before its picture is taken').toEqual([]);
      writeFileSync(join(out, 'run.json'), `${JSON.stringify({ app, issue: 1454 })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (extra files there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC7: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    const failure = tasteFailure(taste, got);
    if (failure?.inconclusive) inconclusive(failure.inconclusive);
    expect(failure?.fails, 'the recorded taste call').toBeUndefined();
  }, 40 * MINUTES);
});
