# Blind redraft of #1463's table judges' self-test

Redrafts the self-test of `tableFailures` and `retiredFailures` in `../helpers.ts` (today `judges.test.ts`'s test
"tableFailures and retiredFailures: the words of states::TABLE"). Like the suite's other judge self-tests it carries no
criterion tag: it holds the judges AC6 (`#1463.cc5d1e3f`, "every word comes from `states::TABLE`") fails through to a right
input and to wrong ones.

Written blind at base `96b462a6` (the suite was written at `0c4a4ec7`; `states.rs` and the design are the same at both) by a
job that saw no plan, transcript or implementation. The implementing agent doesn't edit these files; a dispute goes to a
blind redraft (AGENTS.md, Proof; design: Dogfooding).

## What was read

Issue #1463 (Scope: "One word per state in every reader: `gone quiet`, `need you` and the like go"; AC6); in
`docs/technical-design.md`, States people see (its table) and Dogfooding; `crates/deep-app/src/states.rs` (`TABLE`);
`packages/hub/src/status.ts` `render` (how the base prints `gone quiet` and its capitalised headings); and this suite's
`README.md`, `helpers.ts`, `judges.test.ts`, `words.test.ts` and `tsconfig.json`.

## How to run

Nothing was built or run when this was written. With the workspaces' `node_modules` installed, from the checkout's root:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463/redraft-judges
node node_modules/typescript/bin/tsc -p tests/acceptance/1463/redraft-judges/tsconfig.json
```

No hub, CLI, replica or build: it reads `states.rs` and the design from the checkout. The suite's own run
(`--root tests/acceptance/1463`) picks this file up too.

## What it holds

Every input is built from the table the judge is handed, so it is right or wrong whatever words `states::TABLE` holds now
or gains, and made-up tables show each judge reads its argument rather than a list of its own.

- **`stateTable()`** reads every row of the design's States people see table (parsed from the design's markdown by its
  column headers), with that row's entry and its never-words. More rows or never-words in the code pass; a dropped row, a
  wrong entry or a lost never-word fails, so the right inputs below can't be built from a short table.
- **`tableFailures`** passes a row for every table word with its entry, in any order and repeated. It fails, once, naming
  the row and the reader: `need you`, `gone quiet`, every never-word, each word in another case, cut short by a letter or
  with a word added, and a made-up word; and each word with another word's entry, no entry, or its entry in capitals. One
  wrong row among right ones gives one failure, naming only it. A word added to the table it's handed passes; the same word
  against `states::TABLE` fails; every real word fails against a made-up table.
- **`retiredFailures`** passes a list printed in the table's words, with a finished session's detail (`1 failed`), `quiet`,
  the default sentence and the count sentences (`1 ask needs you`, `3 asks need you`, `12 asks need you`). It fails,
  naming the phrase and the reader, on `gone quiet` mid-line and as a capitalised heading (`Gone quiet: …`, as the base's
  `render` capitalises `Working:`), on `2 need you` and `12 need you`, and on every multi-word never-word of the table in
  lower case, capitalised and in capitals. Against a made-up table it fails on that table's multi-word never-word and not
  on another table's; it passes a single-word never-word (a detail line holds `failed`, and `says done` holds `done`) and
  the phrase inside longer words.

## What a right judge may still dispute

1. **`Gone quiet` capitalised.** `retiredFailures` matches `gone quiet` case-sensitively but never-words case-insensitively.
   Read by hand, not run: the base's judge passes `Gone quiet: Search index`, so this test fails on it there. The issue
   retires the word, not its lower-case spelling.
2. **A table that contradicts itself.** A state word that holds another state's multi-word never-word would fail the right
   list here; this test takes that as a table fault, since the design says no other word names a state.
3. **Single-word never-words** aren't retired in free text, as the judge's comment says; a reader printing `done` alone is
   left to `tableFailures` on its rows.

## Files

- `table-judges.test.ts`: the five tests above; imports `stateTable`, `tableFailures`, `retiredFailures`, `REPO` and the
  `Row` and `TableRow` types from `../helpers.ts`.
- `tsconfig.json`: the suite's, one folder deeper.
