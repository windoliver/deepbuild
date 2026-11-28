import { afterAll, describe, expect, it } from 'vitest';
import { blocked, cleanup, FIVE, fixtureRecord, ID, linesOf, listedFailures, MIN, NOBODY, none, plainWords, waitsFailures } from './helpers.ts';

afterAll(cleanup);
const T = 10 * MIN;

describe(`AC3 ${ID.print} what deep prints for a PASS, a sent back, a says done, a stale and an unpushed session`, () => {
  it(`AC3 ${ID.print}: on a fixture record with a PASS, a sent back, a says done, a stale and an unpushed session, no row deep prints with no arguments holds a listed word`, async () => {
    const w = await fixtureRecord(FIVE);
    const print = w.print();
    console.log(`AC3: what deep prints with no arguments on the fixture record:\n${print}`);
    const lines = linesOf(print, w.rows, FIVE);
    expect(lines.length, 'the fixture record holds the five sessions').toBe(5);
    none(listedFailures(lines, plainWords()), 'each of the five rows, as deep prints it with its title, its agent and its age taken out, holds no listed word');
  }, T);

  it(`AC3 ${ID.print}: on the same record each row that isn't PASS says whom it waits for`, async () => {
    const w = await fixtureRecord(FIVE);
    const lines = linesOf(w.print(), w.rows, FIVE);
    expect(lines.filter((l) => l.word !== 'PASS').length, 'four of the five rows are not PASS').toBe(4);
    none(waitsFailures(lines, w.rows), 'each row that is not PASS names whom it waits for, in its waits_on and in its own sentence as deep prints it');
  }, T);

  it(`AC3 ${ID.print}: a planted sentence that names nobody fails, naming the row`, async () => {
    const w = await fixtureRecord(FIVE);
    const real = w.print();
    none(waitsFailures(linesOf(real, w.rows, FIVE), w.rows), 'the rows as the hub builds them say whom they wait for, so a failure below is the planted sentence\'s');
    const stale = w.rowOf('stale');
    const planted = w.rows.map((row) => (row.id === stale.id ? { ...row, why: NOBODY } : row));
    const print = w.print(planted);
    if (print === real) blocked('the planted sentence changed nothing in what deep prints');
    const failures = waitsFailures(linesOf(print, planted, FIVE), planted);
    expect(failures.length, `the planted sentence fails, and no other row does:\n${failures.join('\n')}\n`).toBe(1);
    expect(failures[0], 'the failure names the row by its ID').toContain(stale.id);
    expect(failures[0], 'the failure names the row by its title').toContain(stale.title);
  }, T);
});
