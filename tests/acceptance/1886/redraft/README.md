# Acceptance tests for #1886: the review reads the route a session started on

Issue #1886, "The review reads the route a session started on, so a proxied route counts no model". Written first,
blind, by a job that never saw an implementation, plan, branch, worktree or pull request of it. Sources:

- **The issue**, as `gh issue view 1886 --comments` gives it (no comments): its body, Scope, the three acceptance
  criteria, Proof ("The proxied start through a real hub's review, failing on the merge base") and Depends on (#87).
- **The design**: `AGENTS.md`; `docs/technical-design.md`'s How runs become one of five verdicts and Plan usage, per
  account and per task (the Billing mode bullet: "The adapter also records at session start whether the session runs
  on the agent's own route"), Dogfooding, Tests written first and "Proven on the base"; `docs/parallel-proof.md` and
  `scripts/proof-runs.mjs` / `scripts/proof-change.mjs` for the proof lanes (criterion IDs, failing at an assertion,
  `twins.json` and `lines.json`).
- **The base commit** `914bd5f29775cf6b64a4050276afb97e04cdd659` (origin/main), read for its surfaces only:
  `packages/checks-review/src/models.ts` (`independence`, the `PROXIED` keys, the `trusts-proxied-transcript` plant),
  `packages/hub/src/kinds.ts` (the review's `ChangeSession`, built with `route: {}`), `packages/hub/src/stop-judging.ts`
  (the `review` check every PR claim gets), `packages/adapters/src/shipped.ts` (`routeAtStart`, which nothing calls),
  `crates/deep-hook/src/main.rs` (SessionStart's billing booleans, read from the hook's own environment), and the suites
  of #87 (`models`), #1537 and #322, whose helpers these tests import and nobody edits.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (the fake second model) and the Rust toolchain, from the repo root:

```sh
npm ci
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/1886 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1886/redraft/tsconfig.json
```

The two hub tests each start a hub of their own, as #1537's do, so the folder runs one test at a time (the
coordinator sets its lane). No network, no real model, no paid call, no `gh` login. `model-suites.test.ts` runs #87's
model suites in one child vitest run (about as long as that suite alone).

## The surfaces

- **The real hub**, `deep hub run`, in #1537's review world (`reviewWorld`: #322's repo, spec and drafted check, the
  fake second model installed as `claude` first on the runner's login PATH answering as `claude-sonnet-5-5`, a made-up
  sign-in, the wiki's rubric, room in the plan window, GitHub's recorded answers for PR 21).
- **A Claude Code session through the real deep-hook**, as #322 drives it: one long-lived process per session is the
  parent of each `deep-hook claude-code <event>` run and gives it its environment, as Claude Code gives its hook
  commands theirs. The session's transcript names `claude-haiku-5-5`. **The base URL override** is
  `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/dh1886-proxy`, a real loopback listener nothing connects to, set only in
  that session process's environment: the hub is started before it and never has it.
- **The record**, through the hub's socket (`events.read`): the review check's run (`run.started`/`run.finished` with
  check `review`) and the claim's `verdict.made`. `job.list` counts the review jobs.
- **#87's model suites** (`tests/acceptance/87/models`), run unchanged in a child vitest with a JSON report, their
  bytes compared with the merge base's (SHA-256 of each file at the base, in `models-at-base.json`).

No new surface is defined here. Where the hub gets the session's route from (a field deep-hook adds to SessionStart,
as it adds the billing booleans, or another reading of the start's environment) is the implementer's; the tests see
only the review's outcome.

## Criteria to tests

| ID | Criterion (short) | Test | How it is proven |
|---|---|---|---|
| `#1886.33628f8b` (AC1) | on a real hub, a session started with a base URL override has its review read "model unknown: proxied route"; on the merge base the transcript's model is trusted | `proxied-hub.test.ts` | fails on the merge base at its first `expect` (the review run's record doesn't contain "model unknown: proxied route": the review counted and the claim passed) |
| `#1886.209d6f6c` (AC2) | a session on the agent's own route reads as it does today: #87's model suites pass unchanged | `own-route-hub.test.ts`; `model-suites.test.ts` (first test) | both pass on the merge base; each fails at an `expect` on the twin `own-route-unknown` |
| `#1886.ece183af` (AC3) | the planted `trusts-proxied-transcript` still fails where it does | `model-suites.test.ts` (second test) | passes on the merge base; fails at an `expect` on the twin `plant-ignored` |

What each holds:

- **AC1.** The session started with the override opens PR 21 with green commands (the spec's unit check and R1's
  drafted check, a precondition, `BLOCKED:` otherwise) and a clean diff, and stops. Once the review check's run has
  finished and a verdict follows it: the run's record contains "model unknown: proxied route"; the claim's last verdict
  isn't PASS; and no event after the stop holds the URL, `127.0.0.1:<port>` or its path (the design's "never a value").
