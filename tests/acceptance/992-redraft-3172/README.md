# #992's app target, redrafted blind for #3172: INCONCLUSIVE off macOS

Redrafted blind at base `2fb3fe996` ("Merge pull request #3182 …", origin/main) from issue #992, issue #3172 (its
third criterion only), AGENTS.md, `docs/technical-design.md` (`node scripts/design-section.mjs --issue 3172` finds no
linked section), `docs/parallel-proof.md` section 3 (an unrun platform is INCONCLUSIVE), the first draft in `../992`
(its README, `app.rs`, and `helpers.ts` for how `app.rs` is run) and `crates/deep-replica/Cargo.toml`. No other
worktree, branch, PR, session, `tests/acceptance/3172/` or lane change was read. The old file is left as it is; this
one replaces it as the target's path once the owner swaps it in.

## Old test, new test, criterion

| | |
|---|---|
| Old test | `../992/app.rs`: off macOS it prints `acceptance_992_app: BLOCKED; the replica runs on macOS only, so no sidebar row was read` and exits 1 |
| New test | `app.rs`: off macOS it prints `acceptance_992_app: INCONCLUSIVE; the replica runs on macOS only, so no sidebar row was read` as its only line and exits 1; on macOS, unchanged |
| Criterion | `#3172.f7060cf1`: "`acceptance_992_app` off macOS states INCONCLUSIVE for its platform, as its 18 neighbours do" |
| Kept criteria | #992's own, `#992.34978db2` (AC2's sidebar) and `#992.45c506d1` (AC3), which `app.rs` serves on macOS exactly as before |
| Wrong program | The base's own `../992/app.rs`, which states BLOCKED off macOS (BASE-FAILURE.txt) |
| Run | macOS: `cargo test --locked -p deep-replica --test acceptance_992_app` with `DH992_APP_CASES`, as `../992/helpers.ts` (`appRows`) runs it. Off macOS: the same cargo command, or `rustc --edition 2021 --crate-type bin app.rs` and the binary, prints the line |

## What changed

Only the non-macOS branch of `main` and the header comment. The macOS branch, `mod rows`, its reading of
`DH992_APP_CASES` and `DEEP_HUB_PLANT`, its exit codes (0, and 2 with no cases file) and its `DH992 {…}` lines are the
first draft's, token for token, so #992's TypeScript tests read the target as before. The non-macOS branch uses std
alone, as before, so it builds where `deep-replica` can't.

The state word is the point: BLOCKED is for a missing precondition a person or a change can supply, and #1121 allows
none on the Spark; a platform that can't run the replica at all is INCONCLUSIVE for that platform (invariant 2,
`docs/parallel-proof.md` section 3). The reason after the semicolon is the first draft's, word for word, so the
line keeps the `<name>: INCONCLUSIVE; <reason>` shape #3172's first criterion reads.

## Proof on this Mac

The non-macOS branch can't be compiled through cargo on a Mac. `BASE-FAILURE.txt` builds both files with
`target_os = "macos"` flipped to a name that never matches, so their off-macOS branches compile here with rustc and
std alone: the base's prints BLOCKED and this one INCONCLUSIVE, each exiting 1. That is a cfg-flipped build, not a
Linux run; the Linux run by cargo (#3172's Proof, the 19 targets on the Spark) is still to be done.

## Registration

Change only the `path` of the existing `acceptance_992_app` `[[test]]` entry in `crates/deep-replica/Cargo.toml`,
keeping its name, `harness = false` and `test = false` (so a workspace run leaves it to #992's tests, #3100):

```toml
[[test]]
name = "acceptance_992_app"
path = "../../tests/acceptance/992-redraft-3172/app.rs"
harness = false
test = false
```

`../992/app.rs` then has no caller; whether it stays or goes is the owner's call, as is moving this file over it.

## Readings a reviewer may revisit

- **"States INCONCLUSIVE for its platform."** Read as the line's state word, with the reason naming macOS as the
  only platform the replica runs on. The line doesn't name the platform it ran on (Linux, say); its neighbours'
  lines, as #3172 quotes them, don't either.
- **"As its 18 neighbours do."** Read as the same shape: `<name>: INCONCLUSIVE; <reason>`, one line, exit 1, no test
  reported. Their reasons vary ("… macOS only, so nothing ran" and others); this one keeps #992's reason ("so no
  sidebar row was read") rather than taking theirs, since #3172 asks for the state, not the wording.
- **Exit 1, not 0 or 2.** Kept, as the criterion's neighbours exit 1 and #3172's first criterion reads a non-zero exit
  with that line. Exit 2 stays the macOS branch's "no `DH992_APP_CASES`".
- **#992's TypeScript side off macOS.** `../992/helpers.ts` turns any failed cargo run of this target into
  `BLOCKED: the app's side: …`, so #992's AC2 sidebar test and AC3 still read BLOCKED off macOS. That file belongs to
  #992's suite and is outside #3172's third criterion, which names the target alone; it is left as it is.
- **The cfg flip.** It proves what the branch prints and that it builds with std alone, not that cargo on Linux
  builds `deep-replica`'s other targets; that is #3172's Spark run.
