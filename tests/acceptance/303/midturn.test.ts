// #303 AC2 and AC8: messages typed while the agent works. Claude Code writes each into the transcript's queue
// (`queue-operation` enqueue) and fires no hook for it; the design reads it "from the transcript's queue at the next
// hook". Each message here is queued while a Read runs, between its PreToolUse and its PostToolUse, so the PostToolUse
// is the one next hook. "Within one hook" is read on the record after that hook and before any other hook of the
// session fires: the test waits up to 10 s for the appends to land, and fires nothing meanwhile.
//
// AC2: a message typed mid-turn that asks for new or changed behavior becomes a task within one hook.
// AC8: typed while the agent works, "why did you pick bcrypt?" opens no task, and "also add a test for expired tokens"
// opens one within one hook; a planted rule that opens a task for every mid-turn message
// (DEEP_HUB_PLANT=midturn-always-task) fails on the first, naming its message handle.
import { afterEach, describe, it } from 'vitest';
import {
  AC2, AC8, BEHAVIOR, MALFORMED, MIDTURN_BEHAVIOR, MIDTURN_QUESTION, askNamed, cleanup, expectNoTask, expectTask, failureOf,
  makeWorld, MESSAGE_HANDLE, must, Session, settle, startHub, taskOf, threadOf, tasksIn, type Ev, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A session whose first prompt asks for a change: it opens the session's first task, and the agent starts work. */
async function working(plant?: string): Promise<{ hub: Hub; s: Session; first: string | undefined }> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  const events = await settle(hub, (all) => tasksIn(all, threadOf(all, s)).length > 0, 20_000);
  return { hub, s, first: taskOf(askNamed(events, s, BEHAVIOR)) };
}
/** `text` typed while a Read runs: queued, then the Read's PostToolUse, the one next hook; the record up to 10 s later. */
async function typedMidTurn(hub: Hub, s: Session, text: string, opens: boolean): Promise<Ev[]> {
  const before = s.hooks.length;
  await s.read('src/auth.ts', { during: () => s.queue(text) });
  // The Read's PreToolUse ran before the message was queued; its PostToolUse is the one hook after it.
  must(s.hooks.length - before === 2 && s.hooks.at(-1)!.event === 'PostToolUse', `BLOCKED: the message must be queued with exactly one hook, PostToolUse, after it; fired ${s.hooks.slice(before).map((h) => h.event).join(', ')}`);
  return settle(hub, (all) => {
    const ask = askNamed(all, s, text);
    if (!ask) return false;
    if (!opens) return true;
    const ref = taskOf(ask);
    return ref !== undefined && tasksIn(all, threadOf(all, s)).some((e) => e.data.task_ref === ref);
  }, 10_000);
}

describe(`${AC2} a message typed mid-turn that asks for a change becomes a task within one hook`, () => {
  it(`${AC2} "${MALFORMED}", typed while a Read runs, is a task under the session's thread, keyed by its message handle, once the next hook has fired`, async () => {
    const { hub, s, first } = await working();
    const events = await typedMidTurn(hub, s, MALFORMED, true);
    const ref = expectTask(events, s, MALFORMED, AC2, { handle: true });
    must(ref !== first, `${AC2} "${MALFORMED}" opens a task of its own, not the first prompt's ${first}`);
    await s.stop('Expired and malformed tokens are both rejected now.');
  }, 180_000);
});

/** The criterion's first half: the mid-turn question opens no task and no drafting job. */
function questionOpensNone(events: Ev[], s: Session, first: string | undefined): void {
  expectNoTask(events, s, MIDTURN_QUESTION, AC8, first ? [first] : []);
}

describe(`${AC8} typed while the agent works, a question opens no task and a request for a change opens one within one hook`, () => {
  it(`${AC8} "${MIDTURN_QUESTION}" opens no task; "${MIDTURN_BEHAVIOR}" opens one within one hook`, async () => {
    const { hub, s, first } = await working();
    const afterQuestion = await typedMidTurn(hub, s, MIDTURN_QUESTION, false);
    questionOpensNone(afterQuestion, s, first);
    const events = await typedMidTurn(hub, s, MIDTURN_BEHAVIOR, true);
    const ref = expectTask(events, s, MIDTURN_BEHAVIOR, AC8, { handle: true });
    must(ref !== first, `${AC8} "${MIDTURN_BEHAVIOR}" opens a task of its own, not the first prompt's ${first}`);
    await s.stop('Expired tokens are rejected, with a test.');
  }, 180_000);

  it(`${AC8} (wrong program) a rule that opens a task for every mid-turn message (DEEP_HUB_PLANT=midturn-always-task) fails on the first, naming its message handle`, async () => {
    const { hub, s, first } = await working('midturn-always-task');
    const events = await typedMidTurn(hub, s, MIDTURN_QUESTION, true);
    const failure = await failureOf(() => questionOpensNone(events, s, first));
    must(failure !== null, `${AC8} the planted rule must fail this test on "${MIDTURN_QUESTION}": it passed`);
    const opened = taskOf(askNamed(events, s, MIDTURN_QUESTION));
    must(opened !== undefined && MESSAGE_HANDLE.test(opened), `${AC8} the planted rule opens a task for "${MIDTURN_QUESTION}", keyed by its message handle: its user.ask names ${JSON.stringify(askNamed(events, s, MIDTURN_QUESTION)?.data.tasks)}`);
    must(failure.includes(opened), `${AC8} the failure must name the question's message handle ${opened}; it said: ${failure}`);
    const behavior = await typedMidTurn(hub, s, MIDTURN_BEHAVIOR, true);
    expectTask(behavior, s, MIDTURN_BEHAVIOR, AC8, { handle: true });
  }, 180_000);
});
