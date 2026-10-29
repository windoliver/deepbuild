// #340 AC2 and AC4 in the terminal: Claude Code 2.1.303 in a terminal, where (spikes/80/decision.json) a message typed
// while a call runs "fires UserPromptSubmit at once" and the transcript also queues it, a `queue-operation` enqueue.
// The replay (README, The terminal's mid-turn path): you ask for a change, the agent starts a Read, and while it runs
// you type a message: its enqueue lands in the transcript and its UserPromptSubmit fires at once, with the message as
// `prompt` and a prompt ID of its own that no transcript entry carries yet (Claude Code writes the message into the
// conversation only when the call ends). Then the Read's PostToolUse, Claude Code's dequeue as it takes the message,
// and the next Read. Two messages, MALFORMED and then MIDTURN_BEHAVIOR, one per Read.
//
// AC2: each message gets a visible acknowledgement within one tool call: a line of the `systemMessage` of a hook from
// its own UserPromptSubmit through the next call's PostToolUse names it (its task's handle or its first 24 characters,
// ack.test.ts's rule); once the second is in, a reply in its window shows both still waiting.
// AC4: each message is counted once, one user.ask from person, not twice (its UserPromptSubmit and its enqueue).
//
// The base answers neither UserPromptSubmit nor PostToolUse with a user-visible message (AC2), and records the
// message's UserPromptSubmit `from: unknown`, since no transcript entry places it (AC4). The wrong programs are the
// suite's: a chat line naming only the newest message (DEEP_HUB_PLANT=queue-shows-newest) fails AC2's queue, and a hub
// counting every enqueue as a message typed mid-turn beside its UserPromptSubmit (DEEP_HUB_PLANT=counts-every-enqueue)
// fails AC4, counting the first message twice.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'vitest';
import {
  AC2, AC4, BEHAVIOR, MALFORMED, MIDTURN_BEHAVIOR, askNamed, asksNamed, asksOf, cleanup, draftFor, failureOf, makeWorld,
  must, said, Session, settle, shown, startHub, taskOf, threadOf, tasksIn, visibleOf, type Ev, type Fired, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const MESSAGES = [MALFORMED, MIDTURN_BEHAVIOR];

/** ack.test.ts's rule, copied so that file stays as it is: a line names a message by its task's handle or its first 24 characters. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const namesMessage = (line: string, text: string, handle: string | undefined): boolean => (handle !== undefined && line.includes(handle)) || squash(line).includes(squash(text).slice(0, 24));

interface Typed { text: string; window: Fired[]; prompt: Ran | undefined; handle: string | undefined }
interface Run { s: Session; typed: Typed[]; events: Ev[] }

async function scenario(plant?: string): Promise<Run> {
  const w = makeWorld({ drafts: [BEHAVIOR, ...MESSAGES].map((t) => draftFor(t)) });
  const hub = await startHub(w, { plant });
  const s = new Session(w, 'terminal');
  await s.start();
  await s.typed(BEHAVIOR);
  await settle(hub, (all) => tasksIn(all, threadOf(all, s)).length > 0, 20_000);
  const typed: Typed[] = [];
  for (const text of MESSAGES) {
    const from = s.hooks.length;
    let prompt: Ran | undefined;
    // Typed while the Read runs: the enqueue, and UserPromptSubmit at once, with a prompt ID of its own.
    await s.read('src/auth.ts', { during: async () => { s.queue(text); prompt = await s.hook('UserPromptSubmit', { prompt: text, prompt_id: randomUUID() }); } });
    s.dequeue();
    await s.read('src/cart.ts');
    // The window: its own UserPromptSubmit, the running Read's PostToolUse, then the next call's PreToolUse and PostToolUse.
    const window = s.hooks.slice(from + 1);
    must(window.map((h) => h.event).join() === 'UserPromptSubmit,PostToolUse,PreToolUse,PostToolUse', `BLOCKED: the message "${text}" must be typed with exactly four hooks in its window; fired ${window.map((h) => h.event).join(', ')}`);
    must(prompt !== undefined && (prompt.code === 0 || prompt.code === 2), `BLOCKED: the message's UserPromptSubmit must end with exit 0: ${prompt ? shown(prompt) : 'not fired'}`);
    typed.push({ text, window, prompt, handle: undefined });
  }
  await s.stop('Expired and malformed tokens are rejected now, with a test.');
  const events = await settle(hub, (all) => MESSAGES.every((t) => askNamed(all, s, t) !== undefined), 20_000);
  for (const t of typed) t.handle = taskOf(askNamed(events, s, t.text));
  return { s, typed, events };
}

const shownWindow = (t: Typed) => t.window.map((h) => `${h.event}: ${JSON.stringify(visibleOf(h.ran).slice(0, 300))} (${shown(h.ran).slice(0, 300)})`).join('; ');

function acknowledged(r: Run): void {
  for (const t of r.typed) {
    const line = t.window.flatMap((h) => visibleOf(h.ran).split('\n')).find((l) => namesMessage(l, t.text, t.handle));
    must(line !== undefined, `${AC2} [terminal] the message "${t.text}", typed while a Read ran, which fired UserPromptSubmit at once, must get a visible acknowledgement within one tool call: a line of the chat's message (systemMessage) from its own UserPromptSubmit through the next call's PostToolUse naming it; the window shows ${shownWindow(t)}`);
  }
}
function queueShown(r: Run): void {
  const [first, second] = r.typed;
  const reply = second!.window.find((h) => namesMessage(visibleOf(h.ran), first!.text, first!.handle) && namesMessage(visibleOf(h.ran), second!.text, second!.handle));
  must(reply !== undefined, `${AC2} [terminal] the chat line must show the queue: once "${second!.text}" is in, a reply in its window must show both asks waiting in the session, "${first!.text}" and "${second!.text}"; the window shows ${shownWindow(second!)}`);
}
function countedOnce(r: Run): void {
  for (const t of r.typed) {
    const all = asksNamed(r.events, r.s, t.text);
    must(all.length === 1 && all[0]!.data.from === 'person', `${AC4} [terminal] the message "${t.text}", typed while a Read ran (its enqueue and its UserPromptSubmit), must be counted once, as one user.ask from person; the session holds ${all.length} with its text: ${all.map(said).join('; ') || 'none'}`);
  }
  const person = asksOf(r.events, r.s).filter((e) => e.data.from === 'person');
  must(person.length === 1 + MESSAGES.length, `${AC4} [terminal] the session holds your prompt and the two messages typed mid-turn, ${1 + MESSAGES.length} user.asks from person; it holds ${person.length}: ${person.map(said).join('; ')}`);
}

describe(`${AC2} in the terminal, where a message typed mid-turn fires UserPromptSubmit at once: each gets a visible acknowledgement within one tool call, and the chat line shows the queue`, () => {
  it(`${AC2} two messages typed while Reads run in the terminal: each is acknowledged in the chat within one tool call, and the chat line shows both waiting asks`, async () => {
    const r = await scenario();
    acknowledged(r);
    queueShown(r);
  }, 240_000);

  it(`${AC2} (wrong program) a chat line that names only the message just read (DEEP_HUB_PLANT=queue-shows-newest) fails on the queue in the terminal`, async () => {
    const r = await scenario('queue-shows-newest');
    acknowledged(r);
    const failure = await failureOf(() => queueShown(r));
    must(failure !== null, `${AC2} the planted chat line that names only the newest message must fail this test: it passed`);
    must(failure.includes('must show the queue') && failure.includes(MALFORMED), `${AC2} the planted chat line must fail on the queue, naming "${MALFORMED}"; it said: ${failure}`);
  }, 240_000);
});

describe(`${AC4} in the terminal, a message typed mid-turn is counted once, from its enqueue and its UserPromptSubmit together`, () => {
  it(`${AC4} each of two messages typed while Reads run in the terminal is one user.ask from person, not two`, async () => {
    countedOnce(await scenario());
  }, 240_000);

  it(`${AC4} (wrong program) a hub that counts every enqueue as a message typed mid-turn (DEEP_HUB_PLANT=counts-every-enqueue) fails in the terminal, counting the first message twice`, async () => {
    const r = await scenario('counts-every-enqueue');
    const failure = await failureOf(() => countedOnce(r));
    must(failure !== null, `${AC4} the planted hub that counts every enqueue must fail this test: it passed`);
    must(failure.includes(`"${MALFORMED}"`) && failure.includes('must be counted once'), `${AC4} the planted hub must fail on "${MALFORMED}" counted twice; it said: ${failure}`);
  }, 240_000);
});
