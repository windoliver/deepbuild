# Twins for the 2219 tests

AC2 (`#2219.091a3d84`) names its wrong program: "a planted hook that skips an entry it can't read". AC4
(`#2219.9b9e651b`) passes on the base, as its "as today" says, so the base can't show it failing; its twin is a hook
that reads a mode it doesn't know. `../twins.json` names both. AC1 and AC3 fail on the base, which is their wrong
program.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2219.091a3d84` (AC2) | `skips-unreadable-entry` | The base's `crates/deep-hook/src/main.rs` (`74e6e2634`) with one line changed, line 250 in `rules`: `.collect::<Result<Vec<Guard>, String>>()?;` becomes `.flatten().collect::<Vec<Guard>>();`, so an entry `guard` can't read is dropped and the rest of the file is read as if it weren't there |
| `#2219.9b9e651b` (AC4) | `mode-read-as-any` | The same file with one line changed, line 357 in `guard`: `if !["watch", "warn", "block"].contains(&text("mode")?.as_str()) {` becomes `if text("mode").is_none() {`, so an entry with any mode, `stop` included, is read as a guard by its `match` |

The blind job wrote these twins with the tests, from the base. Laid over the base in a scratch copy, with deep-hook
built there, each fails its criterion's tests at their assertions (`../BASE-FAILURE.txt`, last two sections):

- `skips-unreadable-entry`: both AC2 tests fail at the denial, as the criterion says: `ls` exits 0 with nothing
  printed, with the hub up (a try the hub answered, with nothing matched) and with it down.
- `mode-read-as-any`: the AC4 test fails at its first assertion, `ls` exits 0 with the hub up, and at every other
  one: `ls` runs with the hub down too, and `pkill -f node` is denied only by no-kill-by-name, never naming
  `rules.json`, with the hub up and down.

Each is a whole file of the base, so laid over the change it also takes the fix out of `main.rs`. If the change's
`main.rs` no longer builds with the base's beside the change's other files, or the implementer wants the plant on
the fixed hook, make the same change to the change's `main.rs` and replace the file: in `rules`, drop each entry
deep-hook can't read whole instead of reading its mode (`skips-unreadable-entry`), or in `guard`, take any mode
(`mode-read-as-any`). The tests stay as they are.
