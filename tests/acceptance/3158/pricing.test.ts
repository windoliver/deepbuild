// #3158 AC1, AC3, AC4 and AC5: a session's cost prices each kind of cache write at its own rate. Transcripts are written
// as files, in Claude Code's shape, and counted by the real counter through the public entry of @deepbuild/readings:
// `countUsage` (a session's count) and `UsageTail` (a stop's count, which finds the subagents' files itself).
//
// Every message is on claude-opus-4-5, whose input price on the shipped rate card is 5 USD per million tokens, so a
// five-minute write is 6.25 (1.25 x 5) and a one-hour write 10.00 (2 x 5) per million. A message carries no other
// tokens, so a cost is its cache writes' alone.
//
// Wrong programs each test fails (README, Wrong programs): the merge base, which prices every write at 6.25; a count
// that prices a total with no split as one-hour writes, or as nothing; one that prices a row by the one write price
// it has.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { countUsage, UsageTail } from '../../../packages/readings/src/index.ts';

const MODEL = 'claude-opus-4-5';
const MILLION = 1_000_000;
const dir = mkdtempSync(join(tmpdir(), 'deep-3158-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let made = 0;
/**
 * One assistant line whose message wrote these cache tokens: the total in `cache_creation_input_tokens` and the split
 * under `cache_creation`, as Claude Code 2.1.299 and later write both; `total` alone is a record with no split.
 */
function wrote(w: { oneHour?: number; fiveMinute?: number } | { total: number }, sidechain = false): string {
  const n = ++made;
  const usage = 'total' in w
    ? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: w.total }
    : {
        input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: (w.oneHour ?? 0) + (w.fiveMinute ?? 0),
        cache_creation: { ephemeral_1h_input_tokens: w.oneHour ?? 0, ephemeral_5m_input_tokens: w.fiveMinute ?? 0 },
      };
  return JSON.stringify({ type: 'assistant', uuid: `a-${n}`, isSidechain: sidechain, message: { id: `msg_3158_${n}`, type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'done' }], usage } });
}
/** A transcript file: one typed prompt, then the lines given. */
function transcript(name: string, lines: string[]): string {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  const prompt = JSON.stringify({ type: 'user', uuid: `u-${++made}`, message: { role: 'user', content: 'go' } });
  writeFileSync(path, [prompt, ...lines].join('\n') + '\n');
  return path;
}

type Loose = Record<string, unknown>;
/** A cost's dollars; undefined when it has none. */
const usd = (cost: unknown): number | undefined => (cost as Loose).usd as number | undefined;
const AT_LEAST = /at[ _-]?least/i;
/** Whether a cost reads "at least": a field named so and set true, or a text in it that says so. */
function saysAtLeast(value: unknown, key = ''): boolean {
  if (typeof value === 'string') return AT_LEAST.test(value);
  if (value === true) return AT_LEAST.test(key);
  if (typeof value === 'object' && value !== null) return Object.entries(value).some(([k, v]) => saysAtLeast(v, k));
  return false;
}

it('#3158.80f74d2a AC1 a transcript whose one message wrote 1,000,000 one-hour and 1,000,000 five-minute tokens at input price 5 costs 10.00 for the first and 6.25 for the second', () => {
  const both = countUsage([transcript('ac1-both.jsonl', [wrote({ oneHour: MILLION, fiveMinute: MILLION })])]).cost;
  // The same message without one of its two parts: what is left of the cost is the other part's.
  const fiveMinuteAlone = countUsage([transcript('ac1-five-minute.jsonl', [wrote({ fiveMinute: MILLION })])]).cost;
  const oneHourAlone = countUsage([transcript('ac1-one-hour.jsonl', [wrote({ oneHour: MILLION })])]).cost;
  expect((both as Loose).basis, 'claude-opus-4-5 is on the shipped rate card, so the cost is an estimate').toBe('estimated');

  expect(usd(both)! - usd(fiveMinuteAlone)!, 'the 1,000,000 one-hour write tokens cost 10.00, twice the input price of 5; the merge base prices them at the five-minute 6.25')
    .toBeCloseTo(10, 6);
  expect(usd(both)! - usd(oneHourAlone)!, 'the 1,000,000 five-minute write tokens cost 6.25, 1.25 times the input price of 5')
    .toBeCloseTo(6.25, 6);
  expect(usd(both), 'the message costs 10.00 + 6.25; the merge base says 6.25 + 6.25').toBeCloseTo(16.25, 6);
});

