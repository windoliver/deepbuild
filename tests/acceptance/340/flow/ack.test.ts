// #340 AC2: each message typed mid-turn gets a visible acknowledgement within one tool call, and the chat line shows
// the queue. A desktop-app session (#80's spike: a message typed while a call runs is queued, `queue-operation`
// enqueue, fires no hook, and is read at that call's PostToolUse; UserPromptSubmit fires only later, when the app
// dequeues it). You ask for a change, the agent starts reading, and while each Read runs you type a message:
// MALFORMED, then MIDTURN_BEHAVIOR, then MIDTURN_QUESTION, one per Read.
//
// "Visible" is what the person sees in the chat: Claude Code's `systemMessage` in a hook's reply on deep-hook's stdout
// (the agent's own context, `additionalContext`, is not visible). "Within one tool call": a message typed while call N
// runs is acknowledged in the reply of a hook from call N's PostToolUse through call N+1's PostToolUse. The
// acknowledgement is one line of that message naming the message: its task's handle, or its first 24 characters. "The
// chat line shows the queue": once MIDTURN_BEHAVIOR is read, a reply in its window shows both asks still waiting in the
// session, MALFORMED and MIDTURN_BEHAVIOR, each named the same way. The wording is left to the implementer (README).
//
// The base answers a PostToolUse and a PreToolUse with no user-visible message, so the test fails there. A chat line
// that names only the message just read (DEEP_HUB_PLANT=queue-shows-newest) fails on the queue.
import { afterEach, describe, it } from 'vitest';
import {
  AC2, BEHAVIOR, MALFORMED, MIDTURN_BEHAVIOR, MIDTURN_QUESTION, askNamed, cleanup, draftFor, failureOf, makeWorld, must,
  Session, settle, shown, startHub, taskOf, threadOf, tasksIn, visibleOf, type Ev, type Fired,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const MESSAGES = [MALFORMED, MIDTURN_BEHAVIOR, MIDTURN_QUESTION];

/** How a line names a message: its task's handle, or its first 24 characters (whitespace collapsed, any case). */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
export function namesMessage(line: string, text: string, handle: string | undefined): boolean {
  if (handle && line.includes(handle)) return true;
  return squash(line).includes(squash(text).slice(0, 24));
}

interface Typed { text: string; window: Fired[]; handle: string | undefined }
interface Run { s: Session; typed: Typed[]; events: Ev[] }

/**
 * The scenario: you ask for a change (it opens a task), then each message is typed while a Read runs; one more Read
 * follows each, so every message has its whole window: its call's PostToolUse through the next call's PostToolUse.
 */
async function scenario(plant?: string): Promise<Run> {
  const w = makeWorld({ drafts: [BEHAVIOR, ...MESSAGES].map((t) => draftFor(t)) });
  const hub = await startHub(w, { plant });
  const s = new Session(w, 'desktop');
  await s.start();
  await s.typed(BEHAVIOR);
  await settle(hub, (all) => tasksIn(all, threadOf(all, s)).length > 0, 20_000);
  const typed: Typed[] = [];
  for (const text of MESSAGES) {
    const from = s.hooks.length;
    await s.read('src/auth.ts', { during: () => s.queue(text) });
    await s.read('src/cart.ts');
    // The window: the PostToolUse of the call the message was typed in, then the next call's PreToolUse and PostToolUse.
    const window = s.hooks.slice(from + 1);
    must(window.map((h) => h.event).join() === 'PostToolUse,PreToolUse,PostToolUse', `BLOCKED: the message "${text}" must be typed with exactly three hooks in its window; fired ${window.map((h) => h.event).join(', ')}`);
    typed.push({ text, window, handle: undefined });
  }
  await s.stop('Expired and malformed tokens are rejected now, with a test.');
  const events = await settle(hub, (all) => MESSAGES.every((t) => askNamed(all, s, t) !== undefined), 20_000);
  for (const t of typed) t.handle = taskOf(askNamed(events, s, t.text));
  return { s, typed, events };
}

const shownWindow = (t: Typed) => t.window.map((h) => `${h.event}: ${JSON.stringify(visibleOf(h.ran).slice(0, 300))} (${shown(h.ran).slice(0, 300)})`).join('; ');

/** Each message's acknowledgement: one line of a reply's visible message in its window names it. */
function acknowledged(r: Run): void {
  for (const t of r.typed) {
    const line = t.window.flatMap((h) => visibleOf(h.ran).split('\n')).find((l) => namesMessage(l, t.text, t.handle));
    must(line !== undefined, `${AC2} the message "${t.text}", typed while a Read ran, must get a visible acknowledgement within one tool call: a line of the chat's message (systemMessage) from that call's PostToolUse through the next call's naming it; the window shows ${shownWindow(t)}`);
  }
}
/** The queue on the chat line: once MIDTURN_BEHAVIOR is read, one reply's visible message names both waiting asks. */
function queueShown(r: Run): void {
  const [first, second] = r.typed;
  const reply = second!.window.find((h) => namesMessage(visibleOf(h.ran), first!.text, first!.handle) && namesMessage(visibleOf(h.ran), second!.text, second!.handle));
  must(reply !== undefined, `${AC2} the chat line must show the queue: once "${second!.text}" is read, a reply in its window must show both asks waiting in the session, "${first!.text}" and "${second!.text}"; the window shows ${shownWindow(second!)}`);
}

describe(`${AC2} each message typed mid-turn gets a visible acknowledgement within one tool call, and the chat line shows the queue`, () => {
  it(`${AC2} three messages typed while Reads run in the desktop app: each is acknowledged in the chat within one tool call, and the chat line shows both waiting asks`, async () => {
    const r = await scenario();
    acknowledged(r);
    queueShown(r);
  }, 240_000);

  it(`${AC2} (wrong program) a chat line that names only the message just read (DEEP_HUB_PLANT=queue-shows-newest) fails on the queue`, async () => {
    const r = await scenario('queue-shows-newest');
    acknowledged(r);
    const failure = await failureOf(() => queueShown(r));
    must(failure !== null, `${AC2} the planted chat line that names only the newest message must fail this test: it passed`);
    must(failure.includes('must show the queue') && failure.includes(MALFORMED), `${AC2} the planted chat line must fail on the queue, naming "${MALFORMED}"; it said: ${failure}`);
  }, 240_000);
});
