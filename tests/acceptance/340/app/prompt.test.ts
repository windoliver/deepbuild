// AC6, the prompt-context route: a note sent over the hub's socket with the control token, as the app sends one,
// that asks for changed behavior, carried by prompt context at the next prompt you type, is recorded as user.ask with
// from: app and its delivery's request ID, and opens a task as a typed prompt would; the same words typed into the
// session's terminal by this test process are never recorded app; a reader built against user.ask's minor before app
// reads the note's from as unknown. The wrong program that marks the app's words person with no request ID fails
// this test, naming the message.
//
// The session's Claude Code runs no waiter (its asyncRewake hook disabled for the session, as #25's suites disable
// it), so with the session idle the note waits for the next prompt (design: "an idle session by the route its flags
// allow"). You type a question; DeepBuild's reply to that UserPromptSubmit carries the note as context. The agent
// answers and stops. Then the test types the note's exact words into the session's terminal.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getSchema, registry, type JsonValue, type Schema } from '../../../../packages/contracts/src/index.ts';
import { serveAt } from '../../../../packages/conformance/src/index.ts';
import {
  AC6, FIXTURES, PLANT_AS_PERSON, asRecorded, assistantSays, cleanup, expectAppNote, expectTask, failureOf, firedShown, idleSession, lastPos, namesTheMessage,
  newNote, payload, readJson, said, sendNote, sleep, typeWords, typedCopy, typedPrompt, world, type Ev, type Line, type Note,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const ROUTE = 'carried by prompt context at the next prompt you type';
const NEXT = 'Is the settings page finished?';

/** The note's recorded user.ask, kept for the earlier reader's test below. */
let recorded: Ev | undefined;

async function scenario(note: Note, plant?: string): Promise<Ev> {
  const w = await world(plant);
  const idle = await idleSession(w, { waiter: false });
  await sendNote(w.hub, idle.s, note);
  await sleep(2000);
  // The next prompt you type: DeepBuild's reply to it carries the note as context.
  typedPrompt(idle.s, NEXT);
  const next = await idle.claude.hook('UserPromptSubmit', payload(idle.s, 'UserPromptSubmit', { prompt: NEXT }));
  expect(said(next), `${AC6} the session runs no waiter, so prompt context must carry the note "${note.text}" (request ${note.request}) at the next prompt you type: DeepBuild's reply to it; ${firedShown(next)}`).toContain(note.text);
  assistantSays(idle.s, 'Not yet; I will add the dark mode toggle you sent.');
  await idle.claude.hook('Stop', payload(idle.s, 'Stop', { last_assistant_message: 'Not yet; I will add the dark mode toggle you sent.' }));

  const ev = await expectAppNote(w.hub, idle.s, note, ROUTE);
  await expectTask(w.hub, idle, ev, `the app's note "${note.text}" (request ${note.request})`);

  // The same words, written into the session's terminal by this test process.
  const after = await lastPos(w.hub);
  await typeWords(idle, note.text);
  const typed = await typedCopy(w, idle, note, after);
  await expectTask(w.hub, idle, typed[0]!, `the typed copy of "${note.text}" (the control)`);
  return ev;
}

describe(`${AC6} a note from the app, carried by prompt context at the next prompt`, () => {
  it(`${AC6} is recorded as user.ask with from: app and its request ID, opens a task as a typed prompt would, and the same words typed into the terminal are never recorded app`, async () => {
    recorded = await scenario(newNote());
  }, 600_000);

  it(`${AC6} a reader built against user.ask's minor before app (the base commit's user.ask@1, served by @deepbuild/conformance's serveAt) reads the note's from as unknown`, () => {
    expect(recorded, `${AC6} the record must hold the note's user.ask from: app (the test above) for a reader at the earlier minor to read`).toBeDefined();
    const before = readJson(join(FIXTURES, 'user.ask@1.base.json')) as Schema;
    const value = asRecorded(recorded!) as JsonValue;
    // The control: a reader at the current minor reads app.
    expect(((serveAt(getSchema('user.ask@1'), value) as Line).data as Line).from, `${AC6} a reader at user.ask@1's current minor reads the note's from as app`).toBe('app');
    const served = serveAt(before, value) as Line;
    expect(served.data.from, `${AC6} a reader built against user.ask's minor before app must read the note's from (${JSON.stringify(recorded!.data.from)}) as unknown; it read ${JSON.stringify(served.data.from)}`).toBe('unknown');
    const valid = registry([{ name: 'user.ask@1', schema: before }]).validate('user.ask@1', served);
    expect(valid.ok, `${AC6} what the earlier reader is served of the note must pass the earlier minor's user.ask@1: ${JSON.stringify(valid.ok ? [] : valid.issues).slice(0, 800)}`).toBe(true);
    expect(served.data.text, `${AC6} the earlier reader still reads the note's words`).toBe(recorded!.data.text);
  });

  it(`${AC6} (wrong program) a hub that marks the app's words person with no request ID (${PLANT_AS_PERSON}) fails this test, naming the message`, async () => {
    const note = newNote();
    const failure = await failureOf(() => scenario(note, PLANT_AS_PERSON));
    expect(failure, `${AC6} the prompt-context test must fail on ${PLANT_AS_PERSON} at the recording assertion, naming the note's words and request ID ${note.request}`).toMatch(namesTheMessage(note));
  }, 600_000);
});
