// AC4 #1463.91324b7e: `deep inbox` prints each question before its handle, and `deep inbox answer <handle>` still works.
// AC8 #1463.8ad45787: an ask that defaults to No at 16:40 today reads "If you don't answer: No, at 16:40" in `deep inbox`,
// and its `--json` row holds `default` and `default_at`; a planted line with no default fails, naming the ask.
// AC10 #1463.dacb7e33: `deep inbox undo` says when the ask now defaults as a clock time in your time zone.
// One world, on the hub's clock at noon today in Asia/Kolkata (README, The fixture); the answer and the undo come last.
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEventsOf, clockFailures, clockOf, cleanup, deep, defaultFieldFailures, DEFAULTED_ASK, ID, inboxFailures, jsonRows, MAIN, makeWorld, NOON, shown,
  THE_1640_ASK, todayAt, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld(MAIN, { clock: NOON }));
const open = (w: World) => w.asks.filter((a) => !a.defaulted);
const the1640 = (w: World) => w.asks.find((a) => a.question === THE_1640_ASK)!;

describe(ID.defaults, () => {
  test(`${ID.defaults}: an ask that defaults to No at 16:40 today reads "If you don't answer: No, at 16:40" in deep inbox, and its --json row holds default and default_at`, async () => {
    const w = await world();
    const ask = the1640(w);
    expect(ask.deadline, 'the fixture ask defaults today at 16:40, in Asia/Kolkata').toBe(todayAt(16, 40));
    const r = await deep(w, ['inbox']);
    console.log(`deep inbox:\n${r.stdout}`);
    expect(r.code, `deep inbox exits 0: ${shown(r)}`).toBe(0);
    expect(inboxFailures(r.stdout, [ask], [ask]), `deep inbox's line for ${ask.handle}`).toEqual([]);
    expect(defaultFieldFailures((await jsonRows(w, 'inbox')).rows, ask), `deep inbox --json's row for ${ask.handle}`).toEqual([]);
  }, 900_000);

  test(`${ID.defaults}: a planted line with no default fails, naming the ask`, async () => {
    const w = await world();
    const ask = the1640(w);
    const r = await deep(w, ['inbox'], 'inbox-no-default');
    const failures = inboxFailures(r.stdout, [ask], [ask]);
    expect(failures.some((f) => f.includes(ask.handle) && /lacks "If you don't answer/.test(f)), `DEEP_HUB_PLANT=inbox-no-default must fail naming ${ask.handle}: ${JSON.stringify(failures)}; ${shown(r)}`).toBe(true);
  }, 900_000);
});

describe(ID.inbox, () => {
  test(`${ID.inbox}: deep inbox prints each question before its handle`, async () => {
    const w = await world();
    const r = await deep(w, ['inbox']);
    expect(r.code, `deep inbox exits 0: ${shown(r)}`).toBe(0);
    expect(inboxFailures(r.stdout, open(w)), `deep inbox over ${open(w).length} open asks: ${r.stdout}`).toEqual([]);
  }, 900_000);

  test(`${ID.inbox}: deep inbox answer <handle> still works`, async () => {
    const w = await world();
    const ask = open(w).find((a) => a.question !== THE_1640_ASK)!;
    const r = await deep(w, ['inbox', 'answer', ask.handle, optionOther(ask.question)]);
    expect(r.code, `deep inbox answer ${ask.handle} exits 0, once the OS confirms you: ${shown(r)}`).toBe(0);
    const closed = (await allEventsOf(w)).filter((e) => e.subject === ask.handle && e.kind === 'ask.answered');
    expect(closed.map((e) => e.data.answer), `${ask.handle} is answered once, with the option given`).toEqual([optionOther(ask.question)]);
    const after = await deep(w, ['inbox']);
    expect(after.stdout.includes(ask.handle), `${ask.handle} leaves deep inbox once answered: ${after.stdout}`).toBe(false);
  }, 900_000);
});

describe(ID.undo, () => {
  test(`${ID.undo}: deep inbox undo says when the ask now defaults as a clock time in your time zone`, async () => {
    const w = await world();
    const ask = w.asks.find((a) => a.question === DEFAULTED_ASK)!;
    expect((await allEventsOf(w)).some((e) => e.subject === ask.handle && e.kind === 'ask.defaulted'), `the fixture ask ${ask.handle} took its default before the hub started`).toBe(true);
    const r = await deep(w, ['inbox', 'undo', ask.handle]);
    console.log(`deep inbox undo:\n${r.stdout}${r.stderr}`);
    expect(r.code, `deep inbox undo ${ask.handle} exits 0, once the OS confirms you: ${shown(r)}`).toBe(0);
    const undone = (await allEventsOf(w)).filter((e) => e.subject === ask.handle && e.kind === 'default.undone').at(-1);
    const deadline = Number(undone?.data.deadline);
    expect(Number.isFinite(deadline), `the record holds the undo of ${ask.handle}'s default, with its new deadline`).toBe(true);
    console.log(`the ask now defaults at ${new Date(deadline).toISOString()}, ${clockOf(deadline)} in Asia/Kolkata`);
    expect(clockFailures(r.stdout, deadline, `deep inbox undo ${ask.handle}`), 'deep inbox undo says when the ask now defaults').toEqual([]);
  }, 900_000);
});

/** The option of the fixture's ask that isn't its default: the answer the test gives. */
function optionOther(question: string): string {
  const spec = MAIN.flatMap((s) => s.asks ?? []).find((a) => a.question === question)!;
  return spec.options.find(([id]) => id !== spec.default)![0];
}
