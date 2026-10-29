// #303 AC7: a session whose first prompt is "explain how the auth middleware checks expiry" opens no task and starts
// no drafting job, its user.ask recording `tasks: []`, and a session whose first prompt is "make the auth middleware
// reject expired tokens" opens one task; a planted rule that opens a task for every first prompt
// (DEEP_HUB_PLANT=first-prompt-always-task) fails on the first, naming its message handle. Both sessions start fresh
// (SessionStart startup), type their prompt, read a file, and stop; the second also edits. A definition is handed for
// both prompts (DEEP_HUB_TEST_DRAFTS), so a kernel that opened a task for the question would lock one.
import { afterEach, describe, it } from 'vitest';
import {
  AC7, BEHAVIOR, QUESTION, askNamed, cleanup, expectNoTask, expectTask, failureOf, makeWorld, MESSAGE_HANDLE, must,
  Session, settle, sleep, startHub, taskOf, threadOf, tasksIn, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

async function twoFirstPrompts(plant?: string): Promise<{ events: Ev[]; q: Session; b: Session }> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  const q = new Session(w);
  await q.start();
  await q.typed(QUESTION);
  await q.read('src/auth.ts');
  await q.stop('The middleware compares the token\'s exp with the clock in checkToken.');
  const b = new Session(w);
  await b.start();
  await b.typed(BEHAVIOR);
  await b.read('src/auth.ts');
  await b.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
  await b.stop('checkToken now rejects a token whose exp has passed.');
  await settle(hub, (all) => tasksIn(all, threadOf(all, b)).length > 0 && askNamed(all, q, QUESTION) !== undefined);
  // Any task the question wrongly opened has had time to land too.
  await sleep(3000);
  return { events: await settle(hub, () => true), q, b };
}

/** The criterion's first half: the question opens no task and no drafting job, `tasks: []`. */
function questionOpensNone(events: Ev[], q: Session, b: Session): void {
  const behaviorTask = taskOf(askNamed(events, b, BEHAVIOR));
  expectNoTask(events, q, QUESTION, AC7, behaviorTask ? [behaviorTask] : []);
}

describe(`${AC7} a first prompt that only asks a question opens no task; one that asks for a change opens one`, () => {
  it(`${AC7} "${QUESTION}" as a first prompt opens no task and starts no drafting job, tasks: []; "${BEHAVIOR}" as a first prompt opens one task`, async () => {
    const { events, q, b } = await twoFirstPrompts();
    questionOpensNone(events, q, b);
    expectTask(events, b, BEHAVIOR, AC7, { handle: true });
  }, 240_000);

  it(`${AC7} (wrong program) a rule that opens a task for every first prompt (DEEP_HUB_PLANT=first-prompt-always-task) fails on the first, naming its message handle`, async () => {
    const { events, q, b } = await twoFirstPrompts('first-prompt-always-task');
    expectTask(events, b, BEHAVIOR, AC7, { handle: true });
    const failure = await failureOf(() => questionOpensNone(events, q, b));
    must(failure !== null, `${AC7} the planted rule must fail this test on "${QUESTION}": it passed`);
    const opened = taskOf(askNamed(events, q, QUESTION));
    must(opened !== undefined && MESSAGE_HANDLE.test(opened), `${AC7} the planted rule opens a task for "${QUESTION}", keyed by its message handle: its user.ask names ${JSON.stringify(askNamed(events, q, QUESTION)?.data.tasks)}`);
    must(failure.includes(opened), `${AC7} the failure must name the question's message handle ${opened}; it said: ${failure}`);
  }, 240_000);
});
