// Adapter registration and session routing, owned independently of Host's loading lifecycle.
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import type { Delivery } from '@deepbuild/asks';
import { validate } from '@deepbuild/contracts';
import type { Ext } from './host-types.js';
import { CALL_MS, message } from './host-shared.js';
/** How an answer reaches a session: into the running turn, in the stop hold, waking an idle session, or at its next prompt. */
export type Route = 'steer' | 'hold' | 'wake' | 'prompt';
export type Delivered =
  | { status: 'delivered'; session: string; adapter: string; route: Route }
  | { status: 'held'; session: string; adapter: string };
/** A session adapters bound: who bound it in order, who gates it, whether a turn runs, and the answers waiting for a route. */
interface Bound { bound: string[]; gater: string | null; inTurn: boolean; waiting: Delivery[] }

const ADAPTER_NAME = /^[a-z][a-z0-9-]*$/;
const GATES = new Set(['PreToolUse', 'Stop']);
const OPENS_TURN = new Set(['UserPromptSubmit', 'PreToolUse']);
const ENDS_TURN = 'Stop';
const ENDS_SESSION = 'SessionEnd';
interface RoutingOptions {
  usable(ext: Ext): Promise<boolean>;
  ask(ext: Ext, ms: number, what: string, method: string, params: unknown): Promise<unknown>;
  plant: string | undefined;
}
export class AdapterRouting {
  private readonly adapterFills = new Map<string, { ext: Ext; caps: AdapterCaps }>();
  private readonly sessions = new Map<string, Bound>();
  constructor(private readonly options: RoutingOptions) {}
  register(ext: Ext, name: unknown, adapter: unknown): null {
    const conformance = ext.mode === 'conformance';
    if (typeof name !== 'string' || !ADAPTER_NAME.test(name)) throw Error(`deep.registerAdapter takes the adapter's name first, one lower-case word, not ${JSON.stringify(name)}`);
    const a = adapter as Record<string, unknown> | null;
    if (typeof a !== 'object' || a === null) throw Error(`deep.registerAdapter: ${name}'s adapter is an object with its facts, caps and unsupported data`);
    // Held to the adapter contract here, every flag present: the host routes by these flags, never by the name.
    for (const [schema, field] of [['adapter.facts@1', 'facts'], ['adapter.caps@1', 'caps'], ['adapter.unsupported@1', 'unsupported']] as const) {
      const held = validate(schema, a[field]);
      if (!held.ok) throw Error(`deep.registerAdapter: ${name}'s ${field} fails ${schema} at ${held.issues[0]!.path || '/'}: ${held.issues[0]!.remediation}`);
    }
    if (!conformance) {
      const taken = this.adapterFills.get(name);
      if (taken && taken.ext !== ext) throw Error(`the adapter ${name} is already registered by ${taken.ext.entry.id}`);
      this.adapterFills.set(name, { ext, caps: structuredClone(a.caps) as AdapterCaps });
    }
    ext.adapters.add(name);
    return null;
  }
  drop(ext: Ext): void {
    for (const name of ext.adapters) {
      if (this.adapterFills.get(name)?.ext !== ext) continue;
      this.adapterFills.delete(name);
      // The sessions it bound forget it; one it gated has no owner until an adapter gates it again, and its answers wait.
      for (const b of this.sessions.values()) {
        b.bound = b.bound.filter((n) => n !== name);
        if (b.gater === name) b.gater = null;
      }
    }
  }
  async hookLine(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }> {
    const name = line.agent;
    const fill = this.adapterFills.get(name);
    // An adapter counts once its package started (live), as a hook handler or an action does; never one a start still running registered.
    if (!fill?.ext.live || !fill.ext.ask || !(await this.options.usable(fill.ext))) throw Error(`no loaded extension registered an adapter ${name}`);
    const mapped = await this.options.ask(fill.ext, CALL_MS, `adapter ${name}`, 'adapter.mapHook', { name, request: line, version: 'hook.request@2' }) as { events?: unknown } | null;
    const events = (Array.isArray(mapped?.events) ? mapped.events : []).flatMap((e: unknown) => (typeof (e as { kind?: unknown })?.kind === 'string' ? [{ kind: (e as { kind: string }).kind }] : []));
    const session = (line.payload as { session_id?: unknown } | null)?.session_id;
    // An adapter binds a session the first time a line it maps names it, and gates it when it maps one of the
    // session's gates: the hook deep-hook held, as the line names it, never a kind the adapter's own mapping returned.
    if (typeof session === 'string' && session && events.length) {
      const b = this.sessions.get(session) ?? this.sessions.set(session, { bound: [], gater: null, inTurn: false, waiting: [] }).get(session)!;
      if (!b.bound.includes(name)) b.bound.push(name);
      if (b.gater === null && GATES.has(line.event)) b.gater = name;
      // Only the owner's lines set the turn and open routes: an adapter that relays can't steer another's delivery.
      if (this.owners(b).includes(name)) {
        if (OPENS_TURN.has(line.event)) b.inTurn = true;
        if (line.event === ENDS_TURN) { b.inTurn = false; await this.flush(session, b, 'hold'); await this.flush(session, b, 'wake'); }
        if (line.event === 'UserPromptSubmit') await this.flush(session, b, 'prompt');
        if (OPENS_TURN.has(line.event)) await this.flush(session, b, 'steer');
      }
    }
    // The session ends with its owner's SessionEnd line, mapped to an event or not, or with any binder's while no
    // adapter gates it. An answer still waiting then has no route left: the session is forgotten, and the hook
    // rejects naming each, never silently.
    const b = typeof session === 'string' ? this.sessions.get(session) : undefined;
    if (b && line.event === ENDS_SESSION && (this.owners(b).includes(name) || (b.gater === null && b.bound.includes(name)))) {
      this.sessions.delete(session as string);
      if (b.waiting.length) throw Error(`session ${session} ended with ${b.waiting.length} answer(s) waiting for a route that never opened: ${b.waiting.map((w) => w.ask).join(', ')}`);
    }
    return { adapter: name, events };
  }

