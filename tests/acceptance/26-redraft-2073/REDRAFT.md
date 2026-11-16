# #26 "Done when" (contradiction) blind redraft, after #2073: the fixture repo is trusted and its checks are ones a claim's checks count

#26's "Done when" says "a prediction that disagrees with its run shows up as a contradiction" (Added Oct 9: "`deep_claim`
records what the agent expects each check to show before it runs; a run that disagrees is reported as a contradiction").
Its test, `tests/acceptance/26/contradiction.test.ts`, proves it with two `deep_run` calls in a fixture repo that no trust
record covers and whose two checks run `false`. #2073's Scope says: "deep_run in a project the core's trust decision
doesn't mark trusted is refused before anything starts, naming the project and that its spec checks run only once you
trust it", and "In a trusted project, deep_run runs the check on the claim's commit in a temporary checkout, as a claim's
checks run". A correct hub then refuses both calls, and the original fails at its first `deep_run`, though the criterion
itself still holds. The redraft keeps the scenario and every assertion, and changes only the fixture.

Written from issue #26 (closed; "Added Oct 9" and "Done when"), issue #2073 (open; Scope and criteria) and #322 (project
trust), as this job was handed them; the frozen `tests/acceptance/26/` (README.md, helpers.ts, contradiction.test.ts,
errors.test.ts, tools.test.ts, fixtures/eval/run.json, BASE-FAILURE.txt); #2073's own blind suite
(`tests/acceptance/2073/`: README.md, helpers.ts, run.test.ts, BASE-FAILURE.txt; tests, not an implementation); the
design (`docs/technical-design.md`: Threats, Untrusted repos and Agents gaming checks; How runs become one of five
verdicts, the run outcomes, Traced programs, Pinned to a commit and Predictions first; the done-gate, spec-draft and
checks-command rows of First-party extensions; Dogfooding; AGENTS.md, Proof); `tests/acceptance/306-redraft-1958/REDRAFT.md`
and `724-redraft-1405/REDRAFT.md` for form; and base `1c4d1f0e2`, read only for how the surfaces are driven:
`packages/hub/src/mcp-operations.ts` (`runCheck`, `status`, `checksOf`, `unknownCheck`), `stop-judging.ts`
(`projectTrusted`), `packages/record/src/trust.ts` (`openTrust`), `packages/checks-command/src/index.ts` and `shell.ts`
(what the hermetic runner counts), `packages/verdicts/src/engine.ts` (`predictionContradictions`) and `scripts/lanes.mjs`.
I never read an implementation of #2073, a diff, a branch, a pull request, an implementer's notes or another checkout.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `26/contradiction.test.ts` › #26.done-when a prediction deep_claim recorded that its run disagrees with shows in deep_status as a contradiction; one it agrees with doesn't | #26 "Done when" (`#26.done-when`) | Two things in its fixture, nothing in the criterion. (1) `agentWorld()` records no trust decision and its home holds neither Claude Code's nor Codex's trust file, so no trust record covers `<tmp>/work`; #2073 refuses such a `deep_run` "before anything starts", and the original fails at "deep_run of unit … must succeed". (2) Both checks run `false`. A trusted project's `deep_run` runs "as a claim's checks run", through the command check kind, and at the base that runner ends `false` uncounted, never failed (BASE-RESULTS.txt): the builtin starts no process that writes the run's read trace. The original's "finishes failed" would then fail, and an uncounted run is no contradiction | `26-redraft-2073/contradiction.test.ts` › the same name with "(redraft 2073)" |

| Part of the test | In #26's test | In the redraft |
|---|---|---|
| The project's trust | none | The core's decision marks `<tmp>/work` trusted: your answer on the trusted path, appended through `openTrust` of the record's public entry in `agentWorld`'s `seeded` step, before the hub starts, as #2073's suite records it |
| The checks' command | `false` for `unit` and `lint` | `node checks/fails.mjs` for both; the script (`process.exitCode = 1;`) is in the fixture's one commit. The spec is the frozen `doneYaml()` with that one command replaced |
| The claim | `deep_claim` at the repo's commit, the worktree clean, predicting unit passed and lint failed | Kept. The fixture was a git repo already and the claim's commit real; nothing is edited after the claim |
| The runs | `deep_run {check, claim}` for unit, then lint, each naming its `run:` handle; each run's `run.finished` is `failed`, else BLOCKED | Kept; the BLOCKED message names the new command |
| The contradiction | `deep_status` holds `{check: unit, run, predicted: passed, outcome: failed}` for unit's run, polled for 60 s, and no contradiction for lint that isn't `late` | Kept, word for word |

The frozen `helpers.ts` is imported unchanged (`agentWorld` with its `files` and `seeded` options, `doneYaml`, `callTool`,
`valueOf`, `eventMatching`, `cleanup`, `ulid`, `sleep`); this folder has no helper file of its own.

## Kept as they are

