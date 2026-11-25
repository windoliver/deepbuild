# Acceptance tests for #3334: remote far-end grant waits bounded by a stall, not a clock

I drafted these tests blind from these sources:

- issue #3334, as `gh issue view 3334` printed it on 2026-11-23
- `docs/parallel-proof.md`, section 6 (Scheduling: the grant-wait table, a stuck drain's named blockers, tables of a
  test's own) and section 8 (Remote lanes: the far end and the record)
- the Dogfooding part of `docs/technical-design.md`, and its Repo guards (the wait ratchet, home paths)
- AGENTS.md
- the base commit `3c564bbdd`, where `scripts/lane-remote.mjs`'s far end asks `throttle.mjs build --wait 30` for its
  install and build, and reads no grant as `BLOCKED lane-remote`, and `throttle.mjs` knows no `--stall`

At the base I also read `scripts/throttle.mjs`, `scripts/lane-remote.mjs`, `scripts/lanes.mjs` (`writeRecord`, the
record's `findings`), `scripts/proof-runs.mjs` (tags, twins, a failure at its assertion), `scripts/wait-ratchet.mjs`,
and `tests/acceptance/1122/`, `2744/`, `2869/` and `3221/` for their conventions. The far-machine tests import
`../1122/helpers.mjs`, the #1122 fixture far machine the issue names. Per AGENTS.md, the implementing agent doesn't
edit these tests; a dispute goes to a blind redraft by this job.

Run them with Node 24:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/3334/*.test.mjs'
```

There are 5 tests in four files. Against a throwaway implementation on the 12-core Mac they were drafted on, at a
1-minute load of 70 to 200, `stall.test.mjs` took 16 s and the three `far-*` files 42 s together. On the merge base
`far-stalled.test.mjs` waits out its 6-minute bound (the base far end waits 30 minutes), so the suite there takes about
6 minutes. Each file stays under 20 minutes even when every bound in it runs out (at most 13 minutes, in
`far-moving.test.mjs` and `stall.test.mjs`). No test needs an idle machine and none holds a port, so there is no
`lane.json`: every test has its own HOMEs and its own throttle table.

## Criteria to tests

Each test's name starts with its criterion's tag.

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3334.6c8b5837` A `build --stall 0.05` request behind a line whose grants change hands every 2 s for 20 s is granted and runs its command; a planted fixed `--wait 0.05` fails | `stall.test.mjs` | On the test's own table, a line of build holders moves for 20 s, six holders a slot waiting ahead at every moment. Once a grant has changed hands, `node scripts/throttle.mjs build --stall 0.05 -- <command>` starts: it exits 0, its command runs under a build grant, it prints no `INCONCLUSIVE no grant`, and at least 3 holders' grants a slot (6 s of hand-overs, twice the bound) are logged between its start and its own grant | The base (`--stall` is an unknown flag: `BLOCKED throttle: usage`, exit 2). Twin `fixed-wait` |
| `#3334.ed504fe3` A stalled line: `INCONCLUSIVE no grant: no build grant changed hands within 0.05 min`, naming the holder's grant, pid and command, exit 3, command unrun | `stall.test.mjs` | Every build slot of the test's own table is held for ten minutes and nothing else changes. The `--stall 0.05` request exits 3; its line starting `INCONCLUSIVE no grant` starts `INCONCLUSIVE no grant: no build grant changed hands within 0.05 min` and holds, for each holder, `; blocked by build grant <id> held by pid <pid> since <time> (<command>)`, the command holding the holder's name; its command never ran | The base (unknown flag, exit 2) |
| `#3334.e38df940` Through the #1122 fixture, a far-end `npm ci` behind a build queue that moves past the bound (`DEEP_LANE_REMOTE_STALL_MIN` = 0.05) gets its grant and reads the lane's own state; a planted fixed 0.05-min wait fails | `far-moving.test.mjs` | The far machine's build queue moves, six holders a slot waiting at every moment, until the far end's `npm ci` starts. `lane-remote.mjs --host <host> unit` prints `PASS unit on <host>` and exits 0, its `RECORD` names `<tree>-unit-<host>.json`, which reads PASS; the lane's test ran on the far machine; `npm ci` ran under a build grant of the far machine's table that came behind at least 3 holders' grants a slot | Twin `far-fixed-wait`. The base passes this test: its 30-minute wait outlasts the fixture's queue |
| `#3334.f5046205` A far end whose queue stalls: near end `INCONCLUSIVE <lane> on <host>`, exit 2, the fetched record `INCONCLUSIVE` with a finding whose note names the holder, the lane unrun; a planted far end reading `BLOCKED` fails | `far-stalled.test.mjs` | Every build slot of the far machine's table is held for ten minutes. Within 6 minutes the near end prints `INCONCLUSIVE unit on <host>` and exits 2. Its `RECORD`, `<tree>-unit-<host>.json`, reads `INCONCLUSIVE`, holds no rows and one finding, `INCONCLUSIVE`, whose note starts `INCONCLUSIVE no grant: no build grant changed hands within 0.05 min` and names each holder's grant, pid and command; it carries `bundle` and a `recipe` naming the shipped commit. The lane's test never ran on either machine, and npm never ran | The base (it waits 30 minutes, so the near end is still running at the 6-minute bound). Twin `far-blocked` |
| `#3334.5d28f79a` A far-end `npm ci` that itself fails still reads `BLOCKED lane-remote` and exits 3 | `far-failed.test.mjs` | The far machine's `npm ci` exits 1. The near end's output holds a line starting `BLOCKED lane-remote`, no `<STATE> unit on <host>` line, and it exits 3; the lane's test never ran | Twin `far-swallows-failure`. The base passes this test: it is today's behavior |
| `#3334.f26a3f37` On the Spark, a remote lane started while the build queue is 3 or more deep with grants held past 30 minutes gets its grants and reads its lane's state | none | Hand-checked: the issue's Proof is the Spark run's near-end lines and its throttle log's `granted` and `timeout` entries. No test here can reach a Spark or hold grants for 30 minutes | — |

`twins.json` names each twin, and `twins/README.md` says exactly what each must plant. The implementing job writes
the twin files.

## The surfaces (my choice where the design leaves it open)

Every surface is one the issue or the design names. The tests start processes and read files; they import nothing of
the code under test, so a flag the throttle doesn't know reads as a failed assertion.

- **The throttle**: `node scripts/throttle.mjs build --stall 0.05 -- <command>` and, for the holders,
  `throttle.mjs build --wait 10 -- <command>`, with `DEEP_THROTTLE_TABLE` naming a folder of the test's own and a
  HOME of the test's own. Read: the exit status, stdout's lines (the command's own output among them), whether the
  command ran (it writes its `DEEP_THROTTLE` to a file), and the table folder's `log` (`granted` entries of class
  `build`, by `id`).
- **A holder's grant**: a holder's command prints or notes its `DEEP_THROTTLE`, `build:<id>`, which section 6 says
  names its grant. Its pid is the pid of the `throttle.mjs` process the test started, the grant's holder. Its command
  is named by a word only it carries, `hold-3334-<k>`, which is in the holder's command line whichever process's
  command line the throttle prints.
- **The near end**: `node scripts/lane-remote.mjs --host far-1122 unit` in a #1122 session worktree. Read: its exit
  status, its last `<STATE> unit on <host>` line, its last `RECORD <path>` line and the record it names.
- **The far machine** is #1122's (`../1122/README.md`, The far machine): `ssh` runs the far end on this machine
  under the far HOME, with a fresh environment. Inside a test run the far end's throttle table is then its HOME's own,
  `<far HOME>/.deepbuild/throttle/`, so the test's holders take their grants there (`DEEP_THROTTLE_TABLE` naming that
  folder). The far machine's `npm` stand-in is wrapped: each call notes the grant it ran under, `npm ci` writes a
  marker the moving queue stops on, and `npm ci` exits 1 when the far HOME holds `.npm-ci-fails-3334`. The lane's test
  notes its run in its machine's HOME, as #1122's fixture tests do.
- **`DEEP_LANE_REMOTE_STALL_MIN`** is set to 0.05 in the far machine's login profile (`~/.bash_profile` and
  `~/.profile` of the far HOME), since the far end runs in a fresh environment under `bash -lc`, and in the session's
  environment too, for an implementation that passes it on.
- **Exit statuses**: the throttle's 3 on no grant, as a timed-out wait; the near end's 0 PASS, 2 INCONCLUSIVE, 3
  BLOCKED, as section 8 gives them.

### The moving line

A small feeder, written by the test into its sandbox, keeps a line of build requests moving: it keeps six holders a
slot (6 on the Mac's one build slot, 12 on the Spark's two) started and not yet granted, each a `throttle.mjs build
--wait 10` whose command notes its grant and sleeps 1.5 s, so with the hand-over a grant changes hands about every 2 s.
It prints `READY` once a grant has changed hands, by which time the holders it started first are in line. In
`stall.test.mjs` it stops adding holders 20 s after its first grant; in `far-moving.test.mjs` once the far end's
`npm ci` starts. Since six a slot are always waiting, a request joining at any moment has several holders ahead of it,
about 10 s of hand-overs, past the 3-second bound, while each hand-over is well inside it. The request under test is
never starved: holders the feeder adds after it join behind it.

The holders sleep 1.5 s, not 2 s, so the time between two hand-overs, sleep plus a release and the next look, stays
near the issue's 2 s even on a loaded machine. Grants change hands at least that often, as the criterion asks.

## Assumptions, where the design is silent

1. **The stall bound restarts on grants of the request's class only.** The holders and the request are all `build`.
2. **A request behind a stalled line names each holder of its class**, with the line #2744 gives a timed-out drain:
   `; blocked by <class> grant <id> held by pid <pid> since <time> (<command>)`. `<time>` is read as any word,
   `<command>` as any text without a parenthesis that holds the holder's `hold-3334-<k>`.
3. **On the Spark's two build slots**, "one build grant held" is both slots held: one holder leaves a slot free, and the
   request would be granted at once. So the stalled tests hold every slot (one on the Mac) and expect each holder named.
4. **The far end's record of no grant** is the lane's record of the tree, `<tree>-unit.json` on the far machine,
   fetched by the near end as `<tree>-unit-<host>.json`; "no rows" is `tests` empty or absent; `findings` is the list
   `lanes.mjs` writes, of `{ state, note }`.
5. **The far end reads `DEEP_LANE_REMOTE_STALL_MIN` from its own environment**, which on the fixture comes from the
   far HOME's login profile under the base's `bash -lc`.
6. **A failed install reads `BLOCKED lane-remote` on the near end** whether the far end's BLOCKED line or the near
   end's own "brought no record back" line says it; either starts `BLOCKED lane-remote`, and no `<STATE> unit on
   <host>` line is printed.

## What stays unproven here

- **The Spark** (`#3334.f26a3f37`): no test reaches it, holds a queue 3 deep or holds a grant past 30 minutes. The
  issue's Proof is the Spark run's near-end lines and the throttle log's `granted` and `timeout` entries, by hand.
- **`acquire(class, { stall })`**: the importable form is in the issue's scope and in no criterion; only the CLI runs.
- **An open budget window pausing the bound**, and **`--wait` with `--stall` refused together**: in the scope, in no
  criterion, untested.
- **A throttle that reads `BLOCKED` on the far end** (its table unusable) staying `BLOCKED lane-remote`: in the scope,
  in no criterion, untested. The failed-`npm ci` test covers a command that fails.
- **The far end's package build** (`npm run build --workspaces`) waiting on the stall: the moving-queue test lets it
  run behind the holders left in line once `npm ci` starts, but no test stalls it alone.
- **Section 6's grant-wait table and section 8's far-end paragraph**: docs, read by diff review.
- **Timing on a very loaded machine**: the moving line's hand-overs must stay under 3 s apart. On the Mac they were
  drafted on, at a load of 70 to 200, they were about 1.6 s apart. A machine so loaded that a release and the next look
  take over a second could see the bound run out between two hand-overs.

## How I checked the tests can pass

No implementation was written into the repository. To tell a test bug from a real failure, I wrote a throwaway
`--stall` in `throttle.mjs` and a far end that waits on it in `lane-remote.mjs`, in a copy of the checkout in this
job's scratch folder, ran this suite against it (5 of 5 passed), and planted each fault of `twins/README.md` in it
(each failed its test at its assertion). The throwaway isn't kept and proves nothing about the real change.
`BASE-FAILURE.txt` is the suite's run on the merge base, then a summary of the planted runs.

## Files

- `helpers.mjs`: the sandbox and its own table, process starts in their own groups, the bound on a run, the moving
  line and the still line, the request under test, and the #1122 far machine made ready for these tests.
- `stall.test.mjs`: the throttle's `--stall` behind a moving line and a still one.
- `far-moving.test.mjs`, `far-stalled.test.mjs`, `far-failed.test.mjs`: the remote lane's far end behind a moving
  queue, a stalled queue, and a failed `npm ci`.
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, home paths written as `~`.

No fixture holds a secret or personal data.
