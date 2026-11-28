# Blind redraft of `tests/acceptance/1894`: criterion tags

Written by the blind acceptance-test job for #1894, from the issue, the design's rules as AGENTS.md states them, the
base commit `e87cefc44` and its own earlier suite `tests/acceptance/1894`. It saw no branch or diff of the change.

## The flaw

The trace lane ties a test to a criterion only by a tag `#<issue>.<8 hex>` in the test's full title (`criterionId` in
`scripts/proof-change.mjs`: the first eight hex digits of the SHA-256 of the criterion's `- [ ] ` line), and the before
lane runs only tagged tests on the merge base. The original suite's titles say `AC1 #1894:` and carry no such tag, so
the lanes read every criterion of #1894 as open and ran nothing on the base.

The tags, computed from the issue's criteria as it stands:

| Criterion | Tag |
|---|---|
| 1 `packages/record/src` names no agent and imports no adapter: a test that reads the sources fails on a planted name | `#1894.e096ddb3` |
| 2 A transcript format added in a test adapter is learned from with no edit under `packages/record` | `#1894.93152973` |
| 3 The learned rows for the recorded sessions in the record's suites are byte for byte the merge base's | `#1894.6158c2a1` |
| 4 No visible change: the suites that cover the touched files pass unchanged against the merge base, and each package's type-check passes | `#1894.6f3b1f79` |

## What changed, and what did not

Each test file is the original's with two kinds of edit and no other (`diff -r tests/acceptance/1894
tests/acceptance/1894-redraft-tags` shows them all): the helpers are imported from `../1894/helpers.ts`, and five test
titles gained `AC<n> <tag> ` in front. Every assertion, expected value, test adapter and fixture is the original's. The
helpers, the scan's patterns and the golden `../1894/fixtures/learned-rows.json` are reused by import, not copied; the
test bodies are copied because importing a test file would register its tests under the old titles.

`golden.test.ts` (the base-only golden writer, skipped on every ordinary run) is not carried over: the golden is
already written, and nobody re-records it.

Every test is a top-level `it` in one `describe`; the `describe` titles keep `AC1 #1894:` and so on, which is not a
tag (a tag needs `.` and eight hex digits after the number), so only the five tests below are tagged.

## Original test → redraft test → tag

| Original (`tests/acceptance/1894`) | Redraft title | Tag | At the base |
|---|---|---|---|
| `names.test.ts` › no file under packages/record/src names an agent or imports an adapter | `AC1 #1894.e096ddb3 no file under packages/record/src names an agent or imports an adapter` | `#1894.e096ddb3` | fails at `expect(shownFindings(scanSources(SRC))).toBe('')` |
| `format.test.ts` › a learned change quoting a turn of the new format is in force; one quoting words the turn lacks is refused | `AC2 #1894.93152973 a learned change quoting …` | `#1894.93152973` | fails at the first `toMatchObject({ state: 'applied', reason: null })` |
| `format.test.ts` › the record and its reader resolve the new format's handles and give its turns, a reader started for each transcript | `AC2 #1894.93152973 the record and its reader resolve …` | `#1894.93152973` | fails at `resolve(…#t1)` `toMatchObject` |
| `format.test.ts` › for each line the first reader that returns a turn names it | `AC2 #1894.93152973 for each line the first reader …` | `#1894.93152973` | fails at `resolve(…#t1)` `toMatchObject` |
| `rows.test.ts` › with the shipped agents' readers, the record gives the base's learned rows, resolved handles and session transcripts | `AC3 #1894.6158c2a1 with the shipped agents' readers, …` | `#1894.6158c2a1` | fails at `expect(Array.isArray(transcriptReaders)).toBe(true)` |

All five fail at the base at a vitest `expect` (an `AssertionError`), for their criterion's reason: the record's
sources name agents; the record ignores `readers`, so the new format's turns don't exist; the adapters export no
`transcriptReaders`. See `BASE-FAILURE.txt`.

## Tests left untagged, and why

The before lane fails a tagged test that passes on the merge base, and these 14 pass there by design. They stay in the
suite with their original titles and still run on the change with the rest of the folder.

| Test | Why it passes at the base |
|---|---|
| `names.test.ts` › ordinary words that look like agent names are not findings | checks the scan itself over a file the test writes, not the record's sources |
| `names.test.ts` › the scan fails on a copy of the sources with … planted (10 cases) | checks the scan itself: a planted line is a finding, at the base as anywhere |
| `format.test.ts` › with no readers the record reads no turn of the new format | the base reads no `tallowmere` turn either |
| `format.test.ts` › nothing under packages/record names the new format | true at the base |
| `rows.test.ts` › the golden holds every shipped format, with rows both in force and refused | a guard on the golden file |

Criterion 1's second half ("a test that reads the sources fails on a planted name") is what the ten planted cases
show: the tagged scan test and they call the same `scanSources`. They were not folded into the tagged test: folding
ten cases into one test would change what a failure names, and the tagged test already fails at the base without
them. The trace lane therefore sees criterion 1 through the one tagged test, and the planted cases as its untagged
neighbours in the same file.

## Criterion 4

No test, as in the original: `#1894.6f3b1f79` is the implementer's run (the suites that cover the touched files,
unchanged, and each package's type-check). No title here carries its tag.

## Run

```sh
npx vitest run --root tests/acceptance/1894-redraft-tags --reporter=verbose
npx tsc -p tests/acceptance/1894-redraft-tags/tsconfig.json --noEmit
```

No hub, no build, no `lane.json` (the original has none). At the base, on November 28, 2026, run serially on a heavily
loaded machine: 5 failed, 14 passed (`BASE-FAILURE.txt`, home and clone paths rewritten). The type-check fails at the
base exactly as the original's does, on the three exports the change is to add (`TranscriptReader` and `Turn` from the
record, `transcriptReaders` from the adapters), and on nothing else.

The original folder `tests/acceptance/1894` stays as the helpers' and the golden's home; its test files duplicate
these under untagged titles.
