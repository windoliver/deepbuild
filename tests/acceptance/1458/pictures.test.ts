// AC13: Shown to you: screenshots of each shipped page at both windows, in light and dark, taken by the check run from
// the real app, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The real `deep-app`, plain, on a real hub in a temp home, read and pressed from outside its process with #1454's
// probe and captured by window ID, never the display. Dark is the app's own appearance, asked for at launch with
// `-AppleInterfaceStyle Dark` (README, Pinned 10), so no system setting changes. Every picture goes to
// $DA1458_SCREENS (a temp folder without it) with run.json; then TASTE.json is read. Nothing here judges a picture:
// each is taken once the page it shows is on the window's tree. "Attached to the PR and shown to you" is the
// implementing agent's; no test can see it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as t1454 from '../1454/helpers.ts';
import * as t1455 from '../1455/helpers.ts';
import * as t26 from '../26/helpers.ts';
import {
  AC, CARD, MINUTES, NEEDS_YOU, OPENING, REFERENCE, REPO, SESSION_PAGE, SUITE, cleanup, flat, inconclusive, renderPages,
  run, sha256File, tasteFailure, tempDir, type Taste,
} from './helpers.ts';

afterAll(async () => { await cleanup(); await t1455.cleanup(); await t1454.t806.cleanup(); }, 60_000);
const WELCOME = 'deepbuild/welcome';
const QUESTION = 'Keep the old logo in the header?';
const TITLE = 'Header layout';
const WINDOWS = [OPENING, REFERENCE] as const;
const THEMES = ['light', 'dark'] as const;
const slug = (page: string): string => (page === CARD ? 'question-card' : page.replace(/^deepbuild\//, ''));
const file = (page: string, w: { width: number; height: number }, theme: string): string => `${slug(page)}-${w.width}x${w.height}-${theme}.png`;

/** A home whose hub holds two tasks and the choice ask, as #1455's pictures seed one. */
async function world(): Promise<{ home: string; hub: t26.Hub }> {
  const home = t1455.makeHome();
  await t1455.deepHook();
  const [a, b] = [t26.ulid(), t26.ulid()];
  await t26.seed(home, async (s) => {
    for (const [session, title] of [[a, TITLE], [b, 'Checkout page']] as const) {
      await s.start(session);
      await s.record.append({ writer: 'core', actor: 'you', scope: 'you', session, project: t26.PROJECT }, { v: 1, id: t26.ulid(s.now()), kind: 'task.created', ts: s.now(), data: { task_ref: `task:${session}`, thread: session, owner: 'you', title } });
    }
    await s.raise(a, 'choice', QUESTION, s.now() + 4 * t26.HOUR);
  });
  return { home, hub: await t26.startHub(home) };
}

/** Sets the app's window to `w` points through the probe, as #1454's App.place does for the reference window. */
async function place(app: t1454.App, w: { width: number; height: number }): Promise<void> {
  const probe = await t1454.probeBinary();
  for (let tries = 0; tries < 40; tries++) {
    const frame = JSON.parse(execFileSync(probe, ['place', String(app.pid), String(w.width), String(w.height)], { encoding: 'utf8' })) as number[];
    if (Math.abs((frame[2] ?? 0) - w.width) < 1 && Math.abs((frame[3] ?? 0) - w.height) < 1) break;
    await t1454.sleep(250);
  }
  await app.front();
  await t1454.sleep(800);
}

/**
 * Opens `page` in the app (README, Pinned 10): Needs you is the first screen; the card is a press on its ask's row; a
 * session's page a press on its row; any other page a press on the node named with its title as the replica draws it.
 */
async function open(app: t1454.App, page: string, titles: Map<string, string>): Promise<string[]> {
  const on = (words: string, what: string) => t1454.settled(async () => (t1454.named(await app.tree()).some((n) => n.name.includes(words)) ? [] : [`the real app shows no ${what} (no node named with ${JSON.stringify(words)})`]), 30_000);
  const press = async (words: string, what: string): Promise<string[]> => t1454.settled(async () => ((await app.press(words)).pressed ? [] : [`the real app has no node named with ${JSON.stringify(words)} to open ${what}`]), 30_000);
  if (page === NEEDS_YOU) return on('Needs you', 'Needs you');
  if (page === CARD) return [...await press(QUESTION, 'its card'), ...await on('Drop it', 'card for the ask')];
  if (page === SESSION_PAGE) return [...await press(TITLE, `${TITLE}'s page`), ...await on(`Session ${TITLE}`, `${TITLE}'s page`)];
  const title = titles.get(page);
  if (!title) return [`the replica draws no title for ${page}, so the real app's way to it is unknown (README, Pinned 10)`];
  return press(title, page);
}

/** One theme's pictures of every page at both windows, each page in a launch of its own. */
async function shots(theme: (typeof THEMES)[number], app: string, pages: readonly string[], titles: Map<string, string>, out: string): Promise<string[]> {
  const failures: string[] = [];
  const args = theme === 'dark' ? ['-AppleInterfaceStyle', 'Dark'] : [];
  const take = async (a: t1454.App, page: string) => {
    for (const w of WINDOWS) {
      await place(a, w);
      const picture = await a.capture(`${slug(page)}-${w.width}-${theme}`);
      if (picture.width !== w.width * 2 || picture.height !== w.height * 2) failures.push(`the ${theme} ${page} picture is ${picture.width} × ${picture.height} px, not ${w.width * 2} × ${w.height * 2}`);
      copyFileSync(picture.path, join(out, file(page, w, theme)));
    }
  };
  const w = await world();
  try {
    for (const page of pages.filter((p) => p !== WELCOME)) {
      const a = await t1454.App.launch({ home: w.home, binary: app, args });
      try {
        const missing = await open(a, page, titles);
        failures.push(...missing);
        if (!missing.length) await take(a, page);
      } finally {
        await a.stop();
      }
    }
  } finally {
    await t26.stopHub(w.hub);
  }
  if (pages.includes(WELCOME)) {
    // First launch: a home where setup never ran, and no hub.
    const a = await t1454.App.launch({ home: t1455.makeHome({ setUp: false }), binary: app, args });
    try { await take(a, WELCOME); } finally { await a.stop(); }
  }
  return failures;
}

describe('#1458 shown to you', () => {
  it(`${AC.shown}: the check run takes each shipped page at 960×640 and 1512×982, light and dark, from the real app, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    await t1454.probeBinary();
    const out = process.env.DA1458_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    // The pages, and the title each draws, as the replica lists and draws them (README, Pinned 3 and 10).
    const replica = await renderPages();
    const pages = replica.map((p) => p.page);
    const titles = new Map(replica.map((p) => [p.page, flat(p.snapshot.tree).find((n) => /-title$/.test(String(n.id ?? '')) && n.id !== 'sidebar-title')?.name ?? '']).filter(([, t]) => t) as [string, string][]);
    const app = await t1454.appBinary();
    const expected = [...pages.flatMap((p) => THEMES.flatMap((t) => WINDOWS.map((w) => file(p, w, t)))), 'run.json'].sort();
    const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: REPO })).stdout.trim();
    const facts = { commit, app: sha256File(app), pages };
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected.filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && JSON.stringify(JSON.parse(readFileSync(runFile, 'utf8'))) === JSON.stringify(facts)
      && JSON.stringify(files()) === JSON.stringify(Object.fromEntries(Object.entries(taste.files ?? {}).sort()));
    if (!kept) {
      const missing: string[] = [];
      for (const theme of THEMES) missing.push(...await shots(theme, app, pages, titles, out));
      writeFileSync(runFile, `${JSON.stringify(facts)}\n`);
      expect(missing, 'each page is on the real window before its pictures are taken').toEqual([]);
    }
    const got = files();
    console.log(`AC13: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected);
    const failure = tasteFailure(taste, got);
    if (failure?.inconclusive) inconclusive(failure.inconclusive);
    expect(failure?.fails, 'the recorded taste call').toBeUndefined();
  }, 240 * MINUTES);
});
