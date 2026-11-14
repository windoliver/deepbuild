// By-hand run of #22 in the app, on macOS: a real hub, `deep setup`, the real deep-app window, and asks raised live by
// Claude Code stand-in sessions through deep_ask (`deep mcp`). Takes screenshots of the window with `screencapture`:
// 1) two taste calls and a session's six asks, the sixth folded into its "keeps asking" exception; 2) after you answer
// the exception in bulk with `deep inbox answer <exception> together`. Batches every minute: before the batch time
// Needs you is empty (0-before-batch.png), and the batch shows them.
// Put it at <repo>/target/e2e-22/app.test.ts and run from the repo root on the Mac:
//   E2E_OUT=<dir> npx vitest run --root target/e2e-22 app.test.ts --testTimeout=1200000
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import * as a27 from '../../tests/acceptance/27/helpers.ts';
import * as a994 from '../../tests/acceptance/994/helpers.ts';

const OUT = process.env.E2E_OUT!;
mkdirSync(OUT, { recursive: true });
const out: string[] = [];
const log = (s: string) => { out.push(s); writeFileSync(join(OUT, 'app-run.txt'), `${out.join('\n')}\n`); };
// The app's own window only, so nothing else on the screen is kept; the display is woken first (a sleeping one is black).
const windowOf = (pid: number) => execFileSync('swift', ['-e', `import CoreGraphics
import Foundation
let all = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as NSArray? as? [[String: Any]]) ?? []
let int = { (w: [String: Any], k: CFString) in (w[k as String] as? NSNumber)?.intValue ?? -1 }
let mine = all.filter { int($0, kCGWindowOwnerPID) == ${pid} }
let shown = mine.first { int($0, kCGWindowLayer) == 0 && int($0, kCGWindowIsOnscreen) == 1 }
// The id, then what was seen, for the BLOCKED line: every window count, and each of the app's as layer/onscreen.
print(shown.map { int($0, kCGWindowNumber) } ?? 0, "windows", all.count, "onscreen", all.filter { int($0, kCGWindowIsOnscreen) == 1 }.count, "app's", mine.map { "\\(int($0, kCGWindowLayer))/\\(int($0, kCGWindowIsOnscreen))" })`], { encoding: 'utf8' }).trim();
let appPid = 0;
const shot = (name: string) => {
  execFileSync('caffeinate', ['-u', '-t', '3']);
  const seen = windowOf(appPid);
  const id = seen.split(' ')[0];
  if (id === '0') throw Error(`BLOCKED: no on-screen window for deep-app pid ${appPid}, so ${name} wasn't taken (${seen})`);
  execFileSync('screencapture', ['-x', '-o', '-l', id, join(OUT, name)]);
  log(`   screenshot ${name} (window ${id})`);
};

it('app', async () => {
  const h: any = a27;
  const { home } = h.makeHome();
  const repo = h.makeRepo(home).dir;
  h.editConfig(home, (c: any) => { c.asks = { batch: { every: '1m', cap: 20 } }; });
  // Built first (cargo), then started well before a batch time, so the asks are seen waiting first.
  await a994.appBinary();
  while (Date.now() % 60_000 > 20_000) await h.sleep(250);
  const hub = await h.startHub(home);
  await h.setup(home);
  const app = await a994.startApp(home, 'allowed');
  await a994.windowUp(app);
  appPid = app.pid;
  log(`World: home ${home}; deep-app pid ${app.pid}; machine ${execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim()}`);
  const ask = async (who: string, n: number, o: any = {}) => {
    const question = `${who}: which header colour for checkout screen ${n}?`;
    const s = o.s ?? h.newSession(home, repo);
    const claude = o.claude ?? h.Claude.start(home);
    if (!o.s) {
      await claude.hook('SessionStart', h.payload(s, 'SessionStart'));
      h.typedPrompt(s, 'Pick header colours for the checkout screens, then stop.');
      await claude.hook('UserPromptSubmit', h.payload(s, 'UserPromptSubmit', { prompt: 'Pick header colours for the checkout screens, then stop.' }));
    }
    const args = { kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'green', steps: null, where: null, why: null, check: null, subject: { point: null, screen: `checkout-${who}-${n}`, element: null } };
    void claude.tool(s, 'deep_ask', args, 600_000).catch(() => undefined);
    const created = await h.waitFor(async () => (await h.allEvents(hub)).find((e: any) => e.kind === 'ask.created' && e.data?.question === question), 60_000, question);
    return { s, claude, handle: `ask:${created.id}` };
  };
  await ask('A', 1);
  await ask('B', 1);
  const d1 = await ask('D', 1);
  for (let n = 2; n <= 6; n++) await ask('D', n, { s: d1.s, claude: d1.claude });
  await h.sleep(3000);
  const inbox0 = await h.deep(home, ['inbox']);
  log(`\n$ deep inbox    # before the batch, ${new Date().toISOString()}\n${inbox0.stdout.trimEnd()}`);
  shot('0-before-batch.png');
  const batch = Math.ceil(Date.now() / 60_000) * 60_000;
  while (Date.now() < batch + 5000) await h.sleep(250);
  const inbox1 = await h.deep(home, ['inbox']);
  log(`\n$ deep inbox    # after the ${new Date(batch).toISOString()} batch\n${inbox1.stdout.trimEnd()}`);
  shot('1-needs-you.png');
  const exc = (await h.inboxRows(hub)).find((r: any) => r.kind === 'exception' && r.status !== 'closed');
  if (exc) {
    const r = await h.deep(home, ['inbox', 'answer', exc.ask, 'together']);
    log(`\n$ deep inbox answer ${exc.ask} together\n${(r.stdout + r.stderr).trimEnd()} (exit ${r.code})`);
  } else log('\nno exception row in the inbox');
  await h.sleep(5000);
  const inbox2 = await h.deep(home, ['inbox']);
  log(`\n$ deep inbox\n${inbox2.stdout.trimEnd()}`);
  shot('2-after-bulk-answer.png');
  await h.stopHub(hub);
  await h.cleanup();
}, 1_200_000);
