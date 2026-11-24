// By-hand run of #22 with #1349's sign-in task, on macOS: a real hub with `deep setup`'s own 8-hour batches, the real
// deep-app window, a Claude Code stand-in whose turn ends on a lapsed sign-in (StopFailure, authentication_failed), and
// a taste call through deep_ask. The sign-in task shows at once, in `deep inbox`, the hub's list and Needs you; the
// taste call waits for its batch, hours away. Takes 0-signin.png of the app's window.
// With NO_APP=1 it runs without the app (any OS): the inbox and the list rows only.
// Put it at <repo>/target/e2e-22/signin.test.ts and run from the repo root:
//   E2E_OUT=<dir> npx vitest run --root target/e2e-22 signin.test.ts --testTimeout=1200000
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as a27 from '../../tests/acceptance/27/helpers.ts';
import * as a994 from '../../tests/acceptance/994/helpers.ts';

const OUT = process.env.E2E_OUT!;
const APP = process.env.NO_APP !== '1';
mkdirSync(OUT, { recursive: true });
const out: string[] = [];
const log = (s: string) => { out.push(s); writeFileSync(join(OUT, 'signin-run.txt'), `${out.join('\n')}\n`); };
// The app's own window only, as e2e-app.test.ts takes it.
const windowOf = (pid: number) => execFileSync('swift', ['-e', `import CoreGraphics
import Foundation
let all = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as NSArray? as? [[String: Any]]) ?? []
let int = { (w: [String: Any], k: CFString) in (w[k as String] as? NSNumber)?.intValue ?? -1 }
let mine = all.filter { int($0, kCGWindowOwnerPID) == ${pid} }
let shown = mine.first { int($0, kCGWindowLayer) == 0 && int($0, kCGWindowIsOnscreen) == 1 }
print(shown.map { int($0, kCGWindowNumber) } ?? 0, "windows", all.count, "app's", mine.map { "\\(int($0, kCGWindowLayer))/\\(int($0, kCGWindowIsOnscreen))" })`], { encoding: 'utf8' }).trim();
let appPid = 0;
const shot = (name: string) => {
  execFileSync('caffeinate', ['-u', '-t', '3']);
  const seen = windowOf(appPid);
  const id = seen.split(' ')[0];
  if (id === '0') throw Error(`BLOCKED: no on-screen window for deep-app pid ${appPid}, so ${name} wasn't taken (${seen})`);
  execFileSync('screencapture', ['-x', '-o', '-l', id, join(OUT, name)]);
  log(`   screenshot ${name} (window ${id})`);
};

it('signin', async () => {
  const h: any = a27;
  const { home } = h.makeHome();
  const repo = h.makeRepo(home).dir;
  if (APP) await a994.appBinary();
  // Well inside a batch window: setup's batches are at 00:00, 08:00 and 16:00 UTC, so the next is at least an hour off.
  const hourUtc = new Date().getUTCHours() % 8;
  if (hourUtc === 7) throw Error(`BLOCKED: within an hour of a batch time (${new Date().toISOString()}); run it again after the hour`);
  const hub = await h.startHub(home);
  await h.setup(home);
  log(`World: home ${home}; machine ${process.platform}; ${new Date().toISOString()}; batches as setup drafts them`);
  let app: any;
  if (APP) {
    app = await a994.startApp(home, 'allowed');
    await a994.windowUp(app);
    appPid = app.pid;
    log(`deep-app pid ${app.pid}`);
  }
  // A taste call, which waits for its batch.
  const t = h.newSession(home, repo);
  const tc = h.Claude.start(home);
  await tc.hook('SessionStart', h.payload(t, 'SessionStart'));
  h.typedPrompt(t, 'Pick a header colour for the checkout screen, then stop.');
  await tc.hook('UserPromptSubmit', h.payload(t, 'UserPromptSubmit', { prompt: 'Pick a header colour for the checkout screen, then stop.' }));
  const question = 'T1: which header colour for this checkout screen?';
  void tc.tool(t, 'deep_ask', { kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'green', steps: null, where: null, why: null, check: null, subject: { point: null, screen: 'checkout-t1', element: null } }, 600_000).catch(() => undefined);
  const taste = await h.waitFor(async () => (await h.allEvents(hub)).find((e: any) => e.kind === 'ask.created' && e.data?.question === question), 60_000, question);
  // A turn that ends on a lapsed sign-in.
  const s = h.newSession(home, repo);
  const sc = h.Claude.start(home);
  await sc.hook('SessionStart', h.payload(s, 'SessionStart'));
  h.typedPrompt(s, 'Add a README line, then stop.');
  await sc.hook('UserPromptSubmit', h.payload(s, 'UserPromptSubmit', { prompt: 'Add a README line, then stop.' }));
  await sc.hook('StopFailure', h.payload(s, 'StopFailure', { error: 'authentication_failed' }));
  const task = await h.waitFor(async () => (await h.allEvents(hub)).find((e: any) => e.kind === 'ask.created' && String(e.data?.proves ?? '').endsWith(' sign-in probe')), 120_000, 'the sign-in task');
  await h.sleep(5000);
  const events = await h.allEvents(hub);
  const listed = new Map<string, boolean>();
  for (const e of events) if (e.kind === 'row.set' && String(e.data?.id ?? '').startsWith('ask:')) listed.set(String(e.data.id), e.data.listed === true);
  const rows = await h.inboxRows(hub);
  const status = (id: string) => rows.find((r: any) => r.ask === `ask:${id}`)?.status;
  const inbox = await h.deep(home, ['inbox']);
  log(`\n$ deep inbox    # ${new Date().toISOString()}\n${inbox.stdout.trimEnd()}`);
  log(`\nsign-in task ask:${task.id} "${task.data.question}": inbox ${status(task.id)}, hub list ${listed.get(`ask:${task.id}`) ? 'listed' : 'not listed'}`);
  log(`taste call ask:${taste.id}: inbox ${status(taste.id)}, hub list ${listed.get(`ask:${taste.id}`) ? 'listed' : 'not listed'}`);
  if (APP) shot('0-signin.png');
  await h.stopHub(hub);
  await h.cleanup();
  expect([status(task.id), listed.get(`ask:${task.id}`) === true], 'the sign-in task shows at once and the hub lists it').toEqual(['shown', true]);
  expect([status(taste.id), listed.get(`ask:${taste.id}`) === true], 'the taste call waits for its batch, unlisted').toEqual(['queued', false]);
}, 1_200_000);
