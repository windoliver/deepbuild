# #2074 — blind acceptance (frozen)

Base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.
Frozen test: `lane-failure.test.ts` (166 lines).
SHA-256: `4227c9f789037004a30ea41baf4b271ade01adf56bf24c8795d90c9c8d1b1d85`.
No fix, production/config/runner changes, or commit. Do not edit the frozen test.

## Inputs and isolation

Read only the supplied job, `../issue.json`, `AGENTS.md`, design verdict/stop/Dogfooding sections, and this base checkout's source/tests. No other worktree, implementation, PR, history diff, or earlier job's files was consulted. Scratch drafts were ours, under this suite; only the finalized file remains.

Each case creates a temporary HOME, independent hub root, local git repo and synthetic Claude transcript. No remote, credentials, personal fixture or network is needed. Personal agent PATH directories are removed; real system tools and inherited Rust toolchain paths remain. No toolchain, metadata, loader, runner, check or lint is replaced. Core shutdown cleans its own resources; the repository's unchanged Vitest setup also owns descendant cleanup.

## Imports and seams

- `packages/hub/dist/hub-runtime.js:createCore`, typed by `src/hub-runtime.ts`; actual composition used by production. The build is necessary for sibling worker files. Supplied builds are from the identical clean base. Rebuild normally before testing an implementation.
- Issue-named `core.ts` seam: `hook` receives parser-shaped input drafts; the core itself verifies the session, applies the stop rule, creates the claim and runs the real gate. `hookReply` supplies the actual stop message, not a test-side formatter. No claim, verdict, open item, run result or judging state is injected.
- Only the issue-authorized checkout service is planted, via the existing core service slot. Snapshot throws `can't read the index`; checkout mode delegates snapshot to real git before throwing the dependency-copy error. Other checkout methods delegate unchanged.
- Real `@deepbuild/gate:OverBudget`, `@deepbuild/record:ulid`, and `@deepbuild/adapters:readFacts`. The budget fixture really has 37 untracked files; its service error counts them with git.
- Monitor/TaskStop enter through `root/spool/spool.jsonl`, exercising the real parser, adapter and core. The first stop's reply finishes before TaskStop; there is no second Stop or held reply at watch end.
- `events.read` reads durable record events. `mcp.call(deep_status)` uses the real session-bound MCP handler and record projection. No reconstructed MCP result or mocked owned component.

## Requirement → test → base result

| Requirement | Test / criterion | Base result |
|---|---|---|
| Snapshot failure yields BLOCKED, original cause, owner you | AC1 `#2074.f6cc7fe2` | Expected BLOCKED; base has partial INCONCLUSIVE fallback. Cause retained; owner absent. |
| Actual judged-stop chat and deep_status show BLOCKED | Same AC1 case | Both expose INCONCLUSIVE, not BLOCKED. |
| Actionable open item names what would close it | Same AC1 case, scope | No matching open item. Closure assertion fails on empty text; it requires an action/evidence cue beyond repeating the error, not exact prose. |
| Same failure when watch ends, no held stop | AC2 `#2074.5acbc1c9` | Deferred claim is recorded; verdict INCONCLUSIVE, owner absent. |
| Checkout error, after successful snapshot | Scope case | Real snapshot succeeds; planted copy error becomes INCONCLUSIVE, owner absent. |
| Budget twin remains INCONCLUSIVE, with count | AC3 `#2074.f387c8cd` | Regression guard passes: INCONCLUSIVE and `37 untracked files`, including actual stop reply. Not red-before proof. |
| Individual check setup/start failure is missing/BLOCKED | Reused `packages/hub/test/codex-files.test.ts`, “a slow check that can't start” | Existing gate test asserts BLOCKED and that the next check runs. Inspected, not rerun; no duplicate added. It is not new end-to-end evidence. |

The old `packages/hub/test/checks-not-started.test.ts` explicitly expects INCONCLUSIVE for a checkout error. It cannot satisfy #2074's BLOCKED requirement; the new scope case tests that distinction. No assertion claims the base has *no* verdict. Fixture/cause assertions and AC3 intentionally already hold; the three behavior-change cases must fail on their named BLOCKED/owner/chat/MCP/open-item assertions, with the generated claim ID in each failure.

## Commands and evidence

Scratch setup: `node node_modules/vitest/vitest.mjs run tests/acceptance/2074/scratch.test.ts` (only our scratch draft, removed at freeze). Final scratch run: 3 intended failures, 1 regression pass, no setup/unhandled errors.

Required final base command, invoked **once**, in background:

```sh
node scripts/affected.mjs tests/acceptance/2074/lane-failure.test.ts
```

Final test block completed: **3 failed, 1 passed**, 10 named soft-assertion failures, no setup or unhandled errors. The proof reporter reached `type: end`; failures identify their generated claim IDs. Frozen hash unchanged.

Raw coordinator log: `/tmp/deep2074-affected.log`; exit status when finished: `/tmp/deep2074-affected.exit`. Coordinator PID **40864** remains running in the background; remaining lints are queued for shared grants. No `WIDE` or `INCONCLUSIVE` coordinator lines have been emitted at handoff. Completed lint output already includes unrelated base failures in repo-rules, conformance, slots and record-reader guard; no overall lint success is claimed. `BASE-FAILURE.txt` preserves the redacted final test output, machine-readable report and available lint output. No neighboring suite/full preflight was requested. No runner/lint was changed or skipped, and no process was killed to release a grant.
