// The types of side.mjs, for ac3-suites.test.ts (as scripts/lanes.d.mts types scripts/lanes.mjs).
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** What a feed is given: the side's evidence store, the fresh hub's, and `send`, which resolves with the side's answer line. */
export interface Fed {
  evidence: string;
  fresh: string;
  send(line: JsonObject): Promise<JsonObject>;
}

/** What a comparison found: `difference` is the first call whose reply differs from a fresh hub's, or null. */
export interface Compared {
  calls: number;
  kept: number;
  scenarios: number;
  outcomes: Record<string, number>;
  difference: { n: number; text: string } | null;
}

export const REPO: string;
export const SHOW_BIN: string;
export function showBinary(): string;
export function compare(name: string, feed: (side: Fed) => Promise<void>): Promise<Compared>;
export function linesOf(scenario: JsonObject): JsonObject[];
