// #340 AC4: mid-turn messages are counted from queued messages and prompts that actually waited, not from the desktop
// app's enqueue of every prompt. The design records a user.ask "for each prompt and each message typed while the agent
// works", so the count is read in the record: each prompt and each message is one user.ask, with its origin.
//
// A desktop-app replay (README, Replays). The app enqueues every prompt and dequeues it a few ms later, before the
// prompt's transcript entry and its UserPromptSubmit, as the corpus's 2.1.299 desktop sessions and 2.1.308 loop and
// subagent sessions show for typed, scheduled, peer and hand-back prompts alike. Here:
//   1. you type BEHAVIOR (its pair, then UserPromptSubmit);
//   2. while a Read runs you type MIDTURN_BEHAVIOR: its enqueue lands between the Read's PreToolUse and PostToolUse and
//      is still waiting at the PostToolUse, the one hook after it; later the app dequeues it and submits it
//      (UserPromptSubmit), as #80's spike saw;
//   3. a scheduled task's prompt, 4. another session's message, each with its pair;
//   5. a background subagent hands back its report: its SubagentHandback call's PreToolUse, the app's pair for the
//      report, the call's PostToolUse (both hooks carry the subagent's agent_id), then the report's UserPromptSubmit,
//      the order the corpus's 2.1.308 subagent session fires them in;
//   6. you type RATE_LIMIT, with its pair.
// Each must be one user.ask: yours from person, the scheduled task's from scheduled, the other session's from session,
// the report from subagent. MIDTURN_BEHAVIOR is in the record within its one hook, the Read's PostToolUse, before the
// app dequeues it, and its later UserPromptSubmit adds none. So the session holds three user.asks from person.
//
// The base reads the report's enqueue at the subagent's PostToolUse as your message, so the test fails there. A hub
// that counts every enqueue as a message typed mid-turn beside each prompt (DEEP_HUB_PLANT=counts-every-enqueue) fails
// on your first prompt.
import { afterEach, describe, it } from 'vitest';
import {
  AC4, BEHAVIOR, MIDTURN_BEHAVIOR, RATE_LIMIT, askNamed, asksNamed, asksOf, cleanup, draftFor, expectAutomatic, failureOf,
  makeWorld, must, said, Session, settle, startHub, type Ev, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const SCHEDULED = 'Run the login tests and add a retry to the cart sync if any of them fail.';
const PEER = '<cross-session-message from="local_8f6f9e9a-898e-4858-aefe-44dfc1b77684" name="GitHub issue #80">\nAdd a dark mode toggle to the settings page.\n</cross-session-message>';
const SUBAGENT = 'aa655931df71547ef';
const REPORT = `<agent-message from="${SUBAGENT}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n  The cart sync drops requests on a timeout. Add a retry with three attempts to the cart sync.\n</agent-message>`;
const YOURS = [BEHAVIOR, MIDTURN_BEHAVIOR, RATE_LIMIT];

interface Replay { events: Ev[]; s: Session; atPost: Ev[] }

async function replay(plant?: string): Promise<Replay> {
  const w = makeWorld({ drafts: [...YOURS, SCHEDULED, PEER, REPORT].map((t) => draftFor(t)) });
  const hub: Hub = await startHub(w, { plant });
  const s = new Session(w, 'desktop');
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.ts', { during: () => s.queue(MIDTURN_BEHAVIOR) });
  // What the record holds after the one hook that followed the message, before any other hook of the session.
  const atPost = await settle(hub, (all) => askNamed(all, s, MIDTURN_BEHAVIOR) !== undefined, 10_000);
  // The app dequeues the message that waited and submits it.
  s.dequeue();
  await s.typed(MIDTURN_BEHAVIOR, { pair: false });
  await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
  await s.stop('Expired tokens are rejected, with a test.');
  await s.scheduled(SCHEDULED);
  await s.read('src/auth.ts');
  await s.stop('The login tests pass.');
  await s.peer(PEER);
  await s.stop('Noted the other session\'s message.');
  // A background subagent hands back: its SubagentHandback call, during which the app enqueues and dequeues the report.
  await s.call('SubagentHandback', { report: 'The cart sync drops requests on a timeout.' }, { agent: SUBAGENT, during: () => s.pair(REPORT) });
  await s.handback(REPORT, SUBAGENT);
  await s.stop('The subagent says the cart sync needs a retry.');
  await s.typed(RATE_LIMIT);
  await s.edit('src/auth.ts', 'export function', 'export const LIMIT = 5;\nexport function');
  await s.stop('Login attempts are limited.');
  const events = await settle(hub, (all) => [...YOURS, SCHEDULED, PEER, REPORT].every((t) => askNamed(all, s, t) !== undefined), 20_000);
  return { events, s, atPost };
}

/** One prompt you typed, counted once: one user.ask with its text, from person. */
function yoursOnce(events: Ev[], s: Session, text: string, what: string): void {
  const all = asksNamed(events, s, text);
  must(all.length === 1 && all[0]!.data.from === 'person', `${AC4} ${what} "${text}" must be counted once, as one user.ask from person; the session holds ${all.length} with its text: ${all.map(said).join('; ') || 'none'}`);
}

function counted(r: Replay): void {
  const { events, s } = r;
  yoursOnce(events, s, BEHAVIOR, 'your first prompt, with the app\'s queue pair,');
  const waited = asksNamed(r.atPost, s, MIDTURN_BEHAVIOR);
  must(waited.length === 1 && waited[0]!.data.from === 'person', `${AC4} the message "${MIDTURN_BEHAVIOR}", typed while the Read ran and still waiting at its PostToolUse, must be counted at that hook, as one user.ask from person, before the app dequeues it: the record then held ${waited.map(said).join('; ') || 'none'}`);
  yoursOnce(events, s, MIDTURN_BEHAVIOR, 'the message that waited, dequeued and submitted later,');
  expectAutomatic(events, s, SCHEDULED, 'scheduled', AC4, 'the scheduled task\'s prompt, with the app\'s queue pair,');
  expectAutomatic(events, s, PEER, 'session', AC4, 'the other session\'s message, with the app\'s queue pair,');
  expectAutomatic(events, s, REPORT, 'subagent', AC4, 'the background subagent\'s report, whose queue pair came during its SubagentHandback call,');
  yoursOnce(events, s, RATE_LIMIT, 'your last prompt, with the app\'s queue pair,');
  const person = asksOf(events, s).filter((e) => e.data.from === 'person');
  must(person.length === YOURS.length, `${AC4} the session holds your two prompts and the one message that waited, ${YOURS.length} user.asks from person; it holds ${person.length}: ${person.map(said).join('; ')}`);
}

describe(`${AC4} mid-turn messages are counted from queued messages and prompts that actually waited, not from the desktop app's enqueue of every prompt`, () => {
  it(`${AC4} in a desktop-app replay where every prompt comes with the app's queue pair, each prompt is one user.ask with its origin, and the one message that waited counts once, at its hook`, async () => {
    counted(await replay());
  }, 240_000);

  it(`${AC4} (wrong program) a hub that counts every enqueue as a message typed mid-turn (DEEP_HUB_PLANT=counts-every-enqueue) fails on your first prompt`, async () => {
    const r = await replay('counts-every-enqueue');
    const failure = await failureOf(() => counted(r));
    must(failure !== null, `${AC4} the planted hub that counts every enqueue must fail this test: it passed`);
    must(failure.includes(`"${BEHAVIOR}" must be counted once`), `${AC4} the planted hub must fail on your first prompt, counted twice; it said: ${failure}`);
  }, 240_000);
});
