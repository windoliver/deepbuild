# #3028 visual check: plain main against the PR head, in the real app (2026-11-28)

Main 22be933ef (the PR's merge base) against the PR head 9e85297f1, on a Mac18,1 (Apple M6), macOS 27.2.1, screen unlocked.

Each of the three shipped journeys in `fn shipped()` (`crates/deep-replica/src/drive/motion.rs`) ran in a deep-drive process of
its own, once on each tree, built with `--features env-plants`. Every journey launched from the fixture on the virtual clock
at 1512 × 2048, took a screenshot at t = 0, hovered the same row by id, and took screenshots at the same virtual times after the
hover: +0, 50, 100, 200, 1000, 1500, 1550, 1600, 1650, 1700, 2000 and 3000 ms. The journeys were Needs you (ask
01MCBHM300GP83QANM5WDCWNNP), the session page and the project page (session 01MCBH57D812FQ88XJ33AV9KCE). Scripts:
`drive-shots.mjs`, `per-process.sh`, `compare-all.sh`, `pixdiff.py`. Results: `compare.txt`.

## Result

- 33 of the 39 frame pairs are byte-equal PNGs, every end state included (hover +1600 ms onward, and +0 to +1000 ms).
- The 6 that differ are the row tooltip, at hover +1500 and +1550 ms, in each journey, and nothing outside the tooltip's
  box (0.16–0.18% of the pixels). The crops here show main, the PR head and the differing pixels, left to right.
- The tooltip shows at hover +1500 ms (`ROW_TIP_DELAY`) and fades in over 120 ms (`OVERLAY_FADE`). On main the fade is timed by
  the wall clock, so real time has already passed most or all of it when the screenshot is taken; on the PR head it runs on the
  replica's virtual clock (`vendor/gpui-pre/src/elements/animation.rs`), so +1500 and +1550 ms show it part way in. From
  +1600 ms both trees are identical.
- The user's ruling on this difference, asked "is the tooltip fading in on the virtual clock what you intended for
  #1427?": "Yes, intended".

In one process holding all three journeys, main's deep-drive panics at the second launch's hover (`used a entity with the
wrong context`, the #1546 panic #3012 fixes); the PR head runs all three in one process with no panic. That is why each journey
ran in its own process here. A second PR-head run gave byte-equal PNGs for every frame.
