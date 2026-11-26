// Shared by earlier suites after #1581 made every ask declare what may answer it (#1581.124656c7; design: Every ask
// ends). Those suites raised asks with no declaration, which the asks core now refuses; a proposal you approved changes
// each one's helper to raise through `withDeclared`, leaving every assertion as it was.
import { askSources } from '../../packages/asks/src/index.ts';
import type { Asks } from '../../packages/asks/src/index.ts';

/**
 * An ask as an earlier suite raises it, with the declaration its place makes: the one its row's example ask carries
 * in ask.sources@2. An ask that declares one, or whose source has no row, is left as it is.
 */
export function declared<T>(source: string, ask: T): T {
  const example = askSources().find((r) => r.source === source)?.fixture.ask as { may_answer?: string } | undefined;
  if (typeof ask !== 'object' || ask === null || Array.isArray(ask) || 'may_answer' in ask || !example?.may_answer) return ask;
  return { ...ask, may_answer: example.may_answer };
}

/** The asks core, with each ask an earlier suite raises without a declaration given its place's. */
export function withDeclared(asks: Asks): Asks {
  return { ...asks, raise: (connection, source, ask, plan) => asks.raise(connection, source, declared(source, ask), plan) };
}
