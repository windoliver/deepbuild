# busy_disk before and after (#2179), linux/arm64 (the Spark), 2026-11-15

## Quiet disk (stand-in dd that writes nothing, stand-in hook that is never late): tests/acceptance/2179

Before (base c740dede7): see tests/acceptance/2179/BASE-FAILURE.txt. cargo reports the test FAILED at busy_disk.rs:64
("only 0 spooled lines' syncs outlasted the deadline in 60 calls, so this proves nothing"), and affected.mjs reads NEW FAIL.

After:
```
✔ AC1 #2179.c2c274c4 A quiet disk reads INCONCLUSIVE: no spooled line's sync outlasts the deadline, and affected.mjs reports the test INCONCLUSIVE with its reason, never FAIL (22177.531909ms)
ℹ busy_disk exited 3; dd ran 60 times, the hook 60
ℹ test a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms ... INCONCLUSIVE
ℹ test result: INCONCLUSIVE. a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms: only 0 spooled lines' syncs outlasted the deadline in 60 calls, so this proves nothing: the disk wasn't busy enough
ℹ affected.mjs: INCONCLUSIVE cargo -p deep-hook --test busy_disk: INCONCLUSIVE. a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms: only 0 spooled lines' syncs outlasted the deadline in 60 calls, so this proves nothing: the disk wasn't busy enough
✔ AC2 #2179.bbec3c91 A hook that takes more than 50 ms with its line still syncing still fails the test, and affected.mjs reports it a new FAIL, not INCONCLUSIVE (3496.694215ms)
ℹ busy_disk exited 101; dd ran 5 times, the hook 5
ℹ thread 'main' (666804) panicked at crates/deep-hook/tests/busy_disk.rs:138:5:
ℹ calls whose spooled line was still syncing at the deadline took [207.541465ms, 351.726448ms, 336.270304ms, 413.555637ms, 203.77137ms]
ℹ test a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms ... FAILED
ℹ test result: FAILED. 0 passed; 1 failed
ℹ affected.mjs: NEW FAIL cargo -p deep-hook --test busy_disk › a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms
```

## Under its own load, the real disk and the real hook

These real-disk runs were taken before review's last two wording changes (the dd exit count in the INCONCLUSIVE reason,
"running 1 test"), which change no pass or fail.

Before (base): GNU dd refuses bs=1m, so no file is written and the run is not under its own load. It passed only
because the machine's own I/O, at load 152, made five syncs late:
```
running 2 tests
test hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running ... ok
test a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 20.35s


real	2m34.073s
user	0m30.465s
sys	0m3.943s
EXIT 0
 00:13:58 up  9:21,  3 users,  load average: 152.29, 113.82, 75.11
```

After (dd writes 512 MB per call: 2 m 49 s of wall clock, a 7 s build included, against the base's 2 m 34 s with a 2 m 13 s build):
```
running 2 tests
test a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms ... ok
test hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running ... ok

test result: ok. 2 passed; 0 failed

real	2m49.540s
user	0m1.135s
sys	0m4.412s
EXIT 0
 00:16:55 up  9:24,  3 users,  load average: 244.26, 172.26, 104.43
```

After, with a dd that writes nothing and the real hook, at load 276: the machine's own I/O made five syncs late, so
it measured and passed. A quiet real disk can't be made on this machine, which is why AC1 uses stand-ins.
```
    Finished `test` profile [unoptimized + debuginfo] target(s) in 3.32s
     Running tests/busy_disk.rs (target/debug/deps/busy_disk-e966b559699926de)

running 1 tests
test a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms ... ok

test result: ok. 1 passed; 0 failed
exit 0
 00:25:48 up  9:33,  5 users,  load average: 275.99, 248.49, 171.82
```
