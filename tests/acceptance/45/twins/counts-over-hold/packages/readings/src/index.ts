// Planted wrong program (#45): every slow-lane FAIL after the reply counts, the check over the hold by its own time among them.
export * from './impl.js';
import { budgetCost as realBudgetCost } from './impl.js';

export function budgetCost(...args: Parameters<typeof realBudgetCost>): ReturnType<typeof realBudgetCost> {
  const read = realBudgetCost(...args);
  return { ...read, failed_after_reply: read.failed_after_reply + 1, items: [...read.items, { check: 'journey', claim: read.items[0]?.claim ?? '', turn_started: read.items[0]?.turn_started ?? null }] };
}
