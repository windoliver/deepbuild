// #3250, a record written before the change: turn.usage@1 events, seeded through the real record before the hub starts
// (tests/acceptance/26/helpers.ts, seed), as the hub wrote them at the base. Through numbers.read and `deep numbers` the
// record reads the spend and tokens the base read (README, The frozen readings). This passes on the base by design; a
// planted reader that drops @1 events, reads their cost or tokens otherwise, or says "at least" on them fails it.
import { afterEach, expect, it } from 'vitest';
import { events, makeHome, MINUTE, PROJECT, seed, startHub, stopHub, ulid, type Hub, type Line } from '../26/helpers.ts';
import { numbersText, rows, saysAtLeast, sessionLine, sessionRow, TIMEOUT, tidy, versionOf } from './world.ts';

afterEach(tidy, 60_000);
const show = (v: unknown): string => JSON.stringify(v).slice(0, 2000);
const WHO = { actor: 'you', scope: 'you', project: PROJECT };
const CARD = 'anthropic-list-2026-10';

interface Seeded { kind: string; session: string; ts: number; id: string; data: Line }
const ask = (session: string, ts: number): Seeded => ({ kind: 'user.ask', session, ts, id: ulid(ts), data: { msg: 1, text: 'fix the login page', tasks: [], from: 'person' } });
/** turn.usage@1 data as the hub wrote it at the base: tokens with input taking cache writes in whole, and a closed cost. */
const used = (session: string, ts: number, turn: string, covers: 'turn' | 'session', tokens: { input: number; cached: number; output: number }, cost: Line): Seeded =>
  ({ kind: 'turn.usage', session, ts, id: ulid(ts), data: { turn, model: 'claude-opus-4-5', covers, tokens: { ...tokens, exact: true }, cost } });

it('#3250.b5e3837c a record holding turn.usage@1 events reads the same spend and tokens it read before', async () => {
  const { home } = makeHome();
  const t = Date.now() - 30 * MINUTE;
  // Sa: two stops' running totals, as the hub writes a Claude Code session (covers: session), estimated.
  const a1 = ask('Sa', t);
  const a2 = ask('Sa', t + 2 * MINUTE);
  // Sb: one turn, its own count, reported. Sc: one turn with no price.
  const b1 = ask('Sb', t);
  const c1 = ask('Sc', t);
  const seeded: Seeded[] = [
    a1, used('Sa', t + MINUTE, a1.id, 'session', { input: 1_100_020, cached: 10_000, output: 400 }, { basis: 'estimated', usd: 7, rate_card: CARD }),
    a2, used('Sa', t + 3 * MINUTE, a2.id, 'session', { input: 2_000_020, cached: 20_000, output: 900 }, { basis: 'estimated', usd: 12.5, rate_card: CARD }),
    b1, used('Sb', t + MINUTE, b1.id, 'turn', { input: 100, cached: 0, output: 50 }, { basis: 'reported', usd: 0.25 }),
    c1, used('Sc', t + MINUTE, c1.id, 'turn', { input: 10, cached: 0, output: 5 }, { basis: 'unpriced' }),
  ].sort((x, y) => x.ts - y.ts);
  await seed(home, async (s) => {
    for (const e of seeded) {
      s.at(e.ts);
      const writer = e.kind === 'user.ask' ? 'hook' : 'core';
      await s.record.append({ writer, ...WHO, session: e.session, ...(writer === 'hook' ? { agent: 'claude-code' } : {}) }, { v: 1, id: e.id, kind: e.kind, ...(e.kind === 'turn.usage' ? { subject: `session:${e.session}` } : {}), ts: e.ts, data: e.data as never });
    }
  }, t - MINUTE);
  let hub: Hub | undefined;
  try {
    hub = await startHub(home);
    const held = (await events(hub)).filter((e) => e.kind === 'turn.usage');
    expect(held.map(versionOf), 'the record holds the four turn.usage events as written, @1').toEqual([1, 1, 1, 1]);

    const read = await rows(hub);
    const value = (id: string, session: string) => sessionRow(read, id, session)?.value;
    // The base's readings of these events (README, The frozen readings).
    expect(value('spend.usd', 'Sa'), `Sa's spend is its last running total, 12.5: ${show(sessionRow(read, 'spend.usd', 'Sa'))}`).toBeCloseTo(12.5, 9);
    expect(value('tokens.session', 'Sa'), 'Sa\'s tokens: 2,000,020 + 20,000 + 900').toBe(2_020_920);
    expect(value('spend.usd', 'Sb'), 'Sb\'s spend, reported').toBeCloseTo(0.25, 9);
    expect(value('tokens.session', 'Sb'), 'Sb\'s tokens: 100 + 50').toBe(150);
    expect(value('spend.usd', 'Sc'), 'Sc\'s spend is unpriced, never 0').toBeNull();
    expect(value('tokens.session', 'Sc'), 'Sc\'s tokens: 10 + 5').toBe(15);
    expect(sessionRow(read, 'spend.usd', 'Sa')?.cost?.basis, 'Sa\'s spend is an estimate').toBe('estimated');
    expect(sessionRow(read, 'spend.usd', 'Sa')?.cost?.rate_card, 'from the card its events name').toBe(CARD);
    expect(sessionRow(read, 'spend.usd', 'Sb')?.cost?.basis, 'Sb\'s spend is reported').toBe('reported');
    const turns = (subject: string) => read.find((r) => r.id === 'cost.turn' && r.subject === subject)?.value;
    expect(turns(a1.id), 'Sa\'s first turn cost 7').toBeCloseTo(7, 9);
    expect(turns(a2.id), 'Sa\'s second turn cost the growth, 12.5 - 7').toBeCloseTo(5.5, 9);
    expect(turns(b1.id), 'Sb\'s turn').toBeCloseTo(0.25, 9);
    expect(read.filter((r) => saysAtLeast(r)).map(show), 'nothing written before reads "at least"').toEqual([]);

    const text = await numbersText(home);
    const line = sessionLine(text, 'spend.usd', 'Sa');
    expect(line, `deep numbers has Sa's spend.usd line: ${text.slice(0, 2000)}`).toMatch(/\b12\.5\b/);
    expect(sessionLine(text, 'tokens.session', 'Sa'), 'and its tokens line').toMatch(/\b2020920\b/);
    expect(text.split('\n').filter((l) => /at[ _-]?least/i.test(l)), 'no deep numbers line says "at least"').toEqual([]);
  } finally {
    if (hub) await stopHub(hub);
  }
}, TIMEOUT);
