// AC7: Shown to you: screenshots of a session's page, the question card, the bound panel and the first screen, before
// and after, taken by the check run from the real app at the reference window, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it.
//
// "Before" is the merge base's app, built from its own tree; "after" is this checkout's. Each runs as the real
// `deep-app` against a real hub in a temp home, read from outside its process with #1454's probe (its window list, the
// press a screen reader sends) and captured by window ID, never the display. The pictures go to $DA1455_SCREENS (a temp
// folder without it) with run.json, the SHA-256 of both apps; then TASTE.json is read as #1454's suite reads its own.
// "Attached to the PR and shown to you" is the implementing agent's; no test can see it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as t1454 from '../1454/helpers.ts';
import * as t26 from '../26/helpers.ts';
import { AC7, BOUND_RUN, baseTree, blocked, cleanup, deepHook, FIXTURES, HOUR, inconclusive, makeHome, mergeBase, MINUTES, REPO, run, sha256File, shown, SUITE, tasteFailure, tempDir, type Taste } from './helpers.ts';

afterAll(async () => { await cleanup(); await t1454.t806.cleanup(); }, 60_000);
const SHOTS = ['first-screen', 'session-page', 'question-card', 'bound-panel'] as const;
const expected = (): string[] => [...['before', 'after'].flatMap((w) => SHOTS.map((s) => `${w}-${s}.png`)), 'run.json'].sort();
const QUESTION = 'Keep the old logo in the header?';
const TITLE = 'Header layout';

/** `deep-app` built in `root` (this checkout, or the merge base's tree in a target folder of its own), with `features`. */
async function build(root: string, name: string, features: string[]): Promise<string | undefined> {
  const targetDir = root === REPO ? (process.env.CARGO_TARGET_DIR ?? join(REPO, 'target')) : join(tmpdir(), 'da1455-base-target');
  const manifest = readFileSync(join(root, 'crates/deep-app/Cargo.toml'), 'utf8');
  if (features.some((f) => !new RegExp(`^${f}\\s*=`, 'm').test(manifest))) return undefined;
  const r = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-app', '--bin', 'deep-app', ...features.flatMap((f) => ['--features', f])], { cwd: root, env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_INCREMENTAL: '0' }, timeoutMs: 120 * MINUTES });
  if (r.code !== 0) blocked(`cargo build -p deep-app ${features.join(' ')} in ${root} failed: ${r.stderr.slice(-2000)}`);
  const out = join(tempDir(), name);
  copyFileSync(join(targetDir, 'debug/deep-app'), out);
  return out;
}

/** A home whose hub holds two tasks and an ask, and the bound values' file the `test-bound` build reads (README, The contract). */
async function world(): Promise<{ home: string; hub: t26.Hub; bound: string }> {
  const home = makeHome();
  await deepHook();
  const [a, b] = [t26.ulid(), t26.ulid()];
  await t26.seed(home, async (s) => {
    for (const [session, title] of [[a, TITLE], [b, 'Checkout page']] as const) {
      await s.start(session);
      await s.record.append({ writer: 'core', actor: 'you', scope: 'you', session, project: t26.PROJECT }, { v: 1, id: t26.ulid(s.now()), kind: 'task.created', ts: s.now(), data: { task_ref: `task:${session}`, thread: session, owner: 'you', title } });
    }
    await s.raise(a, 'choice', QUESTION, s.now() + 6 * HOUR);
  });
  const bound = join(tempDir(), 'bound.in.json');
  const bind = (select: string) => ({ source: `${BOUND_RUN}#header height`, select });
  writeFileSync(bound, JSON.stringify({ runs: [{ run: BOUND_RUN, check: 'header', tool: 'vitest', report: join(FIXTURES, 'vitest-header.json') }], card: [], panel: [{ id: 'expected', bind: bind('expected') }, { id: 'received', bind: bind('received') }] }));
  return { home, hub: await t26.startHub(home), bound };
}

/** The merge base's replica's session page with the bound values, at the reference window: before.bound-panel.png. */
async function replicaBoundPanel(bound: string, out: string): Promise<string[]> {
  const base = baseTree(mergeBase());
  const targetDir = join(tmpdir(), 'da1455-base-target');
  const built = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-replica', '--bin', 'deep-replica'], { cwd: base, env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_INCREMENTAL: '0' }, timeoutMs: 120 * MINUTES });
  if (built.code !== 0) return [`the merge base's replica didn't build: ${built.stderr.slice(-1500)}`];
  const dir = join(tempDir(), 'replica');
  const r = await run(join(targetDir, 'debug/deep-replica'), ['--view', 'session', '--out', dir, '--appearance', 'light', '--bound', bound], { cwd: base, env: t26.childEnv(makeHome()), timeoutMs: 10 * MINUTES });
  if (r.code !== 0) return [`the merge base's replica drew no bound panel: ${shown(r)}`];
  copyFileSync(join(dir, 'screens/session.png'), join(out, 'before-bound-panel.png'));
  return [];
}

