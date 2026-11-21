// AC1 (#1101.5140ae1c): Approving a fixture push starts no git process for 10 s. The receipt shows "Starts in 10 s ·
// Undo", counting down on a virtual clock, and the push starts at 10 s. A planted card that starts the push at the
// click fails, naming the step.
// AC3 (#1101.2d545cc0): After the push runs, its receipt says it ran and can't be undone, with no Undo control in the
// text snapshot. A planted receipt that still shows Undo fails, naming the receipt.
//
// A real hub on its test clock holds the agent's `git push origin main` with an authority ask; Allow is pressed on the
// ask's card in the replica and the app's answer reaches the hub signed, as the app sends it. The agent runs the same
// call again right after the yes, 9 s into the hold and at 10 s on the hub's clock; whatever the hub lets through runs
// for real, a `git push` to a bare repository. The receipt is read on the ask's page in the replica over copies of the
// hub's record, its clock 200 ms past 0 s and 4 s into the hold, and a second after the push ran (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, awaitRecord, blocked, cleanup, clock, copyRecord, held, heldReceipt, HOLD_MS, hubLists, ID, inconclusive, MINUTE, PLANT, PUSH,
  pressAllow, ranReceipt, ranTries, remoteHas, SECOND, settleTries, stepTo, stopHub, world, type Held, type World,
} from './helpers.ts';

interface Scene { w: World; h: Held; start: number; hold: string[]; during: string; after?: { fixture: string; at: number } }

/**
 * The fixture push, approved on its card (with `plant` given to the card and, when it lists it, the hub): the hold's
 * failures, each naming the step; the record copied during the hold, and after the push ran when it did.
 */
async function scene(plant?: string): Promise<Scene> {
  const w = await world(plant ? { plant } : {});
  worlds.push(w);
  const a = await Agent.start(w);
  const h = await held(w, a, PUSH);
  const pressed = await pressAllow(await copyRecord(w), await clock(w), h, { ...(plant ? { plant } : {}), untilSent: true });
  const yes = pressed.sent.find((p) => p.ask === h.ask) ?? blocked(`Allow pressed on ${h.ask}'s card sent no answer: ${JSON.stringify(pressed.sent)}`);
  const start = (await allowOnCard(w, h, undefined, yes)).ts;
  const step = `the step \`${PUSH.command}\` (${h.ask})`;
  // Right after the yes the agent runs the same call again, as a held call is told to; then 9 s into the hold.
  await attempt(w, a, PUSH);
  const during = await copyRecord(w);
  if ((await clock(w)) < start + 9 * SECOND) {
    await stepTo(w, start + 9 * SECOND);
    await attempt(w, a, PUSH);
  }
  const hold: string[] = [];
  for (const t of ranTries(w, PUSH).filter((x) => x.at < start + HOLD_MS)) hold.push(`${step} started ${((t.at - start) / 1000).toFixed(1)} s into its hold, before 10 s`);
  if (!ranTries(w, PUSH).some((x) => x.at < start + HOLD_MS) && await remoteHas(w, 'main')) hold.push(`${step}: a git process pushed main to origin before 10 s into its hold`);
  if (!hold.length && !w.tries.some((t) => t.sent < start + HOLD_MS)) inconclusive(`no try of ${step} was made inside its hold (the hub's clock read ${((Math.min(...w.tries.map((t) => t.sent)) - start) / 1000).toFixed(1)} s at the first), so the hold wasn't seen`);
  // At 10 s on the hub's clock the push starts: a try waiting on the hub comes back let through, or a new one is.
  await stepTo(w, start + HOLD_MS);
  await settleTries(w, 30 * SECOND);
  if (!ranTries(w, PUSH).length) await attempt(w, a, PUSH, 60 * SECOND);
  const ran = ranTries(w, PUSH)[0];
  if (!ran) hold.push(`${step} didn't start at 10 s: the hub still held it (${(w.tries.at(-1)?.said ?? '').slice(0, 200)})`);
  else if (!await remoteHas(w, 'main')) hold.push(`${step} was let through but no git push reached origin`);
  if (!ran) return { w, h, start, hold, during };
  await awaitRecord(w, (all) => all.find((e) => e.kind === 'tool.after' && e.data.call === ran.call), `the PostToolUse of ${step}`);
  return { w, h, start, hold, during, after: { fixture: await copyRecord(w), at: (await clock(w)) + SECOND } };
}

const worlds: World[] = [];
let clean: Promise<Scene> | undefined;
const cleanRun = (): Promise<Scene> => (clean ??= scene());

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC1 ${ID.hold}`, () => {
  it(`${ID.hold} approving a fixture push starts no git process for 10 s, its receipt reads "Starts in 10 s · Undo" counting down, and the push starts at 10 s`, async () => {
    const s = await cleanRun();
    const failures = [...s.hold, ...await heldReceipt(s.during, s.h, s.start)];
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.hold} a planted card that starts the push at the click (${PLANT.startsAtClick}) fails, naming the step`, async () => {
    const s = await cleanRun();
    expect(s.hold, `the clean hold already fails, so the plant can't be told from it: ${s.hold.join('\n')}`).toEqual([]);
    const planted = await scene(PLANT.startsAtClick);
    const naming = planted.hold.filter((f) => f.includes(PUSH.command) && f.includes(planted.h.ask));
    expect(naming, `the card that starts the push at the click wasn't caught, naming \`${PUSH.command}\` (${hubLists(PLANT.startsAtClick) ? 'the hub lists the plant' : 'the hub doesn\'t list the plant'}): ${JSON.stringify(planted.hold)}`).not.toEqual([]);
  }, 180 * MINUTE);
});

describe(`#1101 AC3 ${ID.ran}`, () => {
  it(`${ID.ran} after the push runs, its receipt says it ran and can't be undone, with no Undo control in the text snapshot`, async () => {
    const s = await cleanRun();
    if (!s.after) expect.fail(`the push never ran, so its receipt after it ran can't be read: ${s.hold.join('\n')}`);
    const failures = await ranReceipt(s.after.fixture, s.h, s.after.at);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.ran} a planted receipt that still shows Undo (${PLANT.keepsUndo}) fails, naming the receipt`, async () => {
    const s = await cleanRun();
    if (!s.after) expect.fail(`the push never ran, so the clean receipt can't be read before the plant: ${s.hold.join('\n')}`);
    const failures = await ranReceipt(s.after.fixture, s.h, s.after.at);
    expect(failures, `the clean receipt already fails, so the plant can't be told from it: ${failures.join('\n')}`).toEqual([]);
    // The receipt is the app's to draw; a hub that lists the plant makes it too, so its world runs again with it.
    const p = hubLists(PLANT.keepsUndo) ? await scene(PLANT.keepsUndo) : s;
    if (!p.after) expect.fail(`with ${PLANT.keepsUndo} the push never ran: ${p.hold.join('\n')}`);
    const caught = (await ranReceipt(p.after.fixture, p.h, p.after.at, PLANT.keepsUndo)).filter((f) => f.includes(`the receipt of ${p.h.ask}`) && /Undo/.test(f));
    expect(caught, `the receipt that still shows Undo wasn't caught, naming the receipt of ${p.h.ask}`).not.toEqual([]);
  }, 180 * MINUTE);
});
