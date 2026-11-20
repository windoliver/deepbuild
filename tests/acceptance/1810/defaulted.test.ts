// Criterion 2 #1810.a646c123: a defaulted ask that can still be undone isn't counted. A planted reader that counts it
// fails, naming the ask. The ask takes its default in the asks core (`tick`) before the hub starts, and the test proves
// it could still be undone by undoing it with `deep inbox undo` after the counts are read. The planted reader is the
// hub's status answer under DEEP_HUB_PLANT=needs-you-counts-defaulted (README, Pinned 1).
import { afterAll, describe, expect, test } from 'vitest';
import {
  askRows, cleanup, countFailures, countsIn, deep, foldedRows, ID, makeWorld, PLANT_COUNTS_DEFAULTED, quiet, shown, statusAnswer, statusLogPos, type WorldSpec,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const options: [string, string][] = [['sqlite', 'SQLite'], ['files', 'Plain files']];
const SPEC: WorldSpec = {
  title: 'Docs refresh',
  asks: [
    { question: 'Keep the cart on SQLite or plain files?', options, default: 'sqlite', then: 'default' },
    { question: 'Keep the changelog as a list or as prose?', options: [['list', 'A list'], ['prose', 'Prose']], default: 'list', then: 'open' },
  ],
};

describe(ID.defaulted, () => {
  test(`${ID.defaulted}: an ask that took its default and can still be undone isn't counted by the status answer, deep or the app's list`, async () => {
    const w = await makeWorld(SPEC);
    const defaulted = w.asks.find((a) => a.then === 'default')!;
    const answer = await statusAnswer(w);
    console.log(`status answer:\n${answer}`);
    await quiet(w.hub);
    const at = await statusLogPos(w);
    const r = await deep(w, []);
    const app = askRows(await foldedRows(w, at));
    expect(countFailures(answer, w.asks), 'the status answer counts the one open ask').toEqual([]);
    expect(countsIn(r.stdout), `deep says "1 ask needs you": ${shown(r)}`).toEqual([1]);
    expect(app, `the app's list at log_pos ${at} holds no row for ${defaulted.handle}`).not.toContain(defaulted.handle);
    expect(app.length, `the app's list at log_pos ${at} holds one ask row`).toBe(1);
    // The fixture's premise: the default could still be undone when the counts were read.
    const undo = await deep(w, ['inbox', 'undo', defaulted.handle]);
    expect(undo.code, `${defaulted.handle} took its default and can still be undone (deep inbox undo exits 0): ${shown(undo)}`).toBe(0);
  }, 600_000);

  test(`${ID.defaulted}: (wrong program) a status answer that counts the undoable default (DEEP_HUB_PLANT=${PLANT_COUNTS_DEFAULTED}) fails, naming the ask`, async () => {
    const w = await makeWorld({ ...SPEC, plant: PLANT_COUNTS_DEFAULTED });
    const defaulted = w.asks.find((a) => a.then === 'default')!;
    const answer = await statusAnswer(w);
    console.log(`planted status answer:\n${answer}`);
    const failures = countFailures(answer, w.asks);
    expect(failures.length, `the planted reader must fail the count check: ${JSON.stringify(answer)}`).toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the defaulted ask').toContain(defaulted.handle);
  }, 600_000);
});
