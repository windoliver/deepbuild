# #2660's fast-path target, redrafted blind for #3447: `revise_items` with its fourth argument

Redrafted blind at base `015b665a0` (origin/main) from issue #3447, issue #2660 (bodies only), AGENTS.md, the design
sections #2660 links (`node scripts/design-section.mjs --issue 2660`; `--issue 3447` links none), the first draft in
`../2660` (its README, `fast_path.rs`, `alloc.rs`, fixtures and `BASE-FAILURE.txt`), `Session::revise_items`'
signature and doc comment in `crates/deep-canvas/src/schedule/mod.rs`, and `crates/deep-marks-render/Cargo.toml`. No
other worktree, branch, PR, session, `tests/acceptance/2700/` or implementation was read. The old file is left as it
is; this one replaces it as the target's path once the owner swaps it in.

## Old test, new test, criterion

| | |
|---|---|
| Old test | `../2660/fast_path.rs`: calls `live.revise_items(&mut s, &doc, &[&id])`, three arguments, as the method was at its base `b6b99ad8c`; at this base it doesn't compile (E0061) |
| New test | `fast_path.rs`: calls `live.revise_items(&mut s, &doc, &[&id], &[])`; the same document, changes, fast-path assertions, count and limit |
| Criterion | `#2660.1b678fb1` (AC2), unchanged: "A one-item change on a document with 2,000 text items, taken by the fast path, allocates under 64 KB", which #3447's first criterion asks the target to compile and pass on main |
| Wrong program | The base with the target's path as it is: the target fails to compile, so the test never runs (`BASE-FAILURE.txt`). #2660's own wrong program, a fast path that copies both text maps, is the first draft's reading at `b6b99ad8c` (`../2660/BASE-FAILURE.txt`: 195022 bytes in 2711 allocations) |
| Run | `cargo test --locked -p deep-marks-render --test acceptance_2660_fast_path`, once the path is swapped |

## What changed

Three things; `diff ../2660/fast_path.rs fast_path.rs` shows them all:

- The call takes a fourth argument, `&[]`. The method's doc comment: "`reached` names the members besides `items` its
  patch reached: only those are compared with the revision before". Each of the test's three changes sets one rect's
  `items.<id>.at.pos` and nothing else, so its patch reaches no member besides `items`, and the list is empty.
- `mod alloc;` carries `#[path = "../2660/alloc.rs"]`, so the counting allocator is the first draft's file, not a
  copy.
- The header comment gains three lines saying so.

Everything else is the first draft's, token for token: the 2,000 texts and 40 rects, the four modules and the clean
look, two warming changes and a counted third, `built == 1`, one damaged layer, every text's run kept, the reading of
a copy of the two text maps, the 65,536-byte limit and the test's name and its `// AC2 #2660.1b678fb1` line.

## Proof at this base

`BASE-FAILURE.txt` holds the base's build of the target as it is registered: E0061 at `../2660/fast_path.rs:93`,
cargo exiting 101. This file was not built or run by this job, since it is no target yet; that it compiles and its
test passes is the owner's run after the swap.

## Registration

Change only the `path` of the existing `acceptance_2660_fast_path` `[[test]]` entry in
`crates/deep-marks-render/Cargo.toml`:

```toml
[[test]]
name = "acceptance_2660_fast_path"
path = "../../tests/acceptance/2660-redraft-3447/fast_path.rs"
```

`../2660/fast_path.rs` then has no caller and is not edited (#3447's second criterion); `../2660/alloc.rs` keeps its
callers, this file among them.

## Readings a reviewer may revisit

- **`&[]`, not a list of every member.** A longer list would also compile, and for an unchanged document also pass,
  but it would say the patch reached members it didn't and make the session compare them, which is the cost #2700
  took out. The empty list is what a one-item move is.
- **A debug build checks the claim.** The method, under `cfg(test)` of its own crate, asserts that no member but
  `items` changed without being named. That assertion isn't compiled into this target (it is another crate's test),
  so the test's own setup is the proof that nothing else changed: it writes only `doc["items"][&id]["at"]["pos"]`.
- **Does the empty list change the count?** It may lower it against a call that compared members, and can't raise it.
  The limit is the issue's and is kept; no new reading at the base's fast path was taken, since the target doesn't
  build there.
- **`tests/acceptance/2700/`** was not read; #3447's third criterion (it passes unchanged) is the owner's run.
