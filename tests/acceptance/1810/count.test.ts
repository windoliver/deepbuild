// Criterion 1 #1810.eebcb4a2: with two asks answered and one open, "anything for me?" answers "needs you: 1", and
// `deep` and the app's list say 1 at the same log position. On the merge base the answer says 3, and the test fails,
// naming the count. The asks are answered through the real `deep inbox answer`; the app's list is the rows the app
// folds (`row.set` up to `deep status --json`'s log_pos) and, on macOS, the replica's own list.
import { afterAll, describe, expect, test } from 'vitest';
import {
  askRows, cleanup, countFailures, countsIn, deep, foldedRows, ID, makeWorld, quiet, replicaList, shown, statusAnswer, statusLogPos, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const options: [string, string][] = [['yes', 'Yes'], ['no', 'No']];
let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld({
  title: 'Cart totals',
  asks: [
    { question: 'Ship the cart page today?', options, default: 'no', then: 'answer' },
    { question: 'Keep the old checkout button?', options, default: 'no', then: 'answer' },
    { question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', then: 'open' },
  ],
}));

describe(ID.count, () => {
  test(`${ID.count}: two asks answered and one open: "anything for me?" answers "needs you: 1", and deep and the app's folded list say 1 at one log position`, async () => {
    const w = await world();
    const open = w.asks.filter((a) => a.then === 'open').map((a) => a.handle);
    const before = await quiet(w.hub);
    const answer = await statusAnswer(w);
    console.log(`status answer:\n${answer}`);
    expect(countFailures(answer, w.asks), 'the status answer counts the open asks').toEqual([]);
    await quiet(w.hub);
    const at = await statusLogPos(w);
    const r = await deep(w, []);
    console.log(`deep:\n${r.stdout}`);
    expect(await statusLogPos(w), `the record didn't move while deep read it (log_pos ${at})`).toBe(at);
    const app = askRows(await foldedRows(w, at));
    const then = askRows(await foldedRows(w, before));
    expect(then.sort(), `the app's ask rows are the same at log_pos ${before} (before the answer) and ${at} (deep's read)`).toEqual(app.sort());
    expect(r.code, `deep exits 0: ${shown(r)}`).toBe(0);
    expect(countsIn(r.stdout), `deep says "1 ask needs you", the one count: ${shown(r)}`).toEqual([1]);
    expect(app, `the app's list at log_pos ${at} holds the one open ask's row`).toEqual(open);
  }, 600_000);

  test(`${ID.count}: the replica's list (the app itself, on macOS) says 1 at deep status --json's log position`, async () => {
    const w = await world();
    await quiet(w.hub);
    const at = await statusLogPos(w);
    const app = await replicaList(w);
    expect(app.log_pos, "the replica's list was read at deep status --json's log_pos").toBe(at);
    expect(app.counts, 'the window says "1 ask needs you"').toEqual([1]);
    expect(app.asks, "the replica's list holds the one open ask's row").toEqual(w.asks.filter((a) => a.then === 'open').map((a) => a.handle));
  }, 900_000);
});