Every other file of `tests/acceptance/26/`. I looked in each for a `deep_run` that must start a run in the untrusted
fixture and found none:

- `errors.test.ts` › the three `#26.c1ac84d7` tests call `deep_run` with `check: "unti"` and with two check names that
  hold the hub's control token, and make no claim. Each names a check the spec doesn't, and expects a refusal naming
  `check`. Nothing has to start (see Readings for the order of refusals).
- `errors.test.ts` › `#26.8a0223bc` calls every listed tool, `deep_run` among them, with the unlisted field
  `deep26_unlisted` and expects an error@2 refusal. A refusal for the field or for trust both satisfy it.
- `tools.test.ts` › `#26.281a87e3` and `#26.e335d28b` call every listed tool with `sampleArgs`, each string an ask's or
  a decision's handle or a shell payload. For `deep_run` that is a check name the spec doesn't hold; the replies aren't
  read, only that nothing was answered or decided and no marker was written.
- `scorer.test.ts` reads `fixtures/eval/run.json`, a recorded `deep_run` result; it calls no hub.
- `ask`, `binding`, `budgets`, `evidence`, `outage` and `search` call no `deep_run`.

## Readings

- **Trusted** is by the core's decision alone, as #2073's suite reads "a trusted fixture repo"; the test's home holds
  no Claude Code or Codex trust file.
- **The failing command** is one Node process that prints nothing and exits 1, which is what `false` gives the base's
  `deep_run` (`/bin/sh -c` in the worktree, read by its exit). It is the shape #2073's suite uses
  (`node checks/holds.mjs <word>`). Checked once on the base's command check kind: `node checks/fails.mjs` ends failed,
  "the command exited 1"; `false` ends uncounted (BASE-RESULTS.txt).
- **Both checks keep one command**, as the original's did: the scenario is two failing checks told apart by name.
- **Nothing is edited after the claim**, so the test doesn't depend on which tree a run reads (#2073's criterion 2) or
  on which revision of `done.yaml` is read (#1864's). It asserts nothing of #2073's own: no refusal, no checkout.
- **The order of refusals in `errors.test.ts`**, which is not redrafted. Its `#26.c1ac84d7` tests name `unti` in the
  untrusted fixture and expect the refusal to name `check` with `actual: "unti"`. The base refuses an unknown check
  name before it looks for a claim or starts anything. Under #2073 the tests hold only on a hub that still refuses the
  name before it asks the project's trust; #2073's Scope doesn't say which comes first. On a hub that asks trust first
  they fail at "names check", and would need this redraft's one fixture change, the trust decision, and nothing else.

## Wrong programs they still fail

The original file has no planted program; #26's README names two wrong programs for this criterion, and the assertions
that catch them are unchanged.

- A hub that shows no contradiction for a run its prediction disagrees with: fails at "deep_status shows unit's run …
  as a contradiction".
- A hub that shows one for an agreeing prediction: fails at "lint's run … agrees with its prediction".
- Under #2073, a hub that refuses the trusted repo fails at "deep_run of unit … must succeed", and one whose run ends
  anything but failed, or never ends, fails at "BLOCKED unless … finishes failed".

No wrong hub exists here to run. That each of the first two assertions can fail was seen once on the base with two
scratch copies of the test, not kept, each with one prediction changed: unit predicted failed fails at the first, lint
predicted passed at the second (BASE-RESULTS.txt).

## On the base

`BASE-RESULTS.txt` is the one run at `1c4d1f0e2`: 1 test, PASS in 11.3 s. The base's `deep_run` asks no trust and runs
in the live worktree, which nothing edited since the claim, so both runs finish failed and `deep_status` shows unit's
contradiction and none for lint. The frozen original, run once the same way, also passes there (11.1 s), so the redraft
gives on the base what the original gives. The type check is clean. Not run: any implementation of #2073; none exists
here, so the redraft's pass under #2073 is unverified.

## Run it

```sh
npm ci                        # once, if node_modules is missing
npm run build --workspaces    # the tests run the built CLI: deep hub run, deep mcp
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run tests/acceptance/26-redraft-2073/contradiction.test.ts --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/26-redraft-2073/tsconfig.json
```

Run from the checkout's root, as #26's suite is. The test builds nothing. Its folders are the frozen helpers'
`/tmp/dh26-*`, with `HOME` at `<tmp>/h` for every process, and it stops only processes it started, by PID. No network
and no model call. A hub that doesn't start is BLOCKED and a run that doesn't finish failed within 120 s fails as
BLOCKED; neither is a pass. The test starts a real hub, so `scripts/lanes.mjs` needs
`'tests/acceptance/26-redraft-2073/'` in its `alone` list, as `'tests/acceptance/26/'` is; it belongs on neither the
timed nor the slow list. That edit is the implementer's, at the swap.

## At merge

The frozen `tests/acceptance/26/` stays as written. The owner's call is to swap its `contradiction.test.ts` for the one
here, the original then run by hand only, and to keep its other files as they stand.
