# Twins for the 2204 tests

AC4 (`#2204.7f8edc15`) passes on the base, as its "as today" says, so the base can't show it failing. The criterion
names its wrong program: "a planted hook that reads the rules on every event". `../twins.json` names it.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2204.7f8edc15` (AC4) | `rules-read-on-every-event` | The base's `crates/deep-hook/src/main.rs` (`72fe11a11`) with one place changed: in `forward`, `let rules = if ruling { rules() } else { Ok(Rules::default()) };` becomes `let rules = rules();`, so a `PostToolUse` reads `rules.json` too and carries the denial of a file it can't read |

The blind job wrote this twin with the tests, from the base. Laid over the base it fails AC4's hub-down test at its
assertion, naming the event (`../BASE-FAILURE.txt`, last section): the `PostToolUse` with the cut file exits 2. Its
hub-up test passes there, because the base drops that denial once the hub answers, which is this issue's bug.

It is a whole file of the base, so laid over the change it also takes the fix out of `main.rs`. If the change's
`main.rs` no longer builds with the base's beside the change's other files, or the implementer wants the plant on the
fixed hook (where it should fail both AC4 tests), make the same one-place change to the change's `main.rs` and replace
this file; the tests stay as they are.
