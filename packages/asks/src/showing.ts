// Visibility and batch rules, with their record-derived batch counts. Callers keep read/append ordering under the core's lock.
import { canonicalize, sha256Hex } from '@deepbuild/contracts';
import type { Event } from '@deepbuild/record';
import { bare, CANT_UNDO, isObj } from './model.js';
import type { Ask, BatchCard, InboxStatus, Obj } from './model.js';
import { duration } from './duration.js';

/** Batches every `every` ms since the epoch, showing at most `cap` asks a UTC day. */
export interface Batches { every: number; cap: number }
interface ShowingOptions {
  ask: (handle: string) => Ask | undefined;
  open: () => Ask[];
  openIn: (thread: string) => Ask[];
  now: () => number;
  settings: () => Obj;
  append: (batch: string, groups: Ask[][], now: number) => Promise<void>;
}
const DAY = 86_400_000;
/** The fold's option that leaves the asks it holds to their defaults. */
const FOLD_DEFAULTS = 'defaults';
/** The kinds whose same question from another thread, pinned to the same thing, shows through one card. */
const JOINED_KINDS = new Set(['taste', 'choice', 'definition']);

export class Showing {
  /** The asks each batch showed, by its name. */
  private readonly shownIn = new Map<string, string[]>();
  /** How many asks batches showed each UTC day, by day number. */
  private readonly batched = new Map<number, number>();
  /** Each ask shown in a batch of several, and the batch's asks in order: what an approval's `steps` index (#327). */
  private readonly batchOf = new Map<string, string[]>();

  constructor(private readonly options: ShowingOptions) {}

  /**
   * Your batch schedule; none declared, every ask shows when it's raised, a held one included, since with no batch
   * to wait for the only other time to show it is its deadline. Batches are your visits, one schedule across every
   * repo, so a repo's done.yaml doesn't change them.
   */
  batches(): Batches | undefined {
    const batch = this.options.settings().batch;
    const every = isObj(batch) ? duration(batch.every) : undefined;
    return every && isObj(batch) && typeof batch.cap === 'number' ? { every, cap: batch.cap } : undefined;
  }

  members(handle: string): string[] { return this.batchOf.get(handle) ?? []; }

  /** The open authority asks with a plan that a batch showed, each step with its switch as it starts. */
  batchSteps(batch: string): BatchCard['steps'] {
    const asks = (this.shownIn.get(batch) ?? []).map((h) => this.options.ask(bare(h))).filter((a): a is Ask => !!a && !a.closed && a.data.kind === 'authority' && !!a.plan);
    return asks.flatMap((a) => a.plan!.steps.map((s, step) => ({ ask: a.handle, step, does: s.does, undo: String(s.undo), on: s.undo !== CANT_UNDO })));
  }

  forget(handle: string): void {
    this.batchOf.delete(handle);
    for (const [batch, handles] of this.shownIn) {
      const rest = handles.filter((h) => h !== handle);
      if (rest.length) this.shownIn.set(batch, rest);
      else this.shownIn.delete(batch);
    }
  }

  /** Fold one ask.batched event, under the identity that showed it. */
  apply(e: Event, d: Obj): void {
    if (e.writer !== 'core' || !Array.isArray(d.asks)) return;
    const members = d.asks.flatMap((item) => (isObj(item) && typeof item.ask === 'string' ? [item.ask] : []));
    if (members.length > 1) for (const member of members) this.batchOf.set(member, members);
    const shown = d.asks.flatMap((item) => {
      const ask = isObj(item) ? this.options.ask(bare(String(item.ask))) : undefined;
      // A showing counts only under the identity the ask was raised for.
      return ask && (!ask.shown || ask.later !== undefined) && ask.who.actor === e.actor && ask.who.scope === e.scope ? [ask] : [];
    });
    if (typeof d.batch === 'string') this.shownIn.set(d.batch, [...(this.shownIn.get(d.batch) ?? []), ...shown.map((a) => a.handle)]);
    for (const ask of shown) {
      // Shown again, as when its Later ends: back in Needs you.
      ask.shown = true;
      ask.firstShown ??= e.ts;
      delete ask.later;
    }
    // Only a batch counts toward the day's cap; an ask shown at once doesn't.
    const at = typeof d.batch === 'string' && d.batch.startsWith('batch:') ? Date.parse(d.batch.slice(6)) : NaN;
    if (Number.isNaN(at)) return;
    this.batched.set(Math.floor(at / DAY), (this.batched.get(Math.floor(at / DAY)) ?? 0) + shown.length);
  }

  status(ask: Ask): InboxStatus {
    if (ask.closed) return 'closed';
    if (this.inFold(ask)) return 'folded';
    if (ask.later !== undefined) return 'later';
    if (ask.shown) return 'shown';
    return ask.unread ? 'held' : 'queued';
  }

  /**
   * Whether an ask shows only inside the exception that holds it: while that's open, or once you left its asks to
   * their defaults. Otherwise, as when "answer them together" left an approval or an unblock, it gets its own card.
   */
  inFold(ask: Ask): boolean {
    const holder = ask.folded === undefined ? undefined : this.options.ask(bare(ask.folded));
    return holder !== undefined && (!holder.closed || holder.closed.answer === FOLD_DEFAULTS);
  }

