// A run's outcome from what its play recorded (Check input: playtest), never from a frame: reached once it reaches
// every goal; ended when its span runs out with no failure; stuck from the step its measure last moved, once it moved
// less than `by` over `within` steps before reaching every goal; a trap in the piece's logic; over budget at the
// first step whose fuel passed its class's ceiling; invalid when its bot trapped. The earliest failure decides. And
// the replay's comparison: the first checkpoint whose full-state hash differs.
import type { Goal, Outcome, PlayAnswer } from './types.ts';

/** How far a measure moved between two of its values: a number's difference, a position's straight-line distance. */
export function moved(a: unknown, b: unknown): number {
  const xs = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : [Number(v)]);
  const [p, q] = [xs(a), xs(b)];
  return Math.sqrt(p.reduce((s, x, i) => s + (x - (q[i] ?? 0)) ** 2, 0));
}

/** Whether a value is true: an array's first element, or the number itself, nonzero. */
const truthy = (v: unknown): boolean => Number(Array.isArray(v) ? v[0] : v) !== 0 && v !== null && v !== undefined;

/** The first step each goal is true in a play, or undefined for one it never reaches. */
export function goalSteps(play: PlayAnswer, goals: Goal[]): Map<string, number | undefined> {
  return new Map(goals.map((g) => {
    const k = (play.values[g.when] ?? []).findIndex(truthy);
    return [g.name, k >= 0 ? k : undefined];
  }));
}

/** A run's outcome, with the step it happened. `within` counts steps. */
export function outcomeOf(play: PlayAnswer, goals: Goal[], stuck: { measure: string; by: number; within: number } | undefined): Outcome {
  if (play.bot_trap) return { kind: 'invalid', step: Number(play.bot_trap['step'] ?? 0), why: `its bot trapped at its step ${String(play.bot_trap['step'])} (${String(play.bot_trap['kind'])})` };
  const reached = [...goalSteps(play, goals).values()];
  const done = goals.length && reached.every((k) => k !== undefined) ? Math.max(...(reached as number[])) : undefined;
  const failures: Outcome[] = [];
  if (play.trap) failures.push({ kind: 'trap', step: Number(play.trap['step']), trap: play.trap });
  for (const [item, list] of Object.entries(play.fuel)) {
    const ceiling = play.ceilings[item] ?? Infinity;
    const k = list.findIndex((f) => f > ceiling);
    if (k >= 0) failures.push({ kind: 'over_budget', step: k, item, fuel: list[k]!, ceiling });
  }
  if (stuck) {
    const list = play.values[stuck.measure] ?? [];
    const until = Math.min(done ?? Infinity, list.length);
    let anchor = 0;
    for (let k = 1; k < until; k++) {
      if (moved(list[k], list[anchor]) >= stuck.by) anchor = k;
      else if (k - anchor >= stuck.within) {
        failures.push({ kind: 'stuck', step: k, from_step: anchor, measure: stuck.measure });
        break;
      }
    }
  }
  const first = failures.sort((a, b) => a.step - b.step)[0];
  if (first) return first;
  return done !== undefined ? { kind: 'reached', step: done } : { kind: 'ended', step: play.steps };
}

/** The first checkpoint step whose full-state hash differs between a run and its replay, or undefined when none does. */
export function firstDiffering(run: PlayAnswer, replay: PlayAnswer): number | undefined {
  const theirs = new Map(replay.checkpoints.map((c) => [c.step, c.hash]));
  const steps = [...new Set([...run.checkpoints, ...replay.checkpoints].map((c) => c.step))].sort((a, b) => a - b);
  const ours = new Map(run.checkpoints.map((c) => [c.step, c.hash]));
  const k = steps.find((s) => ours.get(s) !== theirs.get(s));
  if (k !== undefined) return k;
  return run.final !== replay.final ? Math.min(run.steps, replay.steps) : undefined;
}
