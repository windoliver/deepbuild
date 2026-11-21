// AC2 (#1101.08523c57): Undo at 6 s runs nothing, records `approval.withdrawn`, and the push's ask is open on its card
// again. A planted host that runs the push anyway, or closes the ask as declined, fails, naming the ask.
//
// A real hub on its test clock holds the agent's `git push origin main`; it is allowed on its card, and the agent runs
// the same call again right after the yes. At 6 s on the hub's clock the receipt's Undo is pressed: the hub's undo
// (`ask.undo`, the one `deep inbox undo` calls), sent as the app sends it. Then the record, the inbox and the ask's card
// are read, the clock goes on to 12 s and the agent runs the call again (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, cleanup, clock, eventsOf, held, HOLD_MS, hubLists, ID, inconclusive, MINUTE, names, openOnCard, PLANT, PUSH, ranTries,
  remoteHas, SECOND, settleTries, stepTo, stopHub, undoOnCard, withdrawn, world, type World,
} from './helpers.ts';

const worlds: World[] = [];
/** The push allowed, then Undo at 6 s (with `plant` given to the hub when it lists it): the failures, each naming the ask. */
async function undoAt6(plant?: string): Promise<{ ask: string; failures: string[] }> {
  const w = await world(plant ? { plant } : {});
  worlds.push(w);
  const a = await Agent.start(w);
  const h = await held(w, a, PUSH);
  const start = (await allowOnCard(w, h)).ts;
  const who = `${h.ask} (\`${PUSH.command}\`)`;
  await attempt(w, a, PUSH);
  if ((await clock(w)) >= start + 9 * SECOND) inconclusive(`the hub's clock was past 9 s into the hold of ${who} before Undo could be pressed at 6 s`);
  await stepTo(w, start + 6 * SECOND);
  const since = Math.max(0, ...(await eventsOf(w)).map((e) => e.log_pos));
  const undoneAt = await clock(w);
  const refused = await undoOnCard(w, h.ask);
  const failures: string[] = [];
  if (refused) failures.push(`${who}: Undo at 6 s into its hold was refused: ${refused}`);
  else if ((await clock(w)) >= start + HOLD_MS) inconclusive(`Undo of ${who}, pressed at 6 s, was taken only after 10 s on the hub's clock`);
  if (!withdrawn(await eventsOf(w), since).some((e) => names(e, h))) failures.push(`${who}: no approval.withdrawn naming its step was recorded after Undo at 6 s`);
  const open = await openOnCard(w, h.ask);
  if (open) failures.push(`${who} isn't open on its card again after Undo at 6 s: ${open}`);
  // Past the hold the agent runs the same call again: nothing withdrawn runs.
  await stepTo(w, start + 12 * SECOND);
  await attempt(w, a, PUSH);
  await settleTries(w, 20 * SECOND);
  for (const t of ranTries(w, PUSH)) failures.push(`${who} ran ${((t.at - start) / 1000).toFixed(1)} s after its yes, ${t.at < undoneAt ? 'inside its hold, before Undo at 6 s' : 'though Undo at 6 s withdrew it'}`);
  if (!ranTries(w, PUSH).length && await remoteHas(w, 'main')) failures.push(`${who}: a git process pushed main to origin though Undo at 6 s withdrew it`);
  return { ask: h.ask, failures };
}

let clean: ReturnType<typeof undoAt6> | undefined;
const cleanRun = (): ReturnType<typeof undoAt6> => (clean ??= undoAt6());

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC2 ${ID.undo}`, () => {
  it(`${ID.undo} Undo at 6 s runs nothing, records approval.withdrawn, and the push's ask is open on its card again`, async () => {
    const { failures } = await cleanRun();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  for (const plant of [PLANT.runsAnyway, PLANT.closesDeclined]) {
    it(`${ID.undo} a planted host that ${plant === PLANT.runsAnyway ? 'runs the push anyway' : 'closes the ask as declined'} (${plant}) fails, naming the ask`, async () => {
      const { failures } = await cleanRun();
      expect(failures, `the clean Undo already fails, so the plant can't be told from it: ${failures.join('\n')}`).toEqual([]);
      const caught = await undoAt6(plant);
      expect(caught.failures.filter((f) => f.includes(caught.ask)), `the host ${plant} wasn't caught, naming ${caught.ask} (${hubLists(plant) ? 'the hub lists the plant' : 'the hub doesn\'t list the plant'})`).not.toEqual([]);
    }, 180 * MINUTE);
  }
});
