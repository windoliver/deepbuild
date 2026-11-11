// #1580 AC3: Take over from the phone refuses a later answer from the app's old copy, naming the revision. The phone
// takes the card over on the trusted path, signed with its paired key (README, Surfaces: `ask.take_over`); the app then
// answers from the copy of the card it held before, and is refused. On the merge base Take over has no code.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, answeredOf, cleanup, describeItem, lastPos, ok, outcomeOf, said, signedAnswer, signedCall, waitFor, world, type Line, type World } from './helpers.ts';

afterEach(cleanup, 120_000);

const CHOICES = [
  { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' },
  { source: 'deep_ask.choice', question: 'Log in JSON or in plain text?' },
] as const;

/** The app's copy of a card: `ask.card` on an app connection, as the app holds it. */
const appCopy = (w: World, ask: string): Promise<Line> => ok(w, 'ask.card', { ask }, 'app');
/** The app's answer from its copy, signed by its paired device; it names the copy's revision when the copy has one. */
const appAnswer = (w: World, ask: string, option: string, copy: Line): Promise<Line> =>
  signedCall(w, w.app, 'ask.answer', { ask, option, ...(typeof copy.revision === 'number' ? { revision: copy.revision } : {}) });

describe(`${AC[3]} Take over from the phone refuses a later answer from the app's old copy, naming the revision`, () => {
  it(`${AC[3]} once the phone takes the card over, the app's answer from the copy it held before is refused naming the revision and counts for nothing; the phone's answer counts`, async () => {
    const w = await world({ channels: ['paseo'], seed: [...CHOICES] });
    const [ask, other] = w.asks as [typeof w.asks[0], typeof w.asks[0]];
    const relay = w.relays.paseo!;
    // The app's signed answer counts on this hub, so the refusal below is for its copy, not for its signature.
    const control = await appAnswer(w, other.handle, 'sqlite', await appCopy(w, other.handle));
    expect(control.error, `the app's signed answer counts on an open ask: ${JSON.stringify(control.error)}`).toBeUndefined();

    const copy = await appCopy(w, ask.handle);
    const before = await waitFor(() => relay.latest(ask.handle), MINUTE, `${ask.handle} on the phone`);
    const took = await signedCall(w, w.phone, 'ask.take_over', { ask: ask.handle });
    expect(took.error, `Take over from the phone, signed with its paired key, counts: ${JSON.stringify(took.error)}`).toBeUndefined();
    const moved = await waitFor(() => { const c = relay.latest(ask.handle); return c && c.revision > before.revision ? c : undefined; }, 30_000, `${ask.handle}'s card coming to the phone at a revision above ${before.revision}`)
      .catch((e: Error) => { throw Error(`${e.message}; the phone shows ${describeItem(relay.latest(ask.handle))}`); });

    const late = await appAnswer(w, ask.handle, 'files', copy);
    expect(late.error, `the app's answer from its old copy is refused: ${JSON.stringify(late.result)}`).toBeDefined();
    expect(JSON.stringify(late.error), 'the refusal names the revision').toMatch(/revision/i);
    expect(await answeredOf(w, ask.handle), 'the app\'s answer counted for nothing').toEqual([]);

    const since = await lastPos(w);
    relay.give(signedAnswer(w.phone, w.hubId, moved, 'sqlite'));
    const outcome = await outcomeOf(w, ask.handle, since, 'the hub counting the phone\'s answer');
    expect(outcome.kind, `the phone, which holds the card now, answers it: ${said([outcome])}`).toBe('ask.answered');
    expect(outcome.data.answer).toBe('sqlite');
  });
});
