// The installed hub's restart budget (#2973): the restarts asked for on the token alone, kept under the hub's root so
// the count holds across the restarts it limits.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSynced } from './vfs.js';

/** At most this many restarts on the token alone in any window. */
export const RESTARTS = 6;
/** The window, by the hub's clock. */
const RESTART_WINDOW_MS = 60 * 60_000;
/** The restarts `deep hub promote` may need: one to the new build, one to roll back. */
export const PROMOTE_RESTARTS = 2;

/** What the budget leaves now: how many restarts, and when the next frees up; `bad` names a file that reads as spent. */
interface Budget { left: number; frees?: number; bad?: string; at: readonly number[] }

export const budgetFile = (dir: string): string => join(dir, 'restarts.json');

/** The budget at `now`: a missing file is nothing spent; one that can't be read or doesn't parse is spent. */
export function readBudget(dir: string, now: number): Budget {
  const file = budgetFile(dir);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { left: RESTARTS, at: [] };
    return { left: 0, bad: file, at: [] };
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { left: 0, bad: file, at: [] }; }
  const times = (value as { at?: unknown } | null)?.at;
  if ((value as { v?: unknown } | null)?.v !== 1 || !Array.isArray(times) || !times.every((t) => Number.isSafeInteger(t))) return { left: 0, bad: file, at: [] };
  // A time ahead of the clock (a clock set back) still counts: the budget never grants more than it spent.
  const at = (times as number[]).filter((t) => t > now - RESTART_WINDOW_MS).sort((a, b) => a - b);
  const left = Math.max(0, RESTARTS - at.length);
  return { left, at, ...(at.length ? { frees: at[0]! + RESTART_WINDOW_MS } : {}) };
}

/** Spends one restart at `now`, synced before the hub exits for it. */
export function spend(dir: string, budget: Budget, now: number): void {
  writeSynced(budgetFile(dir), Buffer.from(`${JSON.stringify({ v: 1, at: [...budget.at, now] })}\n`));
}

/** Why a restart is refused with this budget left, naming what a person can still do; undefined while one is left. */
export function spentWhy(budget: Budget): string | undefined {
  if (budget.bad) return `The hub's restart budget, ${budget.bad}, can't be read, so it counts as spent. Stop and start the hub yourself with deep hub stop and deep hub start.`;
  if (budget.left > 0) return undefined;
  const when = budget.frees === undefined ? '' : `; the next frees up at ${new Date(budget.frees).toISOString()}`;
  return `The hub's restart budget is spent: ${String(RESTARTS)} restarts in any 60 minutes, ${String(budget.left)} left${when}. Stop and start the hub yourself with deep hub stop and deep hub start.`;
}
