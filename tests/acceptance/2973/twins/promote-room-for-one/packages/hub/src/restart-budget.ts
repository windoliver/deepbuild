// THROWAWAY (blind job for #2973, never delivered): the installed hub's restart budget, kept under its root.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_RESTARTS = 6;
export const WINDOW_MS = 60 * 60_000;
export const budgetFile = (dir: string): string => join(dir, 'restarts.json');

export type Budget = { ok: true; spent: number[]; file: string } | { ok: false; why: string; file: string };

/** The restarts spent in the window ending `now`: a missing file is none, a bad one reads as spent. */
export function readBudget(dir: string, now: number): Budget {
  const file = budgetFile(dir);
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, spent: [], file };
    return { ok: false, file, why: `the restart budget's file ${file} can't be read (${(error as NodeJS.ErrnoException).code ?? String(error)})` };
  }
  try {
    const value = JSON.parse(text) as { restarts?: unknown };
    if (!Array.isArray(value.restarts) || !value.restarts.every((t) => typeof t === 'number' && Number.isFinite(t))) throw Error('it holds no list of restart times');
    return { ok: true, file, spent: (value.restarts as number[]).filter((t) => t > now - WINDOW_MS).sort((a, b) => a - b) };
  } catch (error) {
    return { ok: false, file, why: `the restart budget's file ${file} doesn't parse (${error instanceof Error ? error.message : String(error)})` };
  }
}
/** How many restarts the budget has room for at `now`, and when the next frees up. */
export function room(budget: Budget): { left: number; frees?: number } {
  if (!budget.ok) return { left: 0 };
  const left = Math.max(0, MAX_RESTARTS - budget.spent.length);
  return { left, ...(budget.spent.length ? { frees: budget.spent[0]! + WINDOW_MS } : {}) };
}
export function spend(dir: string, budget: Budget & { ok: true }, now: number): void {
  const file = budgetFile(dir);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ v: 1, restarts: [...budget.spent, now] })}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
const PERSON = 'A person can still stop and start the hub with deep hub stop (which asks the OS to confirm you) and deep hub start.';
/** Why a restart is refused, or undefined when the budget has room for `need`. */
export function refusedFor(budget: Budget, need = 1): string | undefined {
  if (!budget.ok) return `The hub restarts at most ${MAX_RESTARTS} times in any 60 minutes on the control token, and ${budget.why}, so it reads as spent. ${PERSON}`;
  const { left, frees } = room(budget);
  if (left >= need) return undefined;
  return `The hub restarts at most ${MAX_RESTARTS} times in any 60 minutes on the control token: ${budget.spent.length} are spent${need > 1 ? `, leaving room for ${left}, not ${need}` : ''}. The next restart frees up at ${new Date(frees!).toISOString()}. ${PERSON}`;
}
