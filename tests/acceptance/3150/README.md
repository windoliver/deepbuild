# Acceptance tests for #3150: cut.words@1 declares recording and keep in words the form language doesn't read

Written first, blind, from issue #3150 (its finding, "The fix", "Why it isn't a two-line change" and its four "Done
when" items), the design sections it leans on and base commit `8c984adb9` (`origin/main`, "Merge pull request #3376 …"),
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 3150 --repo windoliver/deepbuild`).
- `docs/canvas-primitives.md`: Strip and track's `cut.words@1` line and its "As built (#1518)" paragraph (`recording`,
  "the name of an entry of `assets`"; `keep`, "a list whose entries are a word index or an inclusive `[first, last]`";
  `cut.keep_range`; `cut.words_unbaked`), and Canvas module / Registry and seal: registries. `docs/technical-design.md`
  (Dogfooding). `AGENTS.md` (Proof).
- At the base, for surfaces only: `crates/deep-canvas/src/form.rs` (the form language: `index` is a number name,
  `name` a string name, `[form]` a list, `[a: f, b: f]` named slots, `print`, `alternatives`, `miss`);
  `crates/deep-canvas/src/document/check.rs` (`form_issue`: a structured value no declared form takes is `out_of_range`
  at `items/<key>/params/<name>` with `forms` and the fix `Write <name> as <forms>: <gist>.`; a declaration the
  language can't read refuses nothing); `crates/deep-canvas-media/src/cut.rs` (`register`: `recording` declared
  `asset name`, `keep` `[word index | [first, last]]`); `crates/deep-show/src/kinds.rs` (a json field's row gets
  `grammar: form` and `forms` from `declared_forms`, empty when the declaration doesn't read) and `kinds/tests.rs` (the
  named test); `crates/deep-show/src/main.rs` (`deep_kinds` on `deep-show run`, `deep-show kinds`);
  `scripts/known-failures.json` (the entry under this issue); `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs` (vitest globs, `alone`, a suite's `lane.json`). Sibling suites for harness and shapes only:
  `tests/acceptance/1973/` (deep_kinds `op: field`, the agent's deep_show with its issues) and `1518/` (the film
  document holding a `cut.words@1` item).

## Run them

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"   # where ~/.cargo/bin's proxies are x86_64
npm ci                                                                            # once, for vitest and typescript
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3150 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3150/tsconfig.json     # type-check (exits 0)
```

