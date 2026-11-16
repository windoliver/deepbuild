# Acceptance tests for #2073: deep_run asks the project's trust first, and runs on the claim's commit

Written first and blind at base `1c4d1f0e2` from issue #2073 (updatedAt 2026-11-12T19:27:09Z), "deep_run runs a spec
command in a repo you haven't trusted, as you, in the live worktree": its Scope, its three acceptance criteria, its
Proof and Depends on, by a job that saw the issue, the design and the base commit and never an implementation, a diff or
an implementer's notes; none existed. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, as this job was handed it. #322 and #26, which it depends on, through their suites here.
- **`docs/technical-design.md`**: Threats, and what stops each one (Untrusted repos, Agents gaming checks, What a
  command's children do, Callers posing as others); How runs become one of five verdicts (the run outcomes, Pinned to a
  commit, Traced programs, Check health); Five ways in (the MCP tools row) and the Building blocks Check row; An agent
  says it's done and What done means, fixed at the start, for a claim's commit, snapshot and checks; First-party
  extensions (done-gate, spec-draft's "trust is one decision the core holds", checks-command, the `done.yaml` example);
  Reading by reference (`ev:<sha256>`); How we know version 0 works (Dogfooding, Tests written first).
- **The base's code**, for its surfaces only: `packages/hub/src/mcp-operations.ts` (`runCheck`, which is deep_run;
  `checksOf`; `claim`), `runs.ts` (`start`, `launch`, `RUN_AS_YOU`, `finish`), `stop-judging.ts` (`projectTrusted`, the
  trust read a claim's spec checks use; `specChecks`), `codex-settings.ts` (`codexTrusted`), `tools.ts` (the `deep_run`
  and `deep_claim` schemas), `wire.ts` (a refusal's fields), `mcp.ts` (a tool result's shape);
  `core.ts` (what wakes a waiting deep_run), `paths.ts` and `status.ts` (how a project is named);
  `packages/record/src/trust.ts` (`openTrust`); `packages/checks-command/src/index.ts`, `shell.ts` and `controls.ts`
  (what the hermetic runner counts, and what it leaves uncounted); `packages/supervisor/src/` (a grant, a run's
  environment, and what a run as you may write); `packages/evidence/src/index.ts` (what a stored output returns);
  `packages/contracts/schemas/run.started@3.json` and `run.finished@2.json`; `scripts/lanes.mjs` (the one-at-a-time
  list) and `scripts/throttle.mjs`.
