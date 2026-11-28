// A hook handler that keeps failing is set aside (#2402; design: Extension API, "Several handlers, one reply"). Three
// failures in a row by one extension on one hook kind, each a missed deadline or a throw, and the host stops asking that
// handler: a hook it would have answered takes the policy a failure takes, at once and with no wait for it. A reply in
// time clears the count. The count belongs to the extension's load, so a restart, an update, turning it on again and
// the hub's start each give the handler a fresh try.

/** The failures in a row that set a handler aside (drafted). */
const ASIDE_AT = 3;

/** A handler set aside: its extension, its hook kind, its failures in a row, the last of them, and since when. */
export interface SetAside { extension: string; hook: string; failures: number; last: string; since: number }

interface Misses { count: number; last: string; since?: number }

/** Each loaded extension's failures in a row, by hook kind; a load the host no longer holds takes its count with it. */
export class HandlerMisses {
  private readonly loads = new WeakMap<object, Map<string, Misses>>();
  /** `keepCount` is #2402's planted host: it counts failures and never clears them. */
  constructor(private readonly keepCount = false) {}

  /** The handler as it was set aside, or undefined while it is asked. */
  aside(load: object, extension: string, hook: string): SetAside | undefined {
    const m = this.loads.get(load)?.get(hook);
    return m?.since === undefined ? undefined : { extension, hook, failures: m.count, last: m.last, since: m.since };
  }
  /** A missed deadline or a throw: one more in a row. The one that sets the handler aside returns it. */
  missed(load: object, extension: string, hook: string, reason: string, now: number): SetAside | undefined {
    const kinds = this.loads.get(load) ?? new Map<string, Misses>();
    this.loads.set(load, kinds);
    const m = kinds.get(hook) ?? { count: 0, last: reason };
    kinds.set(hook, m);
    m.count++;
    m.last = reason;
    if (m.count < ASIDE_AT) return undefined;
    m.since = now;
    return this.aside(load, extension, hook);
  }
  /** A reply in time clears the count. */
  replied(load: object, hook: string): void {
    if (!this.keepCount) this.loads.get(load)?.delete(hook);
  }
}
