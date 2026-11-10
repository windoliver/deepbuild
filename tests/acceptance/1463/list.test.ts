// AC1 #1463.f9ab70a8 and AC12 #1463.17f151eb: on one fixture, the app's list and `deep status --json` hold the same
// rows, IDs, words, order and unread at one log_pos; a planted second order, a planted word and a planted unread each
// fail, naming the row. The app's list is the replica's `see` over a copy of the same hub's record (README, Pinned 5),
// and its window draws each of those rows by its id, in that order.
import { afterAll, describe, expect, test } from 'vitest';
import { atOneLogPos, cleanup, drawnFailures, ID, jsonRows, MAIN, makeWorld, NOON, rowFailures, shapeFailures, type World } from './helpers.ts';

afterAll(cleanup, 60_000);

let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld(MAIN, { clock: NOON }));
let read: ReturnType<typeof atOneLogPos> | undefined;
const both = async () => (read ??= atOneLogPos(await world()));

describe(ID.list, () => {
  test(`${ID.list}: on one fixture, the app's list and deep status --json hold the same rows, IDs, words and order at one log_pos`, async () => {
    const { app, status } = await both();
    console.log(`at log_pos ${status.log_pos}: ${status.rows.map((r) => `${r.id} "${r.title}" ${r.word}${r.unread ? ' unread' : ''}`).join('; ')}`);
    expect([...shapeFailures(app.rows!, "the app's list"), ...shapeFailures(status.rows, 'deep status --json')], 'every row has the one row shape').toEqual([]);
    expect(status.rows.length, 'the fixture lists rows: its three open asks and its sessions').toBeGreaterThanOrEqual(5);
    expect(rowFailures(app.rows!, status.rows, 'deep status --json'), "the app's list and deep status --json, row by row").toEqual([]);
    expect(drawnFailures(app.snapshot, app.rows!), "the window draws see's rows, by their ids, in their order").toEqual([]);
  }, 900_000);

  test(`${ID.list}: a planted second order fails, naming the row`, async () => {
    const { app } = await both();
    const planted = await jsonRows(await world(), 'status', 'status-second-order');
    const failures = rowFailures(app.rows!, planted.rows, 'deep status --json');
    expect(failures.some((f) => /second order/.test(f) && planted.rows.some((r) => f.startsWith(`row ${r.id} `))), `DEEP_HUB_PLANT=status-second-order must fail naming the row out of place: ${JSON.stringify(failures)}`).toBe(true);
  }, 900_000);

  test(`${ID.list}: a planted word fails, naming the row`, async () => {
    const { app } = await both();
    const planted = await jsonRows(await world(), 'status', 'status-own-word');
    const failures = rowFailures(app.rows!, planted.rows, 'deep status --json');
    const named = app.rows!.filter((r) => r.word === 'needs you').map((r) => r.id);
    expect(named.length, "the fixture's list has rows that need you").toBeGreaterThan(0);
    expect(named.every((id) => failures.some((f) => f.startsWith(`row ${id} has word`))), `DEEP_HUB_PLANT=status-own-word must fail naming each row that needs you (${named.join(', ')}): ${JSON.stringify(failures)}`).toBe(true);
  }, 900_000);
});

describe(ID.unread, () => {
  test(`${ID.unread}: the fields the first criterion compares include unread, and a planted deep status that disagrees with the app on unread fails, naming the row`, async () => {
    const { app } = await both();
    expect(app.rows!.every((r) => typeof r.unread === 'boolean'), `every row of the app's list carries unread: ${JSON.stringify(app.rows!.map((r) => [r.id, r.unread]))}`).toBe(true);
    const planted = await jsonRows(await world(), 'status', 'status-unread-flipped');
    const failures = rowFailures(app.rows!, planted.rows, 'deep status --json');
    expect(app.rows!.every((r) => failures.some((f) => f.startsWith(`row ${r.id} has unread`))), `DEEP_HUB_PLANT=status-unread-flipped must fail naming each row: ${JSON.stringify(failures)}`).toBe(true);
  }, 900_000);
});
