# Blind redraft of #1887 AC3, after #210: the slot count the check prints is unchanged

AC3 `#1887.4a851c74`: "The slot count the check prints is unchanged". The ID is sha256 of that text, first 8 hex,
checked against the live issue's text. Written from the issue, the design and base main `0f34aacbe`. It never saw an
implementation of #1887: no branch, worktree, diff or pull request of it was read.

## Why a redraft

The first draft (`tests/acceptance/1887/slots-parity.test.mjs` at the blind job's commit `0195afafc`, written at base
`72fe11a11`) fixed the count at 16: 13 `deep.register*` methods, `deep.registerSource` with 4 variants. Since then #210
(closed) published `deep.registerPort` in `packages/contracts/extension-api.json` (a4fa4b6db), a register method with no
variants, so the base's published API now holds 17 slots by the check's own rule. On a branch that has merged main,
the first draft's test reads a correct count of 17 as a change the work made ("the check counts 17 slots; the base
counts 16"), blaming #1887 for #210's slot. #2793 (open) adds the hub-slot row `deep.registerPort` lacks; until it lands
the check prints no count at all (Base results).

## What it read

- Issue #1887, live with `gh issue view`, `updatedAt` 2026-11-14T23:11:11Z (open): its report, Scope, three criteria
  and Proof. The third criterion's text is unchanged from the first draft's.
- Issue #210, live, `updatedAt` 2026-11-17T09:50:10Z (closed): its Scope, Fields and criteria (the
  `deep.registerPort(name, port)` it adds to the extension API).
- Issue #2793, live, `updatedAt` 2026-11-18T00:14:27Z (open): `deep.registerPort` published with no row in
  `packages/contracts/hub-slots.json`, and the check's `FAIL slots: deep.registerPort ...` line on main.
- The first draft at `0195afafc`: `tests/acceptance/1887/README.md`, `slots-parity.test.mjs` and `BASE-FAILURE.txt`,
  nothing else at that commit.
- At base `0f34aacbe` (a read-only checkout; `git rev-parse --short HEAD` there gave `0f34aacbe`):
  `scripts/slots-check.mjs` (its counting rule, its `PASS slots:` and `FAIL slots:` lines, its exit statuses);
  `packages/contracts/extension-api.json` (45 entries, 14 register methods); `packages/contracts/hub-slots.json` (16
  rows, none for `deep.registerPort`); `packages/extension-host/runtime/deep.mjs` (its `API` table, 46 methods, imported
  to list them); `packages/contracts/dist`'s `extensionApi()` (imported once, to see it returns the same 45 entries).
- `docs/technical-design.md` at that base: Extension API (TypeScript, in-process), including the `deep.registerPort`
  line; Hub slots ("one slot per `deep.register*` method and per variant its shape names") and its table's
  `deep.registerPort` / `port@1` row. `AGENTS.md`.
- For form: `tests/acceptance/1018/redraft-ac6/README.md` and `tests/acceptance/139-redraft-1802/REDRAFT.md`.

## The count

17: the number `scripts/slots-check.mjs` at `0f34aacbe` computes over the published API at `0f34aacbe`, by its own
rule, `api.filter(e => e.method.startsWith('deep.register')).reduce((n, e) => n + (e.variants?.length ?? 1), 0)`, which
is the design's "one slot per `deep.register*` method and per variant its shape names":

| Register methods at `0f34aacbe` | Slots |
|---|---|
| registerCheck, registerResolver, registerPort, registerEnvironment, registerView, registerAdapter, registerStateSource, registerChannel, registerRoute, registerIndex, registerAction, registerJob, registerJobTool | 13 |
| registerSource: stream, polled, mcp, library | 4 |
| Total | 17 |

`deep.schedule.read`, the method #1887 publishes, isn't a register method, and neither the issue's Scope nor the design
makes it a slot, so a right branch prints 17 too.

## What changed, and why

| First draft | This redraft | Why |
|---|---|---|
| `SLOTS = 16` | `SLOTS = 17` | #210's `deep.registerPort` is in the base's published API; the check's rule counts it as 1 |
| No look at the merge base | Before the check runs, the published API at `git merge-base HEAD origin/main` is counted by the same rule; anything but 17 fails with `BLOCKED:` | "Unchanged" is against the merge base. The first draft's number went stale when main added a slot; this turns the next such move (or a checkout older than `0f34aacbe`) into `BLOCKED: ... a redraft is due` instead of a verdict on the work. It reads git, not the check, and judges nothing |
| In `slots-parity.test.mjs` beside AC1 and AC2, sharing one check run | Its own file, `tests/acceptance/1887/redraft-ac3/slot-count.test.mjs`, running the check once itself | Only this test is redrafted; the other two stay as they are and are not touched |

Kept as they were: the surface (the real `node scripts/slots-check.mjs` on the checkout, no flags, `NO_COLOR=1`), the
test name `#1887.4a851c74 The slot count the check prints is unchanged`, and the four judging assertions and their
messages: one `PASS slots:` line; it starts `PASS slots: <n> slots`; `<n>` is the expected count; exit 0.

## Run it

```sh
npm ci && npm run build --workspaces     # once: the check imports packages/contracts/dist and packages/conformance/dist
git fetch origin main                    # the merge base guard needs origin/main and its history
node --test --test-reporter=spec tests/acceptance/1887/redraft-ac3/slot-count.test.mjs
```

Node built-ins only. One run of the check (about 10 s here at load 51); the test allows 15 minutes. Nothing is
written. A shallow clone without `origin/main` fails with `BLOCKED:`.

**What it needs.** The check must pass on the checkout, or there is no count to read. Two things outside #1887 stop it:

- #2793: at `0f34aacbe` and on any branch without its row, the check prints `FAIL slots: deep.registerPort, -: ...
  has 0 rows in the hub-slot table` and exits 1. The test then fails at "printed 0", with that line shown. It does not
  pass: an unprinted count isn't shown unchanged.
- The first draft's lsof note: on a box whose lsof writes a tracefs warning and exits 1, the environment kit adds a
  `deep.registerEnvironment ... lsof failed` finding; there, put a folder first on `PATH` whose `lsof` runs
  `exec /usr/bin/lsof -w "$@"`. This box's lsof exited 0 on this run and the check printed no such line.

## Base results

`BASE-FAILURE.txt` is the one run of the check at `0f34aacbe`, whole: exit 1, one `FAIL slots:` line for
`deep.registerPort`, no `PASS slots:` line. The test file was not run. Read off that output, the guard passes (the merge
base counts 17) and the test **fails** at "prints its slot count on its one `PASS slots:` line, and printed 0", for
#2793's reason, not the issue's. The criterion has no failing reason of its own at the base, since "unchanged" is about
the work; at the base it passes once #2793's row lands (the check then prints 17). It is there to fail a change that
moves the count: a check that counts `deep.schedule.read`, or every published method, as a slot prints 18 or more and
fails at "the check counts <n> slots; the base counts 17". Those wrong programs were reasoned, not run.

## Not tested here

AC1 and AC2 (`#1887.a39d9bc9`, `#1887.69370a95`): the first draft's tests, not redrafted. Note for whoever runs them: at
this base they meet the same #2793 line, and the first draft's AC1 second half ("passes once the entry exists") needs
the check to pass on the checkout too.
