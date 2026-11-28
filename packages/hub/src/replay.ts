// A hub whose record replays its log at the start (#3544): a projection an older build made has other columns, so the
// record's open drops every projection and replays every event before the core starts. The core's worker says how far
// the replay is, the hub's health says so while it lasts, and each command that reads the hub says it in one sentence.
import type { Replaying } from '@deepbuild/record';

export type { Replaying };

/** `rebuilding` of a `hub.health` result: how far the hub's record's replay is, while one runs. */
export function replayingOf(health: unknown): Replaying | undefined {
  const at = (health as { rebuilding?: { replayed?: unknown; events?: unknown } | null } | null | undefined)?.rebuilding;
  return at && Number.isInteger(at.replayed) && Number.isInteger(at.events) ? { replayed: at.replayed as number, events: at.events as number } : undefined;
}

/** A count of events as a person reads it: 47,500. */
export const counted = (events: number): string => events.toLocaleString('en-US');
/** The one sentence a command says of a hub whose record replays: that it is rebuilding, and how far. */
export const rebuilding = (at: Replaying): string => `The hub is rebuilding its tables from the log: ${counted(at.replayed)} of ${counted(at.events)} events replayed.`;

/** A replay as the hub's event loop holds it: `at`, how far it is while one runs, and `begun`, settled once one was first heard of. */
class Replay {
  at: Replaying | undefined;
  private begin!: () => void;
  readonly begun = new Promise<void>((resolve) => { this.begin = resolve; });
  /** What the core's worker says: how far the replay is, or nothing once it has committed. */
  heard(at: Replaying | undefined): void {
    this.at = at;
    this.begin();
  }
}
/** The hub's one replay, the record's at its start, when its open runs one: a hub process holds one record. */
export const replay = new Replay();

/** The planted folds DEEP_HUB_TEST_FOLD names, and how long one holds a page; only tests set it. */
const FOLDS = ['page-1s', 'page-3-never'];
const HOLD_MS = 1000;
/**
 * What the record's open says of its replay, in the core's worker: each word goes to the hub's event loop through
 * `post`, which serves the socket meanwhile. A planted fold holds the replay here, before a page is read: `page-1s`
 * each page for 1 s, and `page-3-never` the first two so and the third for good, so its events are never applied.
 */
export function replayTold(post: (message: { op: 'rebuilding'; at?: Replaying }) => void): (at?: Replaying) => void {
  const fold = process.env.DEEP_HUB_TEST_FOLD;
  if (fold && !FOLDS.includes(fold)) throw Error(`DEEP_HUB_TEST_FOLD=${fold} names no planted fold`);
  let pages = 0;
  return (at) => {
    post({ op: 'rebuilding', ...(at ? { at } : {}) });
    if (!fold || !at || at.replayed >= at.events) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, fold === 'page-3-never' && ++pages === 3 ? Infinity : HOLD_MS);
  };
}
