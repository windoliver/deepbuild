# #3587, blind redraft: event waits

This is a blind suite for #3587, written from the issue, the design (docs/technical-design.md, docs/parallel-proof.md
sections 6 and 7b) and base b48a47db7 alone.

It was written under the wait-ratchet rule, a rule given to the job: as the header of scripts/wait-ratchet.mjs says, a
test waits for the event it needs, never for time to pass; a `sleep(…)`, `Atomics.wait`, a `setTimeout` or
`setInterval` timer, or a clock difference inside an assertion is a fixed wait, and a timer or clock check that only
bounds a wait, so all it can do is turn a hang into a failure, is allowed with a `// deadline: <why>` marker, one marker
for one finding.

Run it with `node --test --test-concurrency=1 tests/acceptance/3587-redraft-waits/waits.test.mjs`. `BASE-FAILURE.txt`
holds its run on the base.

How the suite works (these notes were the files' comments; main's comment ratchet allows none in a blind suite, so
they live here, and only the `// deadline:` marker the wait ratchet reads stays in the code):

- Each run is a scratch entry in a temp folder: a copy of the checkout's scripts/, stub scripts/checks.mjs and
  scripts/perf.mjs, a benchmarks/budgets.json with a budget of seconds, and `scripts/preflight` run there as a person
  runs it. The SIGKILL run declares a harness budget and stubs scripts/agent-harness.mjs, so the harness lane's start is
  seen and no agent session starts.
- The throttle table is a temp folder of the file's own, named by DEEP_THROTTLE_TABLE, which throttle.mjs reads only
  inside node --test; an orphan outside the test's tree is refused it, so the machine's table is never touched.
- A top-level timed request waits for the load to fall below the cores, so the test process holds a build grant in
  that table and each preflight runs under it (DEEP_THROTTLE): its timed grant is then nested, under its own PID,
  released by itself, with no load wait. `box.table()` leaves out the holder's build grant and the turn grant a
  top-level build is dealt with it (#3549), and nothing else. Tests run one at a time.
- PATH holds only node's folder and the system's, so no `deep` or cargo of the machine's runs.
- The stubs write `<role> <pid>` lines; a test stops only those PIDs (checked against their ps start), the process
  group it made for preflight, and processes whose command line names its own temp folder.
- Criteria 1 to 3 read one run: a never-ending check with a never-ending child under a 4 s budget with margin 0.5 (a
  6.00 s allowance), given the allowance plus 30 s from its start.
