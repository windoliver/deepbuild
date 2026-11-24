# Acceptance tests for #2960, first criterion (blind redraft)

Drafted blind from issue #2960 (title and body only), `AGENTS.md` ("Proof"), `docs/technical-design.md` ("Numbers version 0 has to hold", "Dogfooding", "Wrong programs" and the edit guard) and the base commit `dcb63a0a0`, which has no implementation. I also read that commit's `scripts/benchmark.mjs` (`measureOnce`, `countChildren`), `scripts/count-children.c`, `benchmarks/budgets.json`, `benchmarks/deep-hook.mjs`, `benchmarks/hub.mjs`, `benchmarks/extension-host.mjs`, `packages/supervisor/native/helper.c` (`leash`) and `tests/acceptance/1404/` as the model. Per AGENTS.md the implementing agent doesn't edit these; a dispute goes to a blind redraft by this job.

## The criterion, whole

> On macOS, `measureOnce` of `deep-hook-guards`, `deep-hook-overhead`, `hub-round-trip` and `extension-host` at the merge base each give a non-null instruction count with an empty `uncounted`. A planted counter that ignores `_exit` reads `uncounted ["(forked)"]` again, and the test fails naming the helper's watcher.

Every test is tagged `#2960.bb693bcf`.

## Run

```
node --test --test-concurrency=1 'tests/acceptance/2960-redraft-ac1/*.test.mjs'
```

They need macOS, `/usr/bin/time -l`, `cc` (the counter is built by `measureOnce` itself), an arm64 `cargo` first on `PATH`, and `hyperfine` (the `overhead` bench). The file's `before` builds the release `deep-hook` once (`cargo build --locked -q --release -p deep-hook`, what the bench itself runs) so a cold build isn't timed inside a measured run. Off macOS, under Rosetta (`sysctl.proc_translated = 1`), or with an x86_64-only `cargo`, each test fails as `BLOCKED`, naming which, never passes.

## Tests

`forked-counted.test.mjs`, one test per task, in the issue's order:

| Test | What it does | Expected |
|---|---|---|
| `#2960.bb693bcf measureOnce of deep-hook-guards gives a non-null instruction count with an empty uncounted` | `measureOnce(command, root, false, 1_500_000)` with the task's own `command` from `benchmarks/budgets.json` (`node benchmarks/deep-hook.mjs guards`), in this checkout, `follow` left at its default, as a perf side runs it | `status` 0; `instructions` a positive safe integer; `uncounted` `[]` |
| `… deep-hook-overhead …` | the same, `node benchmarks/deep-hook.mjs overhead` | the same |
| `… hub-round-trip …` | the same, `node benchmarks/hub.mjs round-trip` | the same |
| `… extension-host …` | the same, `node benchmarks/extension-host.mjs` | the same |

"At the merge base" is read as the issue's reading was: the budgets' commands as the checkout under test has them, which for this issue's change are the merge base's benches, now measured by the change's counter. The timeout is raised from `measureOnce`'s default 300 s because a bench under the counter on a loaded machine can take longer, and a timeout is no reading; the timeout changes nothing the criterion reads.

### Naming the helper's watcher

`measureOnce` removes its counter log when it returns, and its result names an uncounted child only by its path, `(forked)`. So when a test fails its reading, it runs the same command once more under `measureOnce`, wrapped by `diagnose.mjs`, which runs the command as its waited-for child and then copies the counter's log (the file `DEEP_COUNT_LOG` names, the contract `count-children.c` documents) to a scratch file, after giving each process with a `start` line and no end line up to 5 s to go. The failure message then lists each such process, its parent's path, whether it is still running or gone with no end line, and, when a `(forked)` child's parent is `packages/supervisor/dist/helper`, calls it "the supervisor helper's watcher, forked by its leash". This runs only after the reading has already failed; it never turns a failure into a pass.

## Wrong programs

- **The merge base** (this is a fix): its counter writes a process's `exit` line only from a destructor, so the leash watcher that ends with `_exit(0)` has no end, and each test fails with `uncounted` holding `(forked)` and the message naming the helper's watcher. `BASE-FAILURE.txt` is that run.
- **Twin `exit-unseen`** (`twins.json`, `twins/exit-unseen/scripts/count-children.c`): the planted counter that ignores `_exit`, which the criterion's second sentence names. It replaces `scripts/count-children.c` with the merge base's counter, unchanged but for a header comment, so it compiles and runs under the change's `measureOnce` (which builds whatever `count-children.c` sits beside it). On it each test must again read `uncounted` holding `"(forked)"` and fail naming the helper's watcher. If the change also moves another part of the log contract the base counter doesn't write, the twin still fails these tests, and its message shows what it read.

On the base run (Mac15,12, load averages about 250, AC power) all four failed at the `deepEqual`, each with `instructions: null` and `(forked)` in `uncounted`, the message naming "the supervisor helper's watcher, forked by its leash, gone, with no end line". Each also named something else: `deep-hook-guards` `/usr/bin/sandbox-exec`, `deep-hook-overhead` `a child of (forked)`, `hub-round-trip` `a child of /usr/bin/cc`, `extension-host` the helper itself.

The issue also notes `hub-round-trip` naming `/usr/bin/sandbox-exec` and `extension-host` naming the helper itself; the criterion asks for an empty `uncounted` for all four, so those fail these tests too until counted.
