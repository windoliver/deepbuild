# #1942 criterion AC2 blind redraft, after #2073: the download's project is one you trust

#1942's AC2 says "A model download survives the agent's session ending, and the claim waits for it". Its test,
`tests/acceptance/1942/survives.test.ts`, has an agent's session call `deep_run` of a check whose `done.yaml` entry names
`host:`, in a fixture folder no trust record covers. #2073's Scope says "deep_run in a project the core's trust decision
doesn't mark trusted is refused before anything starts, naming the project and that its spec checks run only once you
trust it" and "The refusal goes through the same trust read the claim's spec checks use". So a correct program refuses
that `deep_run`, and nothing starts on the host. The criterion still holds in a project you trust. The redraft keeps the
scenario and every assertion, and trusts the folder before its session starts. Nothing else changes.

**The base run was not done.** The test needs this Mac's Lima VM `deep-fedora`, which is stopped, and this job must not
start, stop or change a VM. Only the type check was run (`BASE-RESULTS.txt`).

Written from issue #1942 (closed, updatedAt 2026-11-10T11:09:12Z), issue #2073 (open, updatedAt 2026-11-12T19:27:09Z) and
issue #322 (project trust), each as handed to this job; the frozen `tests/acceptance/1942/` (README.md, helpers.ts,
fixtures/agent.mjs, survives.test.ts, once.test.ts, unnamed.test.ts, stall.test.ts, budgets.test.ts, BASE-FAILURE.txt,
tsconfig.json); #2073's own blind suite `tests/acceptance/2073/` (README.md, helpers.ts, run.test.ts; tests, not an
implementation); `tests/acceptance/322/` (`helpers.ts`'s `makeWorld`, `trust.test.ts`) for how Claude Code's workspace
trust is written; AGENTS.md (Proof); `docs/technical-design.md` (Threats: Untrusted repos, Agents gaming checks; How runs
become one of five verdicts: Traced programs, Pinned to a commit; the checks-command, done-gate and spec-draft rows; Blocks
for work on your other machines: Hosts, Remote runs; Dogfooding); `tests/acceptance/306-redraft-1958/REDRAFT.md` and
`tests/acceptance/724-redraft-1405/REDRAFT.md` for form; `scripts/lanes.mjs` for where #1942's files are listed; and base
`1c4d1f0e2`, read only for how the surfaces are driven: `packages/hub/src/mcp-operations.ts` (`runCheck`, `checksOf`,
`claim`), `stop-judging.ts` (`projectTrusted`, `specChecks`, `runClaim`, `judging`), `products.ts` (`start`),
`wiki-build.ts` (`choose`), `core.ts` (`planOf`, where trust is wired) and `packages/record/src/trust.ts` (`openTrust`).
I never read an implementation of #2073, a diff, a branch, a pull request, another checkout, or another job's
`*-redraft-2073` folder.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1942/survives.test.ts` › a download an agent starts on a host runs on as a user service named by its token after the session ends; its claim gets no verdict, nor the run an end, until the download ends there | #1942.dd9b1b61 (AC2) | The session works in `<tmp>/repo`, and no trust record covers it: the world's home holds no decision of the core's, no `~/.claude.json` and no `~/.codex/config.toml`. Under #2073 `deep_run` of `model-download` there is refused before anything starts, so the original fails at "deep_run of model-download answers its run", with no run on the host | `1942-redraft-2073/survives.test.ts` › the same name with "(redraft 2073)": the same folder, trusted by Claude Code's workspace trust in the world's home before the session starts |

| Part of the test | In #1942's test | In the redraft |
|---|---|---|
| The project's trust | none | Added: `<home>/.claude.json` holds `projects[<tmp>/repo].hasTrustDialogAccepted: true`, written after the world opens and before the session's SessionStart |
| The folder and its spec | `<tmp>/repo`, a plain folder; `.deepbuild/done.yaml` names `model-download` with `run:` and `host: dh-fedora` | Kept |
| The claim | `deep_claim` for `session:<id>#model`, attempt 1, at `COMMIT` (40 hex no repo holds), scope session | Kept |
| The download | `download.sh` on `dh-fedora`: 40 MiB from `source.bin`, 1 MiB a second, a line after each | Kept |
| Every assertion | the run recorded on `dh-fedora`; one start, with its token; a user unit whose name holds the token; the session's end in the record; 15 s on, the unit active, `model.part` grown, no `run.finished`, no `verdict.made`; `model.bin` is `source.bin`; the run `passed` with the whole output as stdout evidence; no verdict before the run's end | Kept, word for word |
| The proof files | `ac2-midway.json` and `ac2-end.json` under `$TMPDIR/deep-1942-proof/` | Kept (the same names: a run of either file rewrites them) |

The helpers and the agent stand-in are imported from `../1942/` unchanged. The one piece written here is
`trustInClaudeCode`, three lines and their comment in the test file, and the one call to it.

## Kept as they are

No other test file of `tests/acceptance/1942/` calls `deep_run`, has a session, or has a fixture repo, so none is
redrafted:

- `once.test.ts` (AC5): `judgeOnce` starts its run as you, with `run.start` on the hub's socket in the cli role.
- `stall.test.ts` (AC4): `judgeStall` starts runs A and B through `startRemote`, which is `run.start` in the cli role.
- `budgets.test.ts` (AC3): reads `benchmarks/budgets.json`, calls `host.facts`, and starts its lag run through
  `startRemote`.
- `unnamed.test.ts` (AC1): `host.list`, `host.facts` and `run.start` in the cli role, each for a name.
- `helpers.ts` and `fixtures/agent.mjs`: neither calls `deep_run` or writes a `done.yaml`. `Session.tool` is the only
  way to a `deep_*` tool, and `survives.test.ts` is its only caller.

#2073's Scope names `deep_run` alone. A run you start with `run.start` names its own command and no project's spec.

## Readings

- **A host check and the Scope's third line.** "In a trusted project, deep_run runs the check on the claim's commit in a
  temporary checkout" is not read as bearing on a check that names `host:`. Such a check runs at your remote home, not
  in a checkout (the base's `runCheck`: "a host check runs at your remote home (#1942)"; #1942's README, reading 5; the
  design's Remote runs). So the folder stays a plain folder that is not a git repo, the claim keeps `COMMIT`, and the
  check's command stays the shell line the host runs. A program that makes a checkout of the claim's commit before it
  reads `host:` would refuse or block this fixture, and this redraft would fail on it. The Scope doesn't state which
  comes first; this reading is the assignment's.
- **Trusted how.** By Claude Code's workspace trust, not by the core's own decision as #2073's suite writes it. Three
  reasons. The Scope's second line sends the refusal through the trust read a claim's spec checks use, and that read
  takes Claude Code's workspace trust (the spec-draft row: "a repo trusted in either needs no second answer"; #322's
  second trust test; the base's `projectTrusted`, which reads `~/.claude.json` under the hub's HOME each time it is
  asked). The session is a Claude Code session, and its workspace trust is the record the design reuses for one. And
  the core's decision is appended to `<home>/.deepbuild/ledger.db` before the hub starts (#322's and #2073's suites),
  while the frozen `openWorld` makes the home and starts the hub in one call; writing it would mean copying `openWorld`
  and the five unexported pieces it uses. The cost: the redraft passes only on a program whose `deep_run` takes Claude
  Code's workspace trust. One that reads the core's decision alone refuses here. No criterion of #2073 states that half
  (its suite's "Not covered"); the Scope's second line does.
- **What the trust file holds.** One `projects` entry, keyed by the folder's real path, with `allowedTools: []` and
  `hasTrustDialogAccepted: true`, as #322's suite writes it. No account is named, so the world has no account, as
  before. The world's home holds no `~/.claude.json` until the test writes it (`openWorld` writes `~/.ssh` only).
- **The spec's check is also a claim's spec check.** The fixture's `done.yaml` has no `claims:` block, so
  `model-download` is one of the repo's spec checks (`specChecks`: "with no claims block, every check"), and in a
  trusted project a gate run on the claim would take it. The scenario has no stop: its hooks are SessionStart and
  SessionEnd, and the base judges a claim at a stop (`judging`, `runClaim`'s callers; read, not run). So no gate run
  reads the claim, with trust or without. A hub that judged the claim while the download runs fails "the claim has no
  verdict", which is the criterion.
- **A refusal in an untrusted project** is #2073's criterion 1, proven in `tests/acceptance/2073/` on a local check.
  #1942 has no criterion about it, so no test here asserts that an untrusted host check is refused.

## Wrong programs they still fail

AC2 names no planted program; its wrong programs are #1942's README's (reading 9). Each still fails, at the same
assertion:

- A hub that ignores `host:` and runs the check on this Mac: `mustBeOnHost` fails, naming where the run started.
- A hub that starts the download under its SSH session, not as a user service: the cgroup assertion fails, or the unit
  is gone 15 s after the session ended.
- A hub that ends the run when the session or its connection ends: the unit isn't active, `model.part` hasn't grown, or
  a `run.finished` is in the record while the download still runs.
- A hub that judges the claim before its run ends: a `verdict.made` midway, or before the run's `run.finished`.
- A hub that keeps part of the output: the evidence doesn't hold the SHA-256 of the 41 lines.

And one #2073 adds: a hub that refuses `deep_run` in a folder Claude Code's workspace trust covers fails at "deep_run of
model-download answers its run", with the refusal's text in the message.

## On the base

Not run. The VM `deep-fedora` is stopped and this job doesn't start it. By the helper's code, a run now would end
BLOCKED in `openWorld` ("the VM deep-fedora can't be reached over SSH"), which is no result.

What a base run should show, from reading the base's code, unverified: `deep_run` asks no trust there, and the one file
the redraft adds is read by nothing that changes this run. Besides `projectTrusted`, the base reads `~/.claude.json` for
an account (none in it), MCP servers (none), the reading agent setup drafts (Claude Code either way) and the login
plan's cache key. A trusted folder's session start places build products only in a git repo that lists some
(`products.ts`), and the folder is neither. So the redraft should give what the original gives at `1c4d1f0e2` with
`deep-fedora` running. That result isn't recorded either: the frozen `BASE-FAILURE.txt` is from `d51be2c3`, before #1942
was built.

The type check passes (`BASE-RESULTS.txt`).

## Run it

macOS, Node 24.22.0 first on `PATH`, with the Lima VM `deep-fedora` running, from the checkout's root:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run tests/acceptance/1942-redraft-2073/ --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1942-redraft-2073/tsconfig.json
```

Everything in #1942's README under "Run them" holds: one file at a time, a shell that may start the supervisor's
sandbox, `/tmp/dh1942-*` folders removed after the file, `~/dh1942-<id>/` on the VM removed after the file, the VM never
stopped. Vitest's path filter matches any path that holds it, so `tests/acceptance/1942` without the closing slash also
picks up this folder; name `tests/acceptance/1942/` to run the original alone (not tried here).

`scripts/lanes.mjs` lists `tests/acceptance/1942/` in `alone`, and `budgets.test.ts` and `stall.test.ts` in `timed`.
This folder belongs in `alone` and in neither `timed` nor `slow`. That edit is the implementer's, at the swap.

## At merge

The frozen `tests/acceptance/1942/` stays as written. The owner's call is to run this folder's `survives.test.ts` in
place of `tests/acceptance/1942/survives.test.ts`, which is then kept by hand only, and to keep the suite's other four
files as they stand.
