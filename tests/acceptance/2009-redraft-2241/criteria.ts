// The criterion ID this redraft's tests carry (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of
// the criterion's text, trimmed, white space collapsed), computed from #2009's body as it reads today. Criterion 3's
// text hasn't changed, so this is the frozen suite's ID. An ID follows its text: if the owner strikes the clause #2241
// lifts, this one line takes the ID of the new text (REDRAFT.md, What the owner decides, gives it).
export const CRITERIA = { 3: '#2009.43ed60cb' } as const;
