// AC13 of #1458: Shown to you: screenshots of each shipped page at both windows, in light and dark, taken by the check run
// from the real app, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The plain `deep-app` runs against a real hub in a temp home and is read from outside its process with #1454's probe: its
// accessibility tree, the press a screen reader sends, ⌘K posted to its PID, its window placed and captured by window ID. Each
// shipped page is reached as a person reaches it (README: The pages), and its picture is taken at 960 × 640 and at 1512 × 982,
// in the app's own light and dark, each only once that page is on the window's tree. The pictures go to $DA1458_SCREENS (a
// temp folder without it) with run.json, the app's SHA-256. Then TASTE.json is read: no call, or one on other files, is
// INCONCLUSIVE; `looks_wrong` fails, quoting its note; `looks_right` on exactly these files passes. A kept folder holding
// exactly a recorded call's files, from this same app binary, stands, so the run doesn't take them again. "Attached to the PR
// and shown to you" is the implementing agent's; no test can see it. Nothing here judges a picture.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { App, blocked, inconclusive, MINUTES, named, probeBinary, REPO, settled, sha256File, sleep, t26, useCleanup, type Tree } from '../../1454/helpers.ts';

useCleanup();
const SUITE = fileURLToPath(new URL('./', import.meta.url));
const PAGES = ['welcome', 'needs-you', 'question-card', 'session', 'agents', 'home'] as const;
type Page = (typeof PAGES)[number];
/** The window the app opens at, and the reference window, in points; pictures are at 2× (#1458 Scope; design: Decided). */
const WINDOWS = [{ w: 960, h: 640 }, { w: 1512, h: 982 }] as const;
type Win = (typeof WINDOWS)[number];
const LOOKS = ['light', 'dark'] as const;
type Look = (typeof LOOKS)[number];
const SCALE = 2;
const file = (page: Page, win: Win, look: Look): string => `${page}-${win.w}x${win.h}-${look}.png`;
const expected = (): string[] => [...PAGES.flatMap((p) => WINDOWS.flatMap((w) => LOOKS.map((l) => file(p, w, l)))), 'run.json'].sort();

// The seeded world: two titled sessions, one open ask on the first (#26's choice, its options SQLite and Plain files).
const TITLE = 'Header layout';
const QUESTION = 'Store the drafts in SQLite or plain files?';

const has = (tree: Tree, name: string, role?: string): boolean => named(tree).some((n) => n.name === name && (!role || n.role === role));
const holds = (tree: Tree, text: string, role?: string): boolean => named(tree).some((n) => n.name.includes(text) && (!role || n.role === role));
const names = (tree: Tree): string => JSON.stringify(named(tree).map((n) => n.name).slice(0, 40));
/** What says each page is on the window's tree: undefined when it is, else what's missing. */
const ON: Record<Page, (tree: Tree) => string | undefined> = {
  welcome: (t) => (has(t, 'Set up', 'AXButton') ? undefined : 'no "Set up" button'),
  'needs-you': (t) => (has(t, 'Needs you') && holds(t, QUESTION, 'AXButton') ? undefined : `no "Needs you" heading with a row for "${QUESTION}"`),
  'question-card': (t) => (holds(t, 'SQLite', 'AXButton') && holds(t, 'Plain files', 'AXButton') ? undefined : 'no card with the options "SQLite" and "Plain files"'),
  session: (t) => (has(t, `Session ${TITLE}`) ? undefined : `no page named "Session ${TITLE}"`),
  agents: (t) => (has(t, 'MCP servers') ? undefined : 'no "MCP servers" heading'),
  // ⌘K lists "Home" and "Needs you" too: Home is up once ⌘K closed and Needs you's heading is gone.
  home: (t) => (has(t, 'Home') && !has(t, 'Needs you') ? undefined : 'no "Home" heading with ⌘K closed'),
};

/** The plain app and the hook a hub needs, built once and the app copied out of the target folder, so no other build replaces it mid-run. */
async function plainApp(): Promise<string> {
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const built = await t26.run('cargo', ['build', '--locked', '-q', '-p', 'deep-app', '--bin', 'deep-app', '-p', 'deep-hook', '--bin', 'deep-hook'], { env, timeoutMs: 120 * MINUTES });
  if (built.code !== 0) blocked(`cargo build of deep-app and deep-hook failed: ${built.stderr.slice(-2000)}`);
  const out = join(t26.tempDir(), 'deep-app');
  copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-app'), out);
  return out;
}

function setUpFinished(home: string): void {
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(t26.rootOf(home), 'setup-finished.json'), JSON.stringify({ version }));
}
/** A home whose setup finished, its record seeded with the hub stopped, then its hub started. */
async function seeded(): Promise<{ home: string; hub: t26.Hub }> {
  const { home } = t26.makeHome();
  const [a, b] = [t26.ulid(), t26.ulid()];
  await t26.seed(home, async (s) => {
    for (const [session, title] of [[a, TITLE], [b, 'Checkout page']] as const) {
      await s.start(session);
      await s.record.append({ writer: 'core', actor: 'you', scope: 'you', session, project: t26.PROJECT }, { v: 1, id: t26.ulid(s.now()), kind: 'task.created', ts: s.now(), data: { task_ref: `task:${session}`, thread: session, owner: 'you', title } });
    }
    await s.raise(a, 'choice', QUESTION, s.now() + 6 * t26.HOUR);
  });
  setUpFinished(home);
  return { home, hub: await t26.startHub(home) };
}

