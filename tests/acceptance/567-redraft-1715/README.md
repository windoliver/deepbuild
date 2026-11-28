# Blind redraft of #567 AC1 for #1715

#567 AC1, `AC1 #567.4297f978`: "In a Claude Code session, a seeded false "done" is held, sent back, and its verdict
line shows in the chat". It is redrafted here because #1715 found that #567's fixture put the seeded bug on the merge
base, so the hub judged it BLOCKED as inherited. The owner ruled that the fixture is wrong (Owner's ruling, below).

Written blind by the job that sees only the issues, the design, the owner's ruling and the base commit. It never saw
an implementation diff, a dispute write-up or another agent's notes. The implementing agent doesn't edit these files
(AGENTS.md, Proof). A dispute goes to a blind redraft.

## What this job read

- Issue #567: its three criteria and its Proof ("a build without the Stop hold fails this test"). Issue #1715: its one
  criterion ("held, sent back naming unit, and its line says "sent back", never PASS or BLOCKED") and what it found on
  main.
- `docs/technical-design.md` at the base, at least these parts: How runs become one of five verdicts (the inherited
  rule, BLOCKED; FAIL), Fail before, pass after, and Pinned to a commit (a claim on uncommitted changes covers a
  snapshot commit whose parent is HEAD); under Flows, At the claim (inheritance is judged per test, and a test that
  fails only on the claim's commit makes the claim FAIL) and Timing and cost (the spec's checks run before the
  definition locks); An agent says it's done (Every stop is judged, The verdict in the chat); States people see;
  Dogfooding.
- AGENTS.md.
- As surfaces only, never edited: `tests/acceptance/567/` (README, `helpers.ts`, `fast.test.ts`, `fixtures/`,
  `twins.json`, `twins/`) and the precedent `tests/acceptance/668-redraft-1713/`. `scripts/proof-runs.mjs`, to see how
  `twins.json` and a twin's `lines.json` are read. In `packages/hub` and `packages/gate`, only to learn which merge base
  the hub picks: `ask-tasks.ts` (`claimEarly`, `claim`), `gate-runner.ts` (`onBase`), `gate/src/checkouts.ts`
  (`baseCheckout`). And `server.ts`'s Stop hold, to cut the twin.

Base: `9bbe0f24c` (origin/main).

## How to run

As #567's README says (Node 24.22 first on `PATH`, `npm ci && npm run build --workspaces`, `cargo build --locked -q -p
deep-hook`, or the test builds it), then:

```sh
npx vitest run --root tests/acceptance/567-redraft-1715 --no-file-parallelism fast.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/567-redraft-1715/tsconfig.json --noEmit
```

`lane.json` runs the file alone, since it starts a hub and may build deep-hook, as #567's fast tests do. Vitest's cache
goes to `node_modules/.vite/` here: delete it before committing. The proof goes to
`$TMPDIR/deep-567-proof/fast-redraft-1715/` (`record.json`, `false-done.json`, `true-done.json`, `transcript.jsonl`),
redacted as #567's is, and is rewritten on each run.

## The fixture, as changed

Everything is #567's (`helpers.ts`): the temporary home, `deep setup`'s entries, the real deep-hook and hub, #83's
Claude Code stand-in, the spec `claims: { done: { checks: [unit] } }` with its `unit` command check, the two node:test
tests, `FALSE_DONE`, `FIX`, and AC1's check (`falseDoneProblems`). Only the git history and the seeded edit change:

- **`main`, the merge base**: #567's one commit, `Start the shop`, with `checkToken` already fixed
  (`token.exp > Date.now() / 1000`), so `unit` passes there. The test checks this by hand first, and fails `BLOCKED` if
  it doesn't hold.
- **The session's branch, `work`**: made from `main`. The typed prompt is `Refactor checkToken in src/auth.js; it must
  keep rejecting expired tokens.` The agent Reads `src/auth.js`, then its Edit seeds the bug (`token.exp > 0`), and it
  stops with #567's false "done", `Done. Expired tokens are rejected and all tests pass.` Its stop's claim is the
  snapshot commit of that worktree, whose parent is `main`'s commit. So `unit` fails on the claim's commit and passes on
  the merge base.
- **After the send-back**: as in #567, the agent's Edit makes the fix and it stops again (`stop_hook_active: true`),
  saying `Fixed: expired tokens are rejected now.`

### Why the bug lands in the session's own change, not in an earlier commit on the branch

The ruling's words are "its bug in a commit after the merge base". The design names two bases: the definition's base
commit, where the task began (Locked), and the merge base a fix's or spec check's base run checks out (Fail before,
pass after). The hub takes the merge base of the claim's commit with the task's base commit. For a claim made before
the definition locks, as here, that base commit is the session's HEAD at the stop (`claimEarly`, then
`baseCheckout`'s `git merge-base <claim> <onto>`). A bug committed on `work` before the session is on that base under
either of the design's readings: the task began after it. Only one seeding puts the bug after the merge base whichever
base is meant, `main`'s, the task's or HEAD's: the agent's own change in its turn, which the claim's snapshot commit
holds (design: Pinned to a commit). It is also what a false "done" is: the agent's own work, broken, claimed done.

The first #567 draft's prompt, "Make checkToken reject expired tokens", needs the bug to exist before the turn, so the
prompt changes to a refactor that must keep that behavior. It still asks for a change (`Refactor`), so it opens a task
as #567's did.

## Readings

#567's Readings 1 to 4 hold as written there, read through `falseDoneProblems`: held until `unit`'s `run.finished`, sent
back naming `unit`, the line fits 80 columns, says "sent back", never PASS, and shows in the chat. Two additions:

1. **"Never PASS or BLOCKED"** (#1715): the false "done"'s verdict line must not say BLOCKED either. A hub that judged
   the failure inherited fails there.
2. **"Seeded"**: the edit that seeds the bug must make `unit` fail when run by hand, and the branch must leave `main` at
   the passing commit. If either doesn't hold, the run is `BLOCKED`, since nothing false was seeded after the merge base.

Every judgment is node:assert's assertion failure, through `must` from #567's helpers. BLOCKED, INVALID and
INCONCLUSIVE are plain Errors.

## Criteria to tests

| ID | Test | Wrong programs it fails on |
|---|---|---|
| AC1 `#567.4297f978` | `fast.test.ts` | twin `no-stop-hold` (a Claude Code stop answered at once, with no hold): "the seeded false "done" must be held and sent back: DeepBuild's Stop entry let the stop through"; the seeded bug moved onto the merge base: the line says BLOCKED, failing "the verdict line ... says "sent back"" |

`twins.json` names `twins/no-stop-hold/lines.json`. It is #567's twin's one planted change (a `return null` for a Claude
Code stop before the Stop hold), cut again as a line edit of the base's `packages/hub/src/server.ts`. #567's own copy
is a whole `server.ts` from an older main and no longer builds at this base. `proof-runs.mjs` reads twins only from
this folder's `twins/`, so the twin can't point at #567's.

