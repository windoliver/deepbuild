// AC6, the waiter's route: a note sent over the hub's socket with the control token, as the app sends one, that asks
// for changed behavior, delivered by the waiter to an idle Claude Code session, is recorded as user.ask with from: app
// and its delivery's request ID, and opens a task as a typed prompt would; the same words typed into the session's
// terminal by this test process are never recorded app. The wrong program that records a waiter-delivered note as
// nothing fails this test, naming the message.
//
// The session is idle: you asked it a question, it answered and stopped, and DeepBuild's waiter, which Claude Code
// started at that stop, waits. The app sends the note. The waiter takes it and exits 2, and Claude Code wakes the
// session: a UserPromptSubmit whose prompt is a task-notification carrying what the waiter printed (#80, #25). The
// agent answers and stops. Then the test types the note's exact words into the session's terminal.

import { afterAll, describe, expect, it } from 'vitest';
import {
  AC6, PLANT_UNRECORDED, assistantSays, cleanup, expectAppNote, expectTask, failureOf, idleSession, lastPos, namesTheMessage, newNote, payload,
  sendNote, typeWords, typedCopy, waitFor, world, type Note,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const ROUTE = 'delivered by the waiter to the idle Claude Code session';

async function scenario(note: Note, plant?: string): Promise<void> {
  const w = await world(plant);
  const idle = await idleSession(w, { waiter: true });
  await sendNote(w.hub, idle.s, note);
  // The waiter's route: the session wakes, and the wake's prompt carries the note's words.
  const wake = await waitFor(async () => (await idle.claude.wakes()).find((x) => x.woke && (x.prompt ?? '').includes(note.text) && x.ran.length > 0), 30_000, 'the wake').catch(() => undefined);
  expect(wake, `${AC6} the waiter must deliver the note "${note.text}" (request ${note.request}) to idle session ${idle.s.id}: it exits 2 with the note's words and Claude Code wakes the session with them, within 30 s; wakes seen: ${JSON.stringify(await idle.claude.wakes()).slice(0, 1500)}`).toBeDefined();
  assistantSays(idle.s, 'I will add the dark mode toggle to the settings page.');
  await idle.claude.hook('Stop', payload(idle.s, 'Stop', { last_assistant_message: 'I will add the dark mode toggle to the settings page.' }));

  const ev = await expectAppNote(w.hub, idle.s, note, ROUTE);
  await expectTask(w.hub, idle, ev, `the app's note "${note.text}" (request ${note.request})`);

  // The same words, written into the session's terminal by this test process.
  const after = await lastPos(w.hub);
  await typeWords(idle, note.text);
  const typed = await typedCopy(w, idle, note, after);
  await expectTask(w.hub, idle, typed[0]!, `the typed copy of "${note.text}" (the control)`);
}

describe(`${AC6} a note from the app, delivered by the waiter to an idle Claude Code session`, () => {
  it(`${AC6} is recorded as user.ask with from: app and its request ID, opens a task as a typed prompt would, and the same words typed into the terminal are never recorded app`, async () => {
    await scenario(newNote());
  }, 600_000);

  it(`${AC6} (wrong program) a hub that records a waiter-delivered note as nothing (${PLANT_UNRECORDED}) fails this test, naming the message`, async () => {
    const note = newNote();
    const failure = await failureOf(() => scenario(note, PLANT_UNRECORDED));
    expect(failure, `${AC6} the waiter test must fail on ${PLANT_UNRECORDED} at the recording assertion, naming the note's words and request ID ${note.request}`).toMatch(namesTheMessage(note));
  }, 600_000);
});
