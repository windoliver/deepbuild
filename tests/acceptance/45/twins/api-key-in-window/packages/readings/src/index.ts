// Planted wrong program (#45): every session reads as on a plan, and its tokens count against the window.
export * from './impl.js';
import { planWindowTokens as realPlanWindowTokens, billingMode as realBillingMode } from './impl.js';

export function planWindowTokens(...args: Parameters<typeof realPlanWindowTokens>): ReturnType<typeof realPlanWindowTokens> {
  const read = realPlanWindowTokens(...args);
  return { ...read, counted_tokens: read.sessions.reduce((sum, s) => sum + s.tokens, 0), sessions: read.sessions.map((s) => ({ ...s, counted: true })) };
}

export function billingMode(...args: Parameters<typeof realBillingMode>): ReturnType<typeof realBillingMode> {
  const read = realBillingMode(...args);
  void read;
  return 'plan';
}
