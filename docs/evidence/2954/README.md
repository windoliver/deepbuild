# #2954: a failed #56 test leaves no marked process

`forced.mjs` copies one #56 test file per case into an output folder, outside the suite, and makes one test fail, or time out, while holds are in flight. It runs the copy with `node --test`. After the file exits, it counts the processes still running that carry the run's markers or the PIDs the check log recorded for the forced hold, at +3 s and +10 s, then stops them by PID. In every case but `leases-fail`, the forced hold runs on a second hub of the same variant with a virtual clock, so its 2 s timeout never fires and the hold is surely in flight when the test fails.

Each case ran once on Node v24.22.2 at load 160 to 250, against main's helpers at `e575a47af` (`main.txt`) and against the blind redraft at `f020b6c98` (`change.txt`).

| Case | Forced failure (both variants unless noted) | main: left at +10 s | redraft: left at +10 s |
|---|---|---|---|
| `processes-fail` | passes-or-fails test: one extra hanging hold with 2 grandchildren, then the test fails | 6 | 0 |
| `timeouts-fail` | real-clock test: the same extra hold, then the test fails | 6 | 0 |
| `typecheck-fail` | slice-failure test: the same extra hold, then the test fails | 6 | 0 |
| `leases-fail` | 50-session test: its hold-due check made false, with its own 50 holds in flight | 0, swept by its own end step (#2942) | 0 |
| `processes-timeout` | `[plain]` passes-or-fails test with its timeout cut to 150 s: the extra hold, then the test hangs | 3 | 0 |

On both sides every run exits 1 and reports its failure. After the redraft's runs, no process on the Mac carried `ds56m.` (the last line of `change.txt`).

To rerun from a checkout: `node docs/evidence/2954/forced.mjs tests/acceptance/56 <label> <out dir> [case ...]`.
