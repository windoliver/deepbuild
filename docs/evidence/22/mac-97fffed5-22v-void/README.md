# 22v at 97fffed5, on the Mac: void (INCONCLUSIVE)

Stopped at 17:59 when the Mac's free space fell under 20 GB (`DISK-STOP`, `exits.txt`), so the round is void and is
to be run again. What it reached, for the record:

- Part 0, failing first at fe56c134 (main merged, no sign-in fix): the sign-in e2e fails as expected, the task
  `held` and not listed (`signin-fail/`); `0-signin.png` shows Needs you with no row, "Nothing needs you".
- Part 1: deep-app's unit tests 114 of 114.
- Part 2: the whole of `cargo test -p deep-app` fails `acceptance_34` ac11 and `acceptance_1141` ac2 and ac3, a subset of
  main 2252dfd6's six (those three plus `hub_client`'s three, which passed here); the runner's "same as main's six: NO"
  reads the set's size.
- Parts 3 and 4: the app's window was off screen (each window `0/-1`, Windows App in front), so the e2e scripts'
  pictures were BLOCKED. The sign-in e2e's record half passed at head: the task `shown` and listed, the taste call
  `queued` and unlisted (`signin/`).
- Part 5: 1459/identifier BLOCKED on `cargo build -p deep-replica --bin deep-drive` failing to compile
  `cocoa-foundation`, with the disk running low.

Part 2's three failures are, by exact test name, three of the six main 2252dfd6 fails on this Mac in its own run
(`../mac-adaa0e19/2b-failed-names.txt`, from `2b-main-full.txt`): `ac11_after_a_power_cut_drops_900_to_905…`
(`acceptance_34`), `ac2_each_sessions_state_title_and_open_asks…` and `ac3_a_sidebar_render_and_a_notifier_tick…`
(`acceptance_1141`). The other three there (`a_wrong_token_is_refused…`, `the_app_reads_the_hubs_health…`,
`the_hub_takes_the_views…`, `hub_client`) passed here. So nothing new fails at 97fffed5.