/** Sets the app's window to `win`, as #1454's `App.place` sets the reference window; what went wrong, if it didn't take. */
async function placeAt(app: App, win: Win): Promise<string | undefined> {
  const probe = await probeBinary();
  let frame: number[] = [];
  for (let tries = 0; tries < 40; tries++) {
    frame = await new Promise<number[]>((resolve) => execFile(probe, ['place', String(app.pid), String(win.w), String(win.h)], (e, out) => resolve(e ? [] : (JSON.parse(out) as number[]))));
    if (Math.abs((frame[2] ?? 0) - win.w) < 1 && Math.abs((frame[3] ?? 0) - win.h) < 1) {
      await app.front();
      await sleep(500);
      return undefined;
    }
    await sleep(250);
  }
  return `the window couldn't be set to ${win.w} × ${win.h}: it stayed ${JSON.stringify(frame)}`;
}

/** The screen is locked: nothing a window draws reaches a capture. */
async function locked(): Promise<boolean> {
  const ran = await t26.run('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a']);
  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(ran.stdout);
}

/** Every picture one appearance takes, in three launches; what kept a page from its window. */
async function shots(binary: string, look: Look, out: string): Promise<string[]> {
  const failures: string[] = [];
  const env = { DEEP_APP_APPEARANCE: look };
  const launch = async (home: string, steps: (app: App) => Promise<void>): Promise<void> => {
    const app = await App.launch({ home, binary, env });
    try { await steps(app); } finally { await app.stop(); }
  };
  /** The page at both windows, each picture taken once the page is on the tree at that size. */
  const take = async (app: App, page: Page): Promise<boolean> => {
    for (const win of WINDOWS) {
      const placed = await placeAt(app, win);
      if (placed) { failures.push(`${page}, ${look}: ${placed}`); return false; }
      const missing = await settled(async () => { const why = ON[page](await app.tree()); return why ? [why] : []; }, 30_000);
      if (missing.length) { failures.push(`${page} at ${win.w} × ${win.h}, ${look}: ${missing[0]}; the window's names are ${names(await app.tree())}`); return false; }
      await sleep(800);
      const name = file(page, win, look);
      const picture = await app.capture(name.replace(/\.png$/, ''));
      if (picture.width !== win.w * SCALE || picture.height !== win.h * SCALE) inconclusive(`AC13: ${name} is ${picture.width} × ${picture.height} px, not ${win.w * SCALE} × ${win.h * SCALE}: this Mac's screen can't take it at 2×`);
      copyFileSync(picture.path, join(out, name));
    }
    return true;
  };
  const press = async (app: App, text: string, role?: string): Promise<boolean> => {
    const missing = await settled(async () => ((await app.press(text, role)).pressed ? [] : [`nothing named "${text}"${role ? ` (${role})` : ''} takes a press; the window's names are ${names(await app.tree())}`]), 30_000);
    failures.push(...missing.map((m) => `${look}: ${m}`));
    return !missing.length;
  };

  // A first launch: setup hasn't run, so no hub either, and the window opens on the welcome.
  const fresh = t26.makeHome().home;
  mkdirSync(t26.rootOf(fresh), { recursive: true });
  await launch(fresh, async (app) => { await take(app, 'welcome'); });

  const world = await seeded();
  try {
    // The window opens on Needs you; a press on the ask's row shows its card.
    await launch(world.home, async (app) => {
      if ((await take(app, 'needs-you')) && (await press(app, QUESTION, 'AXButton'))) await take(app, 'question-card');
    });
    // A session's row opens its page, the sidebar's Agents opens Agents, and ⌘K's Home opens Home.
    await launch(world.home, async (app) => {
      if (await press(app, TITLE, 'AXButton')) await take(app, 'session');
      if (await press(app, 'Agents', 'AXButton')) await take(app, 'agents');
      await app.commandK();
      let tries = 0;
      const listed = await settled(async () => {
        const tree = await app.tree();
        if (has(tree, 'Home') && has(tree, 'Needs you')) return [];
        if (++tries % 4 === 0) await app.commandK();
        return [`⌘K lists no "Home" and "Needs you"; the window's names are ${names(tree)}`];
      }, 20_000);
      failures.push(...listed.map((m) => `${look}: ${m}`));
      if (!listed.length && (await press(app, 'Home'))) await take(app, 'home');
    });
  } finally {
    await t26.stopHub(world.hub);
  }
  return failures;
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));

describe('#1458 shown to you', () => {
  it('AC13 the check run takes each shipped page from the real app at 960 × 640 and 1512 × 982, in light and dark, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right', async () => {
    await probeBinary();
    if (await locked()) blocked('the screen is locked, so no window\'s pixels can be captured');
    const out = process.env.DA1458_SCREENS ?? t26.tempDir();
    mkdirSync(out, { recursive: true });
    const binary = await plainApp();
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      const missing: string[] = [];
      for (const look of LOOKS) missing.push(...await shots(binary, look, out));
      expect(missing, 'each page is on the real window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1458, criterion: 'AC13', app })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC13: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC13: no taste call is recorded for these screenshots (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC13: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC13: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 180 * MINUTES);
});
