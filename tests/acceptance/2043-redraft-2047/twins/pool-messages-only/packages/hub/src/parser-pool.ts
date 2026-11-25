// The hub's parsers (#16, #2043): the pool of parser workers that parse and scrub each line the hub reads, and the
// parse-on-event-loop plant.
import { Worker } from 'node:worker_threads';
import { scopedAt } from './rules.js';
import { YOUNG } from './settle.js';
import type { Parsed, Plant } from './wire.js';

/** A line longer than this goes to the parser kept for large lines, so it never queues ahead of small ones. */
const BIG = 1 << 20;

/**
 * `scrub` adds values every hook line read from now on is scrubbed of (#332: credentials env-local loaded); `count` is
 * the parser workers the pool holds, for hub.health (#2043).
 */
export interface Parsers { parse(chunks: Buffer[], first: boolean): Promise<Parsed>; scrub(values: string[]): void; count(): number; close(): Promise<void> }

export function parserPool(given: readonly string[], plant: Plant | undefined, dir: string): Parsers {
  // The pool's own list: each scrub's values join it, so a parser started later begins with all its elder was sent.
  const held = [...given];
  // Each line a parser holds, until that parser answers it or ends.
  const pending = new Map<number, { resolve: (parsed: Parsed) => void; worker: Worker }>();
  let n = 0;
  const make = (): Worker => {
    const worker = new Worker(new URL('./parser.js', import.meta.url), { workerData: { held, dir, ...(plant ? { plant } : {}) }, resourceLimits: YOUNG });
    worker.on('message', ({ n: id, parsed }: { n: number; parsed: Parsed }) => {
      pending.get(id)?.resolve(parsed);
      pending.delete(id);
    });
    return worker;
  };
  // One parser for small lines, and one for large ones, started at the first: an idle hub holds one thread fewer.
  let small = make();
  let big: Worker | undefined;
  return {
    parse(chunks, first) {
      const size = chunks.reduce((sum, c) => sum + c.length, 0);
      const worker = size > BIG ? (big ??= make()) : small;
      return new Promise((resolve) => {
        pending.set(++n, { resolve, worker });
        // A line in a buffer of its own is handed to the parser's thread, not copied to it; a short one sits in Node's shared pool, which stays here.
        worker.postMessage({ n, chunks, first }, [...new Set(chunks.filter((c) => plant === 'hands-over-socket-chunk' || c.buffer.byteLength === c.byteLength).map((c) => c.buffer as ArrayBuffer))]);
      });
    },
    scrub(values) {
      held.push(...values);
      for (const worker of [small, big]) worker?.postMessage({ scrub: values });
    },
    count: () => (big ? 2 : 1),
    close: async () => {
      await Promise.all([small, big].map((w) => w?.terminate()));
    },
  };
}
/** The parse-on-event-loop plant: every line it reads scrubbed and parsed on the event loop. */
export async function parserInline(held: string[], plant: Plant, dir: string): Promise<Parsers> {
  const { parseLine } = await import('./hookmap.js');
  const { scrubText } = await import('@deepbuild/evidence');
  return {
    parse: async (chunks, first) => {
      const line = Buffer.concat(chunks);
      const parsed = parseLine(line, first, held, plant);
      // A hook line is scrubbed whole, as a hub that scrubs what it reads before keeping any field would.
      if (parsed.kind === 'hook') scrubText(line.toString('utf8'), { held });
      const scoped = parsed.kind === 'hook' ? scopedAt(parsed.meta, dir) : undefined;
      return scoped ? { ...parsed, scoped } : parsed;
    },
    scrub(values) { held.push(...values); },
    count: () => 0,
    close: async () => undefined,
  };
}
