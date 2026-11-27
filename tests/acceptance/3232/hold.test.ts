// AC7: approving a fixture push adds one entry at the hold's start with "10 s" and the key that undoes it, none while
// the countdown runs on the virtual clock, and one when the push ran.
//
// The hold is #1101's (its world, by import): a real hub on its test clock holds an agent's session's `git push
// origin main` with an authority ask under the shipped guards; the push runs for real, to a bare repository, once the
// hub lets it through at 10 s. The window is the replica on a copy of that hub's record taken before the yes, the
// push's card on its page and armed, its clock brought to the hub's. The yes is given twice over, as one approval: sent
// to the hub as the app's card sends it, signed, and pressed on the card in the window at the time the hub recorded it
// (as #1101's `pressAllow` presses it), so the card's receipt counts the hold down in the window; everything the hub
// appends from the yes on is fed to it in log order (README, The fixtures: the hold).
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { Agent, allowOnCard, attempt, awaitRecord, clock, copyRecord, held, PUSH, ranTries, settleTries, stepTo, world } from '../1101/helpers.ts';
import { blocked, byId, cleanup, flicks, MIN, NOW, quiet, SECOND, Stage } from './helpers.ts';
import { FLICKS, holdLines, ID, PLANT, said, undoKeys, type Read } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
const HELD = 'the shipped app must pass this judge first, or a plant it fails proves nothing';
/** The hold, as #1101 sets it. */
const HOLD_MS = 10 * SECOND;
/** How far into the hold the countdown is read: half a second short of its end, when a receipt that speaks each second has spoken ten times. */
const THROUGH_MS = HOLD_MS - 500;

interface Run { who: string; base: Read; startedAt: number; counted: Read; ran: Read }
async function holdRun(plant?: string): Promise<Run> {
  const w = await world();
  const a = await Agent.start(w);
  const h = await held(w, a, PUSH);
  const who = `the push ${h.ask} (\`${PUSH.command}\`)`;
  // The replica's clock starts at NOW and the hub's a minute on: it is run to the hub's time, never past it.
  await quiet(w.hub);
  const stage = await Stage.on(w, { fixture: await copyRecord(w), ...(plant ? { plant } : {}) });
  try {
    await stage.d.at(await clock(w));
    await stage.d.open(`ask/${h.ask.slice('ask:'.length)}`);
    // Whatever the hub wrote of the held call since the copy is the record before the yes, not the hold.
    await stage.feedNew();
    // The card arms once it has been presented and still for its interval; up to 3 s of the replica's clock.
    const card = async (): Promise<unknown> => byId((await stage.d.see()).snapshot, 'question-card')?.value;
    for (let waited = 0; waited < 3 * SECOND && (await card()) !== 'armed'; waited += 100) await stage.d.wait(100);
    if ((await card()) !== 'armed') blocked(`the fixture didn't hold: the card of ${who} reads ${said(await card())}, not armed, 3 s after its page opened`);
    const base = await stage.read();
    // The yes, as the card sends it; the hold starts at its `ask.answered`, on the hub's clock, which is first stepped
    // up to the replica's if arming took the replica past it, so the hold never starts in the replica's past.
    await stepTo(w, NOW + Math.ceil((stage.d.t * 1000) / FLICKS));
    const start = (await allowOnCard(w, h)).ts;
    await stage.d.at(start);
    // The same yes, pressed on the card in the window: one hardware press on its allow option (`card-option:<id>`).
    const allow = ((h.card.options ?? []) as { id?: unknown; decision?: unknown }[]).find((x) => x.decision === 'allow') ?? blocked(`${who}'s card offers no option that allows`);
    await stage.d.must(`a press on the allow option of ${who}`, { call: 'act', locator: { id: `card-option:${String(allow.id)}` }, act: { kind: 'click', source: 'hid' } });
    if ((await card()) !== 'answered') blocked(`the fixture didn't hold: the card of ${who} reads ${said(await card())}, not answered, after the press on its allow option`);
    const startedAt = stage.d.t;
    await stage.feedNew();
    // The countdown, on the replica's clock alone: nothing is fed while it runs.
    await stage.d.waitTo(startedAt + flicks(THROUGH_MS), 100);
    const counted = await stage.read();
    // At 10 s on the hub's clock the hub lets the push through, and it runs; the replica's clock follows, and then
    // what the hub recorded of it is fed.
    await stepTo(w, start + HOLD_MS);
    await settleTries(w, 30 * SECOND);
    if (!ranTries(w, PUSH).length) await attempt(w, a, PUSH, 60 * SECOND);
    const tried = ranTries(w, PUSH)[0] ?? blocked(`the fixture didn't hold: ${who} wasn't let through at 10 s on the hub's clock (${(w.tries.at(-1)?.said ?? 'no try').slice(0, 200)})`);
    await awaitRecord(w, (all) => all.find((e) => e.kind === 'tool.after' && e.data.call === tried.call), `the PostToolUse of ${who}`);
    await quiet(w.hub);
    await stage.d.waitTo(startedAt + flicks(HOLD_MS + 200), 100);
    await stage.feedNew();
    await stage.d.wait(3 * SECOND);
    return { who, base, startedAt, counted, ran: await stage.read() };
  } finally {
    await stage.stop();
  }
}
const judged = (r: Run): string[] => holdLines({ ...r, through: THROUGH_MS, keys: undoKeys() });
const shipped = shared(() => holdRun());

describe(`AC7 ${ID.hold} a hold is announced at its start and when its step ran, never while it counts down`, () => {
  it(`AC7 ${ID.hold}: approving a fixture push adds one entry at the hold's start with "10 s" and the key that undoes it, none while the countdown runs on the virtual clock, and one when the push ran`, async () => {
    expect(judged(await shipped())).toEqual([]);
  }, LIMIT);

  it(`AC7 ${ID.hold} wrong program: a planted receipt that announces each second (${PLANT.eachSecond}) fails, naming 10 entries`, async () => {
    expect(judged(await shipped()), HELD).toEqual([]);
    const failures = judged(await holdRun(PLANT.eachSecond)).join('\n');
    expect(failures, `${PLANT.eachSecond} wasn't caught naming its 10 entries`).toMatch(/the hold added 10 entries from its start through 9\.5 s of its countdown on the virtual clock/);
  }, LIMIT);
});
