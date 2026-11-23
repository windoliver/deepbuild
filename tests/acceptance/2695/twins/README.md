# Twins for the 2695 tests

Some clauses pass on the merge base, as their "as today" or "as the merge base does" says, so the base can't show
those tests failing. Each such criterion names, or is given here, a planted wrong program; `../twins.json` maps each
criterion to its twin for the proof lanes (`scripts/proof-runs.mjs`). Each twin is one whole file of the base
(`512d194bb`) with one place changed, marked by a comment naming the criterion.

| Criterion | Twin | The wrong program | Tests it fails |
|---|---|---|---|
| `#2695.d791b61b` (AC3) | `installs-without-proofs` | `packages/hub/src/guards.ts`: in `addGuards`, the loop that checks each given entry, `for (const [name, entry] of Object.entries(given.entries)) {`, runs over `Object.entries(given.entries).filter(() => false)`: the install checks no entry's proof (none for a missing planted call, none for a twin its match denies) and installs every entry. The criterion's "planted install that checks no proof once they have moved" | both `install.test.ts` tests, at their first `expect`: `deep guard add` exits 0 where it must refuse, naming the entry |
| `#2695.af072e8f` (AC4) | `old-rules-refused` | `crates/deep-hook/src/main.rs`: in `rules`, right after rules.json is parsed, `if member(&rules, "proofs").is_some() { return Err(...) }`: a hook that, once the proofs have moved, refuses a rules.json an older hub wrote | `older.test.ts`'s matching test: all 102 calls differ: each is denied naming rules.json and matches no entry, where the merge base's deep-hook allows the twins and matches the planted calls |
| `#2695.f70c83fe` (AC5) | `guards-off-without-proofs` | `crates/deep-hook/src/main.rs`: in `rules`, before rules.json is read, `if fs::read(home().join("proofs.json")).is_err() { return Ok(Rules::default()); }`: a hook that turns its guards off when the proofs' file is missing or unreadable. The criterion's "planted hook" | both hook tests of `missing.test.ts`: each planted call a fail_closed entry denies on the merge base is allowed, matching nothing; the failure names each call |
| `#2695.7026a58e` (AC2) | `guards-off-without-proofs` (the same) | It opens `proofs.json` on every PreToolUse | `hook.test.ts`'s opens test: each of the 15 calls opens the file |

`#2695.5cc60b5e` (AC1), AC2's instruction test, AC4's install test and AC5's two doctor tests fail on the merge base at
their assertions (`../BASE-FAILURE.txt`) and need no twin.

## Laying them over the change

Each is a whole file of the base, so laid over the change it also takes the change's own edits out of that file.

- `installs-without-proofs`: the base's `guards.ts` reads the proofs from the file it is given and writes them into
  rules.json. If the change moved the install's code or the proofs' writing elsewhere, or the base file no longer
  type-checks beside the change's files, re-lay it on the change's file: make the loop that checks each given entry's
  planted call and twin check none of them (installing every entry), at the same path or where that loop now lives,
  and replace this file. The tests stay as they are.
- `guards-off-without-proofs`: at the base deep-hook never reads the proofs' file, so this twin adds the one read.
  On the change, make the same one-place change in the change's `rules` (or wherever the change's hook decides what
  it reads): when `~/.deepbuild/proofs.json` can't be read, return no guards. Laid over the change, it should still
  fail both AC5 hook tests and AC2's opens test.
- `old-rules-refused`: on the change, make the same one-place change after the change's hook parses rules.json: a
  `proofs` member makes the file unreadable. It should still fail AC4's matching test.

This job laid no twin over the checkout (it writes only under this folder). Each was run in a copy of HEAD under
/tmp with the twin laid over it and built there (`cargo build --locked -p deep-hook`, or `tsc -p
packages/hub/tsconfig.json` for the hub twin, which type-checked); `../BASE-FAILURE.txt` sections 2-4 hold the runs.
Each failed every test it is listed for, at its assertion.
