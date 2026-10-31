// Criterion 2: a replica's input never answers an ask in your record, starts sound, writes the clipboard or moves focus
// in your app, checked by a fixture that tries (README: Criterion 2). Your record is a real hub (`deep hub run`) in a
// temporary home holding one open choice ask; the replica launches as a read-only copy of it, with the panel that
// tries (fixtures/panels/tries) mounted, and the run clicks the ask's row and every button it can locate, the panel's
// Try among them, presses the keys that answer a card, types "yes", and lets the virtual clock run past the app's
// notification delay. This Mac is watched the whole time: the frontmost app, the pasteboard, the audio-out assertions
// coreaudiod holds for a process, and whether the replica ever registers as a foreground app. Four planted replicas,
// each lifting one guard (DEEP_DRIVE_PLANT), run the same fixture through the same judge, which must name what leaked.
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Drive, FLICKS_PER_SECOND, ID, PANEL, buildDrive, cleanup, frontApp, launch, must, pasteboard, requireMacos, t26, watch, type Obj, type Watch,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/**
 * Your record: one open choice ask, raised for a session of the repo before your hub starts on it. A choice, not an
 * authority ask: since #69 the asks core refuses an authority ask without a plan, which #26's seeding gives none, and the
 * criterion holds for any ask in your record.
 */
async function yourRecord(): Promise<{ home: string; hub: t26.Hub; ask: string }> {
  const { home } = t26.makeHome();
  let ask = '';
  await t26.seed(home, async (s) => {
    await s.start('S124');
    ask = await s.raise('S124', 'choice', 'Keep the release notes in the repo or in the wiki?');
  });
  const hub = await t26.startHub(home);
  return { home, hub, ask };
}

const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'ask.later', 'decision.created', 'permission.answer']);

/** The fixture that tries: every input the run can give that could answer the ask, write the clipboard, sound or take focus. */
async function tryEverything(drive: Drive, replica: string, ask: string): Promise<{ tried: number }> {
  const see = async () => (await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } }));
  const names = (snapshot: Obj): Obj[] => {
    const all: Obj[] = [];
    const walk = (n: Obj) => { all.push(n); for (const c of n.children ?? []) walk(c); };
    walk(snapshot.tree);
    return all;
  };
  let tried = 0;
  const click = async (locator: Obj) => { const { reply } = await drive.call({ call: 'act', replica, locator, act: { kind: 'click' }, timeout: 500 }); return reply; };
  await click({ name: ask });
  const seen = new Set<string>();
  for (let round = 0; round < 2; round++) {
    for (const n of names((await see()).snapshot).filter((x) => x.role === 'button' && typeof x.name === 'string')) {
      if (seen.has(n.name) || seen.size >= 40) continue;
      seen.add(n.name);
      await click({ role: 'button', name: n.name });
    }
  }
  for (const keys of ['enter', '1', 'cmd-enter', 'space']) await drive.call({ call: 'act', replica, act: { kind: 'press', keys }, timeout: 500 });
  await drive.call({ call: 'act', replica, act: { kind: 'type', text: 'yes' }, timeout: 500 });
  const { t } = await see();
  await drive.call({ call: 'wait_for', replica, wait_for: { t: t + 3 * FLICKS_PER_SECOND }, timeout: 10_000 });
  for (let i = 0; i < 3; i++) if ((await click({ role: 'button', name: 'Try' })).ok === true) tried++;
  await drive.call({ call: 'close', replica });
  return { tried };
}

/** Every way the run reached past the replica; none when it touched nothing of yours. */
function isolationProblems(o: { before: t26.Ev[]; after: t26.Ev[]; ask: string; w: Watch; front: { asn: string }; tried: number }): string[] {
  const problems: string[] = [];
  if (o.tried === 0) problems.push('the Try button was never clicked, so the fixture never tried');
  const seen = new Set(o.before.map((e) => e.log_pos));
  const added = o.after.filter((e) => !seen.has(e.log_pos));
  for (const e of added) {
    if (CLOSING.has(e.kind) && (e.subject === o.ask || e.data?.ask === o.ask || JSON.stringify(e.data ?? {}).includes(o.ask.slice(4)))) problems.push(`answered an ask in your record: ${e.kind} on ${o.ask}`);
    else if (e.writer === 'app') problems.push(`wrote to your record as the app: ${e.kind}`);
  }
  if (o.w.marker) problems.push('wrote the clipboard: the pasteboard held the panel\'s marker');
  const moved = [...o.w.front].filter((asn) => asn !== o.front.asn);
  if (moved.length || [...o.w.frontPids].some((p) => o.w.pids.has(p))) problems.push(`moved focus: the frontmost app changed from ${o.front.asn} to ${moved.join(', ')}`);
  if (o.w.foreground) problems.push('moved focus: the replica registered as a foreground app');
  const sounded = [...o.w.audio].filter((p) => o.w.pids.has(p));
  if (sounded.length) problems.push(`started sound: coreaudiod held audio out for the replica (pid ${sounded.join(', ')})`);
  if (o.w.samples < 5) problems.push(`the watch took ${o.w.samples} samples`);
  return problems;
}

async function tryIn(plant?: string): Promise<string[]> {
  const { home, hub, ask } = await yourRecord();
  buildDrive();
  const before = await t26.events(hub);
  const front = frontApp();
  const drive = await Drive.start({ home, ...(plant ? { plant } : {}) });
  const w = watch(() => drive.pid);
  let tried = 0;
  try {
    const replica = await launch(drive, { from: 'record_copy', panel: PANEL.tries, clock: 'virtual' });
    ({ tried } = await tryEverything(drive, replica, ask));
  } finally {
    await drive.stop();
  }
  const seen = await w.stop();
  return isolationProblems({ before, after: await t26.events(hub), ask, w: seen, front, tried });
}

describe(`${ID.isolation} a replica's input never answers an ask in your record, starts sound, writes the clipboard or moves focus in your app`, () => {
  it(`${ID.isolation} the fixture that tries reaches nothing of yours: the ask stays open, the pasteboard, the frontmost app and the audio out are untouched`, async () => {
    requireMacos();
    expect(await tryIn()).toEqual([]);
  }, 600_000);

  // Each planted replica lifts one guard; the judge must name it. The pasteboard and the frontmost app are put back after.
  const PLANTS: [string, RegExp][] = [
    ['answers-your-record', /answered an ask in your record/],
    ['writes-clipboard', /wrote the clipboard/],
    ['moves-focus', /moved focus/],
    ['starts-sound', /started sound/],
  ];
  for (const [plant, named] of PLANTS) {
    it(`${ID.isolation} a replica planted to let one through (${plant}) fails the same fixture, named`, async () => {
      requireMacos();
      const clip = pasteboard();
      const front = frontApp().asn;
      const bundle = /"CFBundleIdentifier"="([^"]+)"/.exec(execFileSync('lsappinfo', ['info', '-only', 'bundleid', front], { encoding: 'utf8' }))?.[1];
      try {
        const problems = await tryIn(plant);
        expect(problems.join('\n'), `the judge names what ${plant} let through`).toMatch(named);
      } finally {
        if (pasteboard() !== clip) execFileSync('pbcopy', [], { input: clip });
        if (frontApp().asn !== front && bundle) try { execFileSync('open', ['-b', bundle]); } catch { /* the app can't be brought back; the README says so */ }
      }
    }, 600_000);
  }
});
