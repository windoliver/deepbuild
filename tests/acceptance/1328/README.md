# Acceptance tests for #1328: the blind acceptance job runs on the runner

Written first and blind. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Sources read

- Issue #1328, as saved verbatim for this job: its Scope, its 5 checkbox criteria and its Proof.
- `docs/technical-design.md`: How we know version 0 works with its Dogfooding bullet, What done means fixed at the start, Attempt and plan.
- `AGENTS.md`.
- The base commit `ed83819d`: `packages/runner/src/`, `packages/hub/src/core.ts`, `github-source.ts`, `gate-runner.ts` and `runs.ts`, `packages/checks-command/src/report.ts`, `scripts/proof.mjs`, `proof-guard.mjs`, `proof-change.mjs`, `proof-runs.mjs`, and `adapters/claude-code.facts.json`.
- `tests/acceptance/159/`, `875/`, `1116/` and `569/helpers.mjs`, for their conventions. Nothing is imported from them.

No other branch, worktree, PR or transcript was read. #875, #159 and #1325 were read only through what this base says of them.

The Dogfooding bullet says a dispute goes to a person and a test is redrafted at most once. The issue is newer: a third draft settles it, and a test is redrafted at most twice. These tests hold the issue's values.

## Criteria to tests

| AC | Tag | Test |
| --- | --- | --- |
| 1 | `#1328.c53e7397` | `job.test.ts`: the record lists exactly the inputs; a planted read of another branch is refused; a planted read of a transcript is refused |
| 2 | `#1328.0bdcba1d` | `job.test.ts`: a write to `src/widget.mjs`; a write to a sibling folder sharing the prefix |
| 3 | `#1328.dfd2cdea` | `job.test.ts`: a test passing on the base is INVALID though the job recorded a failure; its ready twin |
| 4 | `#1328.1533f79d` | `dispute.test.ts`: the redraft also fails; the two passing drafts swap; a third draft that fails keeps the test; a planted hollow redraft; a planted hollow third draft; the guard on the swap; no gate identity |
| 5 | `#1328.3cf9c8d9` | `dispute.test.ts`: no job after a test stood; no job after a swap; no draft meets the base rule |

Every `describe` carries its tag. The first draft in a dispute expects navy, so it fails on the base at its assertion and on the work. The work turns the widget blue.

## How to run

On macOS, with Node 24.22 on `PATH`. The fixture's test command is `node --test`, so the hub finds Node there.

```sh
npm ci                                                       # once, if node_modules is missing
npm run build --workspaces                                   # the tests run the built CLI
node_modules/.bin/vitest run tests/acceptance/1328 --testTimeout=600000
```

Each hub test starts its own hub, so the folder belongs in the `alone` list in `scripts/lanes.mjs`. That file is outside this job's folder, so the implementing change adds it. Three tests read one scene, so that scene takes its time on the first of them.

## Stand-ins