Or one file at a time (`... run --root tests/acceptance/3150 kinds.test.ts`). `kinds.test.ts` and `check.test.ts`
each build the full `deep-show` once (`cargo build --locked --bin deep-show`, default features: full) in the checkout's
own `target/` (`CARGO_TARGET_DIR` dropped) and drive `target/debug/deep-show run`; `unit.test.ts` runs
`cargo test --locked -p deep-show --bin deep-show -- --exact kinds::tests::every_structured_field_prints_forms_that_take_its_own_values`;
`known-failures.test.ts` only reads the file. Each `it` passes its timeout (3,600,000 ms, the unit test's 7,200,000) as
its last argument, since a cold build takes many minutes on a loaded Mac. Temporary folders are under `/tmp/dh3150-*`
and are removed after each file. Node built-ins and vitest only; no hub, no built packages.

Wiring: the files match the repo's vitest globs (`tests/acceptance/**/*.test.ts`), so the unit lane finds them with no
manifest entry. `lane.json` here puts the folder in the alone block with the reason `binary` (its files build with
cargo in the checkout's target); no edit to `scripts/lanes.mjs` or any `Cargo.toml` is needed. No Rust test file is
added: the named unit test already exists and is run as it stands.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId` (`#3150.` and the first 8 hex digits of SHA-256 of the "Done when"
item's text, trimmed, white space collapsed). Every test's name and every failure message starts with its ID.

| ID | Criterion | File › test | What it asserts |
|---|---|---|---|
| `#3150.c7594389` | The test passes. | `unit.test.ts` › `… deep-show's kinds::tests::every_structured_field_prints_forms_that_take_its_own_values passes` | cargo test of that one test (`--exact`) in deep-show's binary prints `test … ... ok` and `test result: ok. 1 passed; 0 failed`, and exits 0 |
| `#3150.b8d82393` | `deep_kinds` prints both forms. | `kinds.test.ts` › `… prints cut.words@1.recording's form, name` | deep_kinds `{op: "field", path: "cut.words@1.recording"}` answers one row, `type: json`, whose `forms` are exactly `["name"]` |
| `#3150.b8d82393` | (same) | `kinds.test.ts` › `… prints cut.words@1.keep's form, [index \| [first: index, last: index]]` | the same for `cut.words@1.keep`: `forms` exactly `["[index \| [first: index, last: index]]"]` |
| `#3150.3f890426` | A document's `keep` holding a value neither form takes is refused at check, naming the form. | `check.test.ts` › `… keep [[0, 1, 2]], a three-number entry, …` | the agent's deep_show (with issues) of a film whose `cut.words@1` item `cut` has `keep: [[0, 1, 2]]`: an error issue at `items/cut/params/keep` (or under it) carries the text `[index \| [first: index, last: index]]`, and the revision's outcome is not `presented`. Control in the same scenario: `keep: [0, [1, 2]]` draws no issue at keep carrying that text |
| `#3150.3f890426` | (same) | `check.test.ts` › `… keep [0, "two"], a string entry, …` | the same with `keep: [0, "two"]` |
| `#3150.6627b6c0` | The test's `scripts/known-failures.json` entry is gone. | `known-failures.test.ts` › `… lists no entry for deep-show's kinds::tests::…` | the file parses with its `failures` object, and no key of `failures` contains the test's name |

## Readings where the issue leaves a choice

- **"Both forms"** is the two fields' forms, one each: `recording`'s and `keep`'s, which the finding says `deep_kinds`
  prints none of. The expected strings are the issue's fix, `name` and `[index | [first: index, last: index]]`, as
  deep_kinds prints a parsed form (`Form::print`, one string per alternative; neither declaration is a top-level `|`,
  so each field prints one). The tests compare `forms` exactly; a declaration that reads but prints otherwise (say
  `[first, last]` with unnamed slots, or `asset name` kept and added to the language) fails them. If the implementer's
  form is a different spelling the design accepts, that's a dispute for a blind redraft, not an edit here.
- **`deep_kinds`** is reached as `op: field` on `deep-show run` (#1971's one-field line, which carries the listing's
  `forms`, the same rows the named unit test reads through `kind_rows`). `deep-show kinds --dump` is the same listing
  and isn't read separately.
- **"A value neither form takes"** is an entry of `keep` that is neither a word index (a number) nor `[first, last]`
  (two numbers): `[0, 1, 2]` (three numbers) and `"two"` (a string), each its own test. A value both forms take,
  `[0, [1, 2]]`, is the control. No out-of-record index is used, since that is `cut.keep_range`'s, not the form's.
- **"Refused at check, naming the form"**: an `error` issue of the document check at `items/cut/params/keep` or a path
  under it whose fields, as JSON text, hold the printed form `[index | [first: index, last: index]]` (form.rs's
  `form_issue` puts it in `forms` and `fix`; the tests don't pin the code, the message or which field holds it), and
  the revision isn't presented. The document holds an asset `rec` whose bytes are in no store and no words record, so
  other issues (the recording unread, `cut.words_unbaked`) may appear beside it; the test reads only the issues at
  keep, and the control shows those other issues don't name keep's form.
- **"The test's entry is gone"**: no key of `failures` names the test, whatever prefix it is keyed by. Other sections
  of the file (`lint`, `timing`, `skips`) don't list unit tests by this key and aren't read.

## Base results

`BASE-FAILURE.txt` holds the full run (home folders written `~`). All 6 tests fail at their assertions; `tsc` exits 0.

- `unit.test.ts`: cargo test exits 101; the test panics at `kinds/tests.rs:64` with the issue's two lines
  (`cut.words@1.recording: \`asset name\` doesn't read …`, `cut.words@1.keep: \`[word index | [first, last]]\` doesn't
  read …`) and `prints no form` for both fields.
- `kinds.test.ts`: both rows are `type: json`, `grammar: form`, with `forms: []`; expected `["name"]` and
  `["[index | [first: index, last: index]]"]`.
- `check.test.ts`: both refused documents' only issue is `unknown_asset` at `items/cut/params/recording`; no issue at
  keep, so none names keep's form (the base's `form_issue` refuses nothing for a declaration it can't read). The
  control holds.
- `known-failures.test.ts`: the entry `cargo -p deep-show --bin deep-show › kinds::tests::every_structured_field_prints_forms_that_take_its_own_values`
  is still there.

## Not tested

The regenerated digests (schedule snapshots, the kit ledger, the web player's full set) the issue's "Why it isn't a
two-line change" names: they are required for the workspace to pass but are no "Done when" item, and their own
existing tests (`the_published_schedule_matches`, the kit and player scripts) hold them. A `recording` value that isn't
a string, and the expansion itself (#1518's suite).
