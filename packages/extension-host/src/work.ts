// Work sources (#66): work taken from wherever it arrives, and results sent back there. A work source is a stream
// source whose reading is work.item@1; you switch it on over a scope (a repo, a team, a label, a channel) and it runs
// on its own schedule. Each run lists the scope's items changed since its read position, reads each one on its own and
// takes in its events by their identity; an item made after the switch-on becomes a task. The run's tasks, events and
// next position go to the record in one append, so a stop between them loses nothing and takes nothing twice. One
// item's failed read stays on that item; a page that repeats its cursor or holds an item from outside the scope is
// refused and the run is INCONCLUSIVE. A result goes back into the item's thread under your standing rule for the
// source, or on your yes to one authority ask; its claim is synced before the request, its send key rides along as a
// marker the provider keeps, and a delivery whose answer never came is settled by looking for that marker.
import { canonicalize, sha256Hex, validate, type JsonValue } from '@deepbuild/contracts';
import type { Asks, PlanInput } from '@deepbuild/asks';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import type { Ended } from './schedules.js';
import type { WorkDecl } from './sources.js';

export type Role = 'owner' | 'collaborator' | 'outside';
export type WorkVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID';
/** A work.item@1 reading. */
export interface WorkItem { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: Role }[]; updated: string }
export interface WorkEvent { id: string; kind: 'item' | 'comment' | 'edit' | 'status'; at: string; reading: WorkItem }
export interface WorkTask { task_ref: string; source: string; id: string; link: string; title: string; criteria: string[]; opened: number; ended: number | null }
export interface WorkPage {
  on: boolean; position: string | null; skipped: number;
  dropped: { id: string; why: 'deleted' | 'not found' | 'forbidden'; at: number }[];
  failing: { id: string; error: string; since: number }[];
  refused: { event: string; why: string }[];
}
export interface DeliveryRow {
  key: string; task_ref: string; source: string; thread: string;
  outcome: 'queued' | 'waiting' | 'sent' | 'not sent' | 'unknown' | 'gone';
  cause: string | null; ask: string | null; rule: string | null; at: number | null;
}
export interface WorkResult { verdict: WorkVerdict; summary: string; requirements: { id: string; text: string; verdict: WorkVerdict; evidence: string[] }[]; receipt: string }
export interface WorkKitFixture { scope: string; items: string[]; roles: Record<string, Role> }
/** A work source you switched on, as work-sources.json keeps it. */
export interface Added { source: string; scope: string; every: number; on: boolean; added: number; rule: { handle: string; sentence: string } | null }

/** What the work sources need of the extension host. */
export interface WorkHost {
  record: RecordStore; now(): number; asks: Asks | undefined;
  added(): Record<string, Added>; saveAdded(all: Record<string, Added>): void;
  /** A loaded work source's declaration and the package holding it, or undefined. */
  decl(source: string): { work: WorkDecl; plugin: string } | undefined;
  /** One op of the package's work source, its context's fetch the hub's; `noAnswer` when a request of it got no answer. */
  call(source: string, op: 'list' | 'item' | 'deliver' | 'find', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }>;
  /** Its schedule, registered (again) for the package that holds the source. */
  schedule(handle: string, added: Added, plugin: string): Promise<void>;
  trusted(connection: Connection, what: string): void;
}

