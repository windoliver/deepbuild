# #33 AC5, blind redraft: passing the bootstrap's commands keeps a task at "Part of"

Criterion `#33.64a97658`, verbatim:

> Until drafting lands, each task here takes its definition of done from its issue's acceptance criteria: a change
> that passes the bootstrap's commands but leaves one criterion unproven stays "Part of"; a gate that judges only the
> bootstrap's commands says "Closes" and fails this test

Written blind, by a job that saw only the issue's criterion and Scope, the design and the base commit, never an
implementation of #33 or an earlier draft of this suite. The implementing agent does not edit these files
(AGENTS.md, Proof).

## Sources

- **The issue, #33**: AC5 (above) and its Scope: the done gate turned on for this repository through a bootstrap
  `.deepbuild/done.yaml` that runs the repo's existing test and typecheck commands, written and approved by the
  maintainer, never by an agent; until drafting lands in week 5, each task takes its definition of done from its
  issue's acceptance criteria. Depends on #322 (closed): the gate reads the bootstrap `done.yaml`, each task's
  acceptance criteria through `work.item@1`, project trust, and Closes or Part of.
- **The design**, `docs/technical-design.md`: What done means, fixed at the start (At the claim: "The PR says
  'Closes' only when every requirement passed; otherwise it says 'Part of' and lists what's left"; Done means
  switched on: an agent can't close an issue by hand while its definition hasn't passed); An agent says it's done
  (Every stop is judged, The verdict in the chat); the done-gate row in First-party extensions (it judges each stop
  against the ask's definition and the repo's `done.yaml`, and maps the verdict to "Closes" or "Part of") and its
  `done.yaml` example; How runs become one of five verdicts (nothing missing or unrun passes); How we know version 0
  works, Dogfooding (week 3 on the maintainer's bootstrap spec, week 5 on the drafted one).
- **The base commit**: `b52f7357`. Read for its surfaces only: `tests/acceptance/322/` (README, `helpers.ts`,
  `work.ts`, `closes.test.ts`, `coverage.test.ts`, `sendback.test.ts`), `packages/hub/src/core.ts` (the PreToolUse
  Closes and Part of rules), `packages/hub/src/forge.ts` (`isPrCreate`, `closesIssue`, `partOfIssue`),
  `packages/hub/src/ask-tasks.ts` (a work item's criteria as the definition when none is handed, `criterionId`), the
  `run.started@3`, `run.finished@2` and `verdict.made@1` fixtures.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the test starts
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/33/redraft-ac5 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/33/redraft-ac5/tsconfig.json
```

- Each test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list.
- Every test makes its folder under `/tmp/dh33r-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (#322's `cleanup`), and removes its own folders.
- No network, no model, no `claude` binary, no `gh` call: the `gh pr create` calls are hook payloads only.
- Each test takes one to four minutes, most of it the stop's hold (60 s by default) and the bootstrap's runs.
- The wrong program's test fails BLOCKED until the hub lists the plant (`plantOf` throws on a name it doesn't list).

## The surface under test

The suite imports `tests/acceptance/322/helpers.ts` and reaches DeepBuild only through its surfaces:

- **deep-hook**, run as Claude Code runs our hook entry (`deep-hook claude-code <event>`), each session's hooks the
  children of its own stand-in process (#322's `fixtures/agent.mjs`): SessionStart, the typed prompt `Fix <link>`, a
  Read, the Edit that makes the unit test pass, the Stop, and two Bash calls at PreToolUse.
- **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS` (empty: no drafting job, no handed
  definition), `DEEP_HUB_TEST_WORK` (the issue's reading) and `DEEP_HUB_TEST_GITHUB` (empty), and `DEEP_HUB_PLANT`
  for the wrong program.
- **The project's trust decision** as #348 records it (#322's `trustRepo`), before the hub starts.
- **The record** through `events.read` on the socket: `task.created`, `definition.locked`, `claim.made`,
  `run.started`/`run.finished`, `verdict.made`.

### The world

`<tmp>/repo` stands in for this repository at the bootstrap stage, one commit on `main`:

- `.deepbuild/done.yaml`, the maintainer's bootstrap, committed by the maintainer (the test), not by an agent:
  `claims: { done: { checks: [test, typecheck] } }`, `test: { type: command, run: "node --test tests/unit.test.js",
  min_tests: 1 }`, `typecheck: { type: command, run: "node --check src/auth.js" }`.
- `package.json`, whose `test` and `typecheck` scripts are those two commands: the repo's existing commands, which the
  bootstrap runs. They are written out rather than as `npm test` / `npm run typecheck` so the hermetic runner counts
  the node:test run as #322's suite has it counted.
- `src/auth.js` and `tests/unit.test.js` from #322's world: the unit test fails at the base and passes after `FIX`.
- No `.deepbuild/checks/` and no `tests/acceptance/7/`: no test is tagged with either criterion's ID.

The issue is `windoliver/deepbuild#7` at the test work source (`https://work.test/windoliver/deepbuild/issues/7`),
authored by the owner, with two acceptance criteria: "An expired token is rejected with 401" and "The e2e test for
expired tokens passes". The session starts from it by its link.

## What the test asserts

`part-of.test.ts`, describe and tests named `AC5 #33.64a97658 …`; every failure message starts with that tag.

1. The tag is the criterion's ID (`#33.` and the first 8 hex of SHA-256 of its text, as `scripts/proof-change.mjs`
   computes it).
2. With no definition handed, the task's definition locks from the issue's acceptance criteria: a requirement quoting
   each criterion.
3. Premise (BLOCKED if missing, never a pass): the Stop after the Edit makes a claim, and the bootstrap's `test` and
   `typecheck` checks both run on it and finish `passed`.
4. `gh pr create --title "Reject expired tokens" --body "Closes #7"` is refused at PreToolUse; its reason names
   `Part of` and lists each unproven criterion by its requirement ID, its `#7.<hash>` ID or its text.
5. The same call with `--body "Part of #7. Still open: R1 (…); R2 (…)"` is allowed.
6. No `verdict.made` on the task's claim is `PASS`, and the stop's reply doesn't say PASS.

## Wrong program

| Name | What the plant does | How the test fails on it |
|---|---|---|
| `bootstrap-commands-only` | the gate judges a claim on the bootstrap's commands alone, leaving out the task's definition from its issue's criteria | the claim passes on `test` and `typecheck`, so `gh pr create … "Closes #7"` is allowed (or the claim's verdict is PASS); the test requires the scenario to fail at its own assertion, its message starting with the tag and naming `Closes` or `PASS` |

`failureOf` (#322's) rethrows a BLOCKED premise, so a plant that doesn't start, or a run where the bootstrap's
commands didn't pass, never counts as the plant's failure.

## What this test could not encode

- **One criterion proven beside the unproven one.** In this repo a criterion's check is the test tagged with its ID,
  run with `npx vitest`; the temp repo has no Vitest, and fetching it needs the network. So neither criterion is
  proven, and the change still passes every bootstrap command, which is the case the criterion names.
- **The real bootstrap file of this checkout.** Its `npm test` and typecheck run the whole repo's suites, far too
  long for one test; the world stands in with the same shape.
- **"Until drafting lands"**: read as no drafting job and no handed definition; what replaces the bootstrap in week 5
  is out of scope.
- **The PR body DeepBuild itself writes through the forge** needs the network; the refusal of the agent's Closes and
  the allowed Part of are the surface, as in #322's AC2.
- **Where the stop's verdict lands** (FAIL, BLOCKED or INCONCLUSIVE for a criterion with no check) is left open; only
  "never PASS" is asserted.
