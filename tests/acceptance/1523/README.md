# Acceptance tests for #1523: push, PR and merge rules read every spelling

jj, sl, stacked-change tools, glab and a GraphQL merge meet the push, PR and merge defaults; the read-only forms of the
same tools, and a GET of the merge endpoint, stay free.

Written first, blind, by a job that never saw an implementation of #1523. Sources:

- **The issue**: its text as of 2026-11-07T10:52:53Z (`updatedAt`): Scope, the 8 checkbox criteria, Proof and Depends
  on. AC numbers below follow the body's order.
- **The design**, `docs/technical-design.md`: [Before each command] (the guard engine, `guard@1`, one matcher,
  planted calls and twins at install, hub up and hub down, `fail_closed`) and [Threats, and what stops each one].
- **Base commit** `2bba2a50` (origin/main). Code read: `crates/deep-hook/src/matcher.rs` (`has_effect`, `programs`,
  `merge_endpoint`, `merge_read`, `may_be`), `crates/deep-hook/src/shell.rs`, `crates/deep-hook/src/main.rs` (`check`,
  `matching`, the request line and `spool`), `crates/deep-hook/default-rules.json`, `packages/hub/src/` (`guards.ts`,
  `holds.ts` with `pushTargets`, `named.ts` with `namedIn` and `pushBranches`, `plant.ts`, `server.ts` `gated` and
  `namedDefaults`, `core.ts` `askCard`), `packages/asks/src/index.ts` (`Card`, `PlanStep.targets`).
