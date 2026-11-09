// Stalled claims (#325; design: Stalled claims): the hold stops sending an agent back at whichever comes first, its
// claim's open items unchanged on two stops in a row with no new passing evidence, or three send-backs without new
// evidence, and the claim becomes one decision for you. New evidence is a check passing that didn't at the stop
// before; a check run again with the same result is none. The hub keeps one count per task and skips the stops a
// question holds, which count toward neither limit.

/** What one stop that would be sent back shows: its open items, the checks passing on it and the runs it made. */
interface StopReading { items: string[]; passing: string[]; runs: string[] }
/** One task's count: send-backs since its last new evidence, the stop before, and the rule it stalled on, if it did. */
export interface StallCount { rounds: number; last?: { items: string; passing: Set<string> }; seen: Set<string>; stalled?: string }
export type StallRule = 'two stops with the same open items' | 'three send-backs without new evidence' | 'four stops in a row did work and ended on an empty message';
/** The stop's fate: sent back as round `round` of 3; or not, because the claim stalled at this stop (`stalled`) or before. */
type StopFate = { sendBack: true; round: number } | { sendBack: false; stalled?: StallRule };

/** Send-backs in a row without new evidence before the claim comes to you instead. */
const ROUNDS = 3;
export const freshCount = (): StallCount => ({ rounds: 0, seen: new Set() });

/** Judges one stop against its task's count, which it moves on. `anyRun` is the planted wrong program's rule: any new run is new evidence. */
export function judgeStop(count: StallCount, stop: StopReading, anyRun = false): StopFate {
  const items = JSON.stringify([...new Set(stop.items)].sort());
  const passing = new Set(stop.passing);
  const fresh = anyRun ? stop.runs.some((r) => !count.seen.has(r)) : count.last !== undefined && [...passing].some((c) => !count.last!.passing.has(c));
  const same = count.last !== undefined && count.last.items === items;
  for (const r of stop.runs) count.seen.add(r);
  count.last = { items, passing };
  if (fresh) {
    count.rounds = 0;
    delete count.stalled;
  }
  // A claim that stalled stays with you until new evidence comes: no further send-back, and no second decision.
  if (count.stalled) return { sendBack: false };
  const rule: StallRule | undefined = !fresh && same ? 'two stops with the same open items' : count.rounds >= ROUNDS ? 'three send-backs without new evidence' : undefined;
  if (rule) {
    count.stalled = rule;
    return { sendBack: false, stalled: rule };
  }
  count.rounds += 1;
  return { sendBack: true, round: count.rounds };
}