  /** Whether an ask is in sight now: shown, and not put off with Later. */
  private visible(ask: Ask): boolean {
    return ask.shown && ask.later === undefined;
  }

  /** In sight on its own card, or inside an exception that is: what typed text can answer, and what can take its default. */
  inSight(ask: Ask): boolean {
    return this.visible(ask) && (!this.inFold(ask) || this.visible(this.options.ask(bare(ask.folded!))!));
  }

  /** Shows these asks now, outside any batch. */
  async showNow(asks: Ask[]): Promise<boolean> {
    if (!asks.length) return false;
    const now = this.options.now();
    await this.appendBatch(`now:${new Date(now).toISOString()}`, asks, now);
    return true;
  }

  /** One ask.batched for each actor and scope among the asks, under that identity. */
  private async appendBatch(batch: string, asks: Ask[], now: number): Promise<void> {
    const groups = new Map<string, Ask[]>();
    for (const a of asks) {
      const key = JSON.stringify([a.who.actor, a.who.scope]);
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    await this.options.append(batch, [...groups.values()], now);
  }

  /**
   * The latest batch, up to the day's cap, oldest first; then, cap or not, each ask whose deadline (for the
   * exception, the earliest among the asks it holds) would pass before the next batch, so none reaches its
   * deadline unseen. Run when an ask is filed, on every tick, and when the core starts.
   */
  async show(): Promise<boolean> {
    // An ask you put off with Later waits for its Later, not for a batch.
    // A block someone else owns never shows: its drafted request does.
    // The same question from another thread shows through the older one's card, and is answered with it.
    // A session's task that joins the shared one is superseded before it could show: the shared task is the card.
    const waiting = () => this.options.open().filter((a) => !a.shown && !this.inFold(a) && a.later === undefined && !a.theirs && !this.rides(a) && a.pending.superseded === undefined);
    // A Later that ends shows its ask again, recorded like any showing; so does one that an ask joining the
    // exception since would outlast.
    const now = this.options.now();
    let acted = await this.showNow(this.options.open().filter((a) => a.later !== undefined && !a.theirs && (a.later <= now || this.dueBy(a) <= a.later)));
    const batches = this.batches();
    // With no batches declared, nothing waits for one.
    const last = batches ? Math.floor(now / batches.every) * batches.every : now;
    const next = batches ? last + batches.every : Infinity;
    // An ask held by an exception that has shown shows there, recorded like any other showing; one from a turn that
    // hasn't read your message waits, as on its own card, for the agent's next step or a deadline before the next batch.
    const joined = this.options.open().filter((a) => !a.shown && this.inFold(a) && this.visible(this.options.ask(bare(a.folded!))!));
    if (await this.showNow(joined.filter((a) => !a.unread || this.showBy(a) <= next))) acted = true;
    // A question held for your message stays held until the agent's stop says whether it still stands (#84).
    if (!batches) return (await this.showNow(waiting().filter((x) => !(x.unread || x.recheck) || this.showBy(x) <= now))) || acted;
    // The latest batch shows every ask waiting for it since before its time, as the log stands: one held for your
    // message and read after it waits for the next, and a showing that failed to append is appended on the next
    // call, without showing again what the log already shows.
    const room = batches.cap - (this.batched.get(Math.floor(last / DAY)) ?? 0);
    const due = waiting().filter((a) => a.since < last && !a.unread).slice(0, Math.max(0, room));
    if (due.length) {
      await this.appendBatch(`batch:${new Date(last).toISOString()}`, due, now);
      acted = true;
    }
    // A deadline at the next batch's own time counts as passing first: an ask first shown at its deadline would
    // default only on a later call, after its deadline, so it shows now instead.
    if (await this.showNow(waiting().filter((a) => this.showBy(a) <= next))) acted = true;
    return acted;
  }

  /** When an ask must have shown by: its deadline, or for the exception the earliest among the asks it holds. */
  dueBy(ask: Ask): number {
    const held = ask.fold ? this.options.openIn(ask.thread).filter((f) => f.folded === ask.handle).map((f) => f.data.deadline as number) : [];
    return Math.min(ask.data.deadline as number, ...held);
  }
  /** When an ask shows at once by: as dueBy, but time the hub didn't run moves no showing later (#908). */
  private showBy(ask: Ask): number {
    return Math.min(this.dueBy(ask), ask.due);
  }

  /** Whether an open ask shows through an older open one from another thread: the same question, by key, pinned to the same thing. */
  rides(ask: Ask): Ask | undefined {
    if (ask.closed || !JOINED_KINDS.has(String(ask.data.kind)) || !isObj(ask.data.subject)) return undefined;
    const pin = sha256Hex(canonicalize(ask.data.pinned_to!));
    return this.options.open().find((b) => b.pos < ask.pos && b.thread !== ask.thread && b.data.kind === ask.data.kind && b.data.key === ask.data.key
      && !b.theirs && !b.fold && b.who.actor === ask.who.actor && b.who.scope === ask.who.scope && sha256Hex(canonicalize(b.data.pinned_to!)) === pin);
  }
}
