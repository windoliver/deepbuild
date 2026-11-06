// AC7: Shown to you: screenshots of the app's window with the fixture record (sidebar, Needs you and a presented card),
// the menu bar's count before and after the answer, a stale plug-in value and a terminal tab, in light and dark, taken by
// the check run from the app at the reference window, are attached to the PR and shown to you in the session. Whether
// they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it.
//
// The run takes every picture from the real app, writes them to $DA1172_SCREENS (a temp folder without it), with the
// replica's frame of the same record beside each appearance's window, and `run.json`, the SHA-256 of the app they came
// from. "Attached to the PR and shown to you" is the implementing agent's; no test can see it. Then it reads TASTE.json in
// this folder: no call, or one on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting it; `looks_right` on exactly
// these files passes. A real window's pixels can differ run to run, so a kept folder that holds every file of a recorded
// call, from this same app binary, stands: the run doesn't take those pictures again (README: The taste call).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answer, App, appBinary, captureMenu, childProcess, inconclusive, makeWorld, panelDir, REFERENCE, replicaBinary, settled, sha256File, sleep, SUITE, tempDir, useCleanup, type World,
} from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
const TASTE = join(SUITE, 'TASTE.json');
const APPEARANCES = ['light', 'dark'] as const;
const WINDOWS = ['shell', 'card', 'panel', 'terminal'] as const;
const expected = (): string[] => [...APPEARANCES.flatMap((a) => [...WINDOWS.map((w) => `${w}-${a}.png`), `menu-before-${a}.png`, `menu-after-${a}.png`, `replica-first-screen-${a}.png`]), 'run.json'].sort();
interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string; when?: string; files?: Record<string, string>; note?: string }

const env = (a: string) => ({ DEEP_APP_APPEARANCE: a });

async function atReference(app: App, what: string): Promise<void> {
  const picture = await app.capture(`${what}-size`);
  const want = [REFERENCE.width * REFERENCE.scale, REFERENCE.height * REFERENCE.scale];
  if (picture.width !== want[0] || picture.height !== want[1]) inconclusive(`AC7: the ${what} picture is ${picture.width} × ${picture.height} px, not the reference window's ${want[0]} × ${want[1]}, so this Mac can't take it`);
}

/** One appearance's pictures, each from a launch of its own over its own fixture record. */
async function take(out: string, a: typeof APPEARANCES[number], binary: string): Promise<void> {
  const shot = async (app: App, name: string): Promise<void> => {
    await atReference(app, name);
    await sleep(800);
    copyFileSync((await app.capture(`${name}-${a}`)).path, join(out, `${name}-${a}.png`));
  };
  const shellWorld: World = await makeWorld();
  const shell = await App.launch({ home: shellWorld.home, binary, env: env(a) });
  await settled(async () => ((await shell.tree()).menu.some((t) => /\b3\b/.test(t)) ? [] : ['menu']));
  await shot(shell, 'shell');
  await captureMenu(await shell.tree(), join(out, `menu-before-${a}.png`));
  await shell.press(shellWorld.asks[0]!.question);
  await sleep(1000);
  await shot(shell, 'card');
  await answer(shellWorld, shellWorld.asks[1]!);
  await sleep(1500);
  await captureMenu(await shell.tree(), join(out, `menu-after-${a}.png`));
  await shell.stop();
  const frames = tempDir();
  await childProcess(replicaBinary(), ['--first-screen', '--out', frames, '--appearance', a], shellWorld.home);
  copyFileSync(join(frames, 'screens/first-screen.png'), join(out, `replica-first-screen-${a}.png`));

  const panelWorld = await makeWorld();
  const panel = await App.launch({ home: panelWorld.home, binary, args: ['--panel', panelDir()], env: env(a) });
  await sleep(1500);
  await shot(panel, 'panel');
  await panel.stop();

  const termWorld = await makeWorld();
  const term = await App.launch({ home: termWorld.home, binary, env: env(a) });
  await settled(async () => ((await term.press(termWorld.sessions[0]!.task, 'AXButton')).pressed ? [] : ['no row']));
  await settled(async () => ((await term.press('Terminal')).pressed ? [] : ['no tab']), 4000);
  await sleep(1000);
  await shot(term, 'terminal');
  await term.stop();
}

describe('#1172 shown to you', () => {
  it('AC7 the check run takes the screenshots at the reference window, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right', async () => {
    const out = process.env.DA1172_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = await appBinary();
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(TASTE, 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const kept = (): boolean => {
      const run = join(out, 'run.json');
      if (!existsSync(run) || (JSON.parse(readFileSync(run, 'utf8')) as { app?: string }).app !== app) return false;
      return JSON.stringify(files()) === JSON.stringify(Object.fromEntries(Object.entries(taste.files ?? {}).sort()));
    };
    if (!kept()) {
      for (const a of APPEARANCES) await take(out, a, binary);
      writeFileSync(join(out, 'run.json'), `${JSON.stringify({ app, issue: 1172 })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (extra files there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC7: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC7: no taste call is recorded for these screenshots (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC7: the taste call names no one or no time');
    if (JSON.stringify(Object.fromEntries(Object.entries(taste.files ?? {}).sort())) !== JSON.stringify(got)) inconclusive('AC7: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 25 * MINUTES);
});