/** One app's four pictures, each taken once its state is on the window's tree. */
async function shots(which: 'before' | 'after', plain: string, withBound: string | undefined, out: string): Promise<string[]> {
  const w = await world();
  const failures: string[] = [];
  const press = async (app: t1454.App, text: string, what: string): Promise<boolean> => {
    const pressed = await t1454.settled(async () => ((await app.press(text)).pressed ? [] : [`the ${which} app has no ${what} that takes a press: ${JSON.stringify(t1454.named(await app.tree()).map((n) => n.name).slice(0, 30))}`]), 30_000);
    failures.push(...pressed);
    return !pressed.length;
  };
  const take = async (app: t1454.App, name: string) => {
    await t1454.sleep(800);
    const picture = await app.capture(`${which}-${name}`);
    const want = [t1454.REFERENCE.width * t1454.REFERENCE.scale, t1454.REFERENCE.height * t1454.REFERENCE.scale];
    if (picture.width !== want[0] || picture.height !== want[1]) inconclusive(`AC7: the ${which} ${name} picture is ${picture.width} × ${picture.height} px, not the reference window's ${want.join(' × ')}`);
    copyFileSync(picture.path, join(out, `${which}-${name}.png`));
  };
  try {
    // The first screen and the card one press on its row opens; then, in a launch of its own, a session's page.
    const app = await t1454.App.launch({ home: w.home, binary: plain });
    try {
      await take(app, 'first-screen');
      if (await press(app, QUESTION, `row for "${QUESTION}"`)) {
        // The card is up once its options are on the tree (#26's choice: SQLite or Plain files).
        const up = await t1454.settled(async () => (t1454.named(await app.tree()).some((n) => n.name.includes('Plain files')) ? [] : [`the ${which} app's card for "${QUESTION}" shows no option "Plain files"`]), 20_000);
        failures.push(...up);
        if (!up.length) await take(app, 'question-card');
      }
    } finally {
      await app.stop();
    }
    const again = await t1454.App.launch({ home: w.home, binary: plain });
    try {
      if (await press(again, TITLE, `row for "${TITLE}"`)) await take(again, 'session-page');
    } finally {
      await again.stop();
    }
    if (withBound) {
      const bound = await t1454.App.launch({ home: w.home, binary: withBound, env: { DEEP_APP_TEST_BOUND: w.bound } });
      try {
        if (await press(bound, TITLE, `row for "${TITLE}"`)) await take(bound, 'bound-panel');
      } finally {
        await bound.stop();
      }
    } else if (which === 'before') {
      // A merge base whose app has no seam for bound values drew its bound panel only in its replica (#629): that one.
      failures.push(...await replicaBoundPanel(w.bound, out));
    } else {
      failures.push('this checkout\'s app can\'t draw a bound panel: crates/deep-app/Cargo.toml has no feature test-bound (README, The contract)');
    }
  } finally {
    await t26.stopHub(w.hub);
  }
  return failures;
}

describe('#1455 shown to you', () => {
  it(`${AC7}: the check run takes the before and after screenshots from the real app at the reference window, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    await t1454.probeBinary();
    const out = process.env.DA1455_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const base = baseTree(mergeBase());
    // The plain build last, so the checkout's target/debug never holds the test-bound app.
    const afterBound = await build(REPO, 'deep-app-after-bound', ['test-bound']);
    const after = (await build(REPO, 'deep-app-after', []))!;
    const before = (await build(base, 'deep-app-before', []))!;
    const beforeBound = await build(base, 'deep-app-before-bound', ['test-bound']);
    const apps = { base: mergeBase(), before: sha256File(before), after: sha256File(after), beforeBoundPanel: beforeBound ? 'app' : 'replica' };
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && JSON.stringify(JSON.parse(readFileSync(runFile, 'utf8'))) === JSON.stringify(apps)
      && JSON.stringify(files()) === JSON.stringify(Object.fromEntries(Object.entries(taste.files ?? {}).sort()));
    if (!kept) {
      const missing = [...await shots('before', before, beforeBound, out), ...await shots('after', after, afterBound, out)];
      expect(missing, 'each state is on the real window before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify(apps)}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC7: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    const failure = tasteFailure(taste, got);
    if (failure?.inconclusive) inconclusive(failure.inconclusive);
    expect(failure?.fails, 'the recorded taste call').toBeUndefined();
  }, 180 * MINUTES);
});
