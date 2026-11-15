# Twins for the 1856 tests

AC2 (`#1856.e52ea188`, "Before setup, with no `~/.deepbuild/rules.json`, `ls` runs") passes on the base, so the base
can't show it failing. Its wrong program is a hook that reads a missing `rules.json` as a file it can't read whether
or not setup has finished. `../twins.json` names it.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#1856.e52ea188` (AC2) | `missing-rules-always-unreadable` | The base's `crates/deep-hook/src/main.rs` (`72fe11a11`) with one place changed: in `rules`, the arm `Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Rules::default()),` of the match on `fs::read_to_string(home().join("rules.json"))` is removed, so a missing file falls to the next arm, `Err(error) => return Err(format!("can't be read: {error}"))`, with or without `setup-finished.json`: before setup, `ls` is denied naming `rules.json` |

The blind job wrote this twin from the base, after the tests, without seeing any implementation. Laid over the base
(`crates/deep-hook/src/main.rs` replaced, `cargo build --locked -p deep-hook`), with
`npx vitest run --root tests/acceptance/1856 --no-file-parallelism hub-away.test.ts`, both AC2 tests fail at their
`expect` (`../TWIN-FAILURE.txt`): in a home with no `~/.deepbuild` and in one with an empty `~/.deepbuild`, `ls` exits
2 with "~/.deepbuild/rules.json can't be read: No such file or directory", `expected 'deny' to be 'allow'`. AC1's test
passes there: the twin also denies `pkill -f node` naming `rules.json` after setup, so it is a wrong program for AC2
only. `hub-running.test.ts` (AC3) wasn't run on the twin; no criterion of it is mapped here.

It is a whole file of the base, so laid over the change it also takes the change's own edits out of `main.rs`. If the
change's `main.rs` no longer builds with the base's beside the change's other files, or the implementer wants the
plant on the changed hook (where it should fail both AC2 tests and leave AC1 passing), make the same one-place change
to the change's `main.rs`, so a missing `rules.json` is unreadable without looking at `setup-finished.json`, and
replace this file; the tests stay as they are.
