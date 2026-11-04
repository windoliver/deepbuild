// Planted wrong program (#45): each failed run of a check counts.
export * from './impl.js';
import { budgetCost as realBudgetCost } from './impl.js';

export function budgetCost(...args: Parameters<typeof realBudgetCost>): ReturnType<typeof realBudgetCost> {
  const read = realBudgetCost(...args);
  const again = args[0].filter((e) => e.kind === 'run.finished' && e.data.outcome === 'failed' && read.items.some((i) => i.check === e.data.check));
  return { ...read, failed_after_reply: again.length, items: again.map((e) => ({ ...read.items.find((i) => i.check === e.data.check)! })) };
}