- **Conventions**: tests/acceptance/84/guard (all of `helpers.ts` but the MCP server, and `fixtures/agent.mjs`),
  tests/acceptance/321 (the planted sorter), tests/acceptance/1202 (reading the spool) and 1098 (a card's targets).
  This suite keeps its own copies.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

### The second model (blind redraft, 2026-11-07)

Main's #1537 landed after the base commit: every claim whose session has a pull request gets a `review` check run by a
second model. The base's world had none, so the delivered thread's PR stop (`helpers.ts`, `delivered`) came back
"open as Part of its issue, with review still unmet", and AC5 (`head.test.ts`) and AC6 (`auto.test.ts`) failed on any
tree holding main (the implementer's evidence: `docs/evidence/1523/main-sendback.txt`, the same failure on pure main).
The redraft, by a job that read only the issue, the design, this README, `helpers.ts` and tests/acceptance/1537's
fake-reviewer setup, gives the world a second model as #1537's suite does: `fixtures/fake-reviewer.pl` (copied from
tests/acceptance/1537, with `fixtures/rubric.md`) is installed as `claude` in `<tmp>/bin`, first on the runner's login
PATH (`runner.login_path` in `~/.deepbuild/config.json`), beside a made-up Claude Code sign-in
(`~/.claude/.credentials.json`) and the wiki's review rubric (`~/.deepbuild/wiki/review-rubric.md`). It answers every
review clean (no findings), so the review check is met by a second model's answer, never by the test's word, and the
PR-opening stop is not sent back. The runner starts no job before the account's first window reading, so `delivered`
first reports the five-hour window with room (`windows.report`, 5% used, as #1537's suite does); without it the
review stays BLOCKED, "no second model is free". The criteria, their IDs and the tests' text are unchanged. The fake makes no network
call; "no model, no `claude` binary" below still holds for the real ones.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the hub tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
# fast: no hub, deep-hook only
npx vitest run --root tests/acceptance/1523 calls.test.ts hubdown.test.ts --no-file-parallelism --testTimeout=600000
# the threads, through the real hub: one hub per test
npx vitest run --root tests/acceptance/1523 --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/1523/tsconfig.json
```

- `calls.test.ts` and `hubdown.test.ts` start no hub and run on a loaded machine. Every other file starts a hub of its
  own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The implementer adds it.
- Every test makes its folders under `/tmp/dh1523-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `gh`, `jj`, `gt`, `sl`, `glab` or `git town`, no `claude` binary. A call is a PreToolUse
  payload; an allowed one "runs" as the test writing its PostToolUse. The only real effects are the agent's edits and
  commits in the temp repo. A child never inherits this process's billing keys, forge tokens or `DEEP_*`, `GIT_*`,
  `XDG_*`, `CLAUDE*` or `CODEX*` settings.

## The surface under test

- **`deep-hook check`** (#304's check mode): `{"entry": guard@1, "call": {tool_name, tool_input, cwd}}` on stdin,
  `{"matched": bool}` on stdout. The entry is built in the test with only its `match` set to the class under test
  (`effect:push`, `effect:pr`, `effect:merge`, `effect:send`, `unread:push`), so the matcher alone decides.
- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the
  hook's JSON on stdin, as a child of the session's own process (`fixtures/agent.mjs`).
- **`deep hub run`**, a real process, with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK`,
  `DEEP_HUB_TEST_STOP_HOLD_MS`, `DEEP_HUB_TEST_SORTER` (#321's planted sorter) and, for the wrong program,
  `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read` and `ask.card`.
- **Files** under `HOME`: `~/.deepbuild/rules.json`, seeded verbatim from `crates/deep-hook/default-rules.json`;
  `~/.deepbuild/config.json` (your ask settings); `~/.deepbuild/spool/*.jsonl`, read only; `~/.claude.json`.
- **`crates/deep-hook/default-rules.json`** itself, read for its entries and proofs (The install check).

### The world

As #84's guard suite: a git repository with one commit on `main`, checked out on the branch **`b`** (AC6's branch, so
`--auto` is armed on `b`), a `.deepbuild/done.yaml` spec with one unit check, a drafted check, and one work item,
`item-61`. The merge criteria start from #84's delivered thread: you type `Fix <link>, then create PR.`, the agent
fixes, commits, pushes and opens PR 12, its stop's claim is PASS on `head`, and you type `merge PR 12`.

### The calls

The issue's exact calls. Where it elides one, the test writes a whole call an agent would make:

| Issue | Test |
|---|---|
| `gh api graphql -f query='mutation { mergePullRequest … }'` | `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "PR_kwDOAcme12"}) { pullRequest { number merged } } }'` |
| `gh api graphql` with `expectedHeadOid` set to the PASS's commit | the same with `, expectedHeadOid: "<head>"` after the pull request's ID |
| `gh pr merge --auto` armed on branch `b` | `gh pr merge 12 --auto --match-head-commit <head>`, in the thread on `b` that opened PR 12 |

Each Scope line's effect classes are the ones the test asks of a form: `gt submit` push and PR, `git town propose` push
and PR, `git town ship` push and merge, `git town sync` push, `jj git push` and `sl push` push, `sl pr submit` and
`glab mr create` PR, `glab mr merge`, `gt merge` and a GraphQL `mergePullRequest` or `enablePullRequestAutoMerge`
merge, `gh issue create` send.

### The prompts

| Prompt, typed | Names | Used by |
|---|---|---|
| `Fix the login bug in src/auth.js.` | none of push, PR, merge | AC1, AC3, AC4, AC6 (the `fork` card), AC7, AC8 |
| `create PR` | the PR, and so the push | AC2 |
| `push` | the push alone | AC2 |
| `Fix https://work.test/acme/shop/issues/61, then create PR.`, then `merge PR 12` | the PR, the push, the merge | AC5, AC6 |

### A proceed (AC7)

#321's planted sorter: `DEEP_HUB_TEST_SORTER=<file>`, `{"rule": "planted-proceed-<hex>", "proceed": ["want me to file
the issue?"]}`. The agent's stop on that question is answered proceed, recorded with the rule, and the stop's reply is a
block that says proceed. The calls after it, before the next stop or prompt, are the turn it started.

### Hub down (AC8)

"With the hub stopped" is read as deep-hook finding no hub in `HOME`: no hub ever starts in that test's `HOME`, which
deep-hook can't tell from one stopped (the socket is gone or refuses), and it keeps the test runnable on a loaded
machine. "Spooled, as `git push` does today" is the spool's PreToolUse request for the call (its `payload.tool_use_id`)
carrying, in `matched`, an entry of each effect class the form's Scope lines give it, as `git push origin HEAD`'s
carries `effect:push` today. The control `git push origin HEAD` runs first and passes on the base.

## Surfaces the implementer must provide

The issue and the design leave these open. Each is the smallest choice they support. Tests assert behavior, never
wording beyond what's below.

- **Held** (AC1, AC2, AC6): the call is denied; the denial names (as a whole word, `rulesIn`) a shipped `block` entry
  whose `match` is `effect:<one of the call's classes>`; an `ask.created` since the denial, `kind: authority`, has a
  `question` holding the call's words. So a new form is held through the existing `push-needs-ask`, `pr-needs-ask` or
  `merge-needs-ask`, or a new block entry of the same class.
- **The card** is `ask.card`'s answer for that ask. **"The effect named on its card"**: the card's own words (its
  `question`, its plan's steps' `does`, its options' labels, each with the call's words taken out, since `sl push` holds
  "push") match one of the call's classes: push `/\bpush/i`, PR `/\bpull requests?\b|\bPRs?\b/`, merge `/\bmerg/i`, send
  `/\bsend/i`. The base's wording ("It pushes", "opens a pull request", "merges", "sends") already does.
- **"The card names `fork`"** (AC6): a target `{ref: "fork"}` in the card's `targets` or a plan step's `targets`
  (#1098's shape). Naming it only in the question doesn't count, since the call's words hold it.
- **Denied by a rule** (AC4, AC5, AC6, AC8): the denial names the entry, `no-unreadable-push` or `merge-names-head`,
  as `rulesIn` reads it. **"Naming what couldn't be read"**: the denial holds `$(printf jj)`, as the base's detail holds
  `$(printf git)` for its own form. **`gt merge`'s denial "naming `gh pr merge --match-head-commit`"**: it matches
  `/gh pr merge\b[^\n]*--match-head-commit/`, so `gh pr merge 12 --match-head-commit <sha>` counts too.
- **The install check** (Scope: each new form lands with a planted call and a twin): for each form in
  `calls.test.ts`'s `FORMS`, some entry of `default-rules.json` whose `match` is one of the form's classes has, in
  `proofs.<name>`, a planted Bash call whose command holds the form's words, and a twin; check mode matches that entry
  on the planted call and not on the twin. `proofs.<name>` may stay one `{planted, twin}` (#304's shape) or become a
  list of them, so one entry can carry a pair per form; the hub's install check must read whichever shape ships.
- **The wrong program** `holds-every-program` (AC3): code the implementer writes, selected by `DEEP_HUB_PLANT`, that
  holds every call to `jj`, `gt`, `sl`, `glab`, `git town` and `gh api` (a matcher that reads the program, not what it
  does). It may sit in the hub (`packages/hub/src/plant.ts`, `Plant`) or in deep-hook, which reads `DEEP_HUB_PLANT`
  already: the sessions get the same variable as the hub. A plant the hub doesn't list stops it from starting, so the
  test fails BLOCKED, never passes.

## Load

The machine is shared. Readings spoiled by load, not by the program, are skipped as **INCONCLUSIVE**, never passed: a
hook deep-hook couldn't hand the hub, or spool, within its budget; a call let through before the hub decided it; a gate
that ran out of time; on a loaded machine, no PASS or locked definition in time.

## Wrong programs

| Program | Criterion | How the test fails on it |
|---|---|---|
| a matcher that reads only `git push`, `gh pr merge` and the REST endpoint | AC1 (and the check-mode list, AC8) | the merge base is that matcher: `BASE-FAILURE.txt`, naming each call |
| a GET of the merge endpoint held as a merge | AC3 | the merge base does that: `BASE-FAILURE.txt`, naming `gh api repos/acme/shop/pulls/3/merge` |
| `holds-every-program`: every call to these programs held | AC3 | `free.test.ts`'s second test: a call of `FREE` "must go through" |

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#1523.<first 8 hex of SHA-256 of the text>`
(trimmed, whitespace collapsed, as `scripts/proof-change.mjs` computes it).

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#1523.b593135b` | the six calls held in a thread naming none, effect on the card | `calls.test.ts` (2, check mode: AC1's calls and every Scope form meet their classes), `held.test.ts` (1, hub) |
| AC2 `#1523.6933063f` | "create PR": `gt submit --stack` runs; "push": held as a PR | `create-pr.test.ts` (1) |
| AC3 `#1523.2436253f` | `jj log`, `jj git fetch`, `gt log`, two `gh api` GETs go through | `calls.test.ts` (1), `free.test.ts` (2: the flow; `holds-every-program`) |
| AC4 `#1523.fca551f5` | `"$(printf jj)" git push` denied by `no-unreadable-push`, naming it | `calls.test.ts` (1), `unreadable.test.ts` (1, hub up); AC8 hub down |
| AC5 `#1523.d4c1de27` | GraphQL with the PASS's `expectedHeadOid` runs; with none, and `gt merge`, denied by `merge-names-head` | `head.test.ts` (1) |
| AC6 `#1523.ea4ec67a` | `--auto` armed on `b` holds `jj git push --bookmark b`; the card of `--remote fork` names `fork` | `auto.test.ts` (1) |
| AC7 `#1523.bc21ee43` | in a proceed's turn `gh issue create -t x` held as a send | `proceed.test.ts` (1) |
| AC8 `#1523.da8f9b01` | hub stopped: the calls go through and are spooled; `"$(printf jj)" git push` denied | `hubdown.test.ts` (1) |
| Scope, install check | each new form has a planted call and a twin | `calls.test.ts` (1) |

## Not asserted

- The drafted budget, "the matcher's p95 stays under its current hook budget": a timing on this shared machine isn't
  evidence, and the issue marks it drafted. The perf lane owns it.
- `curl` and `wget` to a merge endpoint (#345's line), a script file that runs one of these (the recording rule), and
  `gh pr create --repo other/project` (already held by `pr-needs-ask`): the issue puts them out of this task.
- `glab mr merge --sha <head>` going through in a thread that names a merge: the Scope names `--sha` as where its head
  comes from, but no criterion runs it; check mode only shows the form is a merge.
- Aliases and short forms the issue doesn't name (`gt ss`, `jj git push -b`).

## Files

- `helpers.ts`: the world, the hub, the record and the card, sessions through deep-hook, check mode, the spool, the
  rule readers and the judgements (`expectHeld`, `expectDenied`, `expectAllowed`, `expectAuthorityAsk`,
  `expectProceed`, `delivered`, `each`).
- `calls.test.ts` (AC1, AC3, AC4, install check; check mode), `held.test.ts` (AC1), `create-pr.test.ts` (AC2),
  `free.test.ts` (AC3), `unreadable.test.ts` (AC4), `head.test.ts` (AC5), `auto.test.ts` (AC6), `proceed.test.ts`
  (AC7), `hubdown.test.ts` (AC8).
- `fixtures/agent.mjs`: one session's Claude Code, as far as its hooks go. From #84's guard suite (#321's).
- `fixtures/fake-reviewer.pl`, `fixtures/rubric.md`: the second model and its rubric (The second model). From
  tests/acceptance/1537.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion, and what wasn't run.

[Before each command]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
