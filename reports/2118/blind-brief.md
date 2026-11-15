You are the acceptance-test author for one issue of the DeepBuild repository. This is a blind job: you write the tests from the issue, the design and the base commit alone, before any implementation exists. You never see an implementation and you never look for one. You make changes (new test files only); you do not fix the issue.

## Inputs (the only ones you may use)

1. The issue: `<scratch>/issue/issue-2118.md`, the live body of windoliver/deepbuild#2118 saved a moment ago (`gh issue view 2118 --repo windoliver/deepbuild` shows the same). You may also read the issues it links (its epic, #3) with `gh issue view <n> --repo windoliver/deepbuild`.
2. The base checkout: `~/doneright-2118-blind`, a git worktree detached at `0e55727311da14cb0c4644f9afd5e33c9505fefa` (origin/main today). Read `AGENTS.md` there first, then the design, `docs/technical-design.md`: the sections the issue links ("How runs become one of five verdicts", "An agent says it's done", "Before each command"), the Dogfooding and proof parts under "How we know version 0 works", and whatever else a criterion touches. The issue's file:line references are to an older branch. On this base the code has moved (much of `core.ts` now lives in other files of `packages/hub/src/`), so find each behaviour by reading the base.

## Isolation (hard rules)

- Work only inside `~/doneright-2118-blind`, plus temp folders you create yourself. Do not read, list or search any other checkout or worktree of this repository on this machine (`~/doneright`, any other `~/doneright-*`, `~/dev/claude-worktrees`, `/tmp/deepbuild-*`), and nothing under `<scratch>` except the `issue/` folder and the two status files named below.
- Do not look for an implementation of this issue anywhere: no `git fetch`, no reading of other branches or remote refs, no pull-request searches or reads about #2118, no agent transcripts, no shell history. `git log` and `git show` of the base commit's own history are fine.
- Never list all processes with their command lines (`ps aux`, `ps -ef`, `pgrep -fl` and the like). Inspect and stop only processes you started, by PID. Never kill by name or port.
- No git commit, stash, branch or push, and no GitHub writes (no comments, labels or edits). Leave your files uncommitted in the worktree.

## What to deliver

Only new files under `tests/acceptance/2118/` in that worktree:

- One test per acceptance criterion of the issue (there are eight), each named with its criterion tag the way the sibling suites on this base do it (see `tests/acceptance/2120/` and `tests/acceptance/2123/`): `AC<n> #2118.<first 8 hex digits of the SHA-256 of the criterion's checkbox text, trimmed, white space collapsed>`, the normalization in `scripts/proof-change.mjs`.
- The helpers and fixtures the tests need, kept small, and a `tsconfig.json` if the sibling suites carry one for strict type-checking of the suite, done the same way.
- `README.md`: the inputs you used; a requirement → test → base-result table; the exact commands that run the suite; every deviation and everything unrun.
- `BASE-FAILURE.txt`: the base run's result per criterion (the failing assertion and its message), with any home-directory path redacted, as the sibling suites do.
- Edit nothing else: no production code, no existing test, no script, no lane list, no config. If you believe a criterion can't be tested without a new production seam, do not add one: test through the nearest existing surface and say so in the README.

## What makes these tests right (AGENTS.md, Proof)

- Each test asserts the issue's expected values through surfaces the issue and the design name, on real components: the real gate runner, the real hub over its socket, real git checkouts, the real record. Mock only at boundaries the repository doesn't own, such as the program a check runs or the forge. Use the smallest test that sees the behaviour: a fast test on the real class where the criterion is about logic, the hub end to end where it is about what an agent or a person sees.
- Each test must fail on a wrong program. On this base it must fail for the reason its criterion gives after "Today": an assertion failing on the wrong observed value, not a crash, a missing import, a timeout or a setup error. A program that does nothing must fail it too. A test that would still pass if every function it calls returned nothing is not a test.
- Assert behaviour, not implementation: what the criterion names (a verdict and what it names, a run that starts or doesn't, a denied call and its cause, a file that isn't written, a list's contents, a hook reply's fields, a check that is held). Don't pin wording, private fields, call counts or structure the issue doesn't state. The issue's Scope section describes one implementation, not a contract: a fix may choose another that makes the criterion true.
- Never weaken or bend a test to get a failure. If a criterion already holds on this base, so that your honest test passes, keep the test as written and report that plainly in the README and in BASE-FAILURE.txt, with the output.
- Keep it lean: one test per criterion, no extra scenarios, no neighbouring suites.
- No secrets or personal data in tests, fixtures or saved output; redact home paths. Public text names only this project's own design: never name another product or project.

## Environment (facts of this machine, not of the work)

- Put these first on PATH for every command: `$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin` (Node 24.22.0; the Homebrew Node breaks the command check's sandbox tracing) and `/opt/homebrew/opt/rustup/bin` (cargo).
- The checkout is being prepared for you in the background by the session that started you: `node_modules` and the packages' `dist/` builds (status in `<scratch>/base-setup.status`, done when its last line is `build exit 0`), and `target/debug/deep-hook` (log in `<scratch>/base-hook.log`, done when its last line is `hook exit 0`; it waits in the machine's build queue and may take an hour or more). Don't start your own `npm ci`, workspace build or cargo build unless a status file reports a failure, and then say so in your report. Start reading and writing at once: you need the builds only to run the suite.
- vitest picks tests up from `tests/**` (the root `vitest.config.ts`); nothing needs registering.
- The machine is shared and very loaded (a load average in the hundreds on 18 cores). Give vitest `--testTimeout=600000 --hookTimeout=600000`, give spawned processes generous waits, and never make a wall-clock duration an assertion unless the criterion is about one. A timeout under this load is not defect evidence: say so rather than counting it.
- Run the suite on the base once it is written, each file once, for example `node scripts/throttle.mjs test --wait 120 -- npx vitest run tests/acceptance/2118/<file> --testTimeout=600000 --hookTimeout=600000` (the throttle is the machine's shared test queue). AGENTS.md names `node scripts/affected.mjs <test paths>` as the verifier: use it for the final recorded base run if it finishes, and if it can't get a grant record that as unrun and keep the direct vitest output. Rerun a file only after you changed it. Type-check the suite strictly the way the sibling suites document.
- Remove every temp folder and stop every process you created.

## Report back

Your final message is read only by the session that started you. Give: the files you wrote, each with its SHA-256 (`shasum -a 256`); per criterion, its tag, its test file, what it observes and its base result (the failing assertion's message, or "passes on the base"); the exact commands you ran and how each ended; every deviation from these rules, however small; and everything you could not run. Be exact about what you verified and what you did not.
