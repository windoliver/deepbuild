# Acceptance tests for #761: evidence scrub by field name

Drafted blind from issue #761 (its text as of October 26), `docs/technical-design.md` (Privacy; Evidence, the
record object; the Dogfooding bullet) and the base commit `b7bccf9` (origin/main), which has no implementation.
Per AGENTS.md, the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job.

The suite extends #15's evidence store tests and reuses their surface and helpers: it writes through
`openEvidenceStore({ root, now }).connect({ role: 'deepbuild', via: 'job' })` and `storeText` (one text sink,
one chunk), reads back with `store.read(hash)`, and searches every file under the root with `filesContaining`.
Helpers come from `../15/helpers.ts`. The reference-Mac gate and judge in `budgets.test.ts` are copied from
`tests/acceptance/15/budgets.test.ts`, which doesn't export them.

## Running

The root `vitest.config.ts` includes `tests/**/*.test.ts` (through `testGlobs('ts')` in `scripts/lanes.mjs`), so
the unit lane's parallel block already picks this folder up. By hand:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/761 --reporter=verbose
```

`--root tests/acceptance/761` works too (Vitest's defaults; the folder has no config). The suite takes well under
a second on the base; off the reference Mac the budget test is skipped at once. The budget test times a scrub
on the reference Mac, as #15's does: the implementer should add `tests/acceptance/761/budgets.test.ts` to
`alone` in `scripts/lanes.mjs`, as #14's, #42's and others' budget files are, so it doesn't run beside the
parallel block. That edit is outside this folder, so it isn't made here.

## What the tests hold

IDs are `#761.` plus the first 8 hex of the SHA-256 of each criterion's text, trimmed, whitespace collapsed and
`- [ ] ` dropped (the command in `tests/acceptance/48/README.md`).

| ID | Criterion (short) | Test | On the base |
|---|---|---|---|
| AC1 `#761.609597be` | the nine lines are stored with every value replaced and every field name kept; main keeps all nine, naming the first | `redaction.test.ts`: *each line stored alone…*; and the one-log test | fails, naming `Authorization: Bearer q7Zp2LmX9vR4tY8w` (9 of 9 kept) |
| AC2 `#761.542dabc6` | `"input_tokens": 1234`, `"max_tokens": 4096`, `tokenizer=cl100k` and `Authorization required for this route` stored unchanged; a scrub matching secret words inside longer names fails, naming the line | `redaction.test.ts`: *… stored byte for byte*; and the one-log test | passes (the base has no field rules); fails on the twin, naming `"input_tokens": 1234` |
| AC3 `#761.51e647b5` | with the field rules, redaction still adds under 10 ms per MB of text, on the reference Mac | `budgets.test.ts` | skipped INCONCLUSIVE (this Mac is a Mac15,12) |

### AC1: the nine lines

Each line is printed with `run: { held: [] }` and no env, so no scrub list names its value and the gitleaks
rules don't match it (the base keeps all nine). Each is stored alone in a fresh store, and the test fails on
the first of the nine, in the issue's order, that:

- doesn't keep its field name and separator: `Authorization:`, `Proxy-Authorization:`, `Cookie:`,
  `Set-Cookie:`, `access_token=`, `token=`, `password:`, `{"password":` and `{\"client_secret\":`;
- keeps any part of its value after that name. "Every value replaced" is read from the issue's rules:
  - header rule, the whole value to the end of the line: the scheme goes too (`Bearer`, `Basic`), and so do
    `theme=dark` after `Cookie: sid=…;` and `Path=/` after `Set-Cookie: sid=…;` (the parts checked are `sid`,
    the value, `theme`, `dark`, `Path`);
  - auth-scheme rule, to the end of the line: `access_token=Bearer …` loses `Bearer`, and
    `token=Bot q7Zp2LmX9vR4tY8w.sig_part-2` loses `Bot`, the value and `.sig_part-2`;
  - a quoted value goes whole: `password: "hunter two words"` loses all three words;
  - JSON escaped once inside a string (the printed line holds the backslashes) loses the value and keeps
    `client_secret`;
