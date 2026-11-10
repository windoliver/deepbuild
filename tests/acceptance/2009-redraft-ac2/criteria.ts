// The criterion IDs this redraft's tests carry (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of
// each criterion's text, trimmed, white space collapsed), computed from the live issue. Criterion 2's text changed (its
// bound is now 2e-5 m), so its ID did; this map, not `AC` in ../2009/helpers.ts, is where these tests take theirs.
export const CRITERIA = { 1: '#2009.59ac371b', 2: '#2009.f5168c7a' } as const;
