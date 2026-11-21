// A promotion's drain (#1334) as a lease (#2974): session starts pause only while the caller keeps renewing it, so a
// command's child that holds the control token, or a promotion that died, can't hold your Send for good. While it
// holds, whose it is and since when show in the hub's health, in `deep status` and in each start it refuses.
import { visible } from './visible.js';

/** A drain nobody renewed for this long lapses by itself, and session starts work again. */
const DRAIN_LEASE_MS = 30_000;

/** The process that took the drain, as its connection named it: its PID and, where it can be read and shown, its command line. */
export interface DrainHolder { pid: number; command?: string }
/** A drain that holds: its holder (null when the caller named no process), since when, and when it lapses (epoch ms). */
export interface HeldDrain { holder: DrainHolder | null; since: number; lapses: number }

export class Drain {
  private held: { holder: DrainHolder | null; since: number; renewed: number } | undefined;
  /** How many lifts so far: a take that a lift overtook while it read the holder's command line doesn't hold. */
  private lifts = 0;

  constructor(private readonly now: () => number, private readonly argsOf: (pid: number) => Promise<string>) {}

  /** Takes or renews the drain for the caller's process; a renewal keeps when it began. */
  async take(peer: { pid: number } | undefined): Promise<void> {
    const lifts = this.lifts;
    const was = this.read();
    // The command line as you'd read it, control and direction-changing characters shown as text (#1510).
    const holder = !peer ? null : was?.holder?.pid === peer.pid ? was.holder : { pid: peer.pid, command: visible(await this.argsOf(peer.pid)) };
    if (lifts !== this.lifts) return;
    const at = this.now();
    // A renewal keeps when the drain began; another holder's take begins it anew.
    this.held = { holder, since: was && was.holder?.pid === holder?.pid ? was.since : at, renewed: at };
  }

  lift(): void { this.lifts++; this.held = undefined; }

  /** The drain while it holds, or undefined once lifted or lapsed. */
  read(): HeldDrain | undefined {
    if (this.held && this.now() - this.held.renewed >= DRAIN_LEASE_MS) this.held = undefined;
    return this.held && { holder: this.held.holder, since: this.held.since, lapses: this.held.renewed + DRAIN_LEASE_MS };
  }
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The drain as a reader sees it: a person on another machine gets the holder's PID, never its command line's arguments. */
export const drainFor = (d: HeldDrain, role: string): HeldDrain => (role.startsWith('person:') && d.holder ? { ...d, holder: { pid: d.holder.pid } } : d);

/** What the hub's health holds for a drain: plain fields, the times as ISO-8601. */
export const drainHealth = (d: HeldDrain) => ({ paused: true, holder: d.holder, since: iso(d.since), lapses: iso(d.lapses) });

/** The one sentence `deep status` and a refused start say about a drain. */
export function drainWords(d: HeldDrain): string {
  const who = d.holder ? `process ${String(d.holder.pid)}${d.holder.command ? ` (${d.holder.command})` : ''}` : 'a process that named none';
  return `Session starts are paused: a drain from ${who} holds them since ${iso(d.since)}, and it lapses at ${iso(d.lapses)} unless renewed.`;
}
