// #45 AC5 and AC7: tokens counted by Claude Code's rules from the committed fixture, against a hand count (README, The
// fixture), and how every cost says what it is.
import { describe, expect, it } from 'vitest';
import { countUsage, readingsOf, recompute } from '../../../packages/readings/src/index.ts';
import { ask, FIXTURE, T0, usage } from './events.ts';

const MODEL = 'claude-sonnet-4-5-20250929';
const CARD = { name: 'fixture-card', models: { [MODEL]: { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 } } };

describe('AC5 the Claude Code fixture against a hand count', () => {
  it('#45.2a583af6 AC5 subagents, a resume and /compact give 635 input, 195 output, 1,160 cache write and 3,200 cache read: a repeated message once, a resume\'s replayed messages once', () => {
    const { totals } = countUsage(FIXTURE);
    expect(totals.input).toBe(635);
    expect(totals.output).toBe(195);
    expect(totals.cache_write).toBe(1160);
    expect(totals.cache_read).toBe(3200);
  });

  it('#45.2a583af6 AC5 the turn that crashed reads unknown, never zero, and says the totals leave it out; the turn before it reads its own usage', () => {
    const { turns, totals } = countUsage(FIXTURE);
    const crashed = turns.find((t) => t.turn === 'u-crash');
    expect(crashed, 'the crashed turn is listed').toBeDefined();
    expect(crashed?.usage, 'a crash in the middle of a turn: its usage is unknown').toBeNull();
    expect(totals.unknown_turns, 'the totals say one turn is unknown').toBe(1);
    expect(turns.find((t) => t.turn === 'u-resume')?.usage).toEqual({ input: 20, output: 30, cache_write: 100, cache_read: 1500 });
  });
});

describe('AC7 every cost says reported, estimated or unpriced', () => {
  it('#45.9177880c AC7 from the record: reported keeps its amount, estimated names its rate card, unpriced has no amount, never $0, and a session total over an unpriced turn says it is incomplete', () => {
    const readings = readingsOf(recompute([
      ask('S7', T0),
      usage('S7', T0 + 1, 'msg_r', { input: 1, output: 1 }, { basis: 'reported', usd: 0.05 }),
      usage('S7', T0 + 2, 'msg_e', { input: 1, output: 1 }, { basis: 'estimated', usd: 0.02, rate_card: 'card-2026-09' }),
      usage('S7', T0 + 3, 'msg_u', { input: 1, output: 1 }, { basis: 'unpriced' }),
    ]));
    const cost = (turn: string) => readings.find((r) => r.id === 'cost.turn' && r.subject === turn);
    expect(cost('msg_r')?.cost).toEqual({ basis: 'reported', usd: 0.05 });
    expect(cost('msg_e')?.cost).toEqual({ basis: 'estimated', usd: 0.02, rate_card: 'card-2026-09' });
    expect(cost('msg_u')?.cost).toEqual({ basis: 'unpriced' });
    expect(cost('msg_u')?.value, 'no amount at all').toBeNull();
    const spend = readings.find((r) => r.id === 'spend.usd' && r.subject === 'session:S7');
    expect(spend?.value).toBeCloseTo(0.07, 10);
    expect(spend?.complete, 'one of its turns has no price').toBe(false);
  });

  it('#45.9177880c AC7 from transcripts: a rate card that prices the model gives an estimate naming the card, $0.01014 by hand', () => {
    const { cost } = countUsage(FIXTURE, { rateCard: CARD });
    expect(cost.basis).toBe('estimated');
    if (cost.basis !== 'estimated') return;
    expect(cost.rate_card).toBe('fixture-card');
    // Per million: 635 x 3 + 195 x 15 + 1,160 x 3.75 + 3,200 x 0.30 = 10,140, so $0.01014.
    expect(cost.usd).toBeCloseTo(0.01014, 8);
  });

  it('#45.9177880c AC7 from transcripts: a rate card that doesn\'t price the model reads unpriced, with no amount', () => {
    const { cost } = countUsage(FIXTURE, { rateCard: { name: 'other-card', models: {} } });
    expect(cost).toEqual({ basis: 'unpriced' });
  });
});
