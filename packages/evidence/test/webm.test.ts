// A WebM at intake (#37): detected by its EBML header's DocType, whole only when its Segment's size is finalized and
// reaches the file's end; a recording cut short, or one still being written (unknown size), is truncated.
import { expect, it } from 'vitest';
import { detect, missingEnd } from '../src/intake.ts';

/** A minimal WebM: the EBML header Playwright's ffmpeg writes, then a Segment of `body` bytes with its size known. */
function webm(body: number, unknown = false): Buffer {
  const header = Buffer.from('1a45dfa39f42868101' + '42f78101' + '42f28104' + '42f38108' + '4282847765626d' + '42878102' + '42858102', 'hex');
  const size = unknown ? Buffer.from('01ffffffffffffff', 'hex') : Buffer.from([0x01, 0, 0, 0, 0, 0, (body >> 8) & 0xff, body & 0xff]);
  return Buffer.concat([header, Buffer.from('18538067', 'hex'), size, Buffer.alloc(body, 7)]);
}

it('detects a WebM and holds it whole only with its Segment finalized', () => {
  const whole = webm(1552);
  expect(detect(whole)).toBe('webm');
  expect(missingEnd('webm', whole)).toBeUndefined();
  expect(missingEnd('webm', whole.subarray(0, whole.length - 40))).toBe('the end of the Segment element');
  expect(missingEnd('webm', webm(100, true))).toMatch(/Segment's size/);
  expect(detect(Buffer.from('1a45dfa3ff', 'hex'))).toBeUndefined();
  expect(detect(Buffer.from('this is text'))).toBeUndefined();
});
