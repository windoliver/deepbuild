// The reading.source@1 kit (#314): deep.registerSource's polled and MCP shapes fill the slot, many at once.
// A reading is upstream's own, with the as-of time upstream gave it, never the time it was read or served
// from a cache; an MCP source calls its tool only while the tool's schema digest is the one it was built
// against. The kit stands in for upstream (a poll, and an MCP tool with describe and call) and the clock.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, text, word } from './shared.js';

export const READING_SOURCE = 'reading.source@1';

export interface Reading { value: number; unit: string; as_of: number }
/** What the hub gives a source to read from: a poll, or an MCP tool described by its schema digest. */
export interface Upstream { poll(): Reading; describe(): { tool: string; schema_digest: string }; call(): Reading }
export interface ReadRequest { name: string; unit: string; digest: string; upstream: Upstream; clock: { now(): number } }
export type Answer = { name: string; value: number; unit: string; as_of: number; source: string } | { refused: 'schema_digest_changed'; expected: string; actual: string };
export interface ReadingSourceFill extends SlotFill {
  slot: 'reading.source@1';
  variant: 'polled' | 'mcp';
  read(request: ReadRequest): Answer;
}
interface Input { name: string; unit: string; digest: string; described: string; tool: string; readings: [Reading, Reading]; clock: [number, number] }

