// #2199: `deep inbox` shows the option IDs that `deep inbox answer` takes. One test per criterion, against a live hub
// (README). AC1 #2199.bff55edb, AC2 #2199.3ebf26b3, AC3 #2199.e1f74e0f (with its planted wrong program), AC4 #2199.4b672bc1.
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEventsOf, asShown, askOf, BORDER, cleanup, deep, FIXTURE, ID, idsShown, inboxFailures, jsonRows, makeWorld, optionFailures, PLANT, sentenceFailures, shown, STORE,
  type FixtureAsk, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

let made: Promise<World> | undefined;
/** The world the three reading tests share; the answering test makes its own. */
const world = (): Promise<World> => (made ??= makeWorld(FIXTURE));
const all = (w: World) => w.asks.map(asShown);

/** The Given: the ask is open in the hub, with these option IDs (`deep inbox --json` holds them as its row's actions). */
async function given(w: World, ask: FixtureAsk, ids: readonly string[]): Promise<void> {
  const row = (await jsonRows(w, 'inbox')).rows.find((r) => r.id === ask.handle);
  expect(row, `the fixture ask ${ask.handle} ("${ask.question}") is open: deep inbox --json has its row`).toBeDefined();
  const actions = JSON.stringify(row!.actions);
  for (const id of ids) expect(actions.includes(`"${id}"`), `the fixture ask ${ask.handle} has the option ${id}: its --json row's actions are ${actions}`).toBe(true);
}

describe(ID.shown, () => {
  test(`${ID.shown}: with an open taste ask whose options are thin and thick, deep inbox holds both IDs with the ask`, async () => {
    const w = await world();
    const ask = askOf(w, BORDER);
    await given(w, ask, ['thin', 'thick']);
    const r = await deep(w, ['inbox']);
    console.log(`deep inbox:\n${r.stdout}`);
    expect(r.code, `deep inbox exits 0: ${shown(r)}`).toBe(0);
    expect(optionFailures(r.stdout, asShown(ask), all(w)), `deep inbox's ask ${ask.handle}, whose options are thin and thick`).toEqual([]);
  }, 300_000);
});

describe(ID.answers, () => {
  test(`${ID.answers}: deep inbox answer with the ask's handle and an ID deep inbox printed answers the ask with that option`, async () => {
    const w = await makeWorld(FIXTURE);
    const ask = askOf(w, BORDER);
    await given(w, ask, ['thin', 'thick']);
    const listed = await deep(w, ['inbox']);
    expect(listed.code, `deep inbox exits 0: ${shown(listed)}`).toBe(0);
    expect(listed.stdout.includes(ask.handle), `deep inbox prints the handle ${ask.handle}: ${listed.stdout}`).toBe(true);
    // An ID it printed, and not the ask's default (thin), so a default can't pass for the answer.
    const printed = idsShown(listed.stdout, asShown(ask), all(w));
    expect(printed, `deep inbox prints, with ${ask.handle}, an ID to answer it with other than its default; it prints the IDs ${JSON.stringify(printed)}: ${listed.stdout}`).toContain('thick');
    const r = await deep(w, ['inbox', 'answer', ask.handle, 'thick']);
    expect(r.code, `deep inbox answer ${ask.handle} thick exits 0, once the OS confirms you: ${shown(r)}`).toBe(0);
    const closed = (await allEventsOf(w)).filter((e) => e.subject === ask.handle && e.kind === 'ask.answered');
    expect(closed.map((e) => e.data.answer), `the hub's record holds ${ask.handle} answered once, with the option thick`).toEqual(['thick']);
    const after = await deep(w, ['inbox']);
    expect(after.stdout.includes(ask.handle), `${ask.handle} leaves deep inbox once answered: ${after.stdout}`).toBe(false);
  }, 300_000);
});

describe(ID.label, () => {
  test(`${ID.label}: with an option whose label is "Plain files" and whose ID is files, deep inbox shows files`, async () => {
    const w = await world();
    const ask = askOf(w, STORE);
    await given(w, ask, ['sqlite', 'files']);
    const r = await deep(w, ['inbox']);
    console.log(`deep inbox:\n${r.stdout}`);
    expect(r.code, `deep inbox exits 0: ${shown(r)}`).toBe(0);
    expect(optionFailures(r.stdout, asShown(ask), all(w), ['files']), `deep inbox's ask ${ask.handle}, whose option files has the label "Plain files"`).toEqual([]);
  }, 300_000);

  test(`${ID.label}: a planted line that prints only labels fails, naming the ask`, async () => {
    const w = await world();
    const ask = askOf(w, STORE);
    const r = await deep(w, ['inbox'], PLANT);
    console.log(`deep inbox, DEEP_HUB_PLANT=${PLANT}:\n${r.stdout}`);
    const failures = optionFailures(r.stdout, asShown(ask), all(w));
    expect(failures.some((f) => f.includes(ask.handle) && /option files by its label "Plain files" and not by its ID/.test(f)), `DEEP_HUB_PLANT=${PLANT} must print ${ask.handle}'s options by their labels alone, and so fail naming it: ${JSON.stringify(failures)}; ${shown(r)}`).toBe(true);
  }, 300_000);
});

describe(ID.order, () => {
  test(`${ID.order}: deep inbox prints each question before its handle, the default sentence between them, and the handle last on its line`, async () => {
    const w = await world();
    const r = await deep(w, ['inbox']);
    expect(r.code, `deep inbox exits 0: ${shown(r)}`).toBe(0);
    expect(w.asks, 'the fixture holds two open asks').toHaveLength(2);
    expect([...inboxFailures(r.stdout, w.asks), ...sentenceFailures(r.stdout, all(w))], `deep inbox over ${w.asks.length} open asks: ${r.stdout}`).toEqual([]);
  }, 300_000);
});
