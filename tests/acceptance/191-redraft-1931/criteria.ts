// The criterion ID this redraft's tests carry (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of
// the criterion's text, trimmed, white space collapsed), computed from #191's body as it reads today. Criterion 1's
// text hasn't changed and names no substeps, so this is the frozen suite's ID, and #1931 gives no reason to change it
// (REDRAFT.md, What the owner decides).
export const CRITERIA = { 1: '#191.8c7c5edf' } as const;