  async adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]> {
    return [...this.adapterFills].map(([name, { ext, caps }]) => ({ name, extension: ext.entry.id, caps: structuredClone(caps) }));
  }

  /** The adapters that deliver to a session: the one that gates it, none before one does, or every one under the planted twins. */
  private owners(b: Bound): string[] {
    if (this.options.plant === 'both-adapters-deliver') return [...b.bound];
    if (this.options.plant === 'first-to-bind-owns') return b.bound.slice(0, 1);
    return b.gater !== null ? [b.gater] : [];
  }

  async owner(session: string): Promise<{ adapter: string } | null> {
    const b = this.sessions.get(session);
    const [adapter] = b ? this.owners(b) : [];
    return adapter === undefined ? null : { adapter };
  }

  /** The route an adapter's flags allow now: into a running turn only with `steer`, an idle session only with `wakeIdle`; else none, and the answer waits. */
  private routeNow(caps: AdapterCaps, inTurn: boolean): Route | null {
    if (inTurn && caps.steer) return 'steer';
    if (!inTurn && caps.wakeIdle) return 'wake';
    return null;
  }

  /** Whether the route a line opened takes an answer through an adapter with these flags. */
  private opens(caps: AdapterCaps, route: Route): boolean {
    return route === 'prompt' || (route === 'hold' && caps.holdStop) || (route === 'steer' && caps.steer) || (route === 'wake' && caps.wakeIdle);
  }

  async deliverAnswer(answer: Delivery): Promise<Delivered> {
    const session = answer.session;
    const b = this.sessions.get(session);
    if (!b) throw Error(`no adapter bound session ${session}, so its answer ${answer.ask} has no way to it`);
    const owners = this.owners(b);
    // No adapter gates it yet: the answer waits for the one that will. Held names the adapter it waits on: the owner,
    // else the first still bound, else the empty name when every binder was unloaded.
    const held: Delivered = { status: 'held', session, adapter: owners[0] ?? b.bound[0] ?? '' };
    if (!owners.length) {
      b.waiting.push(answer);
      return held;
    }
    let out: Delivered | undefined;
    for (const name of owners) {
      const fill = this.adapterFills.get(name);
      if (!fill) throw Error(`the adapter ${name} that owns session ${session} is no longer registered`);
      let route = this.routeNow(fill.caps, b.inTurn);
      // A delivery that fails leaves the answer waiting for the next route, as flush does: never dropped unheard.
      if (route) await this.deliverVia(fill, name, answer, route).catch(() => { route = null; });
      if (!route && !b.waiting.includes(answer)) b.waiting.push(answer);
      out ??= route ? { status: 'delivered', session, adapter: name, route } : held;
    }
    return out!;
  }

  /**
   * Delivers the answers waiting for the session through the route the owner's line just opened, each once, through
   * each owner whose flags take that route. One whose delivery fails stays waiting, and the hook that opened the
   * route rejects naming the adapter; nothing is dropped unheard.
   */
  private async flush(session: string, b: Bound, route: Route): Promise<void> {
    const owners = this.owners(b).flatMap((name) => { const fill = this.adapterFills.get(name); return fill && this.opens(fill.caps, route) ? [{ name, fill }] : []; });
    if (!owners.length || !b.waiting.length) return;
    const failed: string[] = [];
    for (const answer of [...b.waiting]) {
      b.waiting = b.waiting.filter((w) => w !== answer);
      for (const { name, fill } of owners) {
        try {
          await this.deliverVia(fill, name, answer, route);
        } catch (e) {
          if (!b.waiting.includes(answer)) b.waiting.push(answer);
          failed.push(`${name} didn't take ${answer.ask} by ${route}: ${message(e)}`);
        }
      }
    }
    if (failed.length) throw Error(`session ${session}'s waiting answers weren't all delivered: ${failed.join('; ')}`);
  }

  private async deliverVia(fill: { ext: Ext; caps: AdapterCaps }, name: string, answer: Delivery, route: Route): Promise<void> {
    if (!fill.ext.live || !fill.ext.ask || !(await this.options.usable(fill.ext))) throw Error(`the adapter ${name}'s package stopped, so ${answer.ask} wasn't delivered`);
    await this.options.ask(fill.ext, CALL_MS, `adapter ${name}'s delivery`, 'adapter.deliver', { name, answer, session: answer.session, route });
  }
}
