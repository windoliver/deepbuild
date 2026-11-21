// AC5 (#1101.538a1251): A batch of four steps with two that can't be undone runs the two reversible ones at once and
// holds the other two. Undo at 5 s withdraws exactly those two. A planted batch that holds all four, or withdraws a step
// that already ran, fails, naming the step.
//
// A real hub on its test clock, your visits every 2 minutes: inside one window the agent's two pushes (`git push origin
// main`, `git push origin v2.0.0`), which can't be undone, and two pull requests it opens, which can, are held, and at
// your next visit they show as one batch. The batch is approved on its first step's card with all four steps switched
// on; the agent runs each step again right after the yes. At 5 s on the hub's clock the batch's receipt's Undo is
// pressed: the hub's undo, sent as the app sends it, on the card the batch was approved on. Then the record and the
// inbox are read, the clock goes on to 12 s and the agent runs the pushes again (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, awaitRecord, batchShown, cleanup, clock, eventsOf, HOLD_MS, hubLists, ID, inboxRow, inconclusive, MINUTE, names, openOnCard,
  PLANT, ranTries, remoteHas, SECOND, settleTries, sleep, stepTo, stopHub, undoOnCard, withdrawn, world, type Ev, type Held, type World,
} from './helpers.ts';

const worlds: World[] = [];
const name = (h: Held): string => `the step \`${h.step.command}\` (${h.ask})`;

/** The batch approved, then Undo at 5 s (with `plant` given to the hub when it lists it): the failures, each naming its step. */
async function batchUndo(plant?: string): Promise<string[]> {
  const w = await world({ batch: true, ...(plant ? { plant } : {}) });
  worlds.push(w);
  const a = await Agent.start(w);
  const order = await batchShown(w, a);
  const first = order[0]!;
  const start = (await allowOnCard(w, first, order.map((_, i) => i))).ts;
  for (const h of order) await awaitRecord(w, (all) => all.find((e) => e.kind === 'ask.answered' && e.subject === h.ask && e.data.decision === 'allow'), `${h.ask} allowed with the batch`);
  const reversible = order.filter((h) => h.step.kind === 'pr');
  const cant = order.filter((h) => h.step.kind === 'push');
  const failures: string[] = [];
  // Right after the yes the agent runs each step again; the pull requests' replies are waited on, a push the hub keeps
  // waiting isn't.
  const tries = await Promise.all(order.map((h) => attempt(w, a, h.step)));
  for (let i = 0; i < 60 && tries.some((t, k) => order[k]!.step.kind === 'pr' && !t.replied); i++) await sleep(500);
  if ((await clock(w)) >= start + 9 * SECOND) inconclusive(`the hub's clock was past 9 s into the batch's hold before Undo could be pressed at 5 s`);
  for (const h of reversible) if (!ranTries(w, h.step).some((t) => t.at < start + HOLD_MS)) failures.push(`${name(h)} can be undone, but it didn't run at once: the hub held it (${(w.tries.filter((t) => t.step === h.step.command).at(-1)?.said ?? '').slice(0, 200)})`);
  for (const h of cant) for (const t of ranTries(w, h.step)) failures.push(`${name(h)} can't be undone, but it ran ${((t.at - start) / 1000).toFixed(1)} s into the batch's hold`);
  // Undo at 5 s, on the receipt of the card the batch was approved on.
  await stepTo(w, start + 5 * SECOND);
  const since = Math.max(0, ...(await eventsOf(w)).map((e) => e.log_pos));
  const refused = await undoOnCard(w, first.ask);
  if (refused) failures.push(`Undo at 5 s on the batch's receipt (${first.ask}) was refused, so neither ${cant.map(name).join(' nor ')} was withdrawn: ${refused}`);
  else if ((await clock(w)) >= start + HOLD_MS) inconclusive(`Undo at 5 s on the batch's receipt was taken only after 10 s on the hub's clock`);
  const gone = withdrawn(await eventsOf(w), since);
  // A withdrawal names a step by its data, or by its subject alone when its data names no other step of the batch: one
  // recorded on the card the batch was approved on, naming the steps it withdrew, names those steps only.
  const others = (h: Held): Held[] => order.filter((o) => o !== h);
  const namesStep = (e: Ev, h: Held): boolean => {
    const data = JSON.stringify(e.data ?? {});
    return data.includes(h.ask) || data.includes(h.step.command) || (names(e, h) && !others(h).some((o) => data.includes(o.ask) || data.includes(o.step.command)));
  };
  for (const h of cant) {
    if (!gone.some((e) => namesStep(e, h))) failures.push(`${name(h)}: Undo at 5 s recorded no approval.withdrawn naming it`);
    const open = await openOnCard(w, h.ask);
    if (open) failures.push(`${name(h)} isn't open on its card again after Undo at 5 s: ${open}`);
  }
  for (const h of reversible) {
    if (gone.some((e) => namesStep(e, h))) failures.push(`${name(h)} already ran, but Undo at 5 s withdrew it: approval.withdrawn names it`);
    const row = await inboxRow(w, h.ask);
    if (row && (row.status !== 'closed' || row.outcome !== 'answered')) failures.push(`${name(h)} already ran, but after Undo at 5 s the inbox reads it ${String(row.status)}, ${String(row.outcome)}, not answered`);
  }
  // Past the hold the agent runs the withdrawn steps again: neither runs.
  await stepTo(w, start + 12 * SECOND);
  for (const h of cant) await attempt(w, a, h.step);
  await settleTries(w, 20 * SECOND);
  for (const h of cant) {
    if (ranTries(w, h.step).some((t) => t.at >= start + 5 * SECOND)) failures.push(`${name(h)} ran after Undo at 5 s withdrew it`);
    else if (await remoteHas(w, h.step.ref!)) failures.push(`${name(h)}: a git process pushed ${h.step.ref} to origin though Undo at 5 s withdrew it`);
  }
  return failures;
}

let clean: Promise<string[]> | undefined;
const cleanRun = (): Promise<string[]> => (clean ??= batchUndo());

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC5 ${ID.batch}`, () => {
  it(`${ID.batch} a batch of four steps with two that can't be undone runs the two reversible ones at once and holds the other two, and Undo at 5 s withdraws exactly those two`, async () => {
    const failures = await cleanRun();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  for (const [plant, what, kind] of [[PLANT.holdsAll, 'holds all four', 'gh pr create'], [PLANT.withdrawsRan, 'withdraws a step that already ran', 'gh pr create']] as const) {
    it(`${ID.batch} a planted batch that ${what} (${plant}) fails, naming the step`, async () => {
      const failures = await cleanRun();
      expect(failures, `the clean batch already fails, so the plant can't be told from it: ${failures.join('\n')}`).toEqual([]);
      const caught = await batchUndo(plant);
      expect(caught.filter((f) => f.includes(`\`${kind}`)), `the batch that ${what} wasn't caught, naming a step it got wrong (${hubLists(plant) ? 'the hub lists the plant' : 'the hub doesn\'t list the plant'}): ${JSON.stringify(caught)}`).not.toEqual([]);
    }, 180 * MINUTE);
  }
});
