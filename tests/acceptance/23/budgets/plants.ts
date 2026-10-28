// The wrong programs the budget criteria name, planted around the real ledger, asks core and resolver-decisions:
// each is the real program with one part done wrong, so a scenario that passes on the real one fails on its plant
// for the reason its criterion names. plants.test.ts runs each criterion's scenario against them.

import { BudgetRefused } from '../../../../packages/budget/src/index.ts';
import type { Ledger } from '../../../../packages/budget/src/index.ts';
import type { Resolver } from '../../../../packages/asks/src/index.ts';
import { REPO_A, REPO_B, ulid, type BudgetPlanting, type BudgetWorld } from './helpers.ts';

/** What the planted resolver counts for itself: each budget's cap less every cost reading it saw. */
function chargedCount(b: BudgetWorld, cap: number): number {
  return cap - b.spent;
}

/**
 * #23.d3776517: a resolver that answers from its own count of what was charged. It reads a budget as its cap less
 * the cost readings that landed, never the reservations held, and where that count has room it lets the run through
 * as decided for you, whatever the core's ledger says is left.
 */
export const chargedOnly: BudgetPlanting = {
  ledger: (real: Ledger, b: BudgetWorld): Ledger => ({
    ...real,
    budget: async (id) => {
      const view = await real.budget(id);
      return { ...view, reserved_usd: 0, reservations: [], left_usd: chargedCount(b, view.cap_usd) };
    },
    resolve: async (connection, ask, answer) => {
      try {
        return await real.resolve(connection, ask, answer);
      } catch (error) {
        const cap = b.caps.get(answer.budget);
        if (!(error instanceof BudgetRefused) || b.pricing === null || cap === undefined || chargedCount(b, cap) < b.pricing) throw error;
        const now = b.w.clock.now();
        await b.w.record.append({ writer: 'core', actor: 'you', scope: 'you', ...(connection.session ? { session: connection.session } : {}) }, {
          v: 1, id: ulid(now), kind: 'decision.applied', subject: ask, ts: now, data: { decision: answer.decision, ask },
        });
        return { run: error.run ?? '', status: 'started', reserved: [{ budget: answer.budget, usd: b.pricing }] };
      }
    },
  }),
};

/**
 * #23.67403f66: a resolver that never reads which repo a paid run was asked in: every request from repo B is read as
 * asked in repo A, in a session of repo A, so the budget you approved for repo A answers it.
 */
export const repoIgnored: BudgetPlanting = {
  resolver: (real: Resolver): Resolver => (ask) => real(ask.repo === REPO_B ? { ...ask, repo: REPO_A, session: 'S1' } : ask),
};