type Listed = { id: string; scope: string; created: string; updated: string; mention: boolean };
type Read = { events: { id: string; kind: WorkEvent['kind']; at: string; marker: string | null; mention: boolean; data: unknown }[] } | { failed: 'deleted' | 'not found' | 'forbidden' | 'error'; status?: number };
/** One append's worth of change to a source's state: also what the record keeps, so a restart replays it the same way. */
interface Delta {
  opened: (WorkTask & { item: string })[];
  taken: { task_ref: string; id: string; kind: WorkEvent['kind']; at: string; hash: string; reading: WorkItem }[];
  skipped: string[];
  refused: { event: string; hash: string; why: string }[];
  dropped: { id: string; why: 'deleted' | 'not found' | 'forbidden'; at: number }[];
  failing: { id: string; error: string; since: number; why: string }[];
  cleared: string[];
  read: { id: string; updated: string }[];
  ended: { task_ref: string; at: number }[];
}
interface SourceState {
  position: string | null; skipped: Set<string>; refused: Map<string, { event: string; why: string }>;
  dropped: Map<string, WorkPage['dropped'][number]>; failing: Map<string, { id: string; error: string; since: number; why: string }>;
  taken: Map<string, string>; lastRead: Map<string, string>;
}
type Phase = 'recorded' | 'asked' | 'claimed' | 'sent' | 'tried' | 'gone' | 'refused' | 'unknown';
interface Delivery { key: string; task_ref: string; source: string; thread: string; phase: Phase; text: string; ask: string | null; rule: string | null; cause: string | null; at: number | null; order: number }

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** A time position is saved this long before the newest item read; event identity makes the overlap harmless. */
const OVERLAP_MS = 5_000;
/** A not-found or forbidden item is read again each run until this long after its first failed read. */
const DROP_MS = 24 * 3_600_000;
/** An item stays watched until this long after the later of its last update and its task's end. */
const WATCH_MS = 14 * 86_400_000;
const PAGE = 50;
const PAGES = 1000;
/** A chat reply holds at most this many words. */
const CHAT_WORDS = 100;
const TEXT_MAX = 8000;
const EPOCH = '1970-01-01T00:00:00.000Z';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const empty = (): Delta => ({ opened: [], taken: [], skipped: [], refused: [], dropped: [], failing: [], cleared: [], read: [], ended: [] });
const changed = (d: Delta): boolean => Object.values(d).some((v) => (v as unknown[]).length > 0);
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** A result as its channel takes it: a chat reply is the verdict line and at most 100 words with the receipt's link; elsewhere the structured receipt. */
export function render(delivers: WorkDecl['delivers'], title: string, r: WorkResult): string {
  const passed = r.requirements.filter((q) => q.verdict === 'PASS').length;
  const head = `${r.verdict}: ${title} (${passed} of ${r.requirements.length} requirements pass)`;
  if (delivers === 'chat') {
    const tail = `Full receipt: ${r.receipt}`;
    const room = CHAT_WORDS - words(head).length - words(tail).length;
    const summary = words(r.summary);
    const cut = room > 0 ? (summary.length > room ? [...summary.slice(0, Math.max(0, room - 1)), '…'] : summary) : [];
    return [words(head).slice(0, CHAT_WORDS - words(tail).length).join(' '), ...(cut.length ? [cut.join(' ')] : []), tail].join('\n');
  }
  const lines = [head, '', r.summary, '', 'Requirements:', ...r.requirements.map((q) => `- ${q.id} ${q.verdict}: ${q.text}${q.evidence.length ? ` (evidence: ${q.evidence.join(', ')})` : ''}`), '', `Receipt: ${r.receipt}`];
  const text = lines.join('\n');
  return text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX - r.receipt.length - 20)}…\nReceipt: ${r.receipt}`;
}

export class WorkSources {
  private loaded: Promise<void> | undefined;
  private readonly states = new Map<string, SourceState>();
  private readonly tasks = new Map<string, WorkTask & { item: string }>();
  private readonly events = new Map<string, WorkEvent[]>();
  private readonly deliveriesByKey = new Map<string, Delivery>();
  /** Deliveries whose request is out in this process. */
  private readonly inFlight = new Set<string>();
  /** Claims this process made that got no answer: settled by their marker at the next tick. */
  private delivering: Promise<void> | undefined;
  private order = 0;
  private closed = false;

  constructor(private readonly h: WorkHost) {}

  close(): void {
    this.closed = true;
  }

  // ---- The record: everything the work sources know is rebuilt from it at the first use after a start.
  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const rows = (await this.h.record.raw("SELECT kind, ts, data FROM events WHERE kind IN ('work.read', 'work.delivery') ORDER BY log_pos")) as { kind: string; ts: number; data: string }[];
      for (const row of rows) {
        const d = JSON.parse(row.data) as Record<string, unknown>;
        if (row.kind === 'work.read') this.apply(String(d.source), d.position as string | null, d.state as Delta);
        else this.applyDelivery(d as never, row.ts);
      }
    })());
  }
  private state(handle: string): SourceState {
    let s = this.states.get(handle);
    if (!s) this.states.set(handle, s = { position: null, skipped: new Set(), refused: new Map(), dropped: new Map(), failing: new Map(), taken: new Map(), lastRead: new Map() });
    return s;
  }
  private apply(handle: string, position: string | null, d: Delta): void {
    const s = this.state(handle);
    s.position = position;
    for (const t of d.opened) this.tasks.set(t.task_ref, { ...t });
    for (const e of d.taken) {
      s.taken.set(e.id, e.hash);
      this.events.set(e.task_ref, [...(this.events.get(e.task_ref) ?? []), { id: e.id, kind: e.kind, at: e.at, reading: e.reading }]);
    }
    for (const id of d.skipped) s.skipped.add(id);
    for (const r of d.refused) s.refused.set(`${r.event}\u0000${r.hash}`, { event: r.event, why: r.why });
    for (const x of d.dropped) {
      s.dropped.set(x.id, x);
      s.failing.delete(x.id);
    }
    for (const f of d.failing) s.failing.set(f.id, f);
    for (const id of d.cleared) s.failing.delete(id);
    for (const r of d.read) s.lastRead.set(r.id, r.updated);
    for (const e of d.ended) {
      const t = this.tasks.get(e.task_ref);
      if (t) t.ended = e.at;
    }
  }
  /** The run's change and its position, in one append; applied here only once the record holds it. */
  private async commit(handle: string, position: string | null, d: Delta): Promise<void> {
    if (!changed(d) && position === this.state(handle).position) return;
    const now = this.h.now();
    await this.h.record.append(CORE, { v: 1, id: ulid(now), kind: 'work.read', ts: now, data: { source: handle, position, state: d as unknown as JsonValue } });
    this.apply(handle, position, d);
  }

  // ---- Switching sources on and off, on the trusted path.
  async add(connection: Connection, spec: { source: string; scope: string; every: number }): Promise<string> {
    this.h.trusted(connection, 'a work source is switched on');
    const decl = this.h.decl(spec?.source);
    if (!decl) throw Error(`no loaded package registers the work source ${String(spec?.source)}`);
    if (typeof spec.scope !== 'string' || !spec.scope) throw Error(`a work source is switched on over a scope, such as a repo, a team or a label`);
    if (!Number.isSafeInteger(spec.every) || spec.every < 1000) throw Error('a work source runs every so many ms, at least 1000');
    await this.load();
    // A schedule's name, as every schedule has: ext.<plugin>.<name>.
    const handle = `ext.${decl.plugin.slice(decl.plugin.indexOf('/') + 1)}.work_${ulid(this.h.now()).toLowerCase()}`;
    const added: Added = { source: spec.source, scope: spec.scope, every: spec.every, on: true, added: this.h.now(), rule: null };
    this.h.saveAdded({ ...this.h.added(), [handle]: added });
    await this.h.schedule(handle, added, decl.plugin);
    return handle;
  }
  async remove(connection: Connection, handle: string): Promise<void> {
    this.h.trusted(connection, 'a work source is switched off');
    const all = this.h.added();
    if (!all[handle]) throw Error(`no work source ${String(handle)} is switched on`);
    this.h.saveAdded({ ...all, [handle]: { ...all[handle]!, on: false } });
  }
  async setRule(connection: Connection, handle: string, rule: { sentence: string }): Promise<string> {
    this.h.trusted(connection, 'a standing rule for a work source is set');
    const all = this.h.added();
    if (!all[handle]) throw Error(`no work source ${String(handle)} is switched on`);
    if (typeof rule?.sentence !== 'string' || !rule.sentence.trim()) throw Error('a standing rule says what it covers in a sentence');
    const set = { handle: `rule:${ulid(this.h.now())}`, sentence: rule.sentence };
    this.h.saveAdded({ ...all, [handle]: { ...all[handle]!, rule: set } });
    return set.handle;
  }
  isWork(name: string): boolean {
    return Object.hasOwn(this.h.added(), name);
  }
  on(handle: string): boolean {
    return this.h.added()[handle]?.on === true;
  }
  /** A work source a package registered: each source you switched on over it gets its schedule again. */
  async registered(source: string, plugin: string): Promise<void> {
    for (const [handle, a] of Object.entries(this.h.added())) if (a.source === source && a.on) await this.h.schedule(handle, a, plugin);
  }

  // ---- Reading.
  private async list(a: Added, since: string): Promise<{ items: Listed[] } | { refused: string }> {
    const items: Listed[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < PAGES; page++) {
      let got: unknown;
      try {
        got = (await this.h.call(a.source, 'list', { scope: a.scope, since, cursor, limit: PAGE })).value;
      } catch (e) {
        return { refused: `its list of ${a.scope} failed: ${message(e)}` };
      }
      const p = got as { items?: unknown; cursor?: unknown } | null;
      if (!isObj(p) || !Array.isArray(p.items) || (p.cursor !== null && typeof p.cursor !== 'string')) return { refused: 'its list gave no page of items with a next cursor' };
      for (const i of p.items) {
        if (!isObj(i) || typeof i.id !== 'string' || typeof i.updated !== 'string') return { refused: 'its list gave an entry with no ID or update time' };
        if (i.scope !== a.scope) return { refused: `the page holds ${i.id}, from ${String(i.scope)}, outside ${a.scope}; the page is refused` };
        items.push({ id: i.id, scope: a.scope, created: typeof i.created === 'string' ? i.created : i.updated, updated: i.updated, mention: i.mention === true });
      }
      if (p.cursor === null) return { items };
      if (cursors.has(p.cursor as string)) return { refused: `its next cursor ${String(p.cursor)} repeats one it gave before in this run; the page is refused` };
      cursors.add(p.cursor as string);
      cursor = p.cursor as string;
    }
    return { refused: `its list ran past ${PAGES} pages` };
  }
  /** Whether the hub reads an item now: a new one made after the switch-on, a task's item while watched, a mention. */
  private due(handle: string, a: Added, l: Listed, now: number): boolean {
    const s = this.state(handle);
    if (s.dropped.has(l.id)) return l.mention;
    const task = this.taskOf(handle, l.id);
    if (!task) return Date.parse(l.created) >= a.added && s.lastRead.get(l.id) !== l.updated;
    if (l.mention) return true;
    if (s.lastRead.get(l.id) === l.updated) return false;
    if (task.ended === null) return true;
    const last = Math.max(Date.parse(s.lastRead.get(l.id) ?? EPOCH), task.ended);
    return now <= last + WATCH_MS;
  }
  private taskOf(handle: string, item: string): (WorkTask & { item: string }) | undefined {
    for (const t of this.tasks.values()) if (t.source === handle && t.item === item) return t;
    return undefined;
  }
  /** Every send key the hub recorded: an event carrying one is a delivery of ours, never taken in. */
  private keys(): Set<string> {
    return new Set(this.deliveriesByKey.keys());
  }
  /**
   * One item read on its own, its outcome folded into `d`: a failed read stays on the item; events are taken by their
   * identity once, a reused identity with other input refused; a task opens from its item reading when `open` allows.
   */
  private async readItem(handle: string, a: Added, id: string, d: Delta, open: boolean, now: number, updated: string | null): Promise<(WorkTask & { item: string }) | undefined> {
    const s = this.state(handle);
    let got: Read;
    try {
      got = (await this.h.call(a.source, 'item', { scope: a.scope, id })).value as Read;
    } catch (e) {
      got = { failed: 'error', error: message(e) } as Read;
    }
    if (!isObj(got)) got = { failed: 'error' };
    if ('failed' in got) {
      const why = got.failed;
      const before = s.failing.get(id) ?? d.failing.find((f) => f.id === id);
      const since = before?.since ?? now;
      if (why === 'deleted') d.dropped.push({ id, why, at: now });
      else if ((why === 'not found' || why === 'forbidden') && now >= since + DROP_MS) d.dropped.push({ id, why, at: now });
      else {
        const error = (got as { error?: string }).error ?? `${why}${got.status ? ` (${got.status})` : ''}`;
        d.failing.push({ id, error, since, why });
      }
      return this.taskOf(handle, id);
    }
    if (s.failing.has(id)) d.cleared.push(id);
    if (updated !== null) d.read.push({ id, updated });
    const events = Array.isArray(got.events) ? [...got.events] : [];
    // The item's own reading first, so a task is open before its comments are taken in.
    events.sort((x, y) => Number(isObj(y) && y.kind === 'item') - Number(isObj(x) && x.kind === 'item'));
    const keys = this.keys();
    let task = this.taskOf(handle, id) ?? d.opened.find((t) => t.source === handle && t.item === id);
    for (const ev of events) {
      if (!isObj(ev) || typeof ev.id !== 'string' || !ev.id) continue;
      if (typeof ev.marker === 'string' && keys.has(ev.marker)) continue;
      const held = validate('work.item@1', ev.data);
      if (!held.ok || !['item', 'comment', 'edit', 'status'].includes(ev.kind as string)) {
        if (!s.skipped.has(ev.id) && !d.skipped.includes(ev.id)) d.skipped.push(ev.id);
        continue;
      }
      const reading = ev.data as WorkItem;
      const hash = sha256Hex(canonicalize({ kind: ev.kind, data: reading } as unknown as JsonValue));
      const prior = s.taken.get(ev.id) ?? d.taken.find((t) => t.id === ev.id)?.hash;
      if (prior === hash) continue;
      if (prior !== undefined) {
        const k = `${ev.id}\u0000${hash}`;
        if (!s.refused.has(k) && !d.refused.some((r) => r.event === ev.id && r.hash === hash)) d.refused.push({ event: ev.id, hash, why: `${ev.id} came again with other input under the same identity; it is refused` });
        continue;
      }
      if (!task && ev.kind === 'item' && open) {
        task = { task_ref: `task:${ulid(now)}`, source: handle, id: reading.source_id, item: id, link: reading.link, title: reading.title, criteria: [...reading.criteria], opened: now, ended: null };
        d.opened.push(task);
      }
      if (!task) continue;
      d.taken.push({ task_ref: task.task_ref, id: ev.id, kind: ev.kind as WorkEvent['kind'], at: typeof ev.at === 'string' ? ev.at : reading.updated, hash, reading });
    }
    return task;
  }
  /** One run of a work source, on its schedule or run now. */
  async run(handle: string): Promise<Ended> {
    await this.load();
    const a = this.h.added()[handle];
    if (!a?.on) return { verdict: 'uncounted', cause: 'the work source is switched off', changes: [] };
    const s = this.state(handle);
    const since = s.position ?? new Date(a.added).toISOString();
    const listed = await this.list(a, since);
    if ('refused' in listed) return { verdict: 'INCONCLUSIVE', cause: listed.refused, changes: [] };
    const now = this.h.now();
    const d = empty();
    const reading = new Map<string, string | null>();
    for (const l of listed.items) if (this.due(handle, a, l, now)) reading.set(l.id, l.updated);
    for (const id of s.failing.keys()) if (!reading.has(id)) reading.set(id, null);
    for (const [id, updated] of reading) {
      if (this.closed || !this.on(handle)) break;
      const l = listed.items.find((x) => x.id === id);
      await this.readItem(handle, a, id, d, l ? Date.parse(l.created) >= a.added : true, now, updated);
    }
    // Switched off while it read: nothing it read becomes a task.
    if (this.closed || !this.on(handle)) return { verdict: 'uncounted', cause: 'switched off during the run; nothing it read was taken in', changes: [] };
    const newest = listed.items.reduce((m, l) => Math.max(m, Date.parse(l.updated) || 0), 0);
    const position = new Date(Math.max(Date.parse(since), newest - OVERLAP_MS)).toISOString();
    await this.commit(handle, position, d);
    return { verdict: 'PASS', cause: null, changes: [] };
  }
  /** "Fix <id>": the item read now by its ID through the sources you switched on, whenever it was made. */
  async fix(connection: Connection, id: string): Promise<WorkTask> {
    this.h.trusted(connection, 'work is started from a source');
    if (typeof id !== 'string' || !id) throw Error('Fix names an item by its ID');
    await this.load();
    const why: string[] = [];
    for (const [handle, a] of Object.entries(this.h.added())) {
      if (!a.on || !this.h.decl(a.source)) continue;
      const d = empty();
      const task = await this.readItem(handle, a, id, d, true, this.h.now(), null);
      const failed = d.failing.find((f) => f.id === id);
      if (failed && !task) {
        why.push(`${a.source} over ${a.scope}: ${failed.error}`);
        continue;
      }
      // A one-off read: it marks no failed read on the item, which the source's own runs read as they would.
      d.failing = [];
      d.dropped = [];
      await this.commit(handle, this.state(handle).position, d);
      if (task) return this.public(this.tasks.get(task.task_ref) ?? task);
    }
    throw Error(`no work source you switched on holds ${id}${why.length ? `: ${why.join('; ')}` : ''}`);
  }
  async endTask(connection: Connection, task_ref: string): Promise<void> {
    this.h.trusted(connection, 'a task is ended');
    await this.load();
    const t = this.tasks.get(task_ref);
    if (!t) throw Error(`no work task ${String(task_ref)}`);
    if (t.ended !== null) return;
    const d = empty();
    d.ended.push({ task_ref, at: this.h.now() });
    await this.commit(t.source, this.state(t.source).position, d);
  }
  private public(t: WorkTask & { item: string }): WorkTask {
    const { item: _item, ...rest } = t;
    return { ...rest, criteria: [...rest.criteria] };
  }
  async workTasks(): Promise<WorkTask[]> {
    await this.load();
    return [...this.tasks.values()].map((t) => this.public(t));
  }
  async workEvents(task_ref: string): Promise<WorkEvent[]> {
    await this.load();
    return structuredClone(this.events.get(task_ref) ?? []);
  }
  async page(handle: string): Promise<WorkPage> {
    await this.load();
    const s = this.state(handle);
    return {
      on: this.on(handle), position: s.position, skipped: s.skipped.size, dropped: [...s.dropped.values()],
      failing: [...s.failing.values()].map(({ id, error, since }) => ({ id, error, since })), refused: [...s.refused.values()],
    };
  }

  // ---- Delivering results back.
  private applyDelivery(d: { key: string; task_ref: string; source: string; thread: string; phase: Phase; detail: Record<string, unknown> }, ts: number): void {
    const x = this.deliveriesByKey.get(d.key) ?? { key: d.key, task_ref: d.task_ref, source: d.source, thread: d.thread, phase: d.phase, text: '', ask: null, rule: null, cause: null, at: null, order: this.order++ };
    x.phase = d.phase;
    if (typeof d.detail.text === 'string') x.text = d.detail.text;
    if (typeof d.detail.ask === 'string') x.ask = d.detail.ask;
    if (typeof d.detail.rule === 'string') x.rule = d.detail.rule;
    x.cause = typeof d.detail.cause === 'string' ? d.detail.cause : null;
    if (d.phase === 'sent' || d.phase === 'gone') x.at = ts;
    this.deliveriesByKey.set(d.key, x);
  }
  private async step(x: Delivery, phase: Phase, detail: Record<string, unknown>, sync = false): Promise<void> {
    const now = this.h.now();
    const data = { key: x.key, task_ref: x.task_ref, source: x.source, thread: x.thread, phase, detail };
    await this.h.record.append(CORE, { v: 1, id: ulid(now), kind: 'work.delivery', ts: now, data: data as unknown as JsonValue });
    if (sync) await this.h.record.sync();
    this.applyDelivery(data as never, now);
  }
  /** Records a result for the task's thread; the hub's timer sends it. Its send key. */
  async deliverResult(task_ref: string, result: WorkResult): Promise<string> {
    await this.load();
    const t = this.tasks.get(task_ref);
    if (!t) throw Error(`no work task ${String(task_ref)}`);
    const a = this.h.added()[t.source];
    const decl = a ? this.h.decl(a.source) : undefined;
    if (!decl) throw Error(`${t.source}'s work source isn't loaded, so how its threads take a result is unknown`);
    if (!isObj(result) || typeof result.receipt !== 'string' || !Array.isArray(result.requirements)) throw Error('a result has its verdict, requirements and receipt');
    const key = `d${ulid(this.h.now()).toLowerCase()}`;
    const x: Delivery = { key, task_ref, source: t.source, thread: t.item, phase: 'recorded', text: '', ask: null, rule: null, cause: null, at: null, order: 0 };
    await this.step(x, 'recorded', { text: render(decl.work.delivers, t.title, result) });
    return key;
  }
  async deliveries(): Promise<DeliveryRow[]> {
    await this.load();
    return [...this.deliveriesByKey.values()].sort((a, b) => a.order - b.order).map((x) => ({
      key: x.key, task_ref: x.task_ref, source: x.source, thread: x.thread, cause: x.cause, ask: x.ask, rule: x.rule, at: x.at,
      outcome: x.phase === 'sent' ? 'sent' : x.phase === 'gone' ? 'gone' : x.phase === 'refused' ? 'not sent' : x.phase === 'asked' ? 'waiting'
        : x.phase === 'unknown' || (x.phase === 'claimed' && !this.inFlight.has(x.key)) ? 'unknown' : 'queued',
    }));
  }
  /** The hub's timer: each thread's first unsettled delivery takes its next step; a later one waits behind it. */
  tick(): Promise<void> {
    if (this.delivering) return this.delivering;
    const going = this.deliverAll().finally(() => { this.delivering = undefined; });
    this.delivering = going;
    return going;
  }
  private async deliverAll(): Promise<void> {
    if (this.closed) return;
    await this.load();
    const firsts = new Map<string, Delivery>();
    for (const x of [...this.deliveriesByKey.values()].sort((a, b) => a.order - b.order)) {
      if (['sent', 'gone', 'refused', 'unknown'].includes(x.phase)) continue;
      const thread = `${x.task_ref}\u0000${x.source}\u0000${x.thread}`;
      if (!firsts.has(thread)) firsts.set(thread, x);
    }
    await Promise.all([...firsts.values()].map((x) => this.advance(x).catch((e: unknown) => {
      if (!this.closed) process.stderr.write(`deep: the delivery ${x.key} didn't move on: ${message(e)}\n`);
    })));
  }
  private async advance(x: Delivery): Promise<void> {
    if (this.inFlight.has(x.key) || this.closed) return;
    const a = this.h.added()[x.source];
    // One queued while its source is off waits.
    if (!a?.on || !this.h.decl(a.source)) return;
    this.inFlight.add(x.key);
    try {
      if (x.phase === 'claimed') return await this.settle(x, a);
      if (x.phase === 'recorded' || x.phase === 'tried') {
        if (x.rule || x.ask) return await this.send(x, a);
        if (a.rule) {
          x.rule = a.rule.handle;
          return await this.send(x, a);
        }
        const ask = await this.raise(x, a);
        return await this.step(x, 'asked', { ask });
      }
      if (x.phase === 'asked') {
        const [row] = (await this.h.record.raw('SELECT status, decision FROM asks WHERE id = ?', [x.ask!.slice(4)])) as { status: string; decision: string | null }[];
        if (row?.decision === 'allow') return await this.send(x, a);
        if (row?.decision === 'deny') return await this.step(x, 'refused', { ask: x.ask, cause: `you said no to ${x.ask}` });
        if (row && row.status !== 'open' && row.status !== 'later') return await this.step(x, 'refused', { ask: x.ask, cause: `${x.ask} closed with no yes` });
      }
    } finally {
      this.inFlight.delete(x.key);
    }
  }
  /** The claim, synced before the request; then the package's delivery into the thread, its send key as the marker. */
  private async send(x: Delivery, a: Added): Promise<void> {
    await this.step(x, 'claimed', { ...(x.rule ? { rule: x.rule } : {}), ...(x.ask ? { ask: x.ask } : {}) }, true);
    let got: { value: unknown; noAnswer: boolean };
    try {
      got = await this.h.call(a.source, 'deliver', { scope: a.scope, id: x.thread, key: x.key, text: x.text });
    } catch (e) {
      // No answer: whether it landed is unknown until its marker is looked for, at the next tick.
      if ((e as { noAnswer?: boolean }).noAnswer) return;
      if (this.closed) return;
      return this.step(x, 'tried', { cause: message(e) });
    }
    const v = got.value as { outcome?: unknown; why?: unknown } | null;
    if (got.noAnswer && v?.outcome !== 'sent' && v?.outcome !== 'gone') return;
    if (v?.outcome === 'sent') return this.step(x, 'sent', {});
    if (v?.outcome === 'gone') return this.step(x, 'gone', { cause: typeof v.why === 'string' && v.why ? v.why : 'the target can never take it' });
    return this.step(x, 'tried', { cause: 'the source gave no outcome' });
  }
  /** A claim with no recorded answer: its marker found reads sent, absent reads not sent and goes out once; none kept, unknown. */
  private async settle(x: Delivery, a: Added): Promise<void> {
    let found: unknown;
    try {
      found = (await this.h.call(a.source, 'find', { scope: a.scope, id: x.thread, key: x.key })).value;
    } catch {
      return;
    }
    if (found === true) return this.step(x, 'sent', { cause: 'its marker was found in the thread' });
    if (found === false) {
      await this.step(x, 'tried', { cause: 'no answer came, and the thread holds no marker of it' });
      return this.send(x, a);
    }
    return this.step(x, 'unknown', { cause: 'no answer came, and the provider keeps no marker to find it by' });
  }
  /** One authority ask for a delivery no standing rule of yours covers; nothing a source says answers it. */
  private async raise(x: Delivery, a: Added): Promise<string> {
    if (!this.h.asks) throw Error(`${x.key} needs your yes, and this host has no asks core to ask you`);
    const t = this.tasks.get(x.task_ref);
    const what = `deliver the result of ${t?.title ?? x.task_ref} back to ${x.thread} through ${a.source}`;
    const plan = sha256Hex(canonicalize({ key: x.key, source: a.source, scope: a.scope, thread: x.thread, text: x.text }));
    const input: PlanInput = { steps: [{ does: `${what}: no standing rule of yours covers deliveries to this source`, changes: [x.thread], undo: null, public: false, cost: 0 }], diff: plan };
    return this.h.asks.raise(CORE, 'action.send', {
      kind: 'authority', question: `Let DeepBuild ${what}? No standing rule of yours covers it.`,
      options: [{ id: 'approve', label: 'Send it', decision: 'allow' }, { id: 'decline', label: 'Don\'t', decision: 'deny' }],
      recommended: null, deadline: this.h.now() + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ delivery: x.key, plan })), pinned_to: { kind: 'evidence', ref: plan },
    }, input);
  }

  // ---- The work.item@1 kit.
  /** A loaded work source read through the hub from the start of time: its pages, every item, each author's role. */
  async kit(source: string, fixture: WorkKitFixture): Promise<{ verdict: 'PASS' | 'FAIL'; failures: string[] }> {
    if (!this.h.decl(source)) throw Error(`no loaded package registers the work source ${String(source)}`);
    const failures: string[] = [];
    const read = new Set<string>();
    const listed: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < PAGES; page++) {
      let p: { items?: unknown; cursor?: unknown };
      try {
        p = ((await this.h.call(source, 'list', { scope: fixture.scope, since: EPOCH, cursor, limit: PAGE })).value ?? {}) as typeof p;
      } catch (e) {
        failures.push(`its list failed: ${message(e)}`);
        break;
      }
      for (const i of Array.isArray(p.items) ? p.items : []) {
        if (!isObj(i) || typeof i.id !== 'string') continue;
        if (i.scope !== fixture.scope) failures.push(`it listed ${i.id}, from ${String(i.scope)}, outside ${fixture.scope}`);
        else listed.push(i.id);
      }
      if (typeof p.cursor !== 'string') break;
      if (cursors.has(p.cursor)) {
        failures.push(`its next cursor ${p.cursor} repeats one it gave before`);
        break;
      }
      cursors.add(p.cursor);
      cursor = p.cursor;
    }
    for (const id of new Set(listed)) {
      let got: Read;
      try {
        got = (await this.h.call(source, 'item', { scope: fixture.scope, id })).value as Read;
      } catch (e) {
        failures.push(`${id} couldn't be read: ${message(e)}`);
        continue;
      }
      if (!isObj(got) || 'failed' in got) {
        failures.push(`${id} couldn't be read: ${isObj(got) ? String((got as { failed: string }).failed) : 'no answer'}`);
        continue;
      }
      read.add(id);
      for (const ev of Array.isArray(got.events) ? got.events : []) {
        const held = validate('work.item@1', ev?.data);
        if (!held.ok) {
          failures.push(`${id}'s event ${String(ev?.id)} isn't a work.item@1 reading: ${held.issues[0]!.path || '/'} ${held.issues[0]!.code}`);
          continue;
        }
        for (const author of (ev.data as WorkItem).authors) {
          const expected = fixture.roles[author.handle];
          if (expected && author.role !== expected) failures.push(`${author.handle} is marked ${author.role} on ${(ev.data as WorkItem).source_id}, though the membership makes them ${expected}`);
        }
      }
    }
    for (const id of fixture.items) if (!read.has(id)) failures.push(`${id} wasn't read`);
    return { verdict: failures.length ? 'FAIL' : 'PASS', failures };
  }
}
