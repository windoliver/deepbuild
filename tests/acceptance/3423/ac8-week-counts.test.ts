import { describe, expect, it } from 'vitest';
import { AC, PERSON, TIMEOUT, agent, brief, fixtureRepo, obj, record, recordPath, reply, taste } from './helpers.ts';

describe(`${AC[8]} the readings' three counts per week`, () => {
  it(`${AC[8]} the week's three counts equal a hand count of a fixture week's records`, () => {
    const { dir } = fixtureRepo([{
      [recordPath(9801)]: record(9801, { verdict: 'looks_right', when: '2026-11-10T09:00:00Z', maker: PERSON }),
      [recordPath(9802)]: record(9802, { verdict: 'looks_right', when: '2026-11-12T09:00:00Z', maker: agent('session-1') }),
      [recordPath(9803)]: record(9803, { verdict: 'looks_right', when: '2026-11-16T09:00:00Z', maker: PERSON }),
      [recordPath(9804)]: record(9804, { verdict: 'looks_wrong', when: '2026-11-17T09:00:00Z', maker: PERSON }),
      [recordPath(9805)]: record(9805, { verdict: 'looks_right', when: '2026-11-19T09:00:00Z', maker: PERSON }),
      [recordPath(9806)]: record(9806, { verdict: 'looks_right', when: '2026-11-17T09:00:00Z', maker: agent('session-2'), deadline: '2026-11-18T12:00:00Z' }),
      [recordPath(9807)]: record(9807, { verdict: 'looks_right', when: '2026-11-18T09:00:00Z', maker: agent('session-3') }),
      [recordPath(9808)]: record(9808, { verdict: 'looks_right', when: '2026-11-19T09:00:00Z', maker: agent('session-4'), deadline: '2026-11-21T12:00:00Z' }),
      [recordPath(9809)]: `${JSON.stringify({ issue: 9809, criterion: '#9809.0000c0de' }, null, 2)}\n`,
    }]);
    const r = taste(['week', '--root', dir, '--now', '2026-11-20T12:00:00Z']);
    const weeks = obj(reply(r, 'week on the scratch repository')['weeks'], 'weeks');
    const counts = Object.fromEntries(Object.entries(weeks).map(([w, c]) => { const o = obj(c, w); return [w, { person: o['person'], waiting: o['waiting'], defaults: o['defaults'] }]; }));
    expect(counts, `the week counts: ${brief(weeks)}`).toEqual({
      '2026-W46': { person: 1, waiting: 1, defaults: 0 },
      '2026-W47': { person: 3, waiting: 2, defaults: 1 },
    });
  }, TIMEOUT);
});