## What the base does

The base passes, with no hub change (run on 2026-11-27):

- The false "done" was held 4.8 s while `unit` ran on the claim's snapshot (failed, 1 of 2 passed) and then on the merge
  base (passed, 2 of 2). The verdict was FAIL ("unit: failed on every real run: checkToken rejects an expired token").
  It was sent back with `sent back 1/3: checkToken reject… · tests/unit.test.js:5 · 2 tests · next: agent` and "DeepBuild
  sent this claim back: the repo's spec check unit FAIL."
- The true "done" after the fix was let through with `says done 1/1 · 2 tests · next: DeepBuild`.
- On the twin, it fails at "must be held and sent back: DeepBuild's Stop entry let the stop through". With the bug on
  `main` (a scratch copy, not kept), it fails at the "sent back" line assertion: `BLOCKED 0/0 · 2 tests · next: you ·
  session/…`.

## Owner's ruling (2026-11-27)

On #1715, the owner ruled that the design stands and #567 AC1's fixture is wrong. A seeded false "done" needs its bug
in a commit after the merge base. A spec check that also fails on the merge base stays BLOCKED as inherited, per the
design's verdict rules and "At the claim". The owner authorized one more blind redraft of #567 AC1, past the design's
one-redraft-per-test limit (Dogfooding). This folder is that redraft. It replaces only AC1's fast test.
`tests/acceptance/567/` is left as it was: its AC2, AC3 and the live test aren't redrafted.

## Files

- `fast.test.ts`: AC1, imports `../567/helpers.ts`.
- `lane.json`, `tsconfig.json` (the root options with `noEmit`, as 668-redraft-1713's).
- `twins.json`, `twins/no-stop-hold/lines.json`: the wrong program.
