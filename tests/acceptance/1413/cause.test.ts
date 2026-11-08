// #1413.45bacca1: a forced out-of-memory on a labeled buffer, then 50 validation errors that use it: the writer's
// error is out_of_memory naming the label and the bytes, with the 50 later errors counted; a planted reporter that
// keeps the latest error returns validation and fails. Alpha's revision at frame 30 carries `test.alloc@1`
// "oom-buffer", twice the Mac's unified memory, used 50 times after it fails (README: test.alloc@1). At the base
// there is no `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { LATER_ERRORS, OVER_MEMORY_BYTES, W, alloc, causeProblems, liveCall, liveReply, run, sceneDoc, useBuild, useDir, writeDoc, type Planted, type WriterError } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const LABEL = 'oom-buffer';

function alphaError(planted?: Planted): WriterError | undefined {
  const d = dir();
  const plain = writeDoc(d, 'plain', sceneDoc('Plain'));
  const big = writeDoc(d, 'big', sceneDoc('Over memory, used 50 times', { big: alloc('big', LABEL, OVER_MEMORY_BYTES, LATER_ERRORS) }));
  const { replies } = run(bin(), d, [liveCall({
    frames: 60,
    sessions: [{ session: 'alpha', writer: W.alpha, doc: plain }],
    events: [{ frame: 30, revise: { session: 'alpha', doc: big } }],
  })], planted ? { planted } : {});
  const live = liveReply(replies[0]!, planted ? `the live call (--planted ${planted})` : 'the live call');
  const mine = live.writer_errors.filter((e) => e.session === 'alpha');
  expect(mine.length, `alpha's writer is told one error, not one per symptom: ${JSON.stringify(mine).slice(0, 800)}`).toBe(1);
  return mine[0];
}

describe('#1413.45bacca1 a forced out-of-memory on a labeled buffer, then 50 validation errors that use it: the writer\'s error is out_of_memory naming the label and the bytes, with 50 later errors counted; a planted reporter that keeps the latest error returns validation and fails', () => {
  it('#1413.45bacca1 the writer is told out_of_memory for "oom-buffer" and its requested bytes, with the 50 validation errors after it counted', () => {
    const e = alphaError();
    expect(causeProblems(e, LABEL, OVER_MEMORY_BYTES, LATER_ERRORS), 'the first out-of-memory is the cause, and the symptoms after it are counted').toEqual([]);
    expect(e!.writer, 'the error is the writer\'s').toBe(W.alpha);
  }, 3_600_000);

  it('#1413.45bacca1 a planted reporter that keeps the latest error (--planted keeps_latest_error) tells the writer validation, and the check fails it', () => {
    const e = alphaError('keeps_latest_error');
    expect(e!.code, 'the planted reporter returns the last symptom').toBe('validation');
    expect(causeProblems(e, LABEL, OVER_MEMORY_BYTES, LATER_ERRORS).join('\n'), 'the check fails the planted reporter, naming what it told').toContain('is validation, not out_of_memory');
  }, 3_600_000);
});
