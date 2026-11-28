import { afterAll, describe, expect, it } from 'vitest';
import { answeredInApp, cleanup, finish, ID, lastReceiptStays, MINUTE, PLANT, type Answered } from './helpers.ts';

const scenes: Answered[] = [];
async function receiptRun(plant?: string): Promise<{ ask: string; failures: string[] }> {
  const s = await answeredInApp({ second: false, ...(plant ? { plant } : {}) });
  scenes.push(s);
  return { ask: s.first.ask, failures: await lastReceiptStays(s) };
}
let clean: ReturnType<typeof receiptRun> | undefined;
const cleanRun = (): ReturnType<typeof receiptRun> => (clean ??= receiptRun());

afterAll(async () => {
  for (const s of scenes.splice(0)) await finish(s);
  await cleanup();
}, 5 * MINUTE);

describe(`#1807 AC3 ${ID.last}`, () => {
  it(`${ID.last} answering the only open ask leaves its receipt and Undo on the page`, async () => {
    const { failures } = await cleanRun();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.last} a planted app that jumps to another page within the Undo window (${PLANT.lastReceiptLeaves}) fails`, async () => {
    const before = (await cleanRun()).failures;
    expect(before, `the clean run already fails, so the plant can't be told from it: ${before.join('\n')}`).toEqual([]);
    const planted = await receiptRun(PLANT.lastReceiptLeaves);
    const caught = planted.failures.filter((f) => f.includes(planted.ask) && /jumped to/.test(f));
    expect(caught, `the app that jumps to another page within the Undo window wasn't caught: ${planted.failures.join('\n')}`).not.toEqual([]);
  }, 180 * MINUTE);
});
