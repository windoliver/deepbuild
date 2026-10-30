// Promised checks (#120): the quotes and due times read from an agent's words, and the set/blocked rule.
import { describe, expect, it } from 'vitest';
import { MAX_SETS, PROMISE_END_MS, blockedCause, dueOf, ownerOf, promisesIn, setPromise } from '../src/promises.js';

// A Tuesday at 22:30 local time.
const NOW = new Date(2026, 9, 27, 22, 30, 0).getTime();
const hourOf = (ms: number) => new Date(ms).getHours();
const daysAhead = (ms: number) => Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(NOW).setHours(0, 0, 0, 0)) / 86_400_000);

describe('a promise\'s words', () => {
  it('read "in the morning" as the next 9:00, "tomorrow" as tomorrow 9:00, "in 10 minutes" as ten minutes on', () => {
    const morning = dueOf(' in the morning', NOW)!;
    expect([hourOf(morning), daysAhead(morning)]).toEqual([9, 1]);
    const tomorrow = dueOf(' tomorrow afternoon', NOW)!;
    expect([hourOf(tomorrow), daysAhead(tomorrow)]).toEqual([14, 1]);
    expect(dueOf(' in 10 minutes', NOW)).toBe(NOW + 10 * 60_000);
    expect(dueOf(' in about 2 hours', NOW)).toBe(NOW + 2 * 3_600_000);
    expect(dueOf(' in a few minutes', NOW)).toBe(NOW + 5 * 60_000);
    const three = dueOf(' at 3pm', NOW)!;
    expect([hourOf(three), daysAhead(three)]).toEqual([15, 1]);
    expect(dueOf(' in src/', NOW)).toBeUndefined();
    expect(dueOf(' later', NOW)).toBeUndefined();
  });
  it('are found in a message with the sentence they sit in', () => {
    const text = 'The deploy is still running. I\'ll look again in the morning and report back.\nMeanwhile the tests pass.';
    expect(promisesIn(text, NOW)).toEqual([{ quote: 'I\'ll look again in the morning and report back.', due: dueOf(' in the morning', NOW) }]);
    expect(promisesIn('I will check back in 10 minutes.', NOW)).toEqual([{ quote: 'I will check back in 10 minutes.', due: NOW + 600_000 }]);
    expect(promisesIn('Let me retry this in 30 seconds', NOW)).toEqual([{ quote: 'Let me retry this in 30 seconds', due: NOW + 30_000 }]);
  });
  it('set nothing for words that name no time, or no check', () => {
    expect(promisesIn('I\'ll check back later.', NOW)).toEqual([]);
    expect(promisesIn('I\'ll look in src/ for the file.', NOW)).toEqual([]);
    expect(promisesIn('The build takes about 10 minutes.', NOW)).toEqual([]);
    expect(promisesIn('Done. All tests pass.', NOW)).toEqual([]);
  });
});

describe('setting a promise', () => {
  const made = (minutes: number) => ({ quote: `I'll check again in ${minutes} minutes.`, due: NOW + minutes * 60_000 });
  it('counts each set, keeps the first end, and blocks the fourth set', () => {
    let state = setPromise(undefined, made(10), 'p1');
    expect(state).toEqual({ id: 'p1', quote: made(10).quote, due: NOW + 600_000, set: 1, end: NOW + 600_000 + PROMISE_END_MS, status: 'set' });
    for (let n = 2; n <= MAX_SETS; n++) {
      state = setPromise(state, made(10 * n), 'p-later');
      expect([state.id, state.set, state.status, state.end]).toEqual(['p1', n, 'set', NOW + 600_000 + PROMISE_END_MS]);
    }
    state = setPromise(state, made(40), 'p-later');
    expect([state.set, state.status, blockedCause(state)]).toEqual([MAX_SETS + 1, 'blocked', 'set_again']);
  });
  it('blocks a promise set past its end', () => {
    const first = setPromise(undefined, made(10), 'p1');
    const late = setPromise(first, { quote: 'I\'ll look again next week.', due: first.end + 1 }, 'p2');
    expect([late.status, blockedCause(late)]).toEqual(['blocked', 'past_end']);
    // BLOCKED stands: a promise made after it changes nothing and sets no wake-up.
    expect(setPromise(late, made(10), 'p-again')).toBe(late);
  });
  it('names the owner: the service when the check waits on one, else you', () => {
    expect(ownerOf('I\'ll check whether CI is green in the morning.')).toBe('service');
    expect(ownerOf('I\'ll look at the deploy again in an hour.')).toBe('service');
    expect(ownerOf('I\'ll look again in the morning.')).toBe('you');
  });
});