const RULES = {
  asOf: { id: 'as-of-is-own', rule: 'A reading\'s as_of is the time upstream gave the reading, never the time it was read or served from a cache.', message: 'carries an as-of time other than the reading\'s own' },
  digest: { id: 'digest-checked', rule: 'An MCP source calls its tool only while the tool\'s schema digest is the one the source was built against; a changed digest is refused.', message: 'called its tool after its schema digest changed' },
  faithful: { id: 'reading-faithful', rule: 'A reading carries the request\'s name and unit and upstream\'s value, and names its source.', message: 'answered a reading other than upstream\'s under the request\'s name and unit' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const DIGEST_A = `d1:${'a1'.repeat(32)}`;
const DIGEST_B = `d1:${'b2'.repeat(32)}`;

function polled(fault: 'none' | 'cache-as-of' | 'unit-dropped' = 'none'): ReadingSourceFill {
  const cache = new Map<string, Reading>();
  return {
    slot: READING_SOURCE, revision: 1, variant: 'polled',
    read(request) {
      const cached = fault === 'cache-as-of' ? cache.get(request.name) : undefined;
      if (cached) return { name: request.name, value: cached.value, unit: cached.unit, as_of: request.clock.now(), source: 'polled' };
      const r = request.upstream.poll();
      cache.set(request.name, r);
      return { name: request.name, value: r.value, unit: fault === 'unit-dropped' ? '' : r.unit, as_of: r.as_of, source: 'polled' };
    },
  };
}
function mcp(fault: 'none' | 'stale-digest' = 'none'): ReadingSourceFill {
  return {
    slot: READING_SOURCE, revision: 1, variant: 'mcp',
    read(request) {
      const tool = request.upstream.describe();
      if (fault !== 'stale-digest' && tool.schema_digest !== request.digest) return { refused: 'schema_digest_changed', expected: request.digest, actual: tool.schema_digest };
      const r = request.upstream.call();
      return { name: request.name, value: r.value, unit: r.unit, as_of: r.as_of, source: `mcp:${tool.tool}` };
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: ReadingSourceFill): PlantedFill<ReadingSourceFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<ReadingSourceFill>[] => [
  plant('cache-as-of', 'asOf', ['as_of_not_own'], polled('cache-as-of')),
  plant('stale-mcp-digest', 'digest', ['stale_digest_call'], mcp('stale-digest')),
  plant('unit-dropped', 'faithful', ['reading_unnamed'], polled('unit-dropped')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: { readings: input.readings as unknown as JsonValue, changed: input.described !== input.digest } });
const fixtures: Fixture[] = [
  toCase('stock-quote', 'fixed', { name: 'ext.stocks.quote', unit: 'USD', digest: DIGEST_A, described: DIGEST_A, tool: 'quote', readings: [{ value: 187.25, unit: 'USD', as_of: 1_760_000_000_000 }, { value: 188.1, unit: 'USD', as_of: 1_760_000_060_000 }], clock: [1_760_000_030_000, 1_760_000_090_000] }),
  toCase('digest-changed', 'fixed', { name: 'ext.weather.temp', unit: 'C', digest: DIGEST_A, described: DIGEST_B, tool: 'temperature', readings: [{ value: 21.5, unit: 'C', as_of: 1_760_000_100_000 }, { value: 21.75, unit: 'C', as_of: 1_760_000_160_000 }], clock: [1_760_000_130_000, 1_760_000_190_000] }),
  toCase('room-noise', 'fixed', { name: 'ext.room.noise', unit: 'dB', digest: DIGEST_B, described: DIGEST_B, tool: 'noise', readings: [{ value: 38, unit: 'dB', as_of: 1_760_000_200_000 }, { value: 41, unit: 'dB', as_of: 1_760_000_260_000 }], clock: [1_760_000_230_000, 1_760_000_290_000] }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three requests from the draw, the second with a changed digest; every time is the reading's own, the clock elsewhere. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) => {
  const base = 1_700_000_000_000 + random.int(0, 60_000_000) * 1000;
  const unit = random.pick(['USD', 'EUR', 'C', 'dB', 'kWh', 'ms']);
  const digest = `d1:${word(random, 8).repeat(8)}`;
  return toCase(`seeded-${i + 1}`, 'seeded', {
    name: `ext.${word(random, 5)}.${word(random, 6)}`, unit, digest, described: i === 1 ? `d1:${word(random, 8).repeat(8)}` : digest, tool: word(random, 6),
    readings: [{ value: random.int(1, 100_000) / 100, unit, as_of: base }, { value: random.int(1, 100_000) / 100, unit, as_of: base + 60_000 }],
    clock: [base + 30_000, base + 90_000],
  });
});

function hold(answer: unknown, request: { name: string; unit: string }, own: Reading): void {
  const o = object('the reading', answer);
  if ('refused' in o) throw fail(RULES.faithful.message, ['reading_mismatch'], `refused ${JSON.stringify(o.refused)} a reading upstream gave`);
  if (o.name !== request.name || o.unit !== request.unit) throw fail(RULES.faithful.message, ['reading_unnamed'], `named ${JSON.stringify(o.name)} in ${JSON.stringify(o.unit)}; the request is ${request.name} in ${request.unit}`);
  if (o.as_of !== own.as_of) throw fail(RULES.asOf.message, ['as_of_not_own'], `as_of ${JSON.stringify(o.as_of)}; upstream gave the reading at ${own.as_of}`);
  if (o.value !== own.value) throw fail(RULES.faithful.message, ['reading_mismatch'], `value ${JSON.stringify(o.value)}; upstream gave ${own.value}`);
  if (!text('reading/source', o.source)) throw fail(RULES.faithful.message, ['reading_unnamed'], 'names no source');
}

function* judge(fill: ReadingSourceFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const input = c.input as unknown as Input;
  let polls = 0;
  let calls = 0;
  let ticks = 0;
  const upstream: Upstream = {
    poll: () => input.readings[Math.min(polls++, 1)]!,
    describe: () => ({ tool: input.tool, schema_digest: input.described }),
    call: () => input.readings[Math.min(calls++, 1)]!,
  };
  const request: ReadRequest = { name: input.name, unit: input.unit, digest: input.digest, upstream, clock: { now: () => input.clock[Math.min(ticks++, 1)]! } };
  const first = yield () => fill.read(request);
  if (input.described !== input.digest) {
    // Whatever variant the fill declares, a call of the tool with its schema at another digest breaks the rule; a
    // fill that refuses names the changed digest, and one that polls instead is held to the poll's reading below.
    if (calls > 0) throw fail(RULES.digest.message, ['stale_digest_call'], `called ${input.tool} with its schema at ${input.described}, built against ${input.digest}`);
    const o = object('the answer', first);
    if ('refused' in o) {
      if (o.refused !== 'schema_digest_changed') throw fail(RULES.digest.message, ['stale_digest_call'], `answered ${JSON.stringify(o)} instead of refusing the changed digest`);
      return;
    }
  }
  hold(first, input, input.readings[0]);
  hold(yield () => fill.read(request), input, input.readings[1]);
}

export const readingSourceKit = (): SlotKitImpl<ReadingSourceFill> => ({
  slot: READING_SOURCE, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [polled(), mcp()], generate, judge,
});
