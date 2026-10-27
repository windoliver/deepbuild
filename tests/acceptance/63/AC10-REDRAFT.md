# AC10 blind redraft: the quote rule, through one reading job

Test: `quotes-redraft.test.ts`, one `describe` ("AC10 #63.46c00344 a quote is at its handle only as a byte-exact
substring of the redacted slice it names, after NFC and whitespace collapse, citing its message (redraft)") with one
`it`, a fresh draft of the AC10 test in `quotes.test.ts`. The ID is the first 8 hex of the SHA-256 of the criterion's
text with `- [ ] ` dropped, trimmed and each whitespace run collapsed to one space, as `scripts/proof-change.mjs`'s
`criterionId` does (checked: `46c00344`, the same as `helpers.ts`'s `AC[10]`).

The criterion: "A quote is at its handle only when it is a byte-exact substring of the redacted slice that handle
names, after Unicode NFC and collapsing each whitespace run to one space, and a quote from a transcript cites its
message (`#<message>`): a quote that differs only by a line break is at its handle, one with a word changed is
refused, naming the handle, and so is one that cites the whole session; a check that compares case-folded text
accepts 'Port 3000' for 'port 3000' and fails this test".

No existing file in `tests/acceptance/63` was edited, and nothing was added beside this note, the test and the base
run's output: the test uses `session`/`tag` (corpus.ts), `openWorld`/`runReading`/`dataOf` (world.ts),
`readAll`/`norm`/`AC`/`cleanup` (helpers.ts), `storedMessages`/`caseProblems` (checks.ts) and `foldedCheck`
(wrong.ts) as they are.

## What I read

- Issue #63 (`gh issue view 63`): Scope, the ten criteria, Proof, Depends on.
- `docs/technical-design.md`, Reading by reference, "Answers cite handles": the same quote rule, "a quote from a
  transcript cites its message (`#<message>`), never the whole session"; the redacted slice; and AGENTS.md.
- The suite: `README.md` (the surface: `deep read`, the reading job's result `findings`/`dropped`, `reading.dropped@1`;
  the fake agent; the wrong programs), `helpers.ts`, `world.ts`, `corpus.ts`, `checks.ts`, `wrong.ts`, the head and
  answer path of `fixtures/fake-reader.pl`, and `quotes.test.ts` (the first draft).
- At the base: `packages/evidence/src/index.ts` and `scrub.ts` (`scrubText`: the pattern scrub, mask `[REDACTED]`),
  the archive's use of `scrubText`, and a search for `normalize(` in `packages/*/src` (no store or archive path
  normalizes text).
- `tests/acceptance/387/A9-REDRAFT.md` for this note's shape.

## The cases and what the test asserts

One session (seed 6310, 7 messages, archived by the real archive), one `summary` reading job delivered its handle,
one planted finding per case (`case: <name>`, one cite). `S` is the session handle, `#mN` its message N.

| # | Case | Cites | The slice holds | The quote | Expected |
|---|---|---|---|---|---|
| 1 | exact | `S#m1` | `The api listens on port 3000 once it has started.` | `listens on port 3000` | at |
| 2 | a line break apart (the criterion's) | `S#m2` | `npm run dev\nand then open the browser` | `npm run dev and then open the browser` | at |
| 3 | NFC quote of an NFD slice | `S#m3` | `The 한국어 page …`, the word as 9 conjoining jamo (NFD) | `The 한국어 page is served`, 3 syllables (NFC) | at |
| 4 | NFD quote of an NFC slice | `S#m4` | `The 서울 office opens at nine.`, NFC | `The 서울 office opens`, NFD | at |
| 5 | a whitespace run in the slice | `S#m5` | `retries \t  three\t times before` | `retries three times before` | at |
| 6 | a whitespace run in the quote | `S#m1` | as 1 | `listens  on\n\t port 3000` | at |
| 7 | a word changed (the criterion's) | `S#m1` | as 1 | `listens on port 4000` | refused |
| 8 | `Port 3000` for `port 3000` (the criterion's) | `S#m1` | as 1 | `listens on Port 3000` | refused |
| 9 | the whole session cited (the criterion's) | `S` | the session | `listens on port 3000` | refused |
| 10 | another message of the session cited | `S#m2` | as 2 | `listens on port 3000` | refused |
| 11 | a compatibility form (NFKC, not NFC) | `S#m6` | `The fixture loader reads its seeds first.` | `The ﬁxture loader` (U+FB01) | refused |
| 12 | the secret as it was before redaction | `S#m7` | `The deploy token is [REDACTED] and …` | `deploy token is ghp_…` (a made-up token) | refused |
| 13 | the redacted text as the slice holds it | `S#m7` | as 12 | read from the served slice: `deploy token is` … `and it rotates` | at |

Each message also starts with its corpus tag (`[q6310mN]`). What the test asserts, in order:

1. The fixture: each word's NFD form differs from its NFC form.
2. The record: the archived copy (`storedMessages`: the evidence the `transcript.archived` event links) holds message
   3 in NFD and not in NFC, and message 4 in NFC. So the normalization difference reaches the record, and the check
   has to do NFC itself.
3. The redacted slice `#m7` names (`deep read`) doesn't hold the token, and keeps the words around it; case 13's
   quote is cut from that served text.
4. The rule itself (`norm` from helpers.ts: NFC, then each whitespace run one space; a message handle) gives every
   expected verdict on the slices `deep read` serves. So whatever form `deep read` serves the text in, the expected
   verdicts are the criterion's on that redacted text.
5. After the planted findings are installed (`w.plant`), the reading job runs through the runner (`runReading`);
   each case's verdict is read from its result: kept (`findings` holds `case: <name>`, nothing `dropped` for it) is
   `at`; dropped (`dropped` lists its handle and quote, no finding kept) is `refused`, and the refusal's `reason`
   names the handle. All 13 verdicts must be the expected ones (`caseProblems` empty).
6. Each refused case has a `reading.dropped` event of this reading naming the handle and the quote, with a reason
   naming the handle. No case expected `at` has one.
7. The wrong program (below), judged by the same `caseProblems`, gets exactly one case wrong: case 8.

How the NFC case's bytes reach the reading job: the test builds both forms from code points (`'한국어'
.normalize('NFD')` and `'NFC'`), never typed accented text, so neither the source file's encoding nor an editor
can make both sides the same form. The NFD text is in the message `writeTranscript` writes (`JSON.stringify`, so the
JSONL holds the jamo as raw UTF-8); the real archive's pass reads it, scrubs it (`scrubText` works on bytes and
doesn't normalize; checked at the base) and stores it as evidence linked by `transcript.archived` (assertion 2 reads
it back from there). The NFC quote goes the other way: `installFake` puts the planted findings into the fake as
base64 of their UTF-8 JSON, the fake decodes them and prints them in its answer. The fake prints without an encoding
layer, so every non-ASCII character in the planted quotes is above U+00FF (Hangul, U+FB01): Perl then writes the
whole line as UTF-8. Case 4 is the same with the forms swapped, so a check that normalizes only one side, or a
`deep read` that serves NFC slices to a check that never normalizes the quote, still fails one of 3 and 4.

## The wrong program

`foldedCheck` (wrong.ts, unchanged): the quote rule with case-folded comparison (NFC, whitespace collapsed,
`toLowerCase` on both sides, a session handle without `#` refused), run on the same redacted slices `deep read`
served. It judges case 8 `at` and every other case as expected, so the test asserts its problems are exactly one,
naming `'Port 3000' for 'port 3000'`.

Checked off line on stand-in slices (each message's text through `scrubText`, a throwaway test since removed): the
rule gives no problems; `foldedCheck` exactly case 8; a check normalizing only the slice fails case 4; one with no
normalization fails cases 2 to 6; one that compares NFKC fails 11.

## What the issue and design left open, and what I chose

- **Which side is normalized.** "A byte-exact substring of the redacted slice … after Unicode NFC and collapsing each
  whitespace run" doesn't say whether the quote is normalized too. I read it as both, as the line-break case needs
  (the quote's space against the slice's line break) and as `norm` in helpers.ts does; cases 4 and 6 hold the quote
  side to it.
- **NFC, not NFKC; byte-exact otherwise.** Case 11 holds that a compatibility form (a ligature) is not at its handle,
  since NFC keeps it and only NFKC folds it. Punctuation, trimming and other forms aren't tested.
- **"Cites its message".** Besides the whole session (the criterion's), case 10 cites the wrong message of the right
  session: "at its handle" is the slice that handle names, not the session holding it.
- **The redacted slice.** Cases 12 and 13 test "redacted": the secret's raw form is refused and the slice's masked
  text is at its handle. The criterion doesn't name either; I kept 12 from the first draft and added 13, which takes
  its quote from the served slice so the mask's spelling stays the implementer's.
- **Reading the verdicts.** As the README says: a kept finding and a `dropped` entry with a `reading.dropped` event.
  A finding both kept and dropped, or neither, is "not judged" and fails.
- **The job kind.** A `summary` job delivered the session handle, as the first draft; the criterion names no kind.

## Type check

`node node_modules/typescript/bin/tsc -p tests/acceptance/63/tsconfig.json --noEmit`: this file's only errors are two
TS7006 (`f`, `d` implicitly `any`) on `result.findings`/`result.dropped`, because `ReadingResult` comes from
`packages/reading`, which the base lacks (world.ts's TS2307); `quotes.test.ts` has the same ones.

## Run on the base

`npm ci --ignore-scripts`, then `npm run build --workspaces` (the archive workspace's build fails at the base on a
module resolution error, but `packages/cli/dist/main.js` is built), then
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/63 quotes-redraft --no-file-parallelism`
(output in `AC10-REDRAFT-BASE.txt`): 1 test, 1 failed. Assertions 1 and 2 pass (the NFD bytes are in the archived
copy); it fails at assertion 3, because the base has no `deep read`:

```
AssertionError: deep read session:e46b52c768e14997841a712152f95e1b#m7 --slice  exits 0: Unsupported command. Run deep --help for available commands.
: expected 2 to be +0 // Object.is equality
```
