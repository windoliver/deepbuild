# Acceptance tests for #1886: the review reads the route a session started on

Issue #1886, "The review reads the route a session started on, so a proxied route counts no model". Written first,
blind, by a job that never saw an implementation. Sources:

- **The issue**: its Scope (a session's route is read once at its start, from the environment its start reports,
  through its adapter's `routeAtStart`; the review's change session carries that route), its three acceptance
  criteria, Proof ("the proxied start through a real hub's review, failing on the merge base") and Depends on (#87).
- **The design**, `docs/technical-design.md`: How runs become one of five verdicts (an uncounted run never counts);
  Plan usage, per account and per task, its Billing mode bullet ("deep-hook reports at SessionStart whether each
  billing key is set … as true or false and never a value"; "The adapter also records at session start whether the
  session runs on the agent's own route").
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/checks-review/src/models.ts`
  (`independence`, the reason "model unknown: proxied route", the planted `trusts-proxied-transcript`),
  `packages/hub/src/kinds.ts` (the review's change session, built with `route: {}`), `packages/hub/src/hookmap.ts`
  (SessionStart's `billing` booleans), `packages/adapters/src/shipped.ts` (`routeAtStart`, which nothing calls),
  `crates/deep-hook/src/main.rs` (`BILLING_KEYS`, which don't include `ANTHROPIC_BASE_URL`), and the suites of #87
  (`tests/acceptance/87/models`), #322, #1537 and #1862.
- **The base commit**: `2eaaeb0e` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (#1537's fake reviewer) and the Rust toolchain, from the worktree
root:

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/1886 --testTimeout=600000 --no-file-parallelism
npx vitest run --root tests/acceptance/87/models --testTimeout=600000     # AC2 and AC3
node node_modules/typescript/bin/tsc -p tests/acceptance/1886/tsconfig.json
```

Each test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
beside #1537's and #1862's; the implementer adds it. No network, no real model, no paid call, no `gh` login. The
tests reuse #1537's review world and helpers (`tests/acceptance/1537/helpers.ts`, itself on #322's world: the temp
world under `/tmp/dh322-*` with `HOME` set to it, the hub as a process, Claude Code sessions through the real
deep-hook, `events.read`, processes stopped by PID only, and #1537's fake reviewer as the second model), which those
suites keep and nobody edits.

## The surface under test

Nothing new: the outermost surfaces the issue names.

- **The real hub**, `deep hub run`, with #322's test settings.
- **A Claude Code session through the real deep-hook**: #322's session, whose own Claude Code process fires every
  hook as `deep-hook claude-code <event>`, so deep-hook reads the environment that process was started in, as a real
  session's hooks do. The proxied session's process is started with `ANTHROPIC_BASE_URL` at a loopback HTTP listener
  (`http://127.0.0.1:<port>/dh1886-bridge`); the other with the variable unset.
- **The socket**: `events.read` (`claim.made`, `run.started`/`run.finished` of the review check, `verdict.made`),
  `windows.report`.
- **The hub's root** (`~/.deepbuild` of the test's home), read as files: what the record holds.

What the tests read back: the review run's `run.finished`, whose `outcome` is the run's and whose `findings` hold
`uncounted: <reason>` for an uncounted run (the base's `runs.ts`), and the claim's verdicts.

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#1886.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed and white space collapsed (`scripts/proof-change.mjs`).

| ID | Criterion (short) | Test | What it does |
|---|---|---|---|
| AC1 `#1886.33628f8b` | on a real hub, a session started with a base URL override has its review read "model unknown: proxied route"; on the merge base the transcript's model is trusted | `route.test.ts`, first test | #1537's clean PR claim from a session started with `ANTHROPIC_BASE_URL` at a loopback listener: every review run of the claim finishes `uncounted` naming "model unknown: proxied route"; the claim is never PASS; no event and no file of the hub's root holds the URL, its `127.0.0.1:<port>` or its path; the listener gets no request |
| AC1 (its twin) | the same, on the agent's own route | `route.test.ts`, second test | the same story with the variable unset: the review run is `passed` and names no "model unknown"; the claim is PASS. Passes on the base, and must still pass with the fix |
| AC2 `#1886.209d6f6c` | a session on the agent's own route reads as it does today: #87's model suites pass unchanged | `tests/acceptance/87/models` (all of it), unchanged | no copy here; the twin above holds the same on a real hub |
| AC3 `#1886.ece183af` | the planted `trusts-proxied-transcript` still fails where it does | `tests/acceptance/87/models/proxied-route.test.ts`, its wrong-program test, unchanged | the check with the plant counts the proxied review and the test fails, as at the base |

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC1 | the merge base: the hub builds the review's change session with `route: {}`, and deep-hook doesn't report `ANTHROPIC_BASE_URL` | `BASE-FAILURE.txt`: the first test fails, the review counted on the transcript's model |
| AC1 | a hub that reads the route from its own environment, not the session's start | the hub and its runner jobs start with `ANTHROPIC_BASE_URL` unset (below), so the first test fails on it |
| AC1 | a fix that reads the base URL as proxied whether set or not | the twin fails on it |
| AC1 | a record that keeps the URL's value | the first test's record assertions |
| AC3 | `trusts-proxied-transcript` | #87's suite, as it is |

## Readings where the issue leaves a choice

- **How the hub gets the route's booleans.** The issue says the route is read "from the environment its start
  reports", through the adapter's `routeAtStart`; the design says deep-hook reports billing keys at SessionStart as
  booleans. Whether deep-hook carries `ANTHROPIC_BASE_URL` beside the billing keys, under a field of its own, or some
  other way the start reports it, is the implementer's. The tests drive the real deep-hook with the variable in its
  environment, so they don't name a field; a fix that only changes the hub's side, with no way for the start to
  report the variable, fails them.
- **"A base URL override"** is `ANTHROPIC_BASE_URL` for Claude Code, the variable #87's route names first. Bedrock,
  Vertex and Codex's model provider are #87's suite's, at the check's level; this suite drives only Claude Code
  through the hub.
- **"Has its review read …"** is the review run's record on the hub: `run.finished` with outcome `uncounted` and a
  finding naming the reason, as the base's `kinds.ts` already records an uncounted review (`the review is uncounted:
  <reason>`, its mask). The exact words around the reason are the implementer's; the reason's own words are #87's.
  The claim with no other review is not PASS (INCONCLUSIVE at the base's rule for uncounted runs); which of the four
  is the implementer's.
- **"On the merge base the transcript's model is trusted"** is read as the failure the first test must show on the
  base: the session's transcript names `claude-haiku-5-5`, the fake reviewer answers as `claude-sonnet-5-5` (#1537's
  pair, which the facts know), so the base counts the review ("same-family review") and the claim passes.
- **The environment the tests run in.** #322's sessions and hubs inherit this process's environment less its DEEP_,
  CLAUDE*, GIT_ and billing keys. `ANTHROPIC_BASE_URL` isn't among those, and the agent that runs these tests may
  have it set itself, so `helpers.ts` drops it at load and gives it only to the proxied session's Claude Code process
  (which copies it when #1537's `openTask` makes the session, before its first await), putting it back after the file.
- **"The record never holds it"** is read over everything the hub keeps: every event `events.read` returns, and every
  file under the hub's root (its record, store, logs and transcript copies), searched for the URL, `127.0.0.1:<port>`
  and the URL's path segment. Nothing asserts on the value appearing anywhere.
- **AC2 and AC3** are #87's suites as they are: the issue says they pass, and fail, "unchanged" and "where it does",
  so this folder holds no copy. The twin is the same criterion on a real hub.

## What this suite could not encode

- **Codex**, whose route (`OPENAI_BASE_URL`, a model provider other than its default) comes from its config as well as
  its environment, through a real hub: the issue's proof names the proxied start, which is Claude Code's here.
- **A session resumed or compacted** after its start: the route is read "once at its start"; a later SessionStart of
  the same session is not driven.

## Files

- `helpers.ts`: the criterion IDs, the session's start environment, the loopback listener, the story through #1537's
  review world, and the readers of the review runs, verdicts and the hub's root.
- `route.test.ts`: AC1 and its twin.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
