# #3057: cut.words@1's recording and keep in the form language's words

Run on the Spark (Linux arm64), toolchain 1.99.1, node 24.22.0, each in a systemd user unit capped at 24G with
CARGO_BUILD_JOBS=2, CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0.

Base, 2eaaeb0e6 (origin/main at the branch point):

- `base-unit.txt`: `cargo test --locked -p deep-show --bin deep-show -- kinds::tests::every_structured_field_prints_forms_that_take_its_own_values`
  fails naming `cut.words@1.recording` (`asset name`) and `cut.words@1.keep` (`word index`), each printing no form.
- `base-1973.txt`: `node node_modules/vitest/vitest.mjs run --root tests/acceptance/1973 one-form.test.ts --no-file-parallelism`
  fails both tests, naming the same two fields with `"forms":[]`.

Fix: the two declarations are written in words the form language already names: `asset ID` (a string; the canvas
primitives call an `assets` entry's name its asset ID) and `[index (a word, from 0 in the words record) | [first, last]
(inclusive)]` (a list of a number or a pair of numbers). The form language itself is unchanged.

After:

- `fix-unit.txt`: the same unit test passes.
- `fix-1973.txt`: the same one-form.test.ts passes, 2 of 2.
- `deep-kinds-after.json`: `deep-show run` answering `deep_kinds {op: field}` for `cut.words@1.recording` and
  `cut.words@1.keep`, each line giving its form.
