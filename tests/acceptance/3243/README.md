# #3243 acceptance: #25's held-stop and one-route checks, and the provisional ask

Written blind from issue #3243, `docs/technical-design.md` ("An ask, and your answer getting back": "Work goes on
while you decide") and the base `118ec119f`. Nothing here edits `tests/acceptance/25/`.

| Criterion | ID | Tests | Twin |
|---|---|---|---|
| #25 AC1 and AC4 pass on main | `#3243.53a4911b` | `held.test.ts` (AC1 half), `one-route.test.ts` (AC4 half) | `stop-not-held` |
| A provisional ask still goes on at once | `#3243.48cf467d` | `provisional.test.ts` | `never-provisional` |

## `#3243.53a4911b`: how it decides (`helpers.ts`, `judgeRoute`)

Each half names one #25 criterion, its file and its wrong program:

| Half | #25 criterion | Named file | Wrong program |
|---|---|---|---|
| `held.test.ts` | AC1 `#25.0215da31` | `tests/acceptance/25/routes/held.test.ts` | `answer-skips-held-stop` |
| `one-route.test.ts` | AC4 `#25.1eae4ef9` | `tests/acceptance/25/routes/one-route.test.ts` | `both-routes` |

1. Which files decide. If the named file isn't in `byHand` (exported by `scripts/lanes.mjs`, read with its `listed`,
   so a folder entry ending in `/` counts), the named file decides, and it must be unchanged from the merge base with
   `origin/main` (git diff; no merge base is INCONCLUSIVE). If it is in `byHand`, the files under
   `tests/acceptance/25-redraft-3243/` (any depth, `twins/` aside) whose text carries the #25 ID decide; none is a
   failure ("run by hand, and no redraft carries the ID"). At the base no redraft exists and neither file is by hand.
2. They run in a child Vitest from the checkout root with the root config, as the lanes run a file:
   `node node_modules/vitest/vitest.mjs run --no-file-parallelism --reporter=json --outputFile=<tmp> -t <#25 ID> <files>`,
   with git's, npm's and this Vitest's variables left out of its environment, bounded at 17 minutes.
3. The JSON report is read back. Every test whose full name carries the #25 ID is judged:
   - failed with an assertion: this test fails, quoting it (FAIL outranks the rest);
   - skipped, pending, or failed with a message that starts `BLOCKED`/`INCONCLUSIVE` (or a wrong-program test's
     `expected 'BLOCKED…' to match`), no tagged test at all, or no report: this test skips `INCONCLUSIVE`, never passes;
   - all passed: the wrong program must be proved (below), and the child exits 0.
4. The wrong program, by path:
   - Named file: one passing tagged test must name the wrong program. The #25 files' `(wrong program)` tests do: they
     run the scenario with `DEEP_HUB_PLANT=<plant>` and require the planted failure message. This isn't done by
     planting the child Vitest's environment: #25's helpers give the hub `DEEP_HUB_PLANT` only through
     `startHub(…, { plant })` and strip every `DEEP_` variable from what they start, so a plant set on the child would
     never reach a hub.
   - Redraft: a blind redraft proves its wrong programs through its own `twins.json` and proof lane, not in-file
     wrong-program tests (the before lane can't prove caught-error assertions). So `tests/acceptance/25-redraft-3243/twins.json`
     must map the #25 ID to a list holding the wrong program's name (`answer-skips-held-stop`, `both-routes`), and
     `twins/<that name>/` must exist, hold at least one file, and hold nothing under `tests/` (product source only).
     Whether that twin really fails the redraft is the redraft's own lane's question, not this suite's.

At the base both halves fail at the assertion "`#25.…`'s tests … pass; these failed" (BASE-RESULTS.txt): the ask the
#25 files raise is a choice with a recommendation, which #84 makes provisional, and the hub holds no stop for it.

## `#3243.48cf467d`: `provisional.test.ts`

A real hub (`deep hub run`, `MCP_TOOL_TIMEOUT` 30 s so a waiting deep_ask answers at once), `deep setup` into a test
home, and #25's Claude Code stand-in (`fixtures/claude.mjs`) running DeepBuild's entries through the real deep-hook and
its own `deep mcp`. The session starts with SessionStart and a typed prompt (no work run). The agent calls deep_ask with
`{ kind: 'choice', options: [blue, green], recommended: green }`: the second option, so the first (a question's
default) can't pass. Nobody answers. Passing means:

- deep_ask's reply is `{ status: 'provisional', answer: <green>, ask: 'ask:…' }`;
- the record's `ask.created` for that ID is under the session, with the question, `provisional: true` and
  `recommended: <green>`;
- no `ask.answered`, `ask.defaulted`, `ask.cancelled`, `ask.moot` or `ask.superseded` names it;
- `inbox.read` lists it, under the session, `entry: needs_you`, `waits_on: you`.

"At once" is read as deep_ask returning the recommended option itself, before and without any answer; a hub that waits
returns `still waiting` (under the 30 s tool timeout) or your answer instead. No clock is asserted.

## Twins (`twins.json`, `twins/<name>/<repo path>`, whole files of the base with one planted change)

| Twin | File | Planted | Fails |
|---|---|---|---|
| `stop-not-held` | `packages/hub/src/stop-judging.ts` | `stopHold`'s `open()` counts only answered asks, so a stop is never held for an open ask, question or not | `#3243.53a4911b`: #25's held-stop and one-route checks end the Stop before the answer |
| `never-provisional` | `packages/hub/src/mcp-operations.ts` | deep_ask's `provisional` is always `false`, so a recommended choice waits for you | `#3243.48cf467d`: deep_ask replies still waiting, not provisional |

## Lane

`lane.json`: alone, `binary` (every file builds deep-hook and starts hubs and stand-ins; two run #25's files in a
child Vitest). Each file imports `../25/routes/helpers.ts`, so the lanes give it the binaries those helpers need.
