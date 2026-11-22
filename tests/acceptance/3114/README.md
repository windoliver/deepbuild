# Acceptance tests for #3114: quoted git paths let an edited check with a non-ASCII or quoted name count as approved

Written first, blind, by a job that never saw an implementation of #3114; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #3114 as of 2026-11-22T11:03:06Z (updatedAt): its problem, Scope, the three acceptance criteria, Proof and
  Depends on.
- `docs/technical-design.md`: How runs become one of five verdicts (via `node scripts/design-section.mjs --issue 3114`);
  Dogfooding.
- At the base (`654c560c1`): `packages/hub/src/gate-runner.ts` (`changesOf`, `ownChanged`, `verdictOf`, `stop`,
  `GateOptions`), `packages/gate/src/own.ts` (`ownChanges`, `ownRead`), `packages/gate/src/claim.ts` (`claimVerdict`),
  `packages/verdicts/src/engine.ts` (the rows for a claim covered only by the agent's own checks),
  `packages/hub/test/gate-runner.test.ts` (`repo`, `checkoutsOf`, `runner`), `packages/hub/test/shared-runs.test.ts`
  (a run record that reaches PASS), `scripts/proof-change.mjs` (`criterionId`), and the blind suites
  `tests/acceptance/997`, `2647` (`gate.ts`) and `33` for format.

What the base does (measured, BASE-FAILURE.txt): `changesOf` reads `git diff --name-only --no-renames <base>`,
`git ls-files --others --exclude-standard` and `git ls-files` split on newlines, under git's default `core.quotePath`.
`test/é.test.js` comes back as `"test/\303\251.test.js"`, `test/a"b.test.js` as `"test/a\"b.test.js"`, and a tab
name as `"test/a\tb.test.js"`. None of them matches the run's `read` list, so `ownChanges` finds nothing, the approved
check stays approved, and the claim reads `PASS` (`unit-tests: PASS on 1 clean run`). The same claim on the plain name
`test/e.test.js` does not read PASS, and a reason line says `unit-tests` counts as the agent's own, naming
`test/e.test.js` (the control passes; by `verdictOf` the line reads `unit-tests counts as the agent's own: the claim
changed test/e.test.js, which it loads`).

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # vitest.config.ts loads @deepbuild/config-eval's dist; evidence needs dist/patterns.json
npx vitest run tests/acceptance/3114
npx tsc -p tests/acceptance/3114/tsconfig.json
```

Node 24.22.0. Each test takes well under a second. Nothing needs the network, a model or a sign-in. Folders are under
the system temp dir (`dh3114-*`) and removed after each test. The only processes started are git, each run to its end.

## The bench (`bench.ts`)

The hub's own `GateRunner`, from `packages/hub/src/gate-runner.ts`. The hub package's index doesn't export it, so the
suite imports the module the way the 2647 and 2118 suites do. Each test makes a real git repo. Its merge base is a real
commit and is the claim's `base`. The session runs on a branch of it, and the claim's files are written into the
worktree, with new files left untracked. The gate works out what the claim changed from that worktree itself.

Stand-ins, at the calls the gate makes of the hub:
- **checkouts:** the snapshot is the worktree's tree written into an index of its own, and the checkout is the
  worktree.
- **the run service:** `start` hands out a run ID. `ended` records and keys one passed run, whose output is digested and
  whose `read` list the test sets.

The claim has one check, `unit-tests`: approved, from the task's definition, covering R1 at unit depth. It has no
requirements, so the check counted as the agent's own reads INCONCLUSIVE and the check counted as approved reads PASS.
Each test first requires that the run started and read what the test set, else it throws `BLOCKED`.

## Criteria to tests

Each test's name starts with its criterion's ID (`#3114.<first 8 hex of the SHA-256 of the criterion's text>`, as
`scripts/proof-change.mjs` computes it). All tests are in `quoted-paths.test.ts`.

| ID | Tests | On the base |
|---|---|---|
| AC1 `#3114.1c2cb3dd` | tracked `test/é.test.js` edited, the run read it: not PASS, and a reason line says `unit-tests` counts as the agent's own, holding `test/é.test.js`; (control) the same on `test/e.test.js` | the first fails (verdict PASS); the control passes |
| AC2 `#3114.e80ac3c7` | new untracked `test/a"b.test.js`; new untracked `test/a<tab>b.test.js`; each read by the run, same assertions as AC1 | both fail (verdict PASS) |
| AC3 `#3114.86767b02` | the base holds `test/é.test.js` and `test/a"b.test.js`, the claim edits only `src/a.js`, the run reads `src/a.js` and `test/é.test.js`: no line says the check counts as the agent's own, and the claim reads PASS | passes |

The control isn't a criterion. It shows the bench reaches the own-files rule, so AC1's and AC2's failure on the base
comes from git's quoting and nothing else. It must keep passing after the fix.

## Open points

- The issue's AC2 names `test/a"b.test.js`, and its text says "a tab or a `"`". The suite tests both.
- A reason line is matched by content (it holds `unit-tests`, "counts as the agent's own" and the plain path), not by
  its full wording.
