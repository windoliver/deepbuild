import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import type { TurnUsage } from '../../../packages/adapters/src/index.ts';
import { fixtures, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { BASES, deleteAt, eventFixture, expectAccepted, expectRefused, fixtureLines, getAt, isObject, kindSchema, setAt } from './helpers.ts';

const USAGE = () => kindSchema('turn.usage');
const base = (): JsonValue => eventFixture('turn.usage');
const withCost = (cost: JsonValue): JsonValue => setAt(base(), '/data/cost', cost);
/** A usage the adapter read, placed as the data of a turn.usage event, so the published schema judges it. */
const asEvent = (usage: TurnUsage): JsonValue => setAt(base(), '/data', usage as unknown as JsonValue);

describe('AC4 a cost without its basis fails its schema, and an unpriced cost is never stored as zero', () => {
  it('AC4 the three bases pass: reported with its amount, estimated with its amount and rate card, unpriced with neither', () => {
    expectAccepted(validate(USAGE(), withCost({ basis: 'reported', usd: 0.0421 })), 'a reported cost');
    expectAccepted(validate(USAGE(), withCost({ basis: 'reported', usd: 0 })), 'a reported cost of exactly zero, which a free tier can report');
    expectAccepted(validate(USAGE(), withCost({ basis: 'estimated', usd: 0.0421, rate_card: 'anthropic-2026-10' })), 'an estimated cost');
    expectAccepted(validate(USAGE(), withCost({ basis: 'unpriced' })), 'an unpriced cost');
    expect(BASES).toEqual(['reported', 'estimated', 'unpriced']);
  });

  it('AC4 a cost without its basis fails, naming /data/cost/basis', () => {
    // A schema with cost as a bare number, or with basis optional, accepts these and fails here.
    expectRefused(validate(USAGE(), withCost({ usd: 0.0421 })), '/data/cost/basis', 'a cost with no basis');
    expectRefused(validate(USAGE(), withCost({ usd: 0.0421, rate_card: 'anthropic-2026-10' })), '/data/cost/basis', 'a cost with a rate card but no basis');
    expectRefused(validate(USAGE(), withCost({ basis: 'guessed', usd: 0.1 })), '/data/cost/basis', 'a cost with an unlisted basis');
    expectRefused(validate(USAGE(), withCost(0.0421)), '/data/cost', 'a cost as a bare number');
    expectRefused(validate(USAGE(), deleteAt(base(), '/data/cost')), '/data/cost', 'a usage with no cost at all');
  });

  it('AC4 an unpriced cost carries no amount: zero, or any number, fails naming /data/cost/usd', () => {
    expectRefused(validate(USAGE(), withCost({ basis: 'unpriced', usd: 0 })), '/data/cost/usd', 'unpriced stored as $0');
    expectRefused(validate(USAGE(), withCost({ basis: 'unpriced', usd: 0.5 })), '/data/cost/usd', 'unpriced with an amount');
    expectRefused(validate(USAGE(), withCost({ basis: 'unpriced', rate_card: 'any' })), '/data/cost/rate_card', 'unpriced with a rate card');
  });

  it('AC4 a reported cost needs its amount, and an estimate needs its amount and the rate card it came from', () => {
    expectRefused(validate(USAGE(), withCost({ basis: 'reported' })), '/data/cost/usd', 'reported with no amount');
    expectRefused(validate(USAGE(), withCost({ basis: 'reported', usd: -0.01 })), '/data/cost/usd', 'a negative amount');
    expectRefused(validate(USAGE(), withCost({ basis: 'estimated', usd: 0.1 })), '/data/cost/rate_card', 'estimated with no rate card');
    expectRefused(validate(USAGE(), withCost({ basis: 'estimated', usd: 0.1, rate_card: '' })), '/data/cost/rate_card', 'estimated with an empty rate card');
    expectRefused(validate(USAGE(), withCost({ basis: 'estimated', rate_card: 'anthropic-2026-10' })), '/data/cost/usd', 'estimated with no amount');
  });

  it('AC4 for every amount, an unpriced cost that carries it is refused, and a reported one that carries it passes (1,000 cases)', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }), (usd) => {
      expectRefused(validate(USAGE(), withCost({ basis: 'unpriced', usd })), '/data/cost/usd', `unpriced with ${usd}`);
      expectAccepted(validate(USAGE(), withCost({ basis: 'reported', usd })), `reported ${usd}`);
    }), { numRuns: 1000 });
  });

  it('AC4 the Codex adapter reads a plan\'s usage as unpriced, with no amount, never as $0', () => {
    const codex = shipped().get('codex');
    expect(codex.readUsage, 'the Codex adapter reads usage').toBeDefined();
    const usages = codex.readUsage!(fixtureLines('transcripts', 'codex-rollout.jsonl'));
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expectAccepted(validate(USAGE(), asEvent(usage)), `a Codex usage reading ${JSON.stringify(usage)}`);
      // The facts say Codex on a plan reports tokens only; a reader that fills $0 fails here.
      expect(usage.cost.basis).toBe('unpriced');
      expect('usd' in usage.cost).toBe(false);
    }
  });
});