- leaves nothing after the name (deleted rather than replaced);
- leaves a distinctive part of its value (`q7Zp2LmX9vR4tY8w`, `dXNlcjpodW50ZXIy`, `theme=dark`, `Path=/`,
  `sig_part-2`, `hunter two words`, `hunter2`) in any file under the store's root: scrubbed on read is not
  scrubbed before hashing.

The mask itself isn't pinned: the design names none. The current one is `[REDACTED]`, which holds none of the
parts above. Whether the quotes around a quoted value stay is left open.

### AC2: the four twins

Each line is stored alone and must come back byte for byte, newline included. The test names the first that
changed.

### Both in one log

A third test prints the nine and the four together, one per line, in one log. The stored log must have the same
13 lines (a rule that runs "to the end of the line" past the newline would eat the next one), each of the nine
judged as in AC1 and each of the four unchanged; then every file under the root is searched once for the nine's
distinctive parts. It carries both IDs. This is the issue's Proof: "the nine lines and their four twins, as
printed and as stored". Every test prints each line as printed and as stored.

### AC3: the budget

As #15's AC12: 8 MB of build output, six texts, the first a warm-up; each is stored through the text sink with
the scrub, and its bytes (one byte changed, so nothing dedupes) through `put` with none; the reading is the
difference per MB. The text exercises the new rules: one line in 500 is one of the nine shapes or `x-api-key:`
with a fresh 16-character value, one in 500 a held value (as #15's), and one in 50 a near miss
(`"input_tokens": N, "max_tokens": 4096} tokenizer=cl100k`). The judge is #15's: PASS when all five readings are
under 10, FAIL when all five are over by more than the margin (the larger of 5% and their spread), otherwise
INCONCLUSIVE; off the reference Mac (Mac15,7, mains power, Low Power Mode off, thermal state nominal) it is
skipped as INCONCLUSIVE, never passed.

"Compared with the merge base" is read as the frozen budget, which is the same 10 ms per MB at the merge base
(#15's AC12) and with the field rules; the suite times only the checkout it runs in. The preflight's perf lane
does the merge-base pairing. A reading on this Mac (not the reference Mac, on mains, load 4.6) with the
reference-Mac gate removed in a scratch copy of the base read 5.7 to 6.9 ms per MB for the base's scrub on this
text; it is in `BASE-FAILURE.txt` part 3 as a reading only.

## The wrong program: `twins/secret-words-inside-names`

The base passes AC2, since it has no field rules. AC2's wrong program is the one its criterion names: a scrub
that matches secret words inside longer names. `twins.json` names it for `#761.542dabc6`, so the proof lane
lays it over the change. It is `packages/evidence/src/scrub.ts` as at the base, plus about ten lines marked
`WRONG PROGRAM`: a header rule keyed on the word with any separator, and a field rule matching a secret word
anywhere in a name. It passes AC1 (all nine scrubbed, nothing on disk), which also shows AC1 can pass through
this surface, and fails AC2 on all four lines, naming `"input_tokens": 1234` first. `BASE-FAILURE.txt` part 2
is that run, in a scratch copy of the base with the twin laid over.

The twin replaces the whole of `scrub.ts` and keeps the base's exports (`scrub(text, values, patterns)`,
`scrubList(run)`, `Run`). If the implementation changes what `index.ts` imports from `scrub.ts`, the twin no
longer lays over cleanly; that is a dispute for a redraft of this job, not an edit to the twin.

## Not covered here

- Every secret word in the Scope (passwd, pwd, api key, access key, private key, credential(s), session key,
  `x-api-key` as a header) and every split (`-`, `.`, case changes) beyond what the nine lines use; the
  criteria name only the nine and the four. The budget text uses `x-api-key:` but doesn't check it.
- A field split across output chunks. The criteria don't ask; each text here is one chunk.
- The license notice and commit named in the receiving file (Scope), which is a review item, not a test.
- `redaction: complete` on these texts: unchanged by this issue, held by #15's tests.
