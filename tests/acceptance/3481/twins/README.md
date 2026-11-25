# Twins for the 3481 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed. A twin changes product files only,
never a file under `tests/`, and is kept as its wrong lines in `twins/<name>/lines.json` (the line form,
`tests/acceptance/1832/README.md`), never as a whole copy of a file. "Replaces" below names the files its lines change.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3481.e99bba39` | `refusal-unnamed` | `crates/deep-app/src/main.rs` (and the file that formats the refusal, if that's elsewhere) | On a refused hello `--hub-check` exits non-zero and prints no `hub ok`, as the fix does, but its message names no refusal: it says only that the hub refused the app (no `credential`, no code, no path) | `hub-check.test.ts`, `#3481.e99bba39`: "deep-app --hub-check must name the hub's credential refusal in its output" |
| `#3481.0d194ed9` | `token-untrimmed` | `crates/deep-app/src/record.rs` (and `hub.rs`, wherever the app presents the token) | The app presents control.token as the file holds it, with the trailing newline the hub writes, instead of trimmed; so the hub refuses its own token and the fixed check exits non-zero | `hub-check.test.ts`, `#3481.0d194ed9`: "with the hub's own token deep-app --hub-check must exit 0" |

The merge base fails `#3481.e99bba39` at its exit-code assertion (it exits 0 with `hub ok`), but the base names
`credential` in its stderr, so the base alone doesn't show the naming rule is checked: `refusal-unnamed` does.
`#3481.0d194ed9` passes on the merge base; `token-untrimmed` is its only proof of failing.

Both faults were planted in a throwaway way (see `../README.md`, "How I checked the tests can pass") and failed the
test named, at that assertion.
