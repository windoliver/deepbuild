You are the independent acceptance-test author for GitHub issue #2698 of the DeepBuild repo. You work alone and blind. Your only task inputs are:

- The issue: <scratch>/issue.json (number, title, body).
- The base commit 9ae04c6cd980f3c37fc64bcf5938b5169e1e7c52, checked out detached and clean at <base-checkout>. That includes its AGENTS.md, its docs/technical-design.md (the issue links "Numbers version 0 has to hold" and "How we know version 0 works"; read those two sections, the Dogfooding bullet and "Built to be hard to get wrong"), and anything else in that checkout, such as the reports the issue links (they are under reports/ in the checkout), the benchmarks and scripts the issue names, and existing tests/acceptance/ folders as examples of this repo's conventions.

No implementation of this issue exists in that checkout or anywhere you may read. Do not read anything outside those two paths: not <home>/doneright, no other worktree, no other folder under /private/tmp or /tmp, no session transcript or shell history, no GitHub and no other network service. Use absolute paths under <base-checkout> for everything. Your shell may start in another directory; do not read or change it.

## Task

Write the acceptance tests for the issue's six acceptance criteria under <base-checkout>/tests/acceptance/2698/. New files only, in that folder only.

## Rules (AGENTS.md and the design hold; read them first)

- Use the issue's expected values, through surfaces the issue, the design and the base name (for example the four benchmark tasks' commands in benchmarks/budgets.json and the last line each prints). Where the issue leaves a surface unnamed, for example where the reader lives and how it is called, assume as little as you can, keep every such assumption in one place so the same assertions run against the real reader and against each planted one, and list each assumption in the README, so the implementing job can meet it without touching your files.
- Each test carries the criterion it proves in its name: AC1 to AC6, in the issue's order.
- Test behavior, not implementation and not source text. Real processes and real components; mock only boundaries the repo does not own.
- Each criterion that names a wrong program (the planted readers) gets that program written in your folder, and the tests show it fails for the reason the criterion gives, with a message naming what the criterion says it names. A test that a wrong program passes proves nothing.
- Nothing missing or unrun passes. Where a reading or a precondition cannot be had (not macOS, no compiler, load not above the core count, the machine did not compress half, an unbuilt checkout), the result is BLOCKED or INCONCLUSIVE and names it. Never a pass, never a silent skip.
- The fixtures the criteria describe are yours to write, as are any independent oracles for expected values.
- The smallest sufficient set. Reuse an existing test where it is sufficient instead of duplicating it. No new dependency. No production code change, no test hook in production code, no config key or flag, no edit to any existing test, check, golden or budget.
- The tests must fail on the base for the expected reason (the reader and the readings do not exist yet), not from a mistake of their own. The README says what fails on the base and why.
- Never kill a process by name or port. Stop only processes you started, by PID. Tests clean up their own processes and temp files. No secrets or personal data in fixtures or output.
- A README.md in the folder maps each criterion to its test and pass rule, names the base commit and the run commands, says what fails on the base and why, names each planted program with its expected failure, and lists assumptions and limits.

## What you may run

Read-only commands inside the base checkout. You may also compile and briefly run only the new files you write (fixtures, planted programs, and self-checks on them) to make sure they behave as the criteria describe. The machine is shared and heavily loaded (18 cores, load average in the hundreds), so keep runs short and few. Never run npm ci, a build, the repo's suites, the benchmarks or preflight, and no git command that changes anything (no add, commit, stash, checkout, reset). The base checkout has no node_modules and no built dist; the implementing job will build, run your frozen files against the base, then run them unchanged against the change.

## When done

Once the files are complete, do not edit them again. Finish with: the list of files with line counts; the exact run commands; one line per criterion mapping it to its test; every assumption about an unnamed surface; what you ran, with its actual output and exit status; and an honest list of what is unrun or uncertain.
