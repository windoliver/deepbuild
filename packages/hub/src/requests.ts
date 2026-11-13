// A write retried gets its first result (#1577; design: Reads and writes a slow link can afford). Every app or CLI
// write with an effect takes a request ID. Its receipt, write.done, commits in the same FULL commit as the write's own
// event, so a crash leaves both or neither: the same device, ID and params get the first result back and write
// nothing, the same ID with other params is refused naming the ID, and a write killed before its commit leaves nothing
// held, since the only mark that it is under way is a promise in this process's memory.
import { AsyncLocalStorage } from 'node:async_hooks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { EventInput } from '@deepbuild/record';
import { refusal, Refused, ulid } from './wire.js';

type Obj = Record<string, unknown>;
/** A request ID: 1 to 64 letters, digits, - or _, as session.note has always taken (#340). */
const REQUEST = /^[0-9A-Za-z_-]{1,64}$/;

/** The write's own event: the first it appends that this names, which its receipt commits with and its log_pos is. */
export type Effect = (input: EventInput) => boolean;
/** That event as the record holds it. */
export interface Landed { id: string; kind: string; subject: string | null; data: Obj; log_pos: number }
/** Who a write with a request ID comes from: the paired device that signed it, or its connection's role. */
export interface Caller { device: string; request: string }
/** A write's receipt, as the record holds it: the write's own event, or the result of a write that appended none. */
export interface Receipt { method: string; params: string; event?: Landed; result?: Obj; log_pos: number }

/** One write under way: its receipt's data, and once taken, the event it went with. */
interface Writing { effect: Effect; data: Obj | undefined; done: boolean; taken?: { id: string; log_pos?: number } }

interface RequestsOptions {
  now(): number;
  /** The receipt of `request` from `device`, as the record holds it. */
  receipt(device: string, request: string): Promise<Receipt | undefined>;
  /** Appends the receipt of a write that appended no event of its own; its log_pos. */
  append(receipt: EventInput): Promise<number>;
  /** The log's end. */
  end(): Promise<number>;
}

export class Requests {
  private readonly writing = new AsyncLocalStorage<Writing>();
  /** The writes under way, by device and request ID: a duplicate sent meanwhile waits for the first. Memory only. */
  private readonly running = new Map<string, Promise<Obj>>();
  constructor(private readonly o: RequestsOptions) {}

  /** The request ID a write's params carry, refused when it isn't one; undefined when it carries none. */
  static of(params: Obj): string | undefined {
    const { request } = params;
    if (request === undefined) return undefined;
    if (typeof request !== 'string' || !REQUEST.test(request)) throw new Refused(refusal('type', '/params/request', 'Give the write\'s request ID: 1 to 64 letters, digits, - or _.', request));
    return request;
  }

  /**
   * Runs `body`, a write with an effect, and returns its result with the log_pos it landed at: its own event's, else
   * the log's end. With a request ID, its receipt commits with that event; a retry from the same device with the same
   * params gets the first result, `again` reading it back from that event, and one with other params is refused
   * naming the ID.
   */
  async write(method: string, params: Obj, caller: Caller | undefined, effect: Effect, body: () => Promise<Obj>, again: (event: Landed) => Promise<Obj>): Promise<Obj> {
    if (!caller) return this.landed(effect, undefined, body);
    const key = `${caller.device}\u0000${caller.request}`;
    const before = this.running.get(key);
    const run = (before ? before.catch(() => undefined) : Promise.resolve()).then(async (): Promise<Obj> => {
      // What a retry must send again: the params, with the signature and the request ID left out.
      const { signature: _signature, request: _request, ...sent } = params;
      const hash = sha256Hex(canonicalize(JSON.parse(JSON.stringify(sent)) as JsonValue));
      const done = await this.o.receipt(caller.device, caller.request);
      if (!done) return this.landed(effect, { method, request: caller.request, device: caller.device, params: hash }, body);
      if (done.method !== method || done.params !== hash) {
        throw new Refused(refusal('const', '/params/request', `The request ID ${caller.request} was used already, for ${done.method === method ? 'other params' : done.method}, so this write did nothing. A new write takes a new request ID.`, caller.request));
      }
      return { ...(done.event ? await again(done.event) : done.result), log_pos: done.log_pos };
    });
    this.running.set(key, run);
    try {
      return await run;
    } finally {
      if (this.running.get(key) === run) this.running.delete(key);
    }
  }
  private async landed(effect: Effect, data: Obj | undefined, body: () => Promise<Obj>): Promise<Obj> {
    const writing: Writing = { effect, data, done: false };
    let result: Obj;
    try {
      result = await this.writing.run(writing, body);
    } finally {
      // What the write set off and runs on after it (a state pass, a delivery) never takes its receipt.
      writing.done = true;
    }
    if (writing.taken?.log_pos !== undefined) return { ...result, log_pos: writing.taken.log_pos };
    if (!data) return { ...result, log_pos: await this.o.end() };
    // A write that appended no event of its own (an overrule already made) keeps its receipt alone, with its result.
    const ts = this.o.now();
    return { ...result, log_pos: await this.o.append({ v: 1, id: ulid(ts), kind: 'write.done', ts, data: { ...data, result } as JsonValue }) };
  }

  /**
   * The receipt to commit with `input`, and what to tell once it is in the log, or undefined: the first event of the
   * write under way that its effect names takes it. A write with no request ID keeps only that event's log_pos.
   */
  receiptFor(input: EventInput): { receipt?: EventInput; landed(appended: { log_pos: number } | undefined): void } | undefined {
    const w = this.writing.getStore();
    if (!w || w.done || w.taken || !w.effect(input)) return undefined;
    // Taken now, so another event of the write appended meanwhile never takes it too.
    const taken: { id: string; log_pos?: number } = { id: input.id };
    w.taken = taken;
    const ts = this.o.now();
    return {
      ...(w.data ? { receipt: { v: 1, id: ulid(ts), kind: 'write.done', ts, data: { ...w.data, event: input.id } as JsonValue } } : {}),
      // An append that failed gives it back, so the write's next event can take it.
      landed: (appended) => { if (appended) taken.log_pos = appended.log_pos; else if (w.taken === taken) delete w.taken; },
    };
  }
}
