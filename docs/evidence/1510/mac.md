# #1510 on the Mac (Mac15,12, macOS 14.7.7), run by the owner's Mac runner

## Run 1 at 4a42981a, 2026-11-07

```
== cargo test --locked -p deep-app --test acceptance_1510
test ac2_6263c922_a_call_with_u202e_in_an_authority_card_shows_a_visible_mark_at_that_place ... ok
test ac2_6263c922_a_question_with_u202e_shows_a_visible_mark_at_that_place_in_the_card ... ok
test ac4_5fbd0a55_plain_chinese_and_emoji_questions_show_unchanged_in_the_card ... ok
test ac2_6263c922_each_invisible_or_direction_changing_character_shows_a_visible_mark_at_its_place ... ok
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
== cargo test --locked -p deep-app --lib visible
test question::tests::visible_marks_each_control_direction_and_invisible_character ... ok
test shown::tests::a_view_counts_as_shown_only_visible_unminimized_on_an_awake_display_unlocked ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 64 filtered out; finished in 0.00s
```

- `card-mac-4a42981a.png`: the card for a taste ask whose question holds U+202E draws `Open the attachment invoice\u{202e}txt.exe for the review?`, the mark in the card's font, nothing reversed.
- `needs-you-row-mac-4a42981a.png`: before the fix of 2a2b8c09, the Needs you row drew the same question reversed after the override: "Open the attachment invoice?weiver eht rof exe.txt".
- deep inbox for that home:
```
ask:01M6WR9QE9RTNT285YF34SGHVY  taste  S1510-rlo  1m  shown  Open the attachment invoice\u{202e}txt.exe for the review?  [blue | green]
```

## Run 2 at 2a2b8c09, 2026-11-07

```
== cargo test --locked -p deep-app --lib direction_mark
test views::tests::a_needs_you_row_shows_a_direction_mark_as_the_card_does ... ok
test notify::tests::a_notification_shows_a_direction_mark_as_the_card_does ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 67 filtered out; finished in 0.00s
== cargo test --locked -p deep-app --test acceptance_1510
test ac2_6263c922_a_question_with_u202e_shows_a_visible_mark_at_that_place_in_the_card ... ok
test ac2_6263c922_a_call_with_u202e_in_an_authority_card_shows_a_visible_mark_at_that_place ... ok
test ac4_5fbd0a55_plain_chinese_and_emoji_questions_show_unchanged_in_the_card ... ok
test ac2_6263c922_each_invisible_or_direction_changing_character_shows_a_visible_mark_at_its_place ... ok
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

- `needs-you-row-mac-2a2b8c09.png`: the Needs you row now reads `Open the attachment invoice\u{202e}txt.exe for the review?`, nothing reversed. The ask was raised live through the Claude Code stand-in's deep_ask after the app was up; the card drew the same marked text.
- Notification: no screenshot. The app logged that it posted the ask's notification 1 s after the raise, and `deep doctor` reported notifications healthy, but macOS showed no banner, probably because the ad-hoc test bundle has no notification authorization, or a Focus mode was on. No system setting was changed. The notification's text is proven by `notify::tests::a_notification_shows_a_direction_mark_as_the_card_does`, which passed on both machines.

## The row and notification tests without the fix (Linux, 2a2b8c09 with only the two code hunks taken out)

```
thread 'views::tests::a_needs_you_row_shows_a_direction_mark_as_the_card_does' (1779213) panicked at crates/deep-app/src/views.rs:1785:9:
  left: "Open invoice\u{202e}txt.exe?"
 right: "Open invoice\\u{202e}txt.exe?"
thread 'notify::tests::a_notification_shows_a_direction_mark_as_the_card_does' (1779212) panicked at crates/deep-app/src/notify.rs:500:9:
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 67 filtered out; finished in 0.00s
thread 'notify::tests::a_notification_shows_a_direction_mark_as_the_card_does' (1786791) panicked at crates/deep-app/src/notify.rs:499:9:
DeepBuild · Session s1
--
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 68 filtered out; finished in 0.00s

```
