# #1623 blind draft: proposal (nothing here was run; no shell was available)

## Finding
At this base the issue's own files are clean: no census match in `panel_check.rs`; `panel_tree.rs:254` holds
`"#ffffff80\"` inside an escaped Rust string, which `literalsIn`'s `"#rrggbb"` pattern (closing quote must follow the
hex) doesn't match. The one known-failure entry left (`scripts/known-failures.json:8`) fails because
`tests/acceptance/882/lint-judge.mjs` `literalsIn` counts, by design ("An exception doesn't count here"),
`crates/deep-app/src/cells.rs:387-388` (the entry says 386-387; lines drifted). Those two lines are in the
`#[cfg(test)]` fixture `a_screen_from_the_hubs_reply_keeps_each_rows_runs_and_its_fills_off_the_ground`, held by
dated exceptions (review 2027-05-05) that the guard accepts but the census ignores. The entry's #1333 lapse date,
2026-11-14, has passed (today 2026-11-15), so it no longer excuses the failure.

Conflict inside #882: scope allows a dated exception; AC2 says the source "holds no color literal". The census
reads AC2 strictly. Exceptions can't satisfy it, so don't add or lean on one.

## Product fix (no test change; for the implementer, I did not edit it)
Behavior issue: the test's colors are values the app's own look defines, written as literals. Draw them from the look:
`crate::chrome::terminal(false)` (`chrome.rs:236`, windowless) returns `(ansi, bg, fg)`. In that test:
- `let (ansi, bg, fg) = crate::chrome::terminal(false);` and a small test-local `fn hex(c: [u8; 3]) -> String`
  (`format!("#{:02x}{:02x}{:02x}", ..)`) for the wire strings;
- build the `json!` reply from `hex(bg)`, `hex(fg)` and `hex(ansi[5])` (any ANSI entry that differs from `bg`), and
  drop both `color-literal-exception` comments;
- keep every assertion, with expected values from the same variables (`[0xe8; 3]` becomes `fg`, `[0xd8, 0x1b, 0x9a]`
  becomes `ansi[5]`); the fill must stay different from `bg`, so assert `ansi[5] != bg` first.
Caveat to verify when run: the look's actual `fg`/`bg`/`ansi[5]` must keep the case's shape (runs split 0..2 / 2..3 /
3..4, fill only on the middle one).

## Reused checks (unchanged)
`node --test tests/acceptance/882/lint.test.mjs` (all four tests; the census one is the failing entry), then
`node scripts/color-literal-guard.mjs`, then `node scripts/affected.mjs`; the cells.rs unit test through cargo
(`-p deep-app`). Once the census passes, remove the known-failures entry (a maintainer's edit, outside this job).

## Why this is not a bypass
No test, fixture, expected value, exception rule or census pattern changes. The census still scans every line the same
way, and the lines leave it because the app test no longer names a color of its own, not because their spelling dodges
a pattern (a byte-array or concatenated spelling would, and is rejected). Counter-risk: `format!` of look bytes is
partly a spelling change; a maintainer should judge that the colors now truly come from the look.

## Not proposed
No change under tests/acceptance/882 is justified, so no organization/fixture proposal is drafted. If maintainers
think the look's colors can't serve that test, requirements conflict (AC2 strict vs the dated exception scope):
report BLOCKED, recommend no workaround, and dispute through the #882 blind redraft.
