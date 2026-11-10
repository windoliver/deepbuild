# #883 AC3, the tomorrow case, redrafted blind for #1458

Redrafted blind at base `2721ca7b` ("Merge pull request #2088 …") from issue #883, issue #1458 (whose "One way to
write a time" amends AC3, approved by the owner), issue #1157 for context, `docs/technical-design.md`, AGENTS.md and
the first draft in `..` (its README, `notifications.rs`, `fixtures/`). No other worktree, branch, PR or session was
read. The old file is left as it is; this one replaces its tomorrow case once the owner swaps it in.

## Old test, new test, criterion

| | |
|---|---|
| Old test | `../notifications.rs`, `ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40`: the text holds "tomorrow at 16:40" |
| New test | `ac3_tomorrow.rs`, `ac3_a_default_at_16_40_tomorrow_reads_tomorrow_16_40` |
| Amended criterion | #1458: "A moment today reads "16:40", and on another day "tomorrow 16:40" or "Mon 16:40". An ask row's right edge is the moment its default applies, in the same words as its card and its notification." For #883's AC3 this means: a notification whose default applies at 16:40 tomorrow names that moment as "tomorrow 16:40"; it never says "in 2 h" or "tomorrow at 16:40". The today case and AC3's "in 2 h" plant stay as `../notifications.rs` has them |
| Wrong program | The base's notifier (`crates/deep-app/src/notify.rs`, `clock_time`), which writes a moment on the next day as "tomorrow at {time}". Its text for this case ends "If you don't answer: No, tomorrow at 16:40." and the case fails at the judge's first rule, naming that form (BASE-FAILURE.txt) |
| Run | `cargo test --locked -p deep-replica --test acceptance_883_ac3_redraft` |

## What the case does

The first draft's fixture, zone and clock, unchanged: `TZ=Europe/Berlin` set as `main`'s first line, the record
`../fixtures/two-sessions.events.jsonl`, the clock advanced from `deep_replica::NOW` to 14:40 local
(`NOW + 20,400,000`), then `../fixtures/live.json`'s `ask.created@4` template raised in session `…S01` with its
default "No" applying at 1,800,114,000,000 (2027-01-16 16:40 in Berlin). The premise is checked first with
`TZ=Europe/Berlin date -r`: the clock reads 2027-01-15 14:40 and the deadline 2027-01-16 16:40. 2 s later the ask has
exactly one post in `Replica::notifications()`; its `text` is judged.

The judge, in order, each failure naming the rule and quoting the text:

1. The text doesn't hold "tomorrow at 16:40", the form #1458 replaces.
2. The text doesn't hold "in 2 h", a length where a moment is due.
3. The text holds "tomorrow 16:40".
4. Nothing follows that moment that would make it a longer time (`:` or a digit, as in "tomorrow 16:40:00").

`planted_ac3_the_judge_fails_each_forbidden_form_and_passes_the_right_one` runs the same judge on three planted texts
("… No, tomorrow at 16:40.", "… No, in 2 h.", "… No, tomorrow 16:40:00."), each of which must fail saying why, and on
#1458's own form ("… No, tomorrow 16:40."), which must pass: the judge's control, since no right notifier exists at
the base. It passes at the base, as a judge check should.

The case uses only the base's surface (`Replica::open`, `advance`, `now`, `append`, `notifications`, `Posted.text`),
so it compiles at the base and fails there on its assertion, never on a missing surface.

## Registration

One `[[test]]` entry in `crates/deep-replica/Cargo.toml`, beside `acceptance_883`: `name = "acceptance_883_ac3_redraft"`,
`harness = false`, as the first draft's. On swap-in, the old case's entry in `../notifications.rs`'s `run()` list goes
and this target stays, or this case moves into that file; that is the owner's call.

## Readings a reviewer may revisit

- "In the same words as its card and its notification" ties the notification to the ask row and the card. This case
  checks the notification alone, as AC3 does; the row and the card are #1458's own criterion ("An ask's row, card and
  notification show one moment in one form").
- "tomorrow 16:40" is matched as a substring of the post's text, so "If you don't answer: No, tomorrow 16:40." and
  the same moment placed elsewhere in the body both pass. The issue fixes the moment's form, not the sentence around it.
- Only the literal "in 2 h" is refused as the relative form, as the amended criterion names it. For a default 26 h off
  a relative text would more likely read "in 26 h" or "in 1 d"; those fail rule 3 anyway, since they hold no
  "tomorrow 16:40".
- The today case is left as `../notifications.rs` has it ("at 16:40"), as instructed, though #1458 writes a moment
  today as a bare "16:40". The old today judge's substring match on "at 16:40" fails a bare "16:40"; that case may need
  its own redraft once #1458 lands.
