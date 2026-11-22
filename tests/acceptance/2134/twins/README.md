# Twins for the 2134 tests

One test passes on the base, so the base can't show it failing: AC1's own, on the issue's exact line
`aws s3 ls --profile dev; aws kms create-key --profile prod`. The base splits the line on whitespace only, so the
line's first profile reads as `dev;`, an owner (`aws-profile:dev;`) no standing rule holds, and this one spelling is
denied by accident (`../README.md`, "What the base does"). `../twins.json` names the wrong program for it.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2134.c62f68e2` (AC1) | `owner-from-the-lines-first-profile` | The one the issue describes under "What goes wrong today": the owner is the whole line's first `--profile`, whichever run holds it. It is a whole copy of the base's `crates/deep-hook/src/main.rs` (`512d194bb`) with one line added at the top of `cloud_owner`, `let command = &command.replace(';', " ; ");`, so a `;` ends a word as it does for the shell and the first profile reads as `dev`. The standing rule for `dev`'s owner then covers the line, and the key is created under `prod` |

The blind job wrote it with the tests, from the base. Laid over the base, AC1's own test fails at its assertion (exit 0
where 2 is required), as do AC1's four scope tests (`../BASE-FAILURE.txt`, section 2).

It is a whole file of the base, so laid over the change it also takes the fix out of `main.rs`. If the change's
`main.rs` no longer builds with the base's beside the change's other files, or the owner is no longer read in
`main.rs`, plant the same reading (the owner from the whole line's first `--profile`, a `;` ending a word) in the
change's own file and replace this one; the tests stay as they are.
