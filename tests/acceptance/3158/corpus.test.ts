// #3158 AC2 and AC6: the corpus's recorded sessions (adapters/corpus), counted by the real counter through the public
// entries of @deepbuild/readings (`countUsage`) and @deepbuild/adapters (`shipped().get(<agent>).readUsage`).
//
// AC2 prices each recorded Claude Code session by the split its records give, against this file's own count of the
// transcript (once per message ID, the split under `cache_creation`) and, for two sessions, against a hand count
// (README, The two hand counts). AC6 holds every recorded session's token totals to what the merge base counted,
// kept in base-totals.json (README, The base's totals).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import { countUsage } from '../../../packages/readings/src/index.ts';

const CORPUS = fileURLToPath(new URL('../../../adapters/corpus/', import.meta.url));
const BASE = JSON.parse(readFileSync(new URL('./base-totals.json', import.meta.url), 'utf8')) as {
  readings: Record<string, Record<string, number>>;
  adapters: Record<string, number[][]>;
};
/** The recorded sessions of one agent, as `<version>/<scenario>`. */
const sessions = (agent: string): string[] => readdirSync(join(CORPUS, agent)).sort().flatMap((version) => readdirSync(join(CORPUS, agent, version)).sort().map((scenario) => `${version}/${scenario}`));
const transcriptOf = (agent: string, session: string): string => join(CORPUS, agent, session, 'transcript.jsonl');
type Loose = Record<string, unknown>;

/**
 * USD per million tokens of input, output and cache read for the corpus's three models, as the shipped rate card lists
 * them at the merge base. A five-minute write is 1.25 times the input price and a one-hour write 2 times, as the issue
 * reads Anthropic's prompt caching page.
 */
const LISTED: Record<string, { input: number; output: number; read: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, read: 0.1 },
};
/** This file's own count of a transcript's records, priced by their split; undefined when it holds no priced record. */
function bySplit(path: string): number | undefined {
  const seen = new Set<string>();
  let perMillion: number | undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const { type, message } = JSON.parse(line) as { type?: string; message?: { id: string; model: string; usage: Record<string, number> & { cache_creation: Record<string, number> } } };
    // An API error's entry carries zeros, not usage; a message's usage repeats on each of its lines.
    if (type !== 'assistant' || !message || message.model === '<synthetic>' || seen.has(message.id)) continue;
    seen.add(message.id);
    const price = LISTED[message.model]!;
    const u = message.usage;
    perMillion = (perMillion ?? 0) + u.input_tokens! * price.input + u.output_tokens! * price.output + u.cache_read_input_tokens! * price.read
      + u.cache_creation.ephemeral_5m_input_tokens! * 1.25 * price.input + u.cache_creation.ephemeral_1h_input_tokens! * 2 * price.input;
  }
  return perMillion === undefined ? undefined : perMillion / 1e6;
}

it('#3158.ee4a9451 AC2 every recorded Claude Code session with usage is priced by the split its records give', () => {
  let priced = 0;
  for (const session of sessions('claude-code')) {
    const expected = bySplit(transcriptOf('claude-code', session));
    // Three sessions hold only an API error's entry: no usage, so nothing to price.
    if (expected === undefined) continue;
    priced++;
    const cost = countUsage([transcriptOf('claude-code', session)]).cost as unknown as Loose;
    expect(cost.basis, `${session}: its model is on the shipped rate card`).toBe('estimated');
    expect(cost.usd, `${session}: its records priced by their split, a one-hour write at twice the input price and a five-minute write at 1.25 times, come to ${expected}`).toBeCloseTo(expected, 9);
  }
  expect(priced, 'the corpus holds 30 Claude Code sessions with usage').toBe(30);
});

it('#3158.ee4a9451 AC2 2.1.299/desktop-resume costs 0.3865388 by a hand count of its three records', () => {
  // 6 input x 4 + 436 output x 20 + 42,466 one-hour writes x 8 + 190,334 cache reads x 0.2 = 386,538.8 per million.
  const cost = countUsage([transcriptOf('claude-code', '2.1.299/desktop-resume')]).cost as unknown as Loose;
  expect(cost.usd, 'its 42,466 write tokens are all one-hour writes, 8 a million on claude-opus-5-5; at the five-minute 5 the session reads 0.2591408').toBeCloseTo(0.3865388, 9);
});

it('#3158.ee4a9451 AC2 2.1.308/permission-answered costs 0.00225578 by a hand count of its two records', () => {
  // 4 input x 0.1 + 155 output x 0.5 + 7,843 one-hour writes x 0.2 + 60,928 cache reads x 0.01 = 2,255.78 per million.
  const cost = countUsage([transcriptOf('claude-code', '2.1.308/permission-answered')]).cost as unknown as Loose;
  expect(cost.usd, 'its 7,843 write tokens are all one-hour writes, 0.2 a million on claude-haiku-5-5; at the five-minute 0.125 the session reads 0.001667555').toBeCloseTo(0.00225578, 9);
});

/** A count's cache writes, whole: `cache_write` if the count still has it, else its parts, whatever they are named. */
function writes(totals: Loose): number {
  const sum = (values: unknown[]): number => values.reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
  if (typeof totals.cache_write === 'number') return totals.cache_write;
  if (typeof totals.cache_write === 'object' && totals.cache_write !== null) return sum(Object.values(totals.cache_write));
  return sum(Object.entries(totals).filter(([key]) => key.startsWith('cache_write')).map(([, v]) => v));
}

it('#3158.e3a2e90a AC6 every recorded Claude Code session counts the input, output, cache-write and cache-read tokens it counted on the merge base', () => {
  const recorded = sessions('claude-code');
  expect(recorded, 'the sessions the merge base counted').toEqual(Object.keys(BASE.readings));
  for (const session of recorded) {
    const totals = countUsage([transcriptOf('claude-code', session)]).totals as unknown as Loose;
    const base = BASE.readings[session]!;
    expect({ input: totals.input, output: totals.output, cache_write: writes(totals), cache_read: totals.cache_read, unknown_turns: totals.unknown_turns }, `${session}: its token totals, the cache writes whole`)
      .toEqual(base);
  }
});

it('#3158.e3a2e90a AC6 every recorded Claude Code and Codex session reads the tokens its adapter read on the merge base, input taking in cache writes whole', () => {
  const adapters = shipped();
  const recorded = [...sessions('claude-code').map((s) => ['claude-code', 'claude', s] as const), ...sessions('codex').map((s) => ['codex', 'codex', s] as const)];
  expect(recorded.map(([agent, , session]) => `${agent}/${session}`), 'the sessions the merge base read').toEqual(Object.keys(BASE.adapters));
  for (const [agent, adapter, session] of recorded) {
    const lines = readFileSync(transcriptOf(agent, session), 'utf8').split('\n').flatMap((line) => { try { return [JSON.parse(line) as never]; } catch { return []; } });
    const read = adapters.get(adapter).readUsage!(lines).map((r) => [r.tokens.input, r.tokens.cached, r.tokens.output]);
    expect(read, `${agent}/${session}: each reading's input, cached and output tokens`).toEqual(BASE.adapters[`${agent}/${session}`]);
  }
});
