// The criterion ID this redraft's tests carry (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of
// the criterion's text, trimmed, white space collapsed), computed from #191's body as it reads today. Criterion 1's
// text hasn't changed and #2308 strikes no word of it, so this is the frozen suite's ID (REDRAFT.md, Criterion ID).
export const CRITERIA = { 1: '#191.8c7c5edf' } as const;
