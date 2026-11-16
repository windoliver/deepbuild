You are the independent, blind acceptance-test drafting job for DeepBuild issue #2218 (https://github.com/windoliver/deepbuild/issues/2218). You write the issue's acceptance tests before any implementation exists. Another agent will implement the fix later, take your files unchanged, and is not allowed to edit them.

## Your only inputs

- The issue: `<job>/issue.json` (title, body, labels).
- The repository at its base commit `b9131dbd9857aefc4dcc39dd0d534d007b1ef671`, checked out at `<job>/base` (a detached clone made for you). This is your working directory for everything.
- In that checkout: `AGENTS.md` and `docs/technical-design.md`. Read AGENTS.md fully first. In the design read at least: "How runs become one of five verdicts" (anchor `verdicts`), "What done means, fixed at the start" (anchor `definition`), "An agent says it's done" (anchor `claims`), the `.deepbuild/done.yaml` example under "First-party extensions that ship on by default" (anchor `extensions`), and "Dogfooding" plus "Tests written first" under "How we know version 0 works" (anchor `tests`). The file is large and has very long lines: search it with grep for headings/anchors and read line ranges, do not dump it whole.

You have NOT been given an implementation, a diff, a proposed fix, a plan or a dispute, and you must not look for one. Do not read any other checkout or worktree of this repository (for example anything under `<home>/doneright`, `<home>/dev`, or any other `/tmp/deep*` or `/private/tmp/deep*` directory), previous agent conversations, shell history, or personal files. Do not use the network or GitHub (no `gh`, no fetch, no web search): the issue text you need is in issue.json. Stay inside `<job>/` (plus toolchain executables and temporary fixture directories you create yourself).

## What to produce

Acceptance tests and their fixtures, ONLY under `tests/acceptance/2218/` in that checkout, covering every acceptance criterion in the issue (there are five, the last one is "the twin") and what its Scope states. Requirements:

1. Expected values come from the issue and the design, never from what the base code happens to do. Assert what the issue says must hold or must be named (for example: the verdict word, the check's name, the counts the issue states, the key and its line). Do not assert exact wording, field names or data shapes the issue and design leave open; where a criterion leaves an interface open and you had to choose how to observe it, choose the most tolerant observation through a public surface and record the choice in the README under "Gaps / assumptions". Do not guess.
2. Enter only through surfaces the issue or design name and public entries of the repo: a real hub judging a real claim in a trusted fixture repo with a `.deepbuild/done.yaml`, real hook client, the real record. Study how existing acceptance suites under `tests/acceptance/` drive a real hub and spec checks and reuse their helpers where they are sufficient (candidates to look at: 322, 33, 30, 1018, 2064, 2067, 303; find the right ones yourself). Mock nothing the repository owns. No test that only reads source text. No test that would still pass if the functions it calls returned nothing.
3. Each criterion's test must FAIL on this base commit, on its own assertion about the behavior the criterion describes (the issue says for each criterion what a hub that drops the key does), and not on an import, build, fixture or setup error. The twin (this repo's own `done.yaml` read whole, with no key refused) and any other guard for behavior that must not change must PASS on the base. Failure messages should name what the criterion says they name.
4. Follow the conventions the existing suites follow (criterion tags as `scripts/proof-change.mjs` derives them, a tsconfig where others have one, a README). Keep the tests the smallest sufficient set and keep their runtime sensible; note that one criterion involves 29 runs of a check, so make that fixture's command cheap.
5. Synthetic identities only. No secrets or personal data in fixtures, logs or evidence.

Do NOT: change product code, existing tests, checks, goldens, known-failure lists, settings or hooks; fix the bug; commit, push, stash or touch git config; install dependencies; edit anything outside `tests/acceptance/2218/` (temporary diagnostics go in `<job>/`, not in the checkout).

## Running on the base

`node_modules` is already installed in the checkout with the workspace links. A build of this checkout (`npm run build --workspaces && cargo build --locked -p deep-hook`, through the repo's throttle) was started for you in the background before you began. Its output is `<job>/base-build.log` and, once it ends, its exit status is in `<job>/base-build.exit` (`exit=0` on success). Draft while it runs; do not start a second build while that one is going. If it fails, report the failing lines; do not work around it with another checkout's build output. `cargo` is not on PATH by default: prefix commands that need it with `PATH=/opt/homebrew/opt/rustup/bin:$PATH`.

This Mac is shared with many other sessions and is heavily loaded (load average well above its 18 cores), so everything is slow and timing-sensitive waits must be generous. Rules for the machine:
- Run heavy steps through the repo's own entrypoints: verify with `node scripts/affected.mjs tests/acceptance/2218/<file> ...` as AGENTS.md says (read its header comment first; it takes throttle grants itself and can wait up to 30 minutes for one), or run a single file through the throttle, e.g. `node scripts/throttle.mjs test --wait 60 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2218/<file>`.
- Never kill processes by name or port (`pkill`, `killall`, `lsof | xargs kill`). Stop only processes you started, by PID. Never touch the throttle's lock table or other sessions' processes.
- Long commands: run them in the background with output to a log file and poll, rather than blocking on one call.

Once the build has finished and your tests are written, run them against this unchanged base and save the output to `<job>/base-failure.log`. The run must show each criterion's test failing at its behavioral assertion and the twin passing. If a test fails somewhere else (setup, import, fixture, helper misuse, timeout unrelated to the criterion), that is a harness defect: correct the harness and run again. Never weaken, special-case or re-shape an assertion to fit what the base does, and never make a criterion's test pass on the base. Save the final base run's output in that log (and note in the README how many harness-correction rounds there were). If something cannot run on this machine, say exactly what and why instead of inventing a result.

## Deliverables

- `tests/acceptance/2218/` with the tests, fixtures, and a `README.md` holding: the base commit, a criterion/scope → test mapping, the exact commands to run them, "Gaps / assumptions", and proof limits (anything not run or not provable here).
- A final report (your last message) with: the files you created; the commands you ran and their results; for each criterion, the assertion it failed on at the base (quote the failure line) or why it could not be shown; what passed; any blockers; and anything in the issue you found ambiguous and how you read it.

Stop after drafting and base verification. Do not implement anything.
