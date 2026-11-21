// AC6 (#1101.b49d00ae): A push's card holds no switch in its tree, and one press on Allow starts the hold. A batch of
// four still starts its step that can't be undone switched off. A planted single-step card that needs two presses
// fails, naming the card.
//
// The push's card is read on its ask's page in the replica over a copy of a real hub's record while the push is held,
// the replica's clock at the hub's; once it arms, Allow gets one hardware press, and what the app sent its hub goes to
// the real hub signed, as the app sends it. The hold started when the hub took that yes and keeps the agent's next try
// of the push from running. The batch card is the first step's card of AC5's batch, read the same way before it is
// answered (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, batchShown, cleanup, clock, copyRecord, held, HOLD_MS, hubLists, ID, isOff, MINUTE, PLANT, pressAllow, PUSH,
  ranTries, Replica, stopHub, switches, world, type Held, type World,
} from './helpers.ts';

const worlds: World[] = [];
const cardOf = (h: Held): string => `the card of ${h.ask} (\`${h.step.command}\`)`;

/** The push's card, pressed once on Allow (with `plant` given to the card and, when it lists it, the hub): the failures, each naming the card. */
async function onePress(plant?: string): Promise<{ ask: string; failures: string[] }> {
  const w = await world(plant ? { plant } : {});
  worlds.push(w);
  const a = await Agent.start(w);
  const h = await held(w, a, PUSH);
  const pressed = await pressAllow(await copyRecord(w), await clock(w), h, plant ? { plant } : {});
  const failures: string[] = [];
  const held1 = switches(pressed.page);
  if (held1.length) failures.push(`${cardOf(h)} holds a switch in its tree: ${held1.map((n) => `${n.role} "${n.name ?? ''}" (${String(n.value)})`).join(', ')}`);
  const allow = String(((h.card.options ?? []) as { id: string; decision: string }[]).find((o) => o.decision === 'allow')?.id);
  const yes = pressed.sent.filter((p) => p.ask === h.ask && p.option === allow);
  if (yes.length !== 1) failures.push(`one press on Allow on ${cardOf(h)} sent ${yes.length} yes${pressed.sent.length !== yes.length ? ` (it sent ${JSON.stringify(pressed.sent).slice(0, 300)})` : ''}, not one`);
  else {
    // The hub takes that yes, and the hold keeps the agent's next try of the push from running.
    const start = (await allowOnCard(w, h, undefined, yes[0])).ts;
    const tried = await attempt(w, a, PUSH);
    if (ranTries(w, PUSH).some((t) => t.at < start + HOLD_MS)) failures.push(`one press on Allow on ${cardOf(h)} started no hold: the push ran ${((tried.at - start) / 1000).toFixed(1)} s after the yes`);
  }
  return { ask: h.ask, failures };
}

/** The batch's card before it is answered: each step that can't be undone must start switched off. */
async function batchSwitches(): Promise<string[]> {
  const w = await world({ batch: true });
  worlds.push(w);
  const a = await Agent.start(w);
  const order = await batchShown(w, a);
  const first = order[0]!;
  const r = await Replica.on(await copyRecord(w));
  try {
    await r.at(await clock(w));
    const page = await r.page(first.ask);
    const all = switches(page);
    return order.filter((h) => h.step.kind === 'push').flatMap((h) => {
      const own = all.filter((n) => (n.name ?? '').includes(h.step.command));
      if (!own.length) return [`the batch's card (${first.ask}) draws no switch for \`${h.step.command}\`, a step that can't be undone: its switches are ${all.map((n) => `"${n.name ?? ''}"`).join(', ') || 'none'}`];
      return own.filter((n) => !isOff(n)).map((n) => `the batch's card (${first.ask}) starts \`${h.step.command}\`, a step that can't be undone, switched ${String(n.value)}, not off`);
    });
  } finally {
    await r.stop();
  }
}

let clean: ReturnType<typeof onePress> | undefined;
const cleanRun = (): ReturnType<typeof onePress> => (clean ??= onePress());

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC6 ${ID.card}`, () => {
  it(`${ID.card} a push's card holds no switch in its tree, one press on Allow starts the hold, and a batch of four still starts its step that can't be undone switched off`, async () => {
    const { failures } = await cleanRun();
    const batch = await batchSwitches();
    expect([...failures, ...batch], [...failures, ...batch].join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.card} a planted single-step card that needs two presses (${PLANT.twoPresses}) fails, naming the card`, async () => {
    const { failures } = await cleanRun();
    expect(failures, `the clean card already fails, so the plant can't be told from it: ${failures.join('\n')}`).toEqual([]);
    const caught = await onePress(PLANT.twoPresses);
    expect(caught.failures.filter((f) => f.includes(`the card of ${caught.ask}`)), `the card that needs two presses wasn't caught, naming the card of ${caught.ask} (${hubLists(PLANT.twoPresses) ? 'the hub lists the plant' : 'the hub doesn\'t list the plant'})`).not.toEqual([]);
  }, 180 * MINUTE);
});