- **The agent.** `fixtures/fake-claude.pl`, installed as `claude` on the hub's login path. It prints Claude Code's stream-json and calls no model. Each read and write is real, under the sandbox, and shows as a tool_use. A write needs the job's flags to let `Write` through.
- **Its plan.** A redraft has the same inputs as a first draft, so the prompt can't say what it should do. The test writes `plans/<job folder>.json` beside the stand-in, which is on the job's read grant, and the stand-in waits for it. The order of `Stage.plans` is the order the jobs start.
- **The forge.** The hub's own recorded GitHub answers, `DEEP_HUB_TEST_GITHUB`. Nothing touches GitHub.
- **The gate identity (#1325).** An SSH key made for each hub, named in its config.

Everything else is real: the hub, runner, supervisor and sandbox, record, asks, git, `node --test` on the fixture's tests, and `scripts/proof.mjs guard`. `HOME` is a temp folder. The hub is stopped by its PID. Nothing spends money.

## Failing on a wrong program

Every judgement is a vitest `expect` under this folder. A hub reply that refuses a method fails at `expect` in `Stage.answered`, so on the base each test fails at an assertion, not on a thrown `Error`. A plain `Error` is only for a scene that never got set up, such as a hub that isn't built, and starts `BLOCKED`. A wrong program that hangs fails at `expect.fail` in `Stage.until`.

## Surfaces assumed

All of these live in `helpers.ts`.

1. **Job kind.** `JobSpec.kind` and `JobRecord.kind` take the value `acceptance`. Redrafts are the same kind. `job.list`, `job.status` and `job.output` return these jobs as they do any job.
2. **`acceptance.start`** is a hub control method with params `{ issue, repo, base, design, command, agent }`. `issue` is the issue's link, `https://github.com/<owner>/<name>/issues/<n>`, and `<n>` names `tests/acceptance/<n>/`. `repo` is an absolute path. `base` is a 40-hex SHA. `design` is a list of paths at the base. `command` is the repo's test entry; the hub appends one test file's path and runs it in a fresh checkout. `agent` is `claude-code`. It replies `{ job: <run:ULID>, state: 'running' }`, or `{ job: null, state: 'queued' }` when every slot is taken.
3. **The issue's body** comes through the GitHub work source, `readIssue`. The prompt on the job's stdin holds it verbatim. A redraft's prompt holds the same body, read at the first job, and the criterion's text.
4. **`acceptance.status`** takes `{ issue }` and returns `{ state, result, why, jobs, branch, commit, base, disputes }`.
   - `state` is `queued`, `running` or `done`. `done` means the first job has been judged.
   - `result` is `ready`, `INVALID`, `refused` or `null`. `why` is text or `null`.
   - `jobs` is every job of the issue, oldest first.
   - `branch` and `commit` are the attempt's branch name in `repo` and its first commit, or `null`.
   - `base` has one entry per new-behavior test: `{ test, criterion, outcome: 'failed', at }`. `test` is `<path> › <name>`, `criterion` is the tag, and `at` is `<path>:<line>`.
   - `disputes` has one entry per dispute that started a job: `{ test, outcome, jobs, commit, refused }`. `outcome` is `stands`, `swapped`, `asked` or `null` while it runs. `jobs` are its redrafts. `commit` is the swap's, or `null`. `refused` lists `{ job, test, why }` for each draft the swap would not keep.
5. **`acceptance.dispute`** takes `{ issue, test, work, why }`. `test` is `<path> › <name>`, `work` is the commit the drafts run on, and `why` is the dispute's text. It replies `{ job: <run:ULID> }` for a dispute that starts a redraft, with any other fields left to the hub, and exactly `{ job: null, settled: true }` for a test already settled or already asked about.
6. **The input record** is `data.inputs` on the job's `job.recorded` event, a list with one entry per input:
   - `{ kind: 'issue', ref: <the link>, sha256: <of the body> }`
   - `{ kind: 'design', ref: <path>, sha256: <of the file at the base> }`, one per design document
   - `{ kind: 'base', ref: <the commit> }`
   - on a redraft only, `{ kind: 'criterion', ref: <the tag>, sha256: <of the criterion's text> }`
7. **The job's folder** is its checkout of the base, `JobRecord.folder`, and its working folder, as #159's `checkout` has it. It writes `tests/acceptance/<n>/` there, through Claude Code's `Write` tool. The job's folder keeps its `.git` with the base commit's objects alone.
8. **The refusal.** A read or a write outside the job's reach gives `result: 'refused'`, with the read's absolute path or the written path in `why`. The stand-in makes the read for real and prints it as a `Read` tool_use, so either the sandbox's report or the job's stream can carry it.
9. **New behavior.** The fixture's criteria begin `New behavior:` or `Unchanged:`. A criterion that begins `Unchanged:` is no new behavior, and its test may pass on the base. A test names its criterion by its tag, in its name, as this repo's tests do.
10. **Who judges the base.** The hub runs each test on the base itself. The file the job writes, `BASE-FAILURE.txt` in the fixture, is the job's word and is never evidence.
11. **The attempt.** A ready job leaves an event `attempt.started` with `data: { issue, branch, commit, base }`, `issue` being the link. A job that isn't ready leaves none and no new ref.
12. **The first commit** is made in `repo` on `branch`, whose parent is `base`, without touching that checkout's HEAD or files. The tests put their work commit on `branch` by `update-ref`.
13. **The swap** is one commit on `branch` on top of the work, changing only the disputed test's file. The hub signs an annotated SSH tag on it with one `Approves: <path>` line per file, as `deep/approved/` tags are, under a ref folder of the hub's choice. The commit or those before it name `Part of #<n>`.
14. **Which draft is kept.** Of the two drafts that pass on the work, the swap keeps one that fails on the base at its assertion. The other is listed in `refused` when it doesn't.
15. **The ask** is one `ask.created` event whose JSON names every draft's job. Its source and kind are the hub's choice.
16. **Hub config.** `<root>/config.json` holds `acceptance: { slots: <n> }` beside `runner` and `plan`, and `gate: { key: <path to a private SSH key> }` for the gate identity. No `gate` key means no gate identity, and then the agreeing drafts go to one ask.
17. **Slots.** An issue holds its slot from `acceptance.start` until an ask waits on it. The next queued `acceptance.start` then starts in that slot, in the order they came.
18. **The guard.** `$DEEP_GATES` names an allowed-signers file, read as `$DEEP_APPROVERS` is, by default `~/.deepbuild/gates`. A tag signed by a key it lists counts as an approval only for files under `tests/acceptance/<n>/`, where `<n>` is the issue the change names.

## Scope sentences with no checkbox

These hold in the issue's Scope and no criterion names them, so no test covers them: the job running on the run's plan and under the machine's leases, and one test per criterion being present before a job is ready. Failing on the base away from an assertion is covered only inside AC5's last test. The guard protecting the folder from then on is the guard's existing rule, read only through the swap test.
