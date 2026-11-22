// The types of tool-load.mjs's export, for the hub's test that holds the generated counts to it.
type Tool = { name: string; _meta?: Record<string, unknown> };
export function toolLoadCounts(given: { lists: Record<string, Tool[]>; instructions: Record<string, string>; skill: string }): { startTokens: number; wholeTokens: number };
