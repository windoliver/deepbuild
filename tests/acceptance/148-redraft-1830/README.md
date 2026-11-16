# Blind redraft of #148's budgets (AC10) that reads the load at each run's start and end (#1830)

AC10 `#148.b1b5d323`: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a sync across
five agents takes under 1 s and makes no network call." Written from issue #1830, issue #148, the design and base
`3557b348`, by a job that never saw #1830's implementation or any other redraft of it. `budgets.test.ts` here runs in
place of `tests/acceptance/148/budgets.test.ts`; once it lands, that first draft stops running (the swap is the
implementer's, as #148's README records for its AC16 redraft). Nothing here edits a test: a dispute goes to a blind
redraft (design: Dogfooding).

## Why a redraft

Since #1555, `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`: one `{ start, end }`
per run, the one-minute load average (`os.loadavg()[0]`) read at that run's start and at its end. The first draft calls
it with `limit`, `runs` and `fingerprint` only, so AC10's timing reads INCONCLUSIVE on every machine, a fit reference Mac
included. This draft reads the load where each run is taken and gives it to `judgeLimit`. No criterion text, test name
or limit changes.

## What was read

- Issue #1830 (the dispute, its scope and criteria) and issue #148 (Scope, the 17 criteria, Proof).
- `docs/technical-design.md`: How we know version 0 works (Dogfooding), Numbers version 0 has to hold (Every task carries
  its own budgets: five runs after warm-up, the margin; The reference Macs). `AGENTS.md`.
- At the base: `tests/acceptance/148/budgets.test.ts` (the first draft), its `helpers.ts`, `README.md` and
  `BASE-FAILURE.txt`; `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `measureOnce`'s `loadStart` and `loadEnd`).

## What the base has

At `3557b348` #148 is built: the hub serves `agents.propose` and `agents.read`, and `adapters/` holds OpenCode's and
Cursor's facts, so the world the first draft builds for AC10 can be made and synced. The reference Macs in
`scripts/benchmark.mjs` are three, the Mac17,10 among them. `judgeLimit` reads a run whose load at its start or end
can't be read, or is above `os.availableParallelism()`, as INCONCLUSIVE.

## The test

`budgets.test.ts`, one test, named as the first draft's:
`AC10 #148.b1b5d323 a sync across five agents takes under 1 s and makes no network call` (describe `#148 budgets`).

What it measures is the first draft's, through the #148 suite's own helpers (`../148/helpers.ts`, frozen): a world with
Claude Code, Codex and pi, real, and OpenCode and Cursor as the commands their facts name; a hub with
`fixtures/net-log.cjs` preloaded; one warm-up sync, then five, each a new stdio server proposed to all five agents and
timed from the start of `deep inbox answer ... apply` to the first `agents.read` showing the sync `complete`.

What changes:

- **Each run's load.** Just before your yes, and just after the sync reads complete, the test reads `os.loadavg()[0]`.
  The five timed runs' readings go to `judgeLimit` as `loads`, in the runs' order. The warm-up's aren't judged.
- **The judge.** `judgeLimit` with the runs, this machine's `fingerprint()` and `loads`, against 1000 ms. PASS passes;
  FAIL fails, naming the runs and the loads; INCONCLUSIVE (off a reference Mac, not on mains, Low Power Mode on, the
  thermal state not nominal, the macOS build missing, or a run's load above the core count) and BLOCKED fail with a
  message starting `INCONCLUSIVE:` and ending "this is not a pass", the #148 suite's way. The first draft's own
  load-per-core check after judging is gone: `judgeLimit` now sees each run's load.
- **No network call** is asserted on any machine, before the timing is judged, as in the first draft: no connect or
  lookup by the hub between a run's proposal and its completion.

"Compared with the merge base" stays as the first draft read it: the limit is the issue's 1 s, and no merge-base side
runs here.

## Run it

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                       # once
scripts/lease node scripts/throttle.mjs build -- npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node scripts/throttle.mjs build -- cargo build --locked -p deep-hook
export DEEP_CLAUDE_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/claude
export DEEP_CODEX_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/codex
export DEEP_PI_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/pi
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/148-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/148-redraft-1830/tsconfig.json
```

The agents, temp folders, offline switches and process handling are the #148 suite's (its README: Run them). Delete
`tests/acceptance/148-redraft-1830/node_modules/.vite` if Vitest leaves one.

## The base run

Not run. On 2026-11-15 this job's Mac (a Mac17,10, on mains, at a one-minute load of 300 to 600 from other sessions'
work) held its build request in `scripts/throttle.mjs`'s build queue for hours: `npm run build --workspaces` and
`cargo build --locked -p deep-hook`, which the test needs, never got a slot, so the request was stopped and the suite
handed on unrun. `node node_modules/typescript/bin/tsc -p tests/acceptance/148-redraft-1830/tsconfig.json` exits 0.

What a run on the base should show, from the code and not seen: the world and the five syncs as in the first draft
(#148 is built at the base), no network call, and at this Mac's load AC10 failing as `INCONCLUSIVE: ... load N at a
run's start or end is above the 18 cores ...; this is not a pass`.

## What this doesn't settle

- It hasn't run at all yet (The base run), and so hasn't run on a fit reference Mac (mains, Low Power Mode off, thermal
  nominal, load under the core count): no PASS, FAIL or INCONCLUSIVE of AC10 has been seen from this file.
- A run's readings bracket your yes and the sync's completion, not the proposal before it, which isn't timed.
