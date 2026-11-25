# Merge with main d48d8f14a (40db6d59c), and the ordering fix after it

- One conflict, in packages/record/src/index.ts:
  - #22 commits a turn's FULL appends in one commit.
  - Main's #1410 syncs the evidence a FULL commit names first and keeps the log in arrival order.
  - The merge keeps both, with one commit order (`inOrder`).
- #1410's own test caught a first resolution that let a resume commit ahead of its stop. It passes since 40db6d59c.
- An independent review then found that a FULL append arriving after commit-each ones could still commit ahead of
  them. The pending FULL batch was taken when its turn came, not when the later commit took its place.
  - `failing-first-order.txt`: the new test fails at 40db6d59c, log_pos [5, 6, 4].
  - The fix takes the batch when each commit takes its place (`takeFulls`).
  - `passing-order.txt`: packages/record/test and tests/acceptance/1410 with the fix. All pass except one readSince
    test, which hit its 5 s limit at load ~290 and passed when run alone.
- The reviewer's three ordering repros, run against main's record code and against the fix:
  - Commit-each with a sync ahead: both pass.
  - Commit-each with no sync: both pass.
  - A stream event queued for the end-of-turn flush, then a core verdict in the same turn: both give [5, 7, 6]. Main
    lets a core event commit before the stream queue it arrived after. That isn't this merge's to change; it's a
    follow-up.