describe('usage says what it covers, counts input, cached and output tokens, and how full the context window is', () => {
  it('a usage is per turn or cumulative for the session, and nothing else', () => {
    expectAccepted(validate(USAGE(), setAt(base(), '/data/covers', 'turn')), 'covers turn');
    expectAccepted(validate(USAGE(), setAt(base(), '/data/covers', 'session')), 'covers session');
    expectRefused(validate(USAGE(), setAt(base(), '/data/covers', 'cumulative')), '/data/covers', 'covers cumulative');
    expectRefused(validate(USAGE(), deleteAt(base(), '/data/covers')), '/data/covers', 'no covers');
  });

  it('a count that was not captured is absent, never zero: missing tokens fail, and a context window of 0 fails', () => {
    for (const field of ['input', 'cached', 'output', 'exact']) {
      expectRefused(validate(USAGE(), deleteAt(base(), `/data/tokens/${field}`)), `/data/tokens/${field}`, `tokens without ${field}`);
    }
    expectRefused(validate(USAGE(), deleteAt(base(), '/data/tokens')), '/data/tokens', 'no tokens');
    expectRefused(validate(USAGE(), setAt(base(), '/data/tokens/input', -1)), '/data/tokens/input', 'negative tokens');
    expectRefused(validate(USAGE(), setAt(base(), '/data/tokens/input', 1.5)), '/data/tokens/input', 'fractional tokens');
    expectAccepted(validate(USAGE(), deleteAt(base(), '/data/context')), 'a usage whose context window was not captured');
    expectRefused(validate(USAGE(), setAt(base(), '/data/context', { used: 0, window: 0 })), '/data/context/window', 'a context window of 0');
    expectAccepted(validate(USAGE(), setAt(base(), '/data/context', { used: 17474, window: 258400 })), 'a context reading');
  });

  it('the Claude Code adapter counts a message\'s usage once per message id: input is input plus cache creation, cached is cache read', () => {
    const claude = shipped().get('claude');
    expect(claude.readUsage, 'the Claude Code adapter reads usage').toBeDefined();
    const usages = claude.readUsage!(fixtureLines('transcripts', 'claude-model-switch.jsonl')).filter((u) => u.covers === 'turn');
    // msg_0001 appears on two entries (two content blocks); a reader that sums per entry doubles it and fails here.
    expect(usages.map((u) => u.tokens)).toEqual([
      { input: 110, cached: 1000, output: 20, exact: true },
      { input: 55, cached: 2000, output: 7, exact: true },
    ]);
    expect(new Set(usages.map((u) => u.turn)).size).toBe(2);
    for (const usage of usages) expectAccepted(validate(USAGE(), asEvent(usage)), `a Claude usage reading ${JSON.stringify(usage)}`);
  });

  it('the Codex adapter reads the rollout\'s last token count for the session: cached tokens taken back out of input, with the context window', () => {
    const codex = shipped().get('codex');
    const session = codex.readUsage!(fixtureLines('transcripts', 'codex-rollout.jsonl')).filter((u) => u.covers === 'session');
    expect(session.length, 'one cumulative reading for the session').toBe(1);
    const [usage] = session;
    expect(usage!.tokens).toEqual({ input: 7472, cached: 27392, output: 166, exact: true });
    expect(usage!.context?.window).toBe(258400);
  });
});

describe('AC5 each turn records the model that actually answered, so a switch away from the model you chose shows', () => {
  it('AC5 a usage without its model, or with an empty one, fails naming /data/model', () => {
    expectRefused(validate(USAGE(), deleteAt(base(), '/data/model')), '/data/model', 'a usage with no model');
    expectRefused(validate(USAGE(), setAt(base(), '/data/model', '')), '/data/model', 'a usage with an empty model');
    expectRefused(validate(USAGE(), setAt(base(), '/data/model', null)), '/data/model', 'a usage with model null');
  });

  it('AC5 Claude Code: the second turn answered on claude-haiku-5-5 though claude-opus-5 was chosen, and the record says so', () => {
    const claude = shipped().get('claude');
    const usages = claude.readUsage!(fixtureLines('transcripts', 'claude-model-switch.jsonl')).filter((u) => u.covers === 'turn');
    // A reader that records requestedModel shows two opus turns and fails here.
    expect(usages.map((u) => u.model)).toEqual(['claude-opus-5', 'claude-haiku-5-5']);
  });

  it('AC5 Codex: each turn\'s reading names the model of its turn context, and the session reading the last one', () => {
    const codex = shipped().get('codex');
    const usages = codex.readUsage!(fixtureLines('transcripts', 'codex-rollout.jsonl'));
    const turns = usages.filter((u) => u.covers === 'turn');
    expect(turns.map((u) => u.model)).toEqual(['gpt-reserve', 'gpt-reserve-mini']);
    expect(turns.map((u) => u.tokens)).toEqual([
      { input: 7122, cached: 10240, output: 112, exact: true },
      { input: 350, cached: 17152, output: 54, exact: true },
    ]);
    const session = usages.find((u) => u.covers === 'session');
    expect(session?.model).toBe('gpt-reserve-mini');
  });

  it('AC5 the published usage fixtures each name a model and carry every field the shape needs', () => {
    const published = fixtures(USAGE());
    expect(published.length).toBeGreaterThan(0);
    for (const fixture of published) {
      expect(typeof getAt(fixture, '/data/model')).toBe('string');
      expect(isObject(getAt(fixture, '/data/cost'))).toBe(true);
      expectAccepted(validate(USAGE(), fixture), 'a published usage fixture');
    }
    for (const basis of BASES) {
      expect(published.some((f) => getAt(f, '/data/cost/basis') === basis), `a published fixture with cost basis ${basis}`).toBe(true);
    }
  });
});