- **AC2, on the hub.** The same claim from a session with no override: every review run passed, none names "model
  unknown", and the claim's last verdict is PASS, as on the merge base.
- **AC2, #87's suites.** No file of `tests/acceptance/87/models` is edited, removed or added against the base's bytes,
  and every test of the child run passes.
- **AC3.** In the same child run, `proxied-route.test.ts`'s wrong-program test ("a check that trusts the proxied
  transcript's model name counts the first review, and fails", which expects the scenario to throw "the proxied
  transcript's model trusted" under the plant) passes, and so does its scenario without the plant.

## Wrong programs

`../twins.json` (at `tests/acceptance/1886/twins.json`) maps each must-not-change criterion to its planted twin in
`../twins/<name>/`; each twin is a `lines.json` edit of one line of `packages/checks-review/src/models.ts`, the line
that decides whether a route is proxied, as the change holds it (redrafted blind against that one file, given by the
coordinator, after the base's line went stale):

```ts
  const proxied = plant !== 'trusts-proxied-transcript' && PROXIED.some((k) => change.route?.[k]);
```

- `own-route-unknown` (AC2): `const proxied = plant !== 'trusts-proxied-transcript' && (PROXIED.length > 0 || …)`
  (written so the package still type-checks and builds), so every route reads proxied
  and a session on the agent's own route is "model unknown: proxied route". The hub test fails at its first `expect`
  (the review run is `uncounted`); #87's same-model, canonical and proxied-route tests fail, so the model-suites test
  fails at its `notPassed` `expect`.
- `plant-ignored` (AC3): `const proxied = PROXIED.some((k) => change.route?.[k]);`, so the plant no longer trusts the
  proxied transcript: #87's wrong-program test no longer sees the scenario throw, and the AC3 test fails at its
  status `expect`.

**Placement.** The proof lanes read `twins.json` and `twins/<name>/` at the acceptance folder's top,
`tests/acceptance/1886/` (`twinsOf` in `scripts/proof-runs.mjs` takes the first folder under `tests/acceptance/`), so
they live there, beside this `redraft/` folder. Each `find` matches the change's line exactly once; each `wrong` was
type-checked with checks-review's tsconfig in that file's context. The base runs of the twins in `BASE-RUNS.txt` used
the base's line (`change.route[k]`, no `?.`), the same wrong programs.

## Readings where the issue leaves a choice

- **"Started with a base URL override in its environment"** is `ANTHROPIC_BASE_URL` in the environment the agent gives
  its hooks at SessionStart, the agent here being Claude Code: deep-hook is that environment's only reader at a real
  start, as it is for the billing keys. Codex's provider and `OPENAI_BASE_URL` aren't driven.
- **"Has its review read 'model unknown: proxied route'"** is read on the review check's run in the record (its
  finished event, where the hub puts an uncounted run's reason), not on the stop's reply, whose wording the issue
  doesn't fix. The claim not being PASS follows from the design (an uncounted run never counts).
- **"On the merge base the transcript's model is trusted"** is the base side of AC1: the same test fails there, and
  the failure shows the review counted (BASE-RUNS.txt).
- **"Reads as it does today"** is held two ways: the own-route claim on the hub reads as on the base (review passed,
  claim PASS), and #87's model suites pass unchanged, which the criterion names.
- **"Unchanged"** is byte for byte against the base's files, by recorded hashes, so it needs no git history in
  the checkout a lane runs in.
- **"Still fails where it does"** is the place #87 puts it: the plant's proxied-route scenario throws "the proxied
  transcript's model trusted", which its wrong-program test expects. The hub has no switch for review plants, and the
  issue asks for none, so it isn't driven through the hub.

## Not encoded

- A Codex session's route (`OPENAI_BASE_URL`, `model_provider`) and Bedrock or Vertex sessions on a hub.
- "Read once at its start": that a later change in the session's environment doesn't move the route isn't driven
  (a hook's environment can't change mid-session in Claude Code).
- AC2's hub test and AC3 rely on their twins; neither fails on the merge base, which has the behaviour they keep.

## Files

- `helpers.ts`: IDs, the loopback listener, `reviewedClaim` (one PR claim on a fresh hub, with or without the
  override), the child run of #87's model suites and the byte comparison.
- `proxied-hub.test.ts` (AC1), `own-route-hub.test.ts` (AC2), `model-suites.test.ts` (AC2, AC3).
- `models-at-base.json`: SHA-256 of each file of `tests/acceptance/87/models` at the base.
- `../twins.json`, `../twins/own-route-unknown/lines.json`, `../twins/plant-ignored/lines.json`.
- `BASE-RUNS.txt`: the run at the base, and each twin's run.
