// A write retried gets its first result (#1577; design: Socket roles and contract versions). Every app or CLI write
// with an effect takes a request ID: the same device, ID and params get the first result back and write nothing, and
// the same ID with other params is refused, naming it; a write refused took no effect and holds no ID. The receipt
// commits in one transaction with the event that carries the write out, so a crash leaves both or neither. While a write runs, its mark lives in this process's
// memory alone: nothing of it outlives a crash, and a retry after a restart finds the receipt or nothing, and applies
// once. Every write's reply names the log position it landed at.
import { canonicalize, isRecord as isObj, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { type Receipt, type RecordStore } from '@deepbuild/record';

import { writing, type Write } from './hub-shared.js';
import { refuse, type Refused } from './wire.js';
import type { CallContext } from './session-types.js';

type Obj = Record<string, unknown>;

/** The writes with an effect, each with the event kinds that carry it out: the first of them carries its receipt. */
const WRITES: ReadonlyMap<string, readonly string[]> = new Map([
  ['ask.answer', ['ask.answered']], ['ask.undo', ['default.undone']], ['decision.overrule', ['decision.overruled']],
  ['offer.save', ['ask.answered']], ['run.start', ['run.started']], ['staged.undo', ['staged.undone']], ['session.note', ['session.note']],
]);

/** A request ID: 1 to 64 letters, digits, - or _, as a note's has been (#340). */
const REQUEST = /^[0-9A-Za-z_-]{1,64}$/;

/** Who sent a write: the paired device its signature names, else the connection's role. */
function deviceOf(params: Obj, context: CallContext): string {
  const signed = isObj(params.signature) && isObj(params.signature.signed) ? params.signature.signed : undefined;
  return typeof signed?.device === 'string' ? `device:${signed.device}` : context.role;
}

const otherParams = (request: string): Refused => refuse('conflict', '/params/request', `The request ID ${request} was sent before with other params, so this write is refused; send a new write with a new request ID.`, request);

export class Writes {
  /** Each write with a request ID running now, by device and ID: in memory alone, so no mark outlives the process. */
  private readonly running = new Map<string, { params: string; reply: Promise<Obj> }>();

  constructor(private readonly o: { record: () => RecordStore; plant: () => string | undefined }) {}

  /** A write, applied once per device and request ID; its reply names the log position it landed at. */
  async run(method: string, params: Obj, context: CallContext, write: () => Promise<unknown>): Promise<unknown> {
    const effects = WRITES.get(method);
    if (!effects) return write();
    const { request } = params;
    if (request === undefined) return this.apply(undefined, effects, write);
    if (typeof request !== 'string' || !REQUEST.test(request)) throw refuse('type', '/params/request', 'Give the write\'s request ID: 1 to 64 letters, digits, - or _.', request);
    const { signature: _signed, ...rest } = params;
    const receipt: Receipt = { device: deviceOf(params, context), request, method, params: sha256Hex(canonicalize(rest as JsonValue)) };
    const key = `${receipt.device}\n${request}`;
    const held = this.running.get(key);
    if (held) {
      if (held.params !== receipt.params) throw otherParams(request);
      return held.reply;
    }
    const reply = this.first(receipt, effects, write).finally(() => this.running.delete(key));
    this.running.set(key, { params: receipt.params, reply });
    return reply;
  }

  /** The result the receipt holds; or, with no receipt, the write applied. */
  private async first(receipt: Receipt, effects: readonly string[], write: () => Promise<unknown>): Promise<Obj> {
    const [kept] = (await this.o.record().raw('SELECT method, params, log_pos, outcome FROM receipts WHERE device = ? AND request = ?', [receipt.device, receipt.request])) as { method: string; params: string; log_pos: number | null; outcome: string | null }[];
    if (!kept) {
      // The planted wrong program marks the request ID in progress where the mark outlives the hub.
      if (this.o.plant() === 'pending-across-restart') await this.o.record().keepReceipt(receipt, { pending: true });
      return this.apply(receipt, effects, write);
    }
    if (kept.method !== receipt.method || kept.params !== receipt.params) throw otherParams(receipt.request);
    // A crash between the write's event and its outcome: the write took effect, at the receipt's position.
    if (kept.outcome === null) return { request: receipt.request, log_pos: kept.log_pos };
    const outcome = JSON.parse(kept.outcome) as { result?: Obj; pending?: true };
    if (outcome.pending) throw refuse('unavailable', '/params/request', `The write with request ID ${receipt.request} is still in progress; send it again shortly.`, receipt.request, true);
    return outcome.result!;
  }

  private async apply(receipt: Receipt | undefined, effects: readonly string[], write: () => Promise<unknown>): Promise<Obj> {
    const w: Write = { ...(receipt ? { receipt } : {}), effects, carried: false, done: false, last: 0, after: [] };
    const end = () => {
      w.done = true;
      for (const then of w.after.splice(0)) {
        try {
          then();
        } catch {
          // A once-only ID left unspent lapses in its 10 minutes, and a retry with the request ID reads the receipt.
        }
      }
    };
    // A write refused took no effect and keeps no receipt: its request ID is free for the next send.
    const result = await writing.run(w, write).finally(end);
    const log_pos = w.last || Number(((await this.o.record().raw('SELECT coalesce(max(log_pos), 0) AS log_pos FROM events')) as { log_pos: number }[])[0]!.log_pos);
    const reply = { ...(isObj(result) ? result : {}), log_pos };
    // The write took effect whether or not its outcome is kept: a retry then reads the receipt's position.
    if (receipt) await this.o.record().keepReceipt(receipt, { result: reply as JsonValue }).catch(() => undefined);
    return reply;
  }
}

/** What a write made from a view names: the newest change to its target after that view. */
export interface Change { kind: string; log_pos: number; ts: number; data: Obj }

/**
 * A write made from a view (#1577): an undo, an overrule or a staged undo carries `view`, the log position of what you
 * were shown, and the newest event past that position that changed its target (`changed`, SQL on events with its
 * values) refuses it, named by `named`, so no write silently undoes a newer one. A write with no view is checked as before.
 */
export async function sinceView(raw: RecordStore['raw'], params: Obj, target: string, changed: { sql: string; values: string[] }, named: (change: Change) => Promise<string> | string): Promise<void> {
  const { view } = params;
  if (view === undefined) return;
  if (!Number.isSafeInteger(view) || (view as number) < 0) throw refuse('type', '/params/view', 'Give the log position of the view this was sent from, as the read it showed named it.', view);
  const [row] = (await raw(`SELECT kind, log_pos, ts, data FROM events WHERE log_pos > ? AND ${changed.sql} ORDER BY log_pos DESC LIMIT 1`, [view as number, ...changed.values])) as { kind: string; log_pos: number; ts: number; data: string }[];
  if (!row) return;
  const change = { ...row, data: JSON.parse(row.data) as Obj };
  throw refuse('changed', '/params/view', `${target} changed after the view this was sent from (log position ${String(view)}): ${await named(change)}, at log position ${row.log_pos}, ${new Date(row.ts).toISOString()}. That stands and nothing was changed; read ${target} again.`, row.log_pos);
}

/** The events about one record object, of `kinds`, as `sinceView` reads them. */
export const about = (subject: string, kinds: readonly string[]): { sql: string; values: string[] } => ({ sql: 'subject = ? AND kind IN (SELECT value FROM json_each(?))', values: [subject, JSON.stringify(kinds)] });
