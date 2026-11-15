// #2365's acceptance criteria, word for word as the issue states them, and their IDs as the proof lanes compute them
// (scripts/proof-change.mjs: `#<issue>.` and the first eight hex digits of the SHA-256 of the text, trimmed, white
// space collapsed). Computed here at load, so the IDs are the text's and nothing typed by hand.
import { createHash } from 'node:crypto';

export const CRITERIA = {
  1: "A Claude Code transcript of 100 MB, 94% of it tool results with one line of 2 MB, already archived, gains 1 MB. The pass that follows adds under 2 MB to the evidence store, ends within 1 s, raises the process's resident memory by under 64 MB, and the process serves a 5 ms timer at least every 50 ms throughout (the three limits are drafted). On the merge base the same pass takes 5.8 s or more, serves no timer for up to 1.2 s, peaks above 800 MB and stores a whole copy. A planted archive that reads the file whole fails, naming the peak",
  2: 'A transcript of 600 MB, never archived, is copied in one pass: its parts read back in order equal the file scrubbed a line at a time, and `session:<id>#m<n>` resolves for its last message. On the merge base the pass says it left 1 copy undone and stores nothing',
  3: "A key pasted into a line that is half written when a pass runs is in no part in any form: that pass copies up to the last complete line, the next copies the rest, and the rotate ask is raised once. A planted archive that cuts at the file's end stores the key's first half in one part and fails, naming the part",
  4: "A transcript whose first megabyte was rewritten after its last copy is copied again from its start, and the session's handles resolve through the new parts. A planted archive that appends the rewritten file's tail to the old parts fails, naming the first line that differs",
  5: "For every transcript in #20's suite and its perf tasks, the parts joined are byte-identical to the one copy the merge base stores of the finished file, and a second pass over an unchanged transcript reads none of it",
  6: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a new perf task holds the first criterion's pass, and `archive-live`, `archive-month` and `archive-backlog` stay within their limits",
} as const;
export const criterionId = (n: keyof typeof CRITERIA): string => `#2365.${createHash('sha256').update(CRITERIA[n].trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
