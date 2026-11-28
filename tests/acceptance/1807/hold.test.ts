import { afterAll, describe, expect, it } from 'vitest';
import { answeredInApp, cleanup, finish, ID, MINUTE, PLANT, rowAndCardAt4, undoAt6, type Answered } from './helpers.ts';

type Outcome = { failures: string[] } | { error: unknown };
const outcome = (p: Promise<string[]>): Promise<Outcome> => p.then((failures) => ({ failures }), (error: unknown) => ({ error }));
const failuresOf = (o: Outcome): string[] => {
  if ('error' in o) throw o.error;
  return o.failures;
};

const scenes: Answered[] = [];
async function scene(plant?: string): Promise<Answered> {
  const s = await answeredInApp({ second: true, ...(plant ? { plant } : {}) });
  scenes.push(s);
  return s;
}

let clean: Promise<{ s: Answered; row: Outcome; undo: Outcome }> | undefined;
const cleanRun = (): Promise<{ s: Answered; row: Outcome; undo: Outcome }> => (clean ??= (async () => {
  const s = await scene();
  const row = await outcome(rowAndCardAt4(s));
  const undo = await outcome(undoAt6(s));
  return { s, row, undo };
})());

afterAll(async () => {
  for (const s of scenes.splice(0)) await finish(s);
  await cleanup();
}, 5 * MINUTE);

describe(`#1807 AC1 ${ID.row}`, () => {
  it(`${ID.row} a push allowed at 0 s shows "Starts in" and Undo on its row and its card at 4 s, though a second ask is open`, async () => {
    const failures = failuresOf((await cleanRun()).row);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.row} a planted list that drops the answered row at 2 s (${PLANT.rowLeavesAt2s}) fails, naming the ask`, async () => {
    const before = failuresOf((await cleanRun()).row);
    expect(before, `the clean run already fails, so the plant can't be told from it: ${before.join('\n')}`).toEqual([]);
    const planted = await scene(PLANT.rowLeavesAt2s);
    const caught = (await rowAndCardAt4(planted)).filter((f) => f.includes(planted.first.ask) && /row/.test(f));
    expect(caught, `the list that drops the answered row at 2 s wasn't caught, naming ${planted.first.ask}`).not.toEqual([]);
  }, 180 * MINUTE);
});

describe(`#1807 AC2 ${ID.undo}`, () => {
  it(`${ID.undo} ⌘Z at 6 s leaves the push not run and the ask open again in place`, async () => {
    const failures = failuresOf((await cleanRun()).undo);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.undo} a planted app that clears its own receipt and sends nothing (${PLANT.undoSendsNothing}) fails, naming the missing call`, async () => {
    const before = failuresOf((await cleanRun()).undo);
    expect(before, `the clean run already fails, so the plant can't be told from it: ${before.join('\n')}`).toEqual([]);
    const planted = await scene(PLANT.undoSendsNothing);
    const caught = (await undoAt6(planted)).filter((f) => f.includes('ask.undo') && f.includes(planted.first.ask));
    expect(caught, `the app that clears its own receipt and sends nothing wasn't caught, naming the missing call ask.undo for ${planted.first.ask}`).not.toEqual([]);
  }, 180 * MINUTE);
});
