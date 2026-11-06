// #82 AC4: after the app restarts with ten working sessions, each continues without you typing (design: Every stop is
// judged, "After the app's own resume prompt, when the interrupted turn had done work and left asks open, the session
// gets one automatic continue").
//
// One hub, ten Claude desktop app sessions, each on its own item (31-40) whose R1 fails until FLAG. In each you type
// `Fix <link>`, the agent edits its file, and then the app is quit while each is in the middle of a Bash call
// (PreToolUse with no PostToolUse, SessionEnd other), as the corpus's 2.1.299 desktop-resume session records a quit.
// The app restarts: each session resumes (SessionStart resume) and gets the app's own resume prompt, and the agent of
// each stops with no tool call, as that session's agent did ("resumed"), the ten within 2.5 s. Each session
// must continue with nothing typed: its Stop's reply keeps it going, or DeepBuild's waiter, which Claude Code starts
// beside the Stop, wakes it. The resume turns did no work, so none of their stops is a claim (AC3's rule): the
// continue is the resume's own, not a send-back of a claim. The base sends each back on a claim, so it fails there.
import { afterAll, describe, it } from 'vitest';
import { verdict, AC4, EXPIRED, claimsIn, cleanup, continuation, item, lastPos, makeWorld, must, Session, settle, shown, sleep, startHub, startOnItem, typedAfter, listed } from './helpers.ts';

afterAll(cleanup, 60_000);

const ITEMS = Array.from({ length: 10 }, (_, i) => 31 + i);

describe(`${AC4} ten working sessions continue after the app restarts, with nothing typed`, () => {
  it(`${AC4} items 31-40: after the desktop app is quit mid-call and restarted, each of the ten sessions gets the app's resume prompt and continues without you typing`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: ITEMS.map((n) => item(n, `Expired tokens are accepted (${n})`, [EXPIRED])), files: Object.fromEntries(ITEMS.map((n) => [`src/s${n}.js`, 'module.exports = { step: 0 };\n'])) });
    const hub = await startHub(w);
    const sessions: Session[] = [];
    for (const n of ITEMS) {
      const s = new Session(w, 'desktop');
      await startOnItem(hub, s, n, `${AC4} [item ${n}]`, { read: false });
      await s.edit(`src/s${n}.js`, 'step: 0', 'step: 1');
      await s.begin('Bash', { command: 'npm test', description: 'Run the tests' });
      sessions.push(s);
    }
    // The app is quit: every session ends at once, mid-call.
    await Promise.all(sessions.map((s) => s.end('other')));
    // The app restarts: each session resumes and gets the app's resume prompt.
    for (const s of sessions) await s.start('resume');
    const restarted = await lastPos(hub);
    for (const s of sessions) await s.resumePrompt();
    // The ten agents answer the resume prompt within 2.5 s of each other, each stop 250 ms after the last, as ten
    // model calls end; each is still held while the others come.
    const stops = await Promise.all(sessions.map(async (s, i) => { await sleep(250 * i); return s.stopWaiting('Resumed.', 60_000); }));
    const woke = await Promise.all(stops.map((r) => continuation(r.stop, r.waiter)));
    const events = await settle(hub, () => true);
    for (const s of sessions) must(typedAfter(events, s, restarted).length === 0, `BLOCKED: ${AC4} nothing is typed after the restart: ${listed(typedAfter(events, s, restarted))}`);
    const still = ITEMS.filter((_, i) => woke[i] === undefined);
    must(still.length === 0, `${AC4} after the restart each of the ten working sessions continues without you typing; ${still.length} of 10 were let stop with nothing to go on: items ${still.join(', ')} (first: ${still.length ? shown(stops[ITEMS.indexOf(still[0]!)]!.stop) : 'none'})`);
    // What continues them is the app's resume's one automatic continue, not a send-back of a claim: the resume turn did
    // no work, so its stop is no claim (AC3's rule).
    const claimed = claimsIn(events, restarted);
    must(claimed.length === 0, `${AC4} each session continues by the automatic continue after the app's resume prompt; the resume turns did no work, so their stops make no claim, yet ${claimed.length} claim.made were recorded after the restart and the sessions were sent back on them: ${listed(claimed.slice(0, 3))}; the first reply: ${woke[0]?.slice(0, 300)}`);
  }), 600_000);
});
