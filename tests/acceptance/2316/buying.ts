// The buying world for #2316.b2850c01: #69's buying world (a real record on SQLite, the evidence store, the asks
// core, the #86 ledger and @deepbuild/buying over them, with a payment processor the test holds), its record seen
// through a spy that passes every call to the real store and writes down what each `read` asked for and the kinds
// of the rows it handed back. The spy changes nothing it passes on; the criterion names `record.read` and its
// `kinds`, so what was asked of it is what is observed.

import { ulid, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openBuyingWorld, type BuyingWorld } from '../69/buying.ts';
import { agent, card, CARD_REF, ENDS, purchaseId } from '../69/helpers.ts';

export { agent, card, CARD_REF, ENDS, purchaseId };

/** One `record.read` call: what it asked for, and the kind and log position of each row it handed back. */
export interface Read { after: number; limit: number | undefined; kinds: readonly string[] | undefined; rows: { kind: string; log_pos: number }[] }
export interface SpiedWorld extends BuyingWorld {
  /** Every read made through the record the buying module, the ledger and the asks core were handed, in order. */
  reads: Read[];
  /** The real record, unwatched, for the test's own appends and reads. */
  real: RecordStore;
  /** The record's head: its highest log position. */
  head(): Promise<number>;
  /** The reads made while `run` ran, and its result. */
  during<T>(run: () => Promise<T>): Promise<{ value: T; reads: Read[] }>;
}

export async function openSpiedWorld(): Promise<SpiedWorld> {
  const reads: Read[] = [];
  let real: RecordStore | undefined;
  const w = (await openBuyingWorld({
    record: (record) => {
      real = record;
      return new Proxy(record, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === 'read' && typeof value === 'function') {
            return async (query: { after: number; limit?: number; kinds?: readonly string[]; most?: boolean }) => {
              const page = (await (value as RecordStore['read']).call(target, query)) as Event[];
              reads.push({ after: query.after, limit: query.limit, kinds: query.kinds ? [...query.kinds] : undefined, rows: page.map((e) => ({ kind: e.kind, log_pos: e.log_pos })) });
              return page;
            };
          }
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    },
  })) as SpiedWorld;
  if (!real) throw Error('BLOCKED: the #69 world did not hand its record to the spy');
  const store = real;
  w.reads = reads;
  w.real = store;
  w.head = async () => {
    const [row] = (await store.raw('SELECT coalesce(max(log_pos), 0) AS head FROM events')) as { head: number | bigint }[];
    return Number(row!.head);
  };
  w.during = async (run) => {
    const from = reads.length;
    const value = await run();
    return { value, reads: reads.slice(from) };
  };
  return w;
}

/** The kinds of hook events a session's tool calls leave in the log: none of them is `card_rule.set`. */
export const FILLER = ['tool.before', 'tool.after'] as const;
/**
 * `count` events of a coding session's tool calls, as deep-hook appends them (a `tool.before` and a `tool.after`
 * for each call), written straight to the real record. The log position of the last one.
 */
export async function fill(w: SpiedWorld, count: number, session = 'S2'): Promise<number> {
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  let last = 0;
  for (let i = 0; i < count; i += 2) {
    const t = w.clock.now();
    const call = `call${session}${t}x${i}`;
    const data = { kind: 'read', paths: [`/tmp/deep-2316-work/src/file${i % 97}.ts`], command: null, call };
    last = (await w.real.append(hook, { v: 3, id: ulid(t), kind: 'tool.before', ts: t, data })).log_pos;
    if (i + 1 < count) last = (await w.real.append(hook, { v: 3, id: ulid(t + 1), kind: 'tool.after', ts: t + 1, data: { ...data, outcome: 'ok' } })).log_pos;
  }
  return last;
}
/** The events of these kinds in the log after a log position, counted by the real store. */
export async function countAfter(w: SpiedWorld, after: number, kinds: readonly string[]): Promise<number> {
  const [row] = (await w.real.raw('SELECT count(*) AS n FROM events WHERE log_pos > ? AND kind IN (SELECT value FROM json_each(?))', [after, JSON.stringify(kinds)])) as { n: number | bigint }[];
  return Number(row!.n);
}
