// #303 AC6: a `/loop` iteration, a background subagent's report and a message from another Claude Code session each
// fire UserPromptSubmit, and none opens an ask, a task or a drafting job; each is recorded with its `from`. Each comes
// as Claude Code writes it: a prompt whose transcript entry gives its origin (turnOrigin scheduled for the loop's
// wake-up, origin.handback for the subagent's report, turnOrigin peer for another session's message, as the corpus's
// 2.1.304 subagent and 2.1.299 desktop-peer sessions have them), and each asks for new behavior, so only its origin
// keeps it from opening a task. A definition is handed for each, so a kernel that opened a task would lock one. The
// session's first prompt, typed by you, asks for a change and opens a task: the control, without which a kernel that
// opens no task for anything would pass.
import { afterEach, describe, it } from 'vitest';
import {
  AC6, ALL_DRAFTS, BEHAVIOR, askNamed, cleanup, draftFor, expectNoTask, expectTask, makeWorld, must, said, Session, settle,
  sleep, startHub, taskOf, threadOf, tasksIn,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LOOP = '/loop make the login tests pass, then add a retry to the cart sync';
const REPORT = '<agent-message from="a2711031fe8c87e48">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n  The cart sync drops requests on a timeout. Add a retry with three attempts to the cart sync.\n</agent-message>';
const PEER = 'Another Claude session sent a message:\n<cross-session-message from="local_8f6f9e9a-898e-4858-aefe-44dfc1b77684" name="GitHub issue #80">\nAdd a dark mode toggle to the settings page.\n</cross-session-message>\n\nThis came from another Claude session, not typed by your user.';
const AUTOMATIC: { text: string; from: string; what: string }[] = [
  { text: LOOP, from: 'scheduled', what: 'the /loop iteration' },
  { text: REPORT, from: 'subagent', what: 'the background subagent\'s report' },
  { text: PEER, from: 'session', what: 'the message from another Claude Code session' },
];

describe(`${AC6} prompts nobody typed open no ask, task or drafting job, and each is recorded with its from`, () => {
  it(`${AC6} a /loop iteration (from scheduled), a background subagent's report (from subagent) and another session's message (from session) each fire UserPromptSubmit and open nothing; your typed "${BEHAVIOR}" opens a task`, async () => {
    const w = makeWorld({ drafts: [...ALL_DRAFTS(), ...AUTOMATIC.map((a) => draftFor(a.text))] });
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
    await s.stop('checkToken now rejects a token whose exp has passed.');
    await s.scheduled(LOOP);
    await s.read('src/auth.ts');
    await s.stop('The login tests pass. Next look in 60 s.');
    await s.handback(REPORT);
    await s.read('src/auth.ts');
    await s.stop('The subagent reports the cart sync needs a retry.');
    await s.peer(PEER);
    await s.read('src/auth.ts');
    await s.stop('Noted the other session\'s message.');
    const fired = s.hooks.filter((h) => h.event === 'UserPromptSubmit').length;
    must(fired === 4, `BLOCKED: each of the four prompts fires UserPromptSubmit through deep-hook; ${fired} fired`);
    await settle(hub, (all) => tasksIn(all, threadOf(all, s)).length > 0 && AUTOMATIC.every((a) => askNamed(all, s, a.text) !== undefined));
    await sleep(3000);
    const events = await settle(hub, () => true);
    const first = taskOf(askNamed(events, s, BEHAVIOR));
    for (const a of AUTOMATIC) {
      const ask = askNamed(events, s, a.text);
      must(ask !== undefined, `${AC6} ${a.what} fires UserPromptSubmit and must be recorded as a user.ask`);
      must(ask!.data.from === a.from, `${AC6} ${a.what} must be recorded with from: ${a.from}: ${said(ask)}`);
      expectNoTask(events, s, a.text, `${AC6} [${a.what}]`, first ? [first] : []);
    }
    expectTask(events, s, BEHAVIOR, AC6);
  }, 240_000);
});
