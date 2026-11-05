# Blind redraft of #824 AC4: the per-session reading, on any machine

AC4 `#824.85ef3d40`: "On the reference Mac, compared with the merge base, each session added past the first raises the
summed memory of DeepBuild's own processes by under 25 MB. A planted MCP server that loads the whole hub package for
each session fails, and so does a waiter that keeps a copy of its session's transcript, each naming the per-session
growth and the process that grew". This folder covers the part that holds on any machine: the reading is in the local
preflight, it is real and complete, its sessions were open and idle, and it is BLOCKED where memory can't be read. The
25 MB budget on the reference Mac and the two planted leaks are other files' (Not here, below).

Written from the issue, the design and base `8173fbd2` (origin/main), by a job that never saw an implementation of
AC4, as a blind redraft (design: Dogfooding).

## What it read

- Issue #824 as of 2026-11-03: Scope's per-session bullet and its BLOCKED rule, AC4, Proof.
- `docs/technical-design.md`: Numbers version 0 has to hold (Memory row; Every task carries its own budgets; The
  reference Macs). AGENTS.md.
- `tests/acceptance/824/` at base: README.md, `helpers.ts`, `cycles.test.ts` (AC1's on-any-machine checks), whose
  conventions this follows, and `redraft-ac1/README.md`.
- Base code for surfaces only: `packages/hub/src/hookmap.ts` and `adapters/claude-code.facts.json` (SessionStart,
  UserPromptSubmit, Stop and SessionEnd map to `session.start`, `user.ask`, `agent.stop`, `session.end`; an event's
  `session_id` is the payload's and its `ts` the hook's clock in ms), `packages/hub/src/core.ts` (`events.read`),
  `scripts/lanes.mjs` (`checks`, `releaseLanes`), `benchmarks/budgets.json`.
- The benchmark's surface, as the first draft of this job defined it and this job's brief gave it: `node
  benchmarks/hub-sessions.mjs [--home <dir>] [--merge-base]`, its one JSON line (`platform`, `method`, `limitBytes`,
  `readings[]` with `sessions`, `at`, `totalBytes`, `processes[]` of `pid`, `ppid`, `role`, `child`, `command`, `bytes`;
  `perSessionBytes`, `grew`, `mergeBase`), roles `hub`, `deep mcp`, `deep mcp actions`, `waiter`, methods `pss` (Linux
  `smaps_rollup`) and `phys_footprint` (macOS), the plant `sessions-no-memory-read`, a scripted session's 32 MiB
  transcript at `~/.claude/projects/<project>/<session>.jsonl`, and the words `FAIL` and `BLOCKED`.

## How to run

```sh
npm ci && npm run build --workspaces && cargo build -p deep-hook
npx vitest run --root tests/acceptance/824/sessions/redraft-readings --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/824/tsconfig.json
```

It runs the benchmark twice: once healthy with `--merge-base` (30 sessions, 30 transcripts of 32 MiB, about 1 GB of
disk) and once with the plant. Run it with nothing beside it. Homes are `/tmp/dh824s-*`. Each run's cleanup stops by
PID only processes the test saw under its benchmark (or running this checkout's code and started after it), and only
while they still run the command it saw, plus what still holds that home (`lsof +D`); never by name or port. With
`--root` Vitest writes `node_modules/.vite/` in this folder; delete it before committing.

`scripts/lanes.mjs` should list this file in `alone` (it starts some 90 processes and reads their memory). This job
edits nothing outside this folder.

## Choices, and why

- **One healthy run for two tests.** Tests 2 and 3 share one run, started by whichever comes first and removed only in
  `afterAll`, so neither test's cleanup can take the other's data; each still asserts everything it needs itself. Test
  4's plant run has its own home and its own cleanup in `finally`. The parent's `cleanup()` is not used: it removes
  every home the parent's helpers made.
- **Never the benchmark's word.** While the benchmark runs, the test samples the OS's process table itself (`ps -ww -A -o
  pid=,ppid=,args=`, about every 100 ms) and, on Linux, each tracked process's `Pss` from `/proc/<pid>/smaps_rollup`.
  - Every process the benchmark reports was seen running, with the same parent and command.
  - **Completeness:** a process seen under a read process both in the last look before a reading's `at` and the first
    after it (same PID, same command) must be in that reading. At 1 and 10 sessions the test must have looked on both
    sides (more sessions start after them); at 30 it checks when it could, since the benchmark may stop everything at
    once. The stand-in agent is not read, as the surface says, so only processes under read ones are required.
  - **The same memory (Linux):** the 30-session total is within 0.75x to 1.33x of the Pss the test read for the same
    PIDs in its look nearest `at` (within 30 s). Pss is the issue's "shared pages once". Only the 30-session reading is
    compared, since processes added after an earlier reading change every process's share of shared pages. macOS's
    `phys_footprint` isn't read by the test (no reader short of `footprint`), so there the checks are the process
    table's and the floors.
- **Floors and a ceiling per process,** to catch a reading in the wrong unit, a zero, or virtual size:
  - `hub` at least 10,000,000 bytes: a Node process with its SQLite record and V8 heap.
  - `deep mcp` and `deep mcp actions` at least 3,000,000 bytes: a Node process's own heap and private pages alone pass
    that, even under Pss with dozens of Node processes sharing the binary's text; a reading in kB (thousands) fails.
  - `waiter` at least 100,000 bytes: deep-hook is a small Rust process (a shell reads about 480 kB of Pss here); the
    design caps it at 5 MB, so a floor near it would wrongly fail a lean waiter.
  - a child, more than 0. Every process under 2,000,000,000 bytes: nothing DeepBuild runs holds 2 GB idle, while a
    Node process's virtual size on macOS does.
- **Structure from the surface:** one `hub`, the same PID at every count; exactly N of each of `deep mcp`, `deep mcp
  actions` and `waiter` (own, not children) at N sessions; every own process of an earlier reading still read later
  (sessions stay open); a child's parent was read and it carries that parent's role; `totalBytes` is the exact sum.
- **Recomputed:** `perSessionBytes` within 1 byte of the larger of (total at 10 - at 1) / 9 and (at 30 - at 10) / 20;
  `grew.role` is a role whose summed bytes (children included) grew most by the same rule (ties within a byte allowed),
  and `grew.perSessionBytes` its growth within 1 byte.
- **Verdict:** at or over 25,000,000 bytes, a non-zero exit and a line starting `FAIL` that names the growth (within
  15%, by the parent's `sizesNamed`) and the role (`deep mcp` not matched inside `deep mcp actions`); under it, exit 0
  and no `FAIL`. Never `BLOCKED` when memory was read. A `PASS` word is not required: the surface asks only for no
  `FAIL` and exit 0.
- **The merge base:** `mergeBase.commit` is `git merge-base HEAD origin/main`, with either a reading or `initial`, the
  reason in words (the first run: the merge base has no benchmark). No margin is asserted: the issue states none.
- **Open and idle at the hub, from the record** (`events.read` on the benchmark's home, through the parent's
  `recorded()`): the transcripts left in the home name exactly 30 sessions, each at least 33,554,432 bytes and written
  in JSON lines (the first 64 KiB parsed); the hub's `session.start`s are exactly those 30 IDs, in 30 distinct
  working folders; at each reading's `at`, exactly N had started, none had ended, and each had a `user.ask` and, as its
  last turn event (`user.ask`, `tool.before`, `tool.after`, `agent.stop`), an `agent.stop`. That `ts` and `at` are both
  this machine's clock in ms is the base's (`hookmap.ts`).
- **BLOCKED:** with `DEEP_HUB_PLANT=sessions-no-memory-read`, a non-zero exit, a line starting `BLOCKED`, no `PASS`
  anywhere, no `FAIL`, no reading with a number in `totalBytes` or `bytes`, and no `perSessionBytes` number.
- **Another platform:** where `process.platform` is neither `linux` nor `darwin`, test 2 asserts BLOCKED and no PASS.

## Criteria to tests

| ID | Criterion (part) | Test in `readings.test.ts` |
|---|---|---|
| AC4 `#824.85ef3d40` | the reading is in the local preflight | `the local preflight runs it` |
| AC4 `#824.85ef3d40` | 1, 10, 30 sessions; every DeepBuild process summed, shared pages once; growth per added session; the process that grew; merge base | `at 1, 10 and 30 sessions every process ...` |
| AC4 `#824.85ef3d40` | scripted sessions open and idle | `the sessions read were open and idle at the hub ...` |
| AC4 `#824.85ef3d40` (Scope) | BLOCKED where resident memory can't be read, never PASS | `BLOCKED, never PASS ...: sessions-no-memory-read` |

## Wrong programs each test catches

| Wrong program | Caught by |
|---|---|
| the base: no benchmark, no lane or task naming it | all four; `BASE-FAILURE.txt` |
| a benchmark the preflight never runs | test 1 |
| readings at other counts, or sessions restarted between counts | test 2 (counts, same hub PID, earlier PIDs kept) |
| leaves out a role, a session's process, or a child running under one | test 2 (counts per role; completeness against `ps`) |
| invents processes or PIDs | test 2 (each seen in `ps` with that parent and command) |
| reads RSS (shared pages counted in every process), virtual size, kB as bytes, or zero | test 2 (Pss within a quarter on Linux; floors; ceiling) |
| a total, growth or `grew` not from its readings; growth over one step only, or over all 29 | test 2 (recomputed both steps) |
| PASS over 25 MB, FAIL under it, or a FAIL line without the growth or the role | test 2 (verdict) |
| sessions not yet idle, already ended, or never reaching the hub; reading before they start | test 3 (record at each `at`) |
| small or missing transcripts, so the waiter plant has nothing to copy | test 3 |
| PASS, FAIL or made-up numbers where memory can't be read | test 4 |

## Not here

- The 25 MB budget on the reference Mac against the merge base, and the planted `mcp-loads-hub` and
  `waiter-keeps-transcript` failing it: they need the reference-Mac gate and their own runs, and are other files of
  this criterion. A healthy run here is not asserted to be under 25 MB off the reference Mac; only its verdict must
  agree with its reading.

## Files

- `readings.test.ts`: the four tests.
- `helpers.ts`: temp homes with per-run cleanup, the benchmark as a process with the `ps`/Pss sampler, its JSON line
  and words, the growth rule. It imports `holders`, `recorded`, `sizesNamed`, `REPO` and `MINUTE` from
  `../../helpers.ts`.
- `BASE-FAILURE.txt`: the run on base `8173fbd2`: all four fail because `benchmarks/hub-sessions.mjs` doesn't exist
  and nothing names it.