- **The sibling suites**, for conventions: `tests/acceptance/26/` (README, `helpers.ts`, `fixtures/agent.mjs`,
  `contradiction.test.ts`, `errors.test.ts`, `fixtures/eval/run.json`), `322/` (`helpers.ts`, `trust.test.ts`), `823/`
  (README, `helpers.ts`, `run.test.ts`), `1723/README.md` and `48/README.md` (the criterion IDs' command).

## How to run

With Node 24.22.0 first on `PATH` and `git`, from the checkout's root:

```sh
npm ci                                      # once
scripts/lease npm run build --workspaces    # the hub and deep mcp the tests start
node scripts/throttle.mjs test --wait 30 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/2073 --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2073/tsconfig.json
```

The tests build nothing: a missing build is `BLOCKED`, naming the command. No network, no model, no paid call. Every
folder a test makes is under `/tmp/dh2073-*` (a socket path must fit in 104 bytes on macOS) and is removed when the test
ends. Every process a test starts has `HOME` at `<tmp>/h`, so the real `~/.deepbuild`, `~/.claude` and `~/.codex` are
never read or written. A test stops only the processes it started, by PID. The suite took 5.2 s on the base; on a hub
that refuses, criterion 1 reads the record for 5 s more before it says nothing started.

A hub that doesn't start, a hook the hub doesn't acknowledge, a `deep mcp` that can't reach the hub, a claim that isn't
recorded and an `events.read` that fails are `BLOCKED`; a `deep_run` that answers `outcome: "running"` because its wait
ran out is `INCONCLUSIVE` in criteria 2 and 3. Each throws, so none is ever read as a criterion's pass.

## The surface under test

Everything the tests touch is on the base already. This suite adds no `DEEP_HUB_PLANT` name, no test setting, no tool,
no argument and no event: the wrong program each criterion names is the merge base itself.

### Merged surfaces, used as they are

- **`deep hub run`** in a temporary HOME, with `DEEP_HUB_TEST_CONFIRM` (#24's OS-confirmation stub, as #26's and
  #823's hubs have it) and nothing else set.
- **The project's trust decision**, as #348 records it and #322's suite writes it: your answer on the trusted path,
  appended to `<home>/.deepbuild/ledger.db` through `openTrust` of the record's public entry
  (`packages/record/src/index.ts`) with the app's connection, before the hub starts. The test home holds no
  `~/.claude.json` and no `~/.codex/config.toml`, so neither Claude Code's workspace trust nor Codex's trusted projects
  covers any folder in any test.
- **A Claude Code session**, as #26's suite plays one: an agent stand-in (`fixtures/agent.mjs`) working in the fixture
  repo, whose SessionStart, UserPromptSubmit and PreToolUse reach the hub on deep-hook's wire from its own child
  processes, and whose `deep mcp` is its child, so the hub binds its calls to its session.
- **`deep_claim {task_ref, attempt, commit, scope, predictions: null}`**: `claim: "claim:<id>"`, and a `claim.made`
  with that ID and `data.commit` in the record.
- **`deep_run {check, claim}`**: on success `{run: "run:<id>", outcome, evidence: ["ev:<sha256>", …]}`; a refusal is a
  tool result with `isError: true`.
- **The record through `events.read`** on the hub's socket, with the control token: `claim.made`; `run.started`
  (`data.run`, `data.check`, `data.claim`); `run.finished` (`data.run`, `data.outcome`, `data.evidence`, SHA-256s).
- **`.deepbuild/done.yaml`**: `checks:` entries `{ type: command, run: "<command>" }`, as the design's example has them.

### What the tests hold the implementation to

Nothing here is a new name. Where the issue leaves wording open, the tests pin only what it states.

1. **The refusal** (criterion 1). `deep_run` in the untrusted repo comes back as an error (a tool result with `isError`;
   a JSON-RPC error is read as an error too, since its shape is #26's criterion, not this one's). Its whole text, as
   JSON, must name trust (it matches `/trust/i` once the test's own folder is taken out of it) and the project (it
   holds `shopfront`, the fixture repo's folder name). No code, path or sentence is pinned.
2. **Nothing started** (criterion 1). For 5 s after the reply, the record holds no `run.started` whose `data.check` is
   `marker` or whose `data.claim` is the claim; a run that does appear is given until its `run.finished` (a minute at
   most) before the marker is looked for. The marker file doesn't exist.
3. **The claim's commit** (criterion 2). In the trusted repo, a run of `deep_run` reads a tracked file as the claim's
   commit holds it, whatever the session's worktree holds by then.
4. **A passing check** (criterion 3). `outcome: "passed"`, `run` a `run:` handle, and `evidence` a list of at least one
   `ev:<sha256>` handle, equal as a set to the SHA-256s the run's `run.finished` names.
5. **Checks the hermetic runner counts.** The trusted repo's checks are `node checks/holds.mjs <word>`: one Node
   process, no shell substitution, redirection or other program, exit 0 or 1. The base's deep_run runs that line with
   `/bin/sh -c` in the worktree and reads its exit; the command check kind, which a claim's checks run through, counts
   it too (design: Traced programs; a command that starts no test tool has one result, its exit status), so the same
   checks stand before and after the change. Checked once on the base with a scratch script, not kept: the command
   check kind ran both lines on both contents of `state.txt` and answered passed and failed, never uncounted
   (`BASE-FAILURE.txt`).

## The fixture

One repo shape for all three tests, made new for each under its own `/tmp/dh2073-*` folder as `<tmp>/shopfront`, with
one commit on `main`:

| File | Holds |
|---|---|
| `state.txt` | `committed` |
| `checks/holds.mjs` | reads `state.txt` in the folder it runs in, prints `state.txt holds <word>`, and exits 0 when the word is its argument, 1 otherwise |
| `.deepbuild/done.yaml` | three command checks: `holds-committed` (`node checks/holds.mjs committed`), `holds-edited` (`node checks/holds.mjs edited`) and `marker` (`echo ran > <tmp>/marker`, a file outside the repo) |

The folder's name is letters only, and neither it nor any other name in the fixture holds the word "trust", so a
refusal names trust only by saying so.

- **Untrusted** (criterion 1): no trust record of any kind covers `<tmp>/shopfront`.
- **Trusted** (criteria 2 and 3): the core's decision marks `<tmp>/shopfront` trusted, and nothing else does.

In every test the session claims with `deep_claim` at the repo's commit while the worktree is clean, so the claim's
commit is that commit and its tree is the worktree's at the claim.

## Readings where the issue leaves a choice

1. **"No trust record covers"** is read as all three records the design names: no decision of the core's, and neither
   Claude Code's workspace trust nor Codex's trusted projects.
2. **"A trusted fixture repo"** is trusted by the core's decision alone, the issue's own words ("the core's trust
   decision"). That the refusal goes through the same trust read a claim's spec checks use, which also takes the agents'
   trust, is in the Scope and in no criterion, so no test here trusts through an agent's file (see Not covered).
3. **"Naming the project"** (Scope) is read as holding the project folder's name, which its path, its name and a
   project ID made from its name all hold.
4. **"Edited after the claim"** is an uncommitted edit of `state.txt` in the session's worktree, made once the
   claim's `claim.made` is in the record and before the first `deep_run` for it, so no run of that claim began before
   the edit and the test doesn't depend on timing. The spec and the check's script are not edited, so the tests don't
   depend on which revision of `done.yaml` is read (#1864's).
5. **"Doesn't change deep_run's outcome"** is read against what the claim's commit gives, with both directions seen:
   `holds-committed` passes only where `state.txt` holds `committed`, and `holds-edited` only where it holds `edited`.
   At the claim's commit the outcomes are passed and failed; in the edited worktree they are failed and passed. So the
   pair says which tree the runs read, a hub that answers one outcome whatever it ran fails, and a run that failed for
   another reason (no Node to run, say) is told from one that read the edit: the message says which of the three it is,
   and names the file.
6. **"The same trusted repo"** (criterion 3) is the same fixture, trusted the same way, in a world of its own, so each
   test stands alone.
7. **"Its evidence handles, as #26 has it"**: `ev:<sha256>` handles (design: Reading by reference; #26's evaluation
   fixture shows `deep_run` returning `run`, `outcome` and `evidence`), and "its" as the run's own, the evidence its
   `run.finished` names.

## Criteria to tests

IDs are `#2073.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>`, by the command in `tests/acceptance/48/README.md`. Each test's name starts with its criterion's ID. All
three tests are in `run.test.ts`.

| Criterion | ID | Test | Wrong program it fails on | On the base (`1c4d1f0e2`) |
|---|---|---|---|---|
| 1. In a fixture repo no trust record covers, whose done.yaml names a check that writes a marker file outside the repo, deep_run of that check is refused naming trust, no `run.started` is appended and the marker isn't written | `#2073.c18985be` | "in a fixture repo no trust record covers, deep_run of the check that writes a marker file outside the repo is refused naming trust and the project, no run.started is appended and the marker isn't written" | the merge base: a hub that starts the run | FAIL, as the criterion says: deep_run wasn't refused (it returned `passed`), a `run.started` was appended, and the marker was written, holding `ran` |
| 2. In a trusted fixture repo, a tracked file edited after the claim doesn't change deep_run's outcome for that claim: the run reads the claim's commit | `#2073.77f14713` | "in a trusted fixture repo, a tracked file edited after the claim doesn't change deep_run's outcome for that claim: the runs read state.txt as the claim's commit holds it" | the merge base: a hub that runs in the live worktree | FAIL, as the criterion says, naming `state.txt`: `holds-committed` failed and `holds-edited` passed, the outcomes of the live worktree's edit |
| 3. In the same trusted repo, deep_run of a passing check still returns passed with its evidence handles, as #26 has it | `#2073.7513ec0a` | "in the same trusted repo, deep_run of a passing check still returns passed with its evidence handles, as #26 has it" | a hub that refuses a trusted repo, loses the run's outcome or returns no handles of the run's | PASS: regression protection |

`BASE-FAILURE.txt` holds the base run, one run on November 12, 2026: 2 failed and 1 passed, each failure at its
criterion's own `expect`, none `BLOCKED` or `INCONCLUSIVE`. The type check is clean, and fails on a planted type error.
No implementation was run: the passing side of criteria 1 and 2 is unverified until one exists. A test that ends
`BLOCKED`, or fails anywhere but its criterion's assertion, goes back to this job, not to the implementer.

## Not covered

- **Trust through an agent's own record.** The Scope says the refusal goes through the same trust read a claim's spec
  checks use; that read also takes Claude Code's workspace trust and Codex's trusted projects (#322's suite proves it
  for a stop). No criterion of #2073 states it for deep_run, so no test here does.
- **The run's recorded commit.** The Scope says the commit a run records is the tree it ran on. Criterion 2 proves the
  tree; that `run.started` names the claim's commit holds on the base already and is not asserted.
- **The run's grant.** That a trusted repo's run is hermetic rather than run-as-you is the Scope's "as a claim's checks
  run"; the criteria state only what criterion 2 sees of it.

## For the implementer

- These files are not yours to edit. A dispute goes to a blind redraft of this job, with the criterion and never the
  work.
- Each test starts its own hub, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list, beside #26's and
  #823's: `alone.push('tests/acceptance/2073/');`. This job did not edit that file.
- Sibling suites call `deep_run` in fixture repos of their own. By a search of their own folders, #26's, #823's,
  #27's, #326's setup and #1942's write no trust record, and #823's `run.test.ts` rewrites a file in the worktree
  between runs and reads it with `sleep $(cat pause)`. This job did not trace helpers they import from other folders
  and changed none of them.

## Files

- `run.test.ts`: the three tests.
- `helpers.ts`: the fixture repo, the trust decision, the hub and its socket, the agent stand-in's client, `deep_claim`
  and `deep_run`. Adapted from `tests/acceptance/26/helpers.ts` and `322/helpers.ts`.
- `fixtures/agent.mjs`: #26's agent stand-in, cut to hooks and its `deep mcp`.
- `tsconfig.json`: the type check, as the siblings have it.
- `BASE-FAILURE.txt`: the run on the base commit, and the fixture's checks on the hermetic runner.
