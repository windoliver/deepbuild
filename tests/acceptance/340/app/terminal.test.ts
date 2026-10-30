// AC6, the terminal's words while the note waits: "the same words written into the session's terminal by a test
// process are never recorded app", and the note is matched by its request ID, never by its words.
//
// The session runs no waiter and is idle, so the app's note waits for the next prompt. The test process then writes
// the note's exact words into the session's terminal (a prompt typed, turnOrigin: human). That prompt is what carries
// the note as context, so a hub that matched the note by its words would take your typed prompt for the app's. The
// typed words must be recorded, never as from: app and with no request ID, and any user.ask from: app in the session
// is the note's alone, with its request ID, once.

import { afterAll, describe, expect, it } from 'vitest';
import {
  AC6, asksOf, asksShown, cleanup, idleSession, lastPos, newNote, sendNote, sleep, typeWords, typedCopy, world,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC6} the same words written into the session's terminal by a test process, while the app's note waits`, () => {
  it(`${AC6} are recorded but never app, and only the note carries its request ID`, async () => {
    const w = await world();
    const idle = await idleSession(w, { waiter: false });
    const note = newNote();
    await sendNote(w.hub, idle.s, note);
    await sleep(2000);
    const after = await lastPos(w.hub);
    await typeWords(idle, note.text);
    await typedCopy(w, idle, note, after);
    // Give the note's own record its time, then read every user.ask from: app in the session.
    await sleep(5000);
    const asks = await asksOf(w.hub, idle.s);
    const fromApp = asks.filter((e) => e.data.from === 'app');
    for (const e of fromApp) {
      expect(e.data.request, `${AC6} a user.ask from: app in session ${idle.s.id} must be the note's, matched by its request ID ${note.request}, never words from the terminal; recorded ${asksShown([e])}`).toBe(note.request);
    }
    expect(fromApp.length, `${AC6} the note (request ${note.request}) is recorded at most once from: app; session ${idle.s.id}'s user.ask events: ${asksShown(asks)}`).toBeLessThanOrEqual(1);
  }, 600_000);
});
