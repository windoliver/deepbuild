# Blind redraft for #994: the deadline while notifications are off

`deadline.test.ts` drafts the hub's end of the Scope line "its deadline counts only time it was seen", from the issue,
the design and base `58862789`. It uses the surface `../README.md` pins and imports `../helpers.ts`.

## The timeline, under the design's rules

- **When an ask shows.** It shows when filed if its deadline comes before the next batch, otherwise with that batch, and
  the hub may record the showing after the test's next clock step. An ask that first shows past its deadline takes its
  default no sooner than its kind's notice after it shows, and never past its wait counted again from then. So a single
  step past the deadline can miss the default on a right program. The tests step in rounds until it comes.
- **Notice.** The tests set `asks.notice.choice` equal to `asks.deadline.choice`, so those two bounds name one time.
- **What moves a deadline.** Time the hub didn't run moves an unshown ask's deadline later, and a beat that comes late on
  a loaded machine reads as that time. Stepping in rounds is right however far this moves it.
- **Waiting.** A pause is rounds of 1.1 s and a call through the hub. That is longer than the 1 s beat, and a slower hub
  gets a longer pause. A default's time is the record's `ts`, compared with `test.clock`'s `now` (`advance_ms: 0`) read
  before the report or the raise. The hub's clock also runs in real time, so "no default yet" is asserted only while
  denied; after that the tests compare times.

## What each test fails on

1. **Denied, then allowed.**
   - A hub that takes the default at the deadline whatever the setting: the default lands in the 20 held rounds. If its
     beat is slower than that, it lands within ten 1 m steps of the report, before the wait, and the time check fails.
   - A hub that counts the denied time, so it defaults as soon as allowed comes: the time check fails.
   - A hub that holds the ask for good, or never takes `allowed`: no default in 240 rounds.
2. **The control, allowed throughout.**
   - A hub that holds every ask no window showed, whatever the setting, or reads `allowed` as off: no default in 240
     rounds. A hub that passes test 1's first half by never defaulting fails here.
   - A hub that defaults before the wait: the time check fails.
   - A hub with no `notifications.report`: the report fails, as on the base.

## How to run

With the workspaces built, as `../README.md` says:

```sh
npx vitest run --root tests/acceptance/994 --no-file-parallelism deadline-redraft
```
