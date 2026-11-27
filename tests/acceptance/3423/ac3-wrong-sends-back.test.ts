import { describe, expect, it } from 'vitest';
import { AC, agent, fixtureRepo, obj, record, recordPath, reply, taste } from './helpers.ts';

const WRONG = recordPath(9401);

describe(`${AC[3]} a reading that says wrong`, () => {
  it(`${AC[3]} fails its criterion, and the run says the work was sent back by a reading`, () => {
    const { dir } = fixtureRepo([{
      [WRONG]: record(9401, { verdict: 'looks_wrong', when: '2026-11-17T10:00:00Z', maker: agent('session-w'), deadline: '2026-11-30T00:00:00Z', note: 'the label overlaps the chart' }),
    }]);
    const r = taste(['verdict', '--root', dir, '--record', WRONG, '--now', '2026-11-18T12:00:00Z']);
    const v = reply(r, `verdict on ${WRONG}`);
    expect(v['verdict'], `${WRONG}, a reading that says wrong, fails its criterion`).toBe('FAIL');
    const back = obj(v['sent_back'], `${WRONG}'s sent_back`);
    expect({ by: back['by'], file: back['file'] }, 'the work was sent back by the reading').toEqual({ by: 'reading', file: WRONG });
    expect(r.out, 'the run says the work was sent back by a reading').toContain('sent back by a reading');
  }, 120_000);
});
