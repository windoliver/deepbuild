// #303 AC1: a session with three asks over three days holds three locked definitions. One Claude Code session works
// three days: each day the hub starts on its virtual clock (DEEP_HUB_TEST_CLOCK, set at its start and moving with real
// time from there) a day later than the day before, the session resumes (SessionStart resume, the same session ID),
// you type an ask for a change, the agent edits and stops, and the hub stops by PID. A definition is handed for each
// ask (DEEP_HUB_TEST_DRAFTS). At the end, on the third day's hub, the record holds three tasks under the session's
// thread, each with one definition.locked of its own, each locked on its own day.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, BEHAVIOR, DAY, RATE_LIMIT, RESET_EMAIL, askNamed, cleanup, expectTask, lockedFor, makeWorld, must, said, Session,
  settle, startHub, stopHub, taskOf, threadOf, tasksIn, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const ASKS = [
  { text: BEHAVIOR, file: 'src/auth.ts', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' },
  { text: RATE_LIMIT, file: 'src/auth.ts', from: 'export function', to: 'export const LOGIN_LIMIT = 5;\nexport function' },
  { text: RESET_EMAIL, file: 'src/users.ts', from: 'export function', to: 'export const sendReset = (id: string) => id;\nexport function' },
];

describe(`${AC1} three asks over three days hold three locked definitions`, () => {
  it(`${AC1} one session's asks on day 1, day 2 and day 3 are three tasks under its thread, each with its own locked definition, locked that day`, async () => {
    const w = makeWorld();
    const t0 = Date.now();
    const s = new Session(w);
    let events: Ev[] = [];
    for (const [day, ask] of ASKS.entries()) {
      const hub = await startHub(w, { clock: t0 + day * DAY });
      await s.start(day === 0 ? 'startup' : 'resume');
      await s.typed(ask.text);
      await s.edit(ask.file, ask.from, ask.to);
      await s.stop('Done for today.');
      events = await settle(hub, (all) => { const ref = taskOf(askNamed(all, s, ask.text)); return ref !== undefined && lockedFor(all, ref).length > 0; });
      if (day < ASKS.length - 1) await stopHub(hub);
    }
    const thread = threadOf(events, s);
    const refs = ASKS.map((a) => expectTask(events, s, a.text, `${AC1} [day ${ASKS.indexOf(a) + 1}]`));
    must(new Set(refs).size === 3, `${AC1} the three asks are three tasks: ${refs.join(', ')}`);
    must(tasksIn(events, thread).length === 3, `${AC1} the session's thread ${thread} holds three tasks, one per ask: ${tasksIn(events, thread).map(said).join('; ')}`);
    for (const [day, ref] of refs.entries()) {
      const who = `${AC1} [day ${day + 1}, "${ASKS[day]!.text}"]`;
      const locks = lockedFor(events, ref);
      must(locks.length === 1, `${who} the task ${ref} holds one locked definition: ${locks.length ? locks.map(said).join('; ') : 'no definition.locked for it'}`);
      const at = locks[0]!.ts;
      must(at >= t0 + day * DAY - 60_000 && at < t0 + (day + 1) * DAY, `${who} its definition was locked on day ${day + 1} of the hub's clock (from ${new Date(t0 + day * DAY).toISOString()}): it was locked at ${new Date(at).toISOString()}`);
    }
    must(new Set(refs.map((r) => lockedFor(events, r)[0]!.data.hash)).size === 3, `${AC1} the three definitions are three, each with its own hash: ${refs.map((r) => String(lockedFor(events, r)[0]!.data.hash)).join(', ')}`);
  }, 360_000);
});
