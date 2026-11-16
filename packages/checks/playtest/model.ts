// A model bot (#1048; Check input: playtest): a model reached through a source picks one listed row between steps on
// the replica's virtual clock. Every `every` steps the run is played to that step, the model is asked for one of the
// rows the piece lists there, given the interface's values, and a reply that isn't one is dropped; the replica then
// puts each kept reply as that row's gesture, stamped at the next step, with the writer bot. Its calls stop at its
// budget. Steps in which it sent no entry never count toward stuck. It counts only through replay: the plug-in judges
// its run and the run's track played again without it, and its runs never count toward a goal or a band.
import { listedAt } from './iface.ts';
import type { PlayAnswer } from './types.ts';

export interface ModelBot { provider: string; every?: number; budget?: { calls?: number; tokens?: number } }
/** What the plug-in asks a model through the hub, and the reply's text with the tokens it spent. */
export type Ask = (provider: string, prompt: string) => Promise<{ text: string; tokens?: number }>;

/** A reply as a row: the first `[action, a, b]` it holds, or nothing. */
export function rowOf(text: string): [number, number, number] | undefined {
  const m = /\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** The prompt: the interface's values at the step, by name, and the rows it lists. */
export function promptOf(values: Record<string, unknown>, rows: [number, number, number][], actions: string[]): string {
  return [
    'You play a game through its listed rows. Reply with exactly one of them, as [action, a, b].',
    `Actions, by index: ${actions.map((a, i) => `${i} ${a}`).join(', ')}.`,
    `Values: ${JSON.stringify(values)}.`,
    `Listed rows: ${JSON.stringify(rows)}.`,
  ].join('\n');
}

/**
 * The steps at which a model bot's run holds a bot entry, from the replies it kept, never read back from a recorded
 * track: each reply after step d is stamped at step d + 1. Its stuck rule counts only these, in its run and its replay.
 */
export function actingSteps(rows: number[][]): (k: number) => boolean {
  const at = new Set(rows.map((r) => r[0]! + 1));
  return (k) => at.has(k);
}

/**
 * A model bot's run: its replies so far, `[step, action, a, b]`, grown by playing to each turn, reading the listed rows
 * and asking. `playTo(steps, rows)` plays the run's first `steps` steps with the replies `rows`. Answers the rows it
 * kept and the calls and tokens it spent.
 */
export async function modelReplies(o: {
  bot: ModelBot; steps: number; legal: { rows: string; count: string }; names: Record<string, string>; actions: string[];
  playTo: (steps: number, rows: number[][]) => Promise<PlayAnswer>; ask: Ask;
}): Promise<{ rows: number[][]; calls: number; tokens: number }> {
  const every = Math.max(15, o.bot.every ?? 15);
  const calls = o.bot.budget?.calls ?? Infinity;
  const tokens = o.bot.budget?.tokens ?? Infinity;
  const rows: number[][] = [];
  let spent = { calls: 0, tokens: 0 };
  for (let d = 0; d + 1 < o.steps && spent.calls < calls && spent.tokens < tokens; d += every) {
    const a = await o.playTo(d + 1, rows);
    const listed = listedAt(a.values[o.legal.rows]?.[d], a.values[o.legal.count]?.[d]);
    if (!listed.length) continue;
    const values = Object.fromEntries(Object.entries(o.names).map(([n, p]) => [n, a.values[p]?.[d]]));
    const reply = await o.ask(o.bot.provider, promptOf(values, listed, o.actions));
    spent = { calls: spent.calls + 1, tokens: spent.tokens + (reply.tokens ?? 0) };
    const row = rowOf(reply.text);
    // A reply that isn't a listed row is dropped: it sends no entry.
    if (row && listed.some((r) => r.every((v, i) => v === row[i]))) rows.push([d, ...row]);
  }
  return { rows, ...spent };
}