it('#3158.969013e8 AC3 a record with a write total and no split is priced at the five-minute rate, and its session\'s cost reads "at least"', () => {
  const { cost } = countUsage([transcript('ac3-no-split.jsonl', [wrote({ total: MILLION })])]);
  expect(usd(cost), '1,000,000 write tokens with no split cost 6.25, the five-minute rate: not 10.00 as one-hour writes, and not 0 as nothing')
    .toBeCloseTo(6.25, 6);
  expect(saysAtLeast(cost), `a one-hour write can only cost more, so the cost reads "at least"; it reads ${JSON.stringify(cost)}`).toBe(true);
  // A session whose every record gives its split has nothing left out to cost more.
  const split = countUsage([transcript('ac3-split.jsonl', [wrote({ fiveMinute: MILLION })])]).cost;
  expect(saysAtLeast(split), `every record of this session gives its split, so its cost doesn't read "at least"; it reads ${JSON.stringify(split)}`).toBe(false);
});

it('#3158.3dd67f02 AC4 a session with a subagent\'s file beside its transcript prices the subagent\'s five-minute writes and its own one-hour writes each at its rate, in one total', async () => {
  // The session wrote 300,000 one-hour tokens; its subagent, in <transcript without .jsonl>/subagents/, 800,000 five-minute ones.
  const session = transcript('ac4/session.jsonl', [wrote({ oneHour: 300_000 })]);
  transcript('ac4/session/subagents/agent-a1.jsonl', [wrote({ fiveMinute: 800_000 }, true)]);
  const { cost } = await new UsageTail().read(session);
  expect(usd(cost), 'one total: 300,000 one-hour tokens at 10.00 a million and 800,000 five-minute tokens at 6.25 a million, 3.00 + 5.00. All at the five-minute rate is 6.875, all at the one-hour rate 11.00, the two rates swapped 9.875, the session alone 3.00')
    .toBeCloseTo(8, 6);
});

it('#3158.fad2fa05 AC5 a model whose row holds one write price and not the other reads unpriced, never priced by the one it has', () => {
  const paths = [transcript('ac5.jsonl', [wrote({ oneHour: MILLION, fiveMinute: MILLION })])];
  // `cache_write` is the five-minute price, as it is at the merge base; `cache_write_1h` is the one-hour price (README, Surfaces).
  const row = { input: 5, output: 25, cache_read: 0.5 };
  const priced = (prices: Loose): Loose => countUsage(paths, { rateCard: { name: 'acceptance-3158', models: { [MODEL]: { ...row, ...prices } } } as never }).cost as unknown as Loose;

  const fiveMinuteOnly = priced({ cache_write: 6.25 });
  expect(fiveMinuteOnly.basis, `a row with the five-minute price alone reads unpriced, never its one-hour writes at 6.25; it reads ${JSON.stringify(fiveMinuteOnly)}`).toBe('unpriced');
  expect(fiveMinuteOnly.usd, 'an unpriced cost has no amount').toBeUndefined();

  const oneHourOnly = priced({ cache_write_1h: 10 });
  expect(oneHourOnly.basis, `a row with the one-hour price alone reads unpriced, never its five-minute writes at 10.00; it reads ${JSON.stringify(oneHourOnly)}`).toBe('unpriced');
  expect(oneHourOnly.usd, 'an unpriced cost has no amount').toBeUndefined();

  // The same row with both prices is priced, so the two above are unpriced for the price they lack.
  const whole = priced({ cache_write: 6.25, cache_write_1h: 10 });
  expect(whole.basis, `a row with both write prices is priced; it reads ${JSON.stringify(whole)}`).toBe('estimated');
  expect(whole.usd, 'the row with both prices: 10.00 + 6.25').toBeCloseTo(16.25, 6);
});
