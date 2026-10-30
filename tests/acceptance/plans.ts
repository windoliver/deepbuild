// Shared by earlier suites after #69 made a plan part of every authority ask (#69.9eb13dee, design: Plans
// before acting). Those suites raised authority asks without one and approved with no plan's hash; a proposal you
// approved changes each one's helper to raise through `withPlans` and approve with `shownPlanHash`, leaving every
// assertion as it was.
import { createHash } from 'node:crypto';
import { askSources } from '../../packages/asks/src/index.ts';
import type { Asks, PlanInput } from '../../packages/asks/src/index.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * The one-step plan an earlier suite's authority ask shows, from its source alone, so asks those suites hold to be
 * twins show the same plan: the effect, undone by a revert.
 */
export function planOf(source: string): PlanInput {
  return { steps: [{ does: `What ${source} asks`, changes: [source], undo: 'Revert it', public: true, cost: 0 }], diff: sha256(source) };
}

/** The asks core, with each authority ask raised without a plan given the one its question names. */
export function withPlans(asks: Asks): Asks {
  return {
    ...asks,
    raise: (connection, source, ask, plan) => asks.raise(connection, source, ask, plan
      ?? (askSources().find((r) => r.source === source)?.kind === 'authority'
        ? planOf(source) : undefined)),
  };
}

/** The hash of the plan an ask's card shows, which an approval binds; null on an ask with none. */
export const shownPlanHash = async (asks: Asks, ask: string): Promise<string | null> => (await asks.card(ask)).plan?.hash ?? null;
