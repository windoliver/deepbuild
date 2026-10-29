// #303 AC3: a rename-only prompt opens no task. In one session you first ask for a change, which opens a task (the
// control: a kernel that opens no task for anything would pass a rename alone), and then type "Rename the getUser
// function to fetchUser.", a prompt that changes no behavior (the design: "A prompt that changes no behavior, such as a
// rename, is judged by the repo's spec alone"). The agent makes the rename with an Edit and stops. A definition is
// handed for both prompts, so a kernel that opened a task for the rename would lock one.
import { afterEach, describe, it } from 'vitest';
import {
  AC3, BEHAVIOR, RENAME, askNamed, cleanup, expectNoTask, expectTask, makeWorld, Session, settle, sleep, startHub, taskOf,
  threadOf, tasksIn,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC3} a rename-only prompt opens no task`, () => {
  it(`${AC3} "${RENAME}" opens no task, no drafting job and no definition; the session's earlier "${BEHAVIOR}" opened one`, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
    await s.stop('checkToken now rejects a token whose exp has passed.');
    await s.typed(RENAME);
    await s.edit('src/users.ts', 'function getUser', 'function fetchUser');
    await s.stop('Renamed getUser to fetchUser.');
    await settle(hub, (all) => tasksIn(all, threadOf(all, s)).length > 0 && askNamed(all, s, RENAME) !== undefined);
    await sleep(3000);
    const events = await settle(hub, () => true);
    const first = taskOf(askNamed(events, s, BEHAVIOR));
    expectNoTask(events, s, RENAME, AC3, first ? [first] : []);
    expectTask(events, s, BEHAVIOR, AC3);
  }, 180_000);
});
