// The source@1 kit (#314): a stream source reads a stream page by page from a cursor, in order, within the
// page limit, and loses nothing when it resumes from a cursor after a restart. The reference fill reads an
// in-memory stream; the planted fills skip the first event after a resume, reverse a page, and overrun the limit.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail, Finding } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { canonical, list, object, same, word } from './shared.js';

export const SOURCE = 'source@1';

export interface StreamEvent { seq: number; kind: string; data: string }
export interface Stream { events: StreamEvent[] }
export interface Page { events: StreamEvent[]; cursor: string | null }
export interface SourceFill extends SlotFill {
  slot: 'source@1';
  /** The next page after `cursor` (null for the start), at most `limit` events, and the cursor after it. */
  read(stream: Stream, cursor: string | null, limit: number): Page;
  /** Forgets any state, as a restart of the hub would. */
  restart(): void;
}
interface Input { events: StreamEvent[]; limit: number }
interface Expected { first: StreamEvent[]; second: StreamEvent[] }

const RULES = {
  order: { id: 'in-order', rule: 'A page holds the stream\'s next events after the cursor, in stream order, each once.', message: 'returned a page other than the stream\'s next events in order' },
  limit: { id: 'page-limit', rule: 'A page holds at most the limit asked.', message: 'returned more events than the page limit' },
  resume: { id: 'resume-loses-nothing', rule: 'A read from a cursor after a restart gives every event after it, none lost.', message: 'lost events after a restart from a cursor' },
  cursor: { id: 'reads-at-cursor', rule: 'A read gives the page after the cursor given, whatever was read before it: the cursor says where the stream continues, not the order of the calls.', message: 'read by the order of the calls instead of the cursor' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const KINDS = ['note', 'edit', 'run', 'ask'];

/** The `by-call-order` fault takes the cursor only on its first read after a restart, then just reads on. */
function reference(fault: 'none' | 'skips-after-resume' | 'reversed' | 'over-limit' | 'by-call-order' = 'none', variant = 'memory'): SourceFill {
  let fresh = true;
  let position = 0;
  return {
    slot: SOURCE, revision: 1, variant,
    read(stream, cursor, limit) {
      let start = cursor === null ? 0 : Number(cursor);
      if (fault === 'skips-after-resume' && fresh && cursor !== null) start += 1;
      if (fault === 'by-call-order' && !fresh) start = position;
      fresh = false;
      const take = fault === 'over-limit' ? limit + 1 : limit;
      const events = stream.events.slice(start, start + take);
      position = start + events.length;
      return { events: fault === 'reversed' ? [...events].reverse() : events, cursor: String(position) };
    },
    restart() { fresh = true; },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: SourceFill): PlantedFill<SourceFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<SourceFill>[] => [
  plant('skips-first-after-resume', 'resume', ['event_lost'], reference('skips-after-resume')),
  plant('out-of-order', 'order', ['out_of_order'], reference('reversed')),
  plant('over-limit', 'limit', ['page_overrun'], reference('over-limit')),
  plant('ignores-cursor', 'cursor', ['cursor_ignored'], reference('by-call-order')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => {
  const expected: Expected = { first: input.events.slice(0, input.limit), second: input.events.slice(input.limit, 2 * input.limit) };
  return { id, part, input: input as unknown as JsonValue, expected: expected as unknown as JsonValue };
};
const events = (data: string[], kinds = KINDS): StreamEvent[] => data.map((d, i) => ({ seq: i + 1, kind: kinds[i % kinds.length]!, data: d }));
const fixtures: Fixture[] = [
  toCase('five-by-two', 'fixed', { events: events(['opened the cart', 'added a line', 'ran the checks', 'asked about tax', 'closed the cart']), limit: 2 }),
  toCase('seven-by-three', 'fixed', { events: events(['a', 'b', 'c', 'd', 'e', 'f', 'g']), limit: 3 }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three streams from the draw, each at least two pages long. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) => {
  const limit = random.int(2, 3);
  const count = random.int(2 * limit, 2 * limit + 4);
  return toCase(`seeded-${i + 1}`, 'seeded', { events: events(Array.from({ length: count }, () => word(random, 7))), limit });
});

function holdPage(answer: unknown, limit: number): Page {
  const o = object('the page', answer);
  const page = list('page/events', o.events).map((e, i) => object(`page/events/${i}`, e) as unknown as StreamEvent);
  if (o.cursor !== null && typeof o.cursor !== 'string') throw new Finding('FAIL', 'page/cursor is neither a cursor nor null', ['type']);
  if (page.length > limit) throw fail(RULES.limit.message, ['page_overrun'], `${page.length} events for a limit of ${limit}`);
  return { events: page, cursor: o.cursor as string | null };
}

function* judge(fill: SourceFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { events: all, limit } = c.input as unknown as Input;
  const expected = c.expected as unknown as Expected;
  const stream: Stream = { events: all };
  yield () => fill.restart();
  const first = holdPage(yield () => fill.read(stream, null, limit), limit);
  if (!same(first.events, expected.first)) throw fail(RULES.order.message, ['out_of_order'], `the first page is ${canonical(first.events)}; the stream starts ${canonical(expected.first)}`);
  const second = holdPage(yield () => fill.read(stream, first.cursor, limit), limit);
  if (!same(second.events, expected.second)) throw fail(RULES.order.message, ['out_of_order'], `the page after ${first.cursor} is ${canonical(second.events)}; the stream continues ${canonical(expected.second)}`);
  yield () => fill.restart();
  const resumed = holdPage(yield () => fill.read(stream, first.cursor, limit), limit);
  if (!same(resumed.events, expected.second)) throw fail(RULES.resume.message, ['event_lost'], `after a restart, the page from ${first.cursor} is ${canonical(resumed.events)}; before it was ${canonical(expected.second)}`);
  // Out of call order: the start again with no restart, then the page after the second; a fill reading on from
  // where its last call left off, cursor unread, gives the third page twice.
  const again = holdPage(yield () => fill.read(stream, null, limit), limit);
  if (!same(again.events, expected.first)) throw fail(RULES.cursor.message, ['cursor_ignored'], `a read from the start after two pages is ${canonical(again.events)}; the stream starts ${canonical(expected.first)}`);
  const third = holdPage(yield () => fill.read(stream, second.cursor, limit), limit);
  const expectedThird = all.slice(2 * limit, 3 * limit);
  if (!same(third.events, expectedThird)) throw fail(RULES.cursor.message, ['cursor_ignored'], `the page after ${second.cursor} is ${canonical(third.events)}; the stream continues ${canonical(expectedThird)}`);
}

export const sourceKit = (): SlotKitImpl<SourceFill> => ({
  slot: SOURCE, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
