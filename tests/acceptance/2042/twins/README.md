# Twins for the 2042 tests

Two criteria have tests that pass on the base, so the base can't show them failing. `../twins.json` names a wrong
program for each. Both are a whole copy of the base's `crates/deep-hook/src/main.rs` (`ee05e7257`) with one block added
in `forward`, right after `let parsed = parse(&input).ok();`.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2042.c82ae59d` (AC5) | `denies-every-unread-payload` | The one the criterion names, "a planted hook that denies every payload it can't read": when `parsed` is `None` on a `PreToolUse` or a `PostToolUse`, it prints a denial and exits 2, whatever entries are installed and whatever the hub says |
| `#2042.4ee175d8` (AC1, scope test only) | `reads-1-mib-at-most` | A reader that reads at most 1 MiB: on a `PreToolUse` whose payload is over 1 MiB it prints a denial calling the payload unreadable and exits 2, so the readable 2 MiB `git push origin main` is denied as unreadable |

The blind job wrote both with the tests, from the base. Laid over the base, each fails its tests at their assertions
(`../BASE-FAILURE.txt`, last section): every AC5 test names the event and payload that exited 2, and AC1's 2 MiB
scope test sees the readable payload denied, not decided as the plain push is.

Each is a whole file of the base, so laid over the change it also takes the fix out of `main.rs`. If the change's
`main.rs` no longer builds with the base's beside the change's other files, or the implementer wants the plant on the
fixed hook, make the same one-block change to the change's `main.rs` and replace the file; the tests stay as they are.
