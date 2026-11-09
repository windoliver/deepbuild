# Acceptance tests for #1738: session titles shown as data

Written first, blind, from issue #1738 (its text as of November 9, 2026, last updated 03:25 UTC: the opening, Scope, the 4 acceptance criteria, Proof and Depends on), `docs/technical-design.md` ("Threats, and what stops each one", its row "Approvals that drift": what you're shown is what's held, the app marks invisible and direction-changing Unicode, and the record keeps the bytes unchanged; and the Dogfooding bullets on acceptance tests written by a job that never sees the work) and the base commit `667292fc` (PR #1664's branch for #1510, which adds `crates/deep-app/src/question.rs` `visible()`; no #1738). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
cargo test --locked -p deep-app --test acceptance_1738   # all four criteria, from the checkout's root
```

No network, no hub, no display: the app's shell draws in gpui-kit's test window (`TestAppContext`), so the suite runs on Linux and on macOS. Nothing is timed, and no process is started.

## The surfaces

The issue names five places that show a session's task title, and the record. The tests reach each one only through deep-app's public lib (`app/titles.rs`), on one record held in memory by the app's one reader (`deep_app::record::install_local`, as the replica holds it): a session's `session.start`, its `task.created` (`data.thread` = the session, `data.title` = the title under test) and an open `ask.created` of the core's, so the session needs you and its ask notifies.

- **The ask notification's title**: the `Notification` that `deep_app::notify::Notifier::due` posts for the session's ask once it comes due (a `Notifier` with no wait, that `saw` the record's events), its `title` field, which the app hands the OS as the notification's title (`main.rs`). Its `text` is title then body, and the app posts what follows the first newline as the body, so the test also holds the text's first line to be the whole title.
- **The sidebar row, the session page's heading and its line**: the app's shell, `deep_app::views::Shell` on `Layout::shipped("session")` (the sidebar, the session's page and the line, as the replica opens it), with its views' clock set by `views::set_state`, drawn in gpui-kit's test window and read through `gpui_kit::base::test_support::snapshots`: each element's accessibility label, the text an assistive client reads. The row is `session:<id>`, the heading `session-title`, the line `line-status`.
- **The replica's verdict line to the session's chat**: `deep_app::states::verdict_line(table, session, now)` on the reader's folded table. It is the line deep-replica's `Replica::surfaces` returns as `"verdict-line"` (`crates/deep-replica/src/replica.rs` calls this function and nothing else). The replica itself is not used: it draws through gpui's headless Metal renderer and its suites run on macOS only, so a deep-replica test would be INCONCLUSIVE off the Mac, and the line's text is the same call either way.
- **The record's `task.created`**: after every surface above was drawn and posted, the one reader's record (`deep_app::record::history()`) and the events its view applied (`record::View::events`), read back.

No surface was BLOCKED: each has a public way to read its text at the base.

## Readings where the issue leaves a choice

- **The title**: `Fix the cart` U+202E `txt.exe` `\x1b[2K\r` `Approved by you` `\n` `ship it`. The override reverses what follows it, `ESC [2K` erases the line and `\r` returns to its start, so drawn raw it could read as something else entirely.
- **"Shows each one as its escape"**: the strict spelling the issue gives, `\u{202e}`, `\x1b`, `\r`, `\n` (lowercase hex, braces, as `question.rs` `visible()` writes them, the step the scope says titles go through). Each surface's text must hold the title as `Fix the cart\u{202e}txt.exe\x1b[2K\rApproved by you\nship it`, those escapes as literal backslash text at each character's place and every other character unchanged, and none of U+202E, ESC, CR or LF raw. What a surface puts around the title (a status mark, `DeepBuild · `, ` · needs you`) is free.
- **"The session page's heading and line"**: the page's heading is its `session-title`; its line is the session's line under it, the shell's `line-status` ("from its task to where it stands now").
- **"Marks those characters too"** (criterion 2): the verdict line holds the same marked title, by the same check as criterion 1.
- **"Keeps the title's original bytes"**: the `task.created` in the record the app reads is the event given, and its `data.title` equals the title byte for byte, after every surface was drawn: marking on the way to a surface, never in the record. The hub's own store is not read: the issue's change is in the app, and #1510's suite holds the hub to keeping an ask's bytes.
- **Plain, Chinese and emoji**: `Cart totals`, `修复结账页面的总价`, and `Ship the header 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧` (a skin-tone modifier, a heart with U+FE0F and a family joined by U+200D, as people type them). Each surface's text holds the title exactly. So the joiners and variation selectors stay unmarked, as the scope says, and an implementation that escapes non-ASCII or marks every zero-width character fails criterion 4.
- **The CLI** is out of scope (the issue's scope: `deep status` and `deep inbox` never print a task title), so no CLI test.

## The contract per criterion

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID.

| # | ID | Criterion | Tests | On the base |
|---|---|---|---|---|
| 1 | `#1738.0d008709` | A task title holding U+202E, `\x1b[2K\r` and a newline shows each one as its escape (`\u{202e}`, `\x1b`, `\r`, `\n`) in the ask notification's title, in the sidebar row, and in the session page's heading and line | `app/titles.rs`: `ac1_0d008709_*`, one per surface: the notification's title, the sidebar row, the page's heading, its line | FAIL, all four: each surface holds U+202E, ESC, CR and LF raw and shows no escape; the notification's raw newline also puts `ship it` into its body |
| 2 | `#1738.e6a3db6d` | The replica's verdict line to the session's chat marks those characters too | `app/titles.rs`: `ac2_e6a3db6d_*`, the verdict line | FAIL: the verdict line holds the four characters raw |
| 3 | `#1738.7a00b50e` | The `task.created` event in the record keeps the title's original bytes | `app/titles.rs`: `ac3_7a00b50e_*`, the record and the reader's applied events after every surface was drawn | PASS: the base keeps them; regression protection for an implementation that marks the title on the way in |
| 4 | `#1738.f8a06717` | Plain, Chinese and emoji titles show unchanged | `app/titles.rs`: `ac4_f8a06717_*`, each title on all five surfaces | PASS on the base (it changes nothing); it fails an implementation that escapes non-ASCII or marks the emoji's joiners |

No implementation was run: the passing side of criteria 1 and 2 is unverified until the implementation exists. `BASE-FAILURE.txt` holds the base run.

## Files

- `app/titles.rs` (criteria 1 to 4), wired as `acceptance_1738` in `crates/deep-app/Cargo.toml`.
- `BASE-FAILURE.txt`: the base run.
