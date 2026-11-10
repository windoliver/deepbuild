// A running job's row (#1925): its count only from its tool's own counter, its time left only once the job has run
// 30 s and from the rate measured so far, and with no counter the word running and no count. The blind suite reads
// a 600-frame encode at 300 of 600; these read what it leaves: the 30 s rule, a provider's percent and no counter.
import { describe, expect, it } from 'vitest';
import { jobRow } from '../src/rows.js';

const job = { key: 'k', kind: 'test.encode', tool: 'encode-a@1.0.0', started: 1_000_000 };

describe("a running job's row", () => {
  it('says no time left before the job has run 30 s, then the time its counter\'s rate so far gives', () => {
    expect(jobRow({ ...job, counter: { done: 200, total: 600 }, at: job.started + 29_999 }).progress).toBe('200 of 600');
    expect(jobRow({ ...job, counter: { done: 300, total: 600 }, at: job.started + 40_000 }).progress).toBe('300 of 600 · 40 s left');
    expect(jobRow({ ...job, counter: { done: 100, total: 600 }, at: job.started + 60_000 }).progress).toBe('100 of 600 · 5 min left');
  });

  it("counts a provider's percent as the provider reported it", () => {
    expect(jobRow({ ...job, counter: { percent: 42.7 }, at: job.started + 10_000 }).progress).toBe('42%');
  });

  it('with no counter says running and no count, from since, and that the job keeps running when the app or the session closes', () => {
    const row = jobRow(job);
    expect(row).toMatchObject({ id: 'job:k', word: 'running', entry: 'running', since: job.started });
    expect(row.progress).toBeUndefined();
    expect(row.why).toContain('keeps running when the app or the session closes');
  });
});
