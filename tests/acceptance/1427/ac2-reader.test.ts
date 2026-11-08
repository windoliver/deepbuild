// Criterion 2 (README: Criterion 2): a streaming fixture that inserts text above the reader's line gives reader_moved, and
// the same fixture with the insert below gives nothing. On data: three transcript lines, the reader on line-b, a line
// streamed in at step 40 at 10% opacity (so it never pops in): above the reader it pushes line-b down 40 in one step;
// directly below the reader it pushes only line-c; at the end of the transcript nothing moves. On a real replica: the
// lab's "Insert above" and "Insert below" with the reader on the text "Line B".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Drive, FLICKS, STEP, STREAM, cleanup, checked, expectFindings, journey, requireMacos, type Obj } from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

/** Every finding is reader_moved, and line-b's is among them, at `t`, measuring the 40 it moved. */
function readerMoved(reply: Obj, t: number): void {
  const found = reply.findings as Obj[];
  expect(found.map((f) => f.finding), `only reader_moved: ${JSON.stringify(found)}`).toEqual(found.map(() => 'reader_moved'));
  const mine = found.filter((f) => f.element === 'line-b');
  expect(mine.length, `one reader_moved names line-b, the reader's line: ${JSON.stringify(found)}`).toBe(1);
  expect(mine[0]!.t, 'at the step it moved').toBe(t);
  expect(mine[0]!.value, 'by the 40 it moved').toBeCloseTo(40, 3);
}

describe('#1427 AC2 a streaming insert above the reader\'s line gives reader_moved; below it gives nothing', () => {
  it('data: text streamed in above line-b moves line-b 40 down in one step: reader_moved', async () => {
    const reply = await checked(drive, { recording: STREAM('above') });
    readerMoved(reply, 40 * STEP);
    expect(reply.claim, 'and the claim fails').toBe('FAIL');
  });
  it('data: the same text streamed in directly below line-b, which moves only line-c: nothing', async () => {
    expectFindings(await checked(drive, { recording: STREAM('below') }), []);
  });
  it('data: the same text streamed in at the end of the transcript, which moves nothing: nothing', async () => {
    expectFindings(await checked(drive, { recording: STREAM('end') }), []);
  });

  it('a real replica: "Insert above" streams a line in above Line B and moves it', async () => {
    const reply = await checked(drive, { journey: journey('Insert above'), reader: { text: 'Line B' } });
    const click = reply.recording.inputs[0].t as number;
    const found = reply.findings as Obj[];
    expect(found.map((f) => f.finding), `only reader_moved: ${JSON.stringify(found)}`).toEqual(found.map(() => 'reader_moved'));
    const mine = found.filter((f) => String(f.element).includes('line-b'));
    expect(mine.length, `one reader_moved names line-b: ${JSON.stringify(found)}`).toBe(1);
    expect(mine[0]!.t, 'within a quarter second of the press').toBeGreaterThanOrEqual(click - 0.1 * FLICKS);
    expect(mine[0]!.t).toBeLessThanOrEqual(click + 0.25 * FLICKS);
    expect(mine[0]!.value, 'by the 20 pt (40 px) a line is tall').toBeCloseTo(40, 3);
  });
  it('a real replica: "Insert below" streams a line in directly below Line B and moves only Line C: nothing', async () => {
    const reply = await checked(drive, { journey: journey('Insert below'), reader: { text: 'Line B' } });
    expectFindings(reply, []);
  });
});
