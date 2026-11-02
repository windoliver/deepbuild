// AC5: a runner answer that cites a price reading fresh for 5 minutes reads stale 5 minutes after that price's as-of
// time, and a notice that cites it then is refused (README, Readings: AC5). On a controlled clock: the price is read
// at 10:00 (fresh for 5 minutes), the job runs at 10:02 and cites it; a notice citing the answer at 10:04 goes out, and
// one at 10:05 is refused. The wrong program is a hub whose answer is as of its own job, 10:02: the notice it lets
// through at 10:05 is shown on the real host by citing a reading as of 10:02.
import { describe, expect, it } from 'vitest';
import { act, at, CROSSED, FRESH, gotOf, ID, readPrice, stocksWorld, YOU, type Answer, type Got } from './helpers.ts';
import { staleProblems } from './judges.ts';

const notify = async (s: Awaited<ReturnType<typeof stocksWorld>>, key: string, readings: string[]): Promise<Got> =>
  gotOf(await act(s.h, 'notify', { subscription: 'NVDA', key, readings }));

describe(`AC5 ${ID.ac5} A runner answer that cites a price reading fresh for 5 minutes reads stale 5 minutes after that price's as-of time, and a notice that cites it then is refused`, () => {
  it('AC5 the 10:02 answer citing the 10:00 price is as of 10:00 and stale at 10:05: a notice citing it goes out at 10:04 and is refused at 10:05, naming it', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    await s.h.subscribeNotice(YOU, CROSSED, 'NVDA');
    const price = await readPrice(s.h, s.w);
    s.c.set(at('2026-11-02T10:02'));
    const got = gotOf(await act(s.h, 'ask', { prompt: `@answer ${JSON.stringify({ value: 'NVDA is under its 200 target', cites: [price.handle] })}`, inputs: [price.handle] }));
    const answer: Answer | undefined = got.ok ? got.answer : undefined;
    expect(answer, `the runner answered: ${JSON.stringify(got)}`).toBeDefined();
    s.c.set(at('2026-11-02T10:04'));
    const before = await notify(s, 'NVDA-crossed-1004', [answer!.handle]);
    s.c.set(price.as_of + FRESH);
    const after = await notify(s, 'NVDA-crossed-1005', [answer!.handle]);
    expect(staleProblems({ priceAsOf: price.as_of, answer, before, after }, FRESH)).toEqual([]);
  }, 180_000);

  it('AC5 (wrong program) a hub whose answer is as of its own job lets the notice through at 10:05, and fails, naming it', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    const price = await readPrice(s.h, s.w);
    // The wrong hub stamps the answer with its job's time, 10:02, fresh for 5 minutes from then, so it sends the
    // notice at 10:04 and again at 10:05 (modelled: its notices are what that stamp lets through).
    const answer: Answer = { handle: 'reading:01TWINANSWER', value: 'NVDA is under its 200 target', cites: [price.handle], as_of: at('2026-11-02T10:02'), stale_at: at('2026-11-02T10:07') };
    const problems = staleProblems({ priceAsOf: price.as_of, answer, before: { ok: true, notice: 'notice:01TWIN1004' }, after: { ok: true, notice: 'notice:01TWIN1005' } }, FRESH);
    expect(problems.some((p) => p.includes('10:05:00 went out')), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => p.includes('fresh until 10:07:00')), JSON.stringify(problems)).toBe(true);
  }, 180_000);
});
