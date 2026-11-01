// #883's Proof, run by hand on a Mac: the app bundle (scripts/app-bundle) reads a real hub in a temporary home,
// agent stand-ins raise asks through deep_ask, and `deep inbox answer` answers one. After each step the OS's own list
// of what Notification Center holds from the app (`deep-app --notification-center`) is written to
// out/notification-center.txt, with the app's notified/withdrew lines. Needs the app allowed to notify (System
// Settings › Notifications › DeepBuild) and the hub's and agent's helpers from #667. Processes stop by PID only.
//
//   scripts/app-bundle && node node_modules/vitest/vitest.mjs run tests/proof/883/notification-center.live.test.ts

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  Agent, childEnv, cleanup, deep, makeHome, own, question, raise, REPO, sleep, startHub, stopHub, writeSettings, type Hub,
} from '../../acceptance/667/helpers.ts';

const APP = join(REPO, 'target/DeepBuild.app/Contents/MacOS/deep-app');
const OUT = join(REPO, 'tests/proof/883/out/notification-center.txt');
const log: string[] = [];
let said = 0;

interface Held { tag: string; title: string; body: string }
interface App { child: ChildProcess; lines: string[] }

function launch(home: string): App {
  const child = spawn(APP, [], { env: childEnv(home), stdio: ['ignore', 'ignore', 'pipe'] });
  own(child.pid);
  const app: App = { child, lines: [] };
  child.stderr!.setEncoding('utf8').on('data', (d: string) => app.lines.push(...d.split('\n').filter(Boolean)));
  return app;
}
/** Waits for the app's first frame: its reader opened on the hub before the window drew. */
async function drawn(app: App): Promise<void> {
  const until = Date.now() + 60_000;
  while (!app.lines.some((l) => l.startsWith('first-frame-ms '))) {
    if (Date.now() > until) throw Error(`BLOCKED: the app drew no first frame in 60 s: ${app.lines.join(' | ')}`);
    await sleep(100);
  }
}
async function quit(app: App): Promise<void> {
  app.child.kill('SIGTERM');
  await new Promise((resolve) => app.child.once('exit', resolve));
}
/** What Notification Center holds from the app now, as the OS lists it, written to the proof under `step`. */
async function center(step: string, apps: App[]): Promise<Held[]> {
  const listed = await new Promise<string>((resolve, reject) => {
    const child = spawn(APP, ['--notification-center'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(Error(`--notification-center exited ${code}`))));
  });
  const held = listed.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Held);
  const lines = apps.flatMap((a) => a.lines);
  log.push(`-- ${new Date().toISOString()} ${step}`, '   the app said since the last step:', ...lines.slice(said).map((l) => `     ${l}`),
    '   Notification Center holds:', ...(held.length ? held.map((h) => `     ${JSON.stringify(h)}`) : ['     (nothing)']));
  said = apps.flatMap((a) => a.lines).length;
  return held;
}
const posts = (apps: App[], ask: string) => apps.flatMap((a) => a.lines).filter((l) => l.startsWith('deep-app: notified ') && l.endsWith(` ${ask}`));

afterAll(async () => {
  mkdirSync(join(REPO, 'tests/proof/883/out'), { recursive: true });
  writeFileSync(OUT, `${log.join('\n')}\n`);
  await cleanup();
}, 60_000);

