# Evidence for #2420: a run's refusals past 256 targets are counted in one closing event, and a long target is cut

All runs are on 2026-11-23, on fresh GitHub clones. The merge base is `0a875355b`.

- `hand.png` and `hand.txt`: the hand run in a Terminal window on the MacBook Pro, on the pushed head `f72256cd1`.
  - It uses #1106's sample stack. The app is sandboxed by the supervisor, and requests come from outside the run to
    its filter port.
  - Run A is sent one request under a 9,000-byte `Host`, then 1,000 different `Host`s, then 1,000 more. While it
    lives, the record holds 256 events naming a target and no closing event. That stays true after the second
    thousand.
  - Run A's long `Host` is recorded as its first 512 bytes, then `…9000`.
  - When run A ends, the record holds one `more` event with target `1745`, which is 2,001 − 256. The criteria's `744`
    and `1744` are for runs without the long request.
  - Run B, beside it, is refused 3 targets. It records 3 events and no closing event.
  - The window title and the shell prompt are masked: they named the account. A separate agent checked the screenshot
    against the log and the code, and found no error and nothing unmasked.
- `suite-and-plants.txt`: `tests/acceptance/2420` run on the branch, then each planted twin's tagged test.
  - The suite passes 5 of 5 on the branch.
  - `new-256-once-full` fails, naming 512.
  - `closing-always` fails, naming the run and its `more`/`0` event.
  - `one-count-for-both` fails, naming the second run with 0 events.
  - This was the run of review round 3's code. The last code commit after it (`7d9a5c7ac`) only hands a closing
    event the record refused to the recheck. The before lane and the hand run were run on the final head.
- `spark-linux-unit.txt`: `packages/supervisor/src/denied-ceiling.test.ts` on the Spark (Linux, bubblewrap), at the
  pushed head and then with the merge base's `supervisor.ts`.
  - It covers the Linux sandbox parent's path.
  - On the branch: 256 events while the run lives, the long path cut, one closing event.
  - With the merge base's code it fails at its assertion: 301 events, expected 256.
- The blind suite's own run on the merge base is `tests/acceptance/2420/BASE-FAILURE.txt`.