test('#883 on Notification Center: withdrawn on a CLI answer, one per session, a clock time, nothing again after restarts', async () => {
  const home = makeHome();
  writeSettings(home);
  const s1 = Agent.start(home);
  const s2 = Agent.start(home);
  let hub: Hub = await startHub(home, { confirm: 'confirmed' });
  for (const agent of [s1, s2]) {
    await agent.establish(hub);
    await agent.initialize();
  }
  const first = launch(home);
  const apps = [first];
  await drawn(first);
  log.push(`sessions: S1 ${s1.session}, S2 ${s2.session}`);
  // What an earlier run left is from sessions with no open ask on this hub, so the app withdrew it on start.
  const before = await center('before: the app is up, nothing asked', apps);
  expect(before, 'Notification Center holds nothing from the app').toEqual([]);

  // AC1: an ask that notified, then answered in the CLI, leaves Notification Center within 2 s.
  const a1 = await raise(s1, hub, question('taste', 'Which header colour on the checkout total?', [['blue', 'Blue header'], ['green', 'Green header']], 'blue'));
  const ask1 = `ask:${a1.created.id}`;
  await sleep(2500);
  const shown = await center(`AC1: ${ask1} raised by S1, 2.5 s on`, apps);
  expect(shown.map((h) => h.tag), `${ask1} notified`).toContain(s1.session);
  const held1 = shown.find((h) => h.tag === s1.session)!;
  expect(held1.title, 'the title names DeepBuild').toMatch(/^DeepBuild · /);
  expect(held1.body, 'the default is a clock time').toMatch(/If you don't answer: Blue header, (on \w{3} \d{1,2} \w{3} |tomorrow )?at \d{2}:\d{2}\.$/);
  const answered = await deep(home, ['inbox', 'answer', ask1, 'green']);
  log.push(`   deep inbox answer ${ask1} green: exit ${answered.code} ${answered.stdout.trim()} ${answered.stderr.trim()}`);
  expect(answered.code, answered.stderr).toBe(0);
  await sleep(2000);
  const after1 = await center(`AC1: 2 s after deep inbox answer ${ask1}`, apps);
  expect(after1.map((h) => h.tag), `${ask1}'s notification left Notification Center`).not.toContain(s1.session);

  // AC2: two asks from one session, 30 s apart, leave one, the second's; another session's leaves a second.
  const a2 = await raise(s1, hub, question('taste', 'Which font for the receipt?', [['inter', 'Inter'], ['plex', 'Plex']], 'inter'));
  await sleep(30_000);
  const a3 = await raise(s1, hub, question('taste', 'Which icon for the cart?', [['bag', 'Bag'], ['cart', 'Cart']], 'bag'));
  const a4 = await raise(s2, hub, question('taste', 'Which tone for the release notes?', [['plain', 'Plain'], ['warm', 'Warm']], 'plain'));
  await sleep(2500);
  const two = await center(`AC2: ask:${a2.created.id} then, 30 s later, ask:${a3.created.id} from S1; ask:${a4.created.id} from S2`, apps);
  const mine = two.filter((h) => [s1.session, s2.session].includes(h.tag));
  expect(mine.map((h) => h.tag).sort(), 'one per session').toEqual([s1.session, s2.session].sort());
  expect(mine.find((h) => h.tag === s1.session)!.body, "S1's is the second ask's").toContain('Which icon for the cart?');

  // AC4: quit and reopen the app, then restart the hub: no second notification for the asks that notified.
  const ask4 = `ask:${a4.created.id}`;
  await quit(first);
  const second = launch(home);
  apps.push(second);
  await drawn(second);
  await sleep(5000);
  await center('AC4: 5 s after quitting and reopening the app', apps);
  await stopHub(hub);
  hub = await startHub(home, { confirm: 'confirmed' });
  await sleep(5000);
  const restarted = await center('AC4: 5 s after restarting the hub', apps);
  expect(posts(apps, ask4), `${ask4} notified once`).toHaveLength(1);
  expect(posts([second], `ask:${a3.created.id}`), 'the reopened app posted nothing again').toEqual([]);
  expect(restarted.filter((h) => h.tag === s2.session), `${ask4} is held once`).toHaveLength(1);

  // The control: a new ask after the restarts still notifies. The restarted hub binds deep_ask to a fresh hook.
  await s2.establish(hub);
  const a5 = await raise(s2, hub, question('taste', 'Which order for the changelog?', [['date', 'By date'], ['area', 'By area']], 'date'));
  await sleep(2500);
  const control = await center(`control: ask:${a5.created.id} from S2 after the restarts`, apps);
  expect(posts([second], `ask:${a5.created.id}`), 'a new ask notifies after the restarts').toHaveLength(1);
  expect(control.find((h) => h.tag === s2.session)?.body, "S2's now holds the newest").toContain('Which order for the changelog?');
  // What the run left open is answered, so its notifications leave Notification Center too.
  for (const ask of [a3, a5]) await deep(home, ['inbox', 'answer', `ask:${ask.created.id}`, ask === a3 ? 'cart' : 'area']);
  await sleep(2000);
  const end = await center('the end: the open asks answered in the CLI', apps);
  expect(end.filter((h) => [s1.session, s2.session].includes(h.tag)), 'nothing left from these sessions').toEqual([]);
  await quit(second);
}, 300_000);
