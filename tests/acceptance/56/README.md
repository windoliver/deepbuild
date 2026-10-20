# Acceptance tests for #56: Effect 4 or plain TypeScript for the hub core

These tests were drafted from issue #56 (its text as of October 18), `docs/technical-design.md` and the base commit `dcfd7b8`, and nothing else. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

## The surface (my choice, since none was named)

The issue names the slice, its numbers and the decision, but no command, file layout or record. I picked the smallest surface that fits the repo: one folder for the spike, one hub entry with a variant selector, a line protocol on a Unix socket shaped like the design's hook protocol, and one JSON record. Both builds are driven through the same entry and socket, so every live test runs once per variant.

### Layout

```
spikes/hub-core/
  hub.mjs            the one entry; --variant picks the build
  plain/             the plain TypeScript build (AbortController trees, a PID ledger)
  effect/            the Effect 4 build
  bench.mjs          the hold bench, run by the preflight's perf lane
  startup.mjs        times import("effect/Effect")
  typecheck.mjs      tsc, and for effect the Effect diagnostics
  package.json       the spike's own dependencies, pinned exactly; its own package-lock.json
  PROMPT.md          the one prompt both builds were written from
  results.json       the record: decision, fix rounds, review times, budgets, startup timing
```

- Each build's sources are the `.ts` files under its folder, outside `node_modules`. They may run directly under Node's type stripping or be built, but a stack trace or diagnostic must name the `.ts` source and its line.
- The spike keeps its dependencies (`effect`, `@effect/platform-node` if used, `@effect/language-service`, TypeScript) in `spikes/hub-core/package.json`, installed with `npm ci --prefix spikes/hub-core`, so the root's dependencies change only by the decision.

### The hub

```
node spikes/hub-core/hub.mjs --variant <plain|effect> --state <dir> --ports <first>-<last>
     [--extension <module>]...    load an extension module in-process (repeatable)
     [--clock virtual]            the hub's clock starts at 0 and moves only on `tick`
```

- It listens on `<state>/hub.sock` and, once listening, prints one line to stdout: `{"ready":true,"variant":"plain","socket":"<state>/hub.sock","pid":<its PID>}`.
- `<state>` holds whatever the hub keeps between runs, such as its PID ledger. A hub started on the `<state>` of a hub that was killed with `kill -9` stops every process the killed hub started that still runs, and frees their leases. It stops only what it can prove it started (by PID and start time, or by its process group), never by command name.
- `--ports a-b` is the lease pool. The tests always pass 10 ports.
- On SIGTERM it stops every process it started and exits within 5 s, even while an extension's promise is pending and its timers run.

### The socket

One JSON object per line. Each connection carries one request; the hub may close it after its reply.

```
// hold: a session's hook, held until its check settles or 2 s pass
→ {"op":"hold","id":"<unique>","session":"<name>","check":{"argv":["<path>","<arg>"...]}}
← {"ack":"<id>","hold_until_ms":<ms>}                 first, at once
← {"id":"<id>","outcome":"pass|fail|timeout|cancelled|blocked","attempts":<n>,"error":{"message":"…","stack":"…"}}
                                                       error only with blocked

→ {"op":"cancel","session":"<name>"}   ← {"ok":true,"cancelled":<holds of that session it cancelled>}
→ {"op":"leases"}                      ← {"pool":[<port>...],"held":[{"port":<p>,"session":"<name>","hold":"<id>"}]}
→ {"op":"stats"}                       ← {"rssBytes":<n>,"maxRssBytes":<n>,"handles":<n>}
→ {"op":"tick","ms":<n>}               ← {"now":<virtual ms>}     only with --clock virtual
```

What a hold does:

- `hold_until_ms` is the hub's clock at the request plus 2,000: `Date.now()` on the real clock, the virtual time on the virtual one.
- The check waits for a port from the pool, then runs as `argv` with `PORT=<leased port>` added to the hub's environment, in a process group of its own. Every process left in that group when an attempt ends is stopped before the next attempt starts, and before the lease goes back.
- An attempt that exits 0 is a pass. One that exits otherwise is retried at once, three times at most, so a check runs at most four times. `attempts` counts the attempts the hub started. There's no backoff, so retries never wait on either clock.
- The 2 s covers the whole hold: waiting for a port and every attempt. At `hold_until_ms` the reply is `timeout`, the running attempt is stopped and not retried.
- `cancel` ends every open hold of that session with `cancelled`, stopping its processes and freeing its lease. Other sessions go on.
- A check that can't start, such as a missing binary, is `blocked`, with an error whose message or stack names the `.ts` file and line in the build where it was handled.
- With `--clock virtual`, `tick` answers once every timer due by the new time has fired. The hub uses that clock for the hold timeout and for any grace it gives a stop.

### The extension API in the slice

Extensions stay plain TypeScript either way (design: Promises with an AbortSignal). An extension module's default export is `{ name, onHold(hold, signal) }`, with `hold` as `{ id, session }` and `signal` a standard `AbortSignal`. The hub calls `onHold` once per hold when the hold starts, aborts the signal when the hold ends, and never waits on the promise before replying, freeing a lease or exiting. `fixtures/extension.mjs` is the one that ignores its abort signal: it never settles and keeps a timer running forever.

### Bench, startup and typecheck

```
node spikes/hub-core/bench.mjs --variant <v>
  → {"bench":"hold","variant":"<v>","holds":50,"holdP50Ms":<n>,"holdP95Ms":<n>,"hubPeakBytes":<n>,"leakedHandles":<n>}
node spikes/hub-core/startup.mjs
  → {"node":"<process.version>","module":"effect/Effect","effect":"<installed version>","samples":<≥20>,"p50Ms":<n>,"p95Ms":<n>}
node spikes/hub-core/typecheck.mjs --variant <v>
  → {"tool":"tsc|effect","file":"<path>","line":<1-based>,"severity":"error|warning|…","code":"…","message":"…"}   one per diagnostic
  → {"variant":"<v>","tools":["tsc"] | ["tsc","effect"],"errors":<n>}                                        last
```

- The bench starts the variant's hub as a child, holds one hook in each of 50 sessions on a check that passes at once, and measures each hold from request to reply. `hubPeakBytes` is the hub's own peak resident memory (`stats.maxRssBytes`). `leakedHandles` is the hub's `stats.handles` once the holds have ended and their leases are back, minus its count before them. It exits 0 when every hold passed.
- The startup timing runs each sample in a fresh Node process, the way the CLI would pay it.
- `typecheck.mjs` exits 0 only with no error. For `effect`, `tools` includes `effect`: the `@effect/language-service` diagnostics over the same files, with its default rules.

### Budgets

`benchmarks/budgets.json` gets two tasks that the existing perf lane measures, 20 rounds each, against the merge base:

```json
{ "id": "hub-core-plain",  "command": ["node", "spikes/hub-core/bench.mjs", "--variant", "plain"],  "margin": 0.5, "limits": { "peakBytes": <n> }, "initialReason": "Issue #56 first measurement: …" }
{ "id": "hub-core-effect", "command": ["node", "spikes/hub-core/bench.mjs", "--variant", "effect"], "margin": 0.5, "limits": { "peakBytes": <n> }, "initialReason": "Issue #56 first measurement: …" }
```

The merge base has neither, so each is a first measurement, `INITIAL` with its reason.

### The record, `spikes/hub-core/results.json`

```json
{
  "decision": "plain | effect",
  "prompt": "spikes/hub-core/PROMPT.md",
  "variants": {
    "plain":  { "agent": "<agent>", "model": "<model>", "fixRounds": 1, "reviewMinutes": 30, "failed": [] },
    "effect": { "agent": "<agent>", "model": "<model>", "fixRounds": 2, "reviewMinutes": 41, "failed": ["#56.<id>"] }
  },
  "startup": { "node": "v22.x.y", "module": "effect/Effect", "effect": "4.0.5", "samples": 20, "p50Ms": 0, "p95Ms": 0 },
  "budgets": {
    "machine": { "model": "Mac15,7", "reference": true },
    "commit": "<40-hex commit the preflight ran on>",
    "perf": [ <perf's JSON line for hub-core-plain>, <perf's JSON line for hub-core-effect> ],
    "bench": { "plain": <the bench line>, "effect": <the bench line> }
  }
}
```

- `fixRounds`: how many rounds of fixes the agent's code needed before it passed tsc (and, for effect, the Effect diagnostics), 0 when it passed as written.
- `reviewMinutes`: the maintainer's review time for each build, or `null` when that build wasn't reviewed.
- `failed`: the criterion IDs (table below) that build failed, empty when none.
- `budgets` comes from one local preflight on the reference Mac (on mains power, Low Power Mode off, thermal state nominal): perf's two lines as printed, and a bench line per variant from that machine.

### The decision in the design

The Decided table's "Effect in the hub core" row states the outcome instead of the pending rule: its decision cell starts with "Plain TypeScript", or names Effect with its pinned version, and the row gives the `import("effect/Effect")` time and each variant's hold latency (ms) and hub memory (MB or MiB).

If the decision is Effect:

- every package outside the spike that depends on `effect` or `@effect/*` pins it to an exact version, which the root `package-lock.json` resolves;
- `node scripts/import-rules.mjs [<root>]` fails, naming each file, when a file under `packages/cli`, `packages/extension-api`, `packages/contracts` or `packages/store` imports `effect` or `@effect/*` (static import, `export … from`, dynamic `import()` or `require`), and passes on `packages/hub`; a lane in `scripts/lanes.mjs` runs it; the repo passes it.

If the decision is plain, no package outside the spike depends on Effect.

## How to run

```
npm ci && npm ci --prefix spikes/hub-core
node --test --test-concurrency=1 tests/acceptance/56/*.test.mjs
```

- `--test-concurrency=1` keeps the files from running side by side: they time real processes, and CPU from another file would push holds past their 2 s.
- The whole suite takes about five minutes. Against a throwaway plain hub, the lease file took about 35 s and the timeout file about 27 s per variant.
- A randomized run prints its seed on failure. Replay it with `DEEP_SPIKE_SEED=<seed>`.
- A test never skips. A build that isn't there fails as `BLOCKED: the <variant> hub didn't start`.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped, as for #48.

| ID | Criterion | Tests | Wrong program it must fail on |
|---|---|---|---|
| `#56.d29f38cc` | No process from the hub's process groups survives a cancel, SIGTERM, or kill -9 followed by a restart, in either build | `processes.test.mjs`, per variant. Five sessions hold hooks on checks that hang with two grandchildren each, all ignoring SIGTERM, SIGHUP and SIGINT. A cancel of one session stops its check and grandchildren within 2 s, frees its lease and leaves the other four running. A check that passes, or fails four times, leaves no grandchild behind. SIGTERM to the hub, with the abort-ignoring extension loaded, ends the hub within 5 s and every process it started. After `kill -9`, the processes are shown still running, a hub restarted on the same `--state` stops them all within 5 s, frees every lease and serves a new hold, and a decoy running the same fixture, started by the test, survives | A hub that kills only the check's PID (its grandchildren survive), sends only SIGTERM, cancels every session on one cancel, does nothing on SIGTERM, waits on the extension's timers to exit, keeps no ledger, or reaps by command line (the decoy dies) |
| `#56.80ab2a58` | No lease leaks across 1,000 randomized runs | `leases.test.mjs`, per variant. 50 sessions hold hooks at once on a pool of 10 ports: every hold is acknowledged with `hold_until_ms` 2 s ahead, all pass, the hub's leases never pass 10 or repeat a port, and no check finds its port taken. Then 1,000 seeded runs from 50 sessions with checks that pass, fail, flake, run out of retries or hang, 0 to 2 grandchildren, 30% random cancels and the extension: each run's outcome fits its script (or a timeout between 2 and 3.5 s), a cancel is `cancelled` exactly when the cancel says it cancelled one, no check runs more than four times, and at the end no lease is held, every pool port binds, no process is left, and every extension signal aborted | A hub that keeps a cancelled or queued hold's lease, leaks a port on a timeout, leases a port twice, retries forever, ignores cancel, or waits on the extension's promise before replying (all 50 time out) |
| `#56.57268f7d` | Timeout tests on a virtual clock pass 20 of 20 runs | `timeouts.test.mjs`, per variant, 20 runs each on a fresh hub with `--clock virtual`: holds made at 0 are due at exactly 2000; a check that passes on its last retry and one that never passes end with 4 attempts with the clock still at 0; three hanging holds (one after a failed attempt) stay unanswered at 1999 and time out at 2000, under 1.7 s of wall time after their request, and a timed-out attempt isn't retried; a hold made at 2000 is due at 4000 and still waits at 3999; past a 60 s grace nothing is left and no lease is held. 20 of 20 must pass. One more test checks the same 2 s on the real clock | A hub whose timeout runs on the wall clock, resets per attempt, fires a millisecond early or late, retries a timed-out attempt, retries more or fewer than three times, or waits on a clock between retries |
| `#56.6526364c` | The agent-written code passes tsc and the Effect diagnostics within two rounds of fixes, and errors name the DeepBuild file and line | `typecheck.test.mjs`. Each build passes `typecheck.mjs` with no error (effect with both tools). A type error planted in a build's folder fails it, naming that file and line 2. A floating Effect planted in the effect build is reported by the Effect diagnostics at line 4, and not by tsc. A hold whose check binary is missing comes back `blocked` with an error naming a `.ts` file and an existing line in that build's own folder. The record names one prompt file, the same agent and model for both, and `fixRounds` of at most 2 for each | A typecheck that prints a clean summary without running tsc, or never runs the Effect diagnostics. A build whose errors carry only Node's or Effect's internal frames (Node's own `spawn ENOENT` stack fails it) |
| `#56.6fcf7fe2` | Review takes at most 1.5 times as long as for the plain version; if any criterion fails, the decision is plain TypeScript | `decision.test.mjs`. The record has a decision, each build's review time (or null) and what each build failed; the plain build failed nothing. When the decision is Effect, both review times exist and Effect's is at most 1.5 times plain's. When the Effect side failed anything by the record's own numbers (a criterion listed in `failed`, more than two fix rounds, a missing or too long review, latency or memory more than 10% over plain's, or a missing number), the decision must be plain | A record that chooses Effect with a missing or 1.6-times review, with a failed criterion, or with missing numbers |
| `#56.31f12028` | Budgets, on the reference Mac in the local preflight, compared with the merge base: each variant's hold latency, memory and leaked handles are recorded, and Effect is used only within 10% of plain TypeScript on latency and memory | `decision.test.mjs`. `benchmarks/budgets.json` has `hub-core-plain` and `hub-core-effect`, running the bench per variant with a #56 first-measurement reason and a memory cap, and passes perf's own `validateBudgets` against the base commit's budgets. The bench runs for each variant and prints 50 holds' latency, the hub's peak memory and its leaked handles. The record keeps perf's two lines from a preflight (`INITIAL` or `PASS`) and both bench lines, from Mac15,7 marked as the reference. When the decision is Effect, its hold p50 and hub memory are within 10% of plain's | No budget for a variant, a budget perf can't run, a changed established budget, a bench that measures nothing, numbers from another machine, or Effect chosen at 11% over plain |

The issue's scope also asks for the startup timing and the written decision. `decision.test.mjs` checks them under `#56 scope`: the record's `import("effect/Effect")` timing on Node 22 with 20 or more samples and the pinned Effect version, and `startup.mjs` measuring on whatever Node runs the test; exact pins for the spike's Effect packages, with Effect 4; the design's row stating the decision with its numbers; and, by the decision, either the pins and the import rule for Effect or no Effect dependency outside the spike.

## What depends on parts the base commit lacks

At `dcfd7b8` there's no spike, no record, no budget and no import rule. All 34 tests fail there (checked on this worktree at the base): the live ones with `BLOCKED: the <variant> hub didn't start`, the record ones with `BLOCKED: the spike's record … doesn't exist`, and the commands with exit 1.

Some criteria can only be proven by a person or by the reference Mac, and the tests read those from the record:

- Review time is the maintainer's measurement. The tests check only what the record says and the rule.
- Fix rounds are a fact of how the code was written. The tests check that the record has them, at most 2 each, and that both builds pass now.
- Budget numbers count only from a preflight on the reference Mac. The tests check that the record has them from that machine, run the bench here to show it measures, and apply the 10% rule to the recorded numbers.

## How these tests were checked

Outside the repo, I ran the live tests against a throwaway plain hub (about 200 lines, not kept), for both variant names. The process, lease, timeout and runtime-error tests passed against it. Each of these mutants failed the test named:

- no reaping after a restart: kill -9;
- no stops on SIGTERM: SIGTERM;
- killing only the check's PID: cancel and ended-check;
- a queued hold's place kept after it ended: 1,000 runs;
- a cancelled hold's lease never returned: 1,000 runs;
- the wall clock under `--clock virtual`: 20 of 20;
- waiting on the extension before replying: 50 sessions;
- Node's raw spawn error passed back: the runtime-error test.

One mutant passed: a lease returned just before its group was killed instead of after. With SIGKILL the group dies before the next check can bind, so nothing sees it.

The decision tests ran against a made-up record and design row, both ways. A plain decision passed; flipping it to Effect with an over-10% build and a 1.67-times review failed each rule. The typecheck tests haven't run against real tsc or `@effect/language-service`, since the base has no `node_modules`.

## Assumptions a redraft may revisit

- I chose the layout, command names, flags, the socket ops and fields, the outcomes, `PORT`, the extension shape, the record's fields, the task IDs, the design row's wording rule, `scripts/import-rules.mjs` and the four package folder names it guards (the design names the CLI, the extension API, contracts and the SQLite store, but not their folders).
- "Retried three times" is read as three retries after the first attempt: at most four attempts.
- Retries have no backoff. If a build wants one, the virtual-clock test would have to tick for it.
- The 2 s covers waiting for a port and every attempt, and a timed-out attempt isn't retried.
- A check that can't start is `blocked` (invariant 2), not `fail`, and isn't required to be retried.
- "Errors name the DeepBuild file and line" is read as runtime errors coming back with a stack naming the build's own `.ts` source, as well as compile diagnostics naming their file and line.
- The Effect diagnostics' default rules report a floating Effect (`Effect.log(...)` as a statement).
- The plain build must meet every criterion, since it's what the hub falls back to. The live tests hold the Effect build to the same criteria ("in either build"). If the Effect build fails one, the issue's rule makes the decision plain: the record lists the criterion in `variants.effect.failed`, and that failing test's output is the decision's evidence. The suite then isn't all green, so the PR says so (AGENTS.md: `Part of #56` unless the maintainer accepts it).
- Hold latency and memory for the 10% rule are the bench's `holdP50Ms` and `hubPeakBytes`. perf's own readings for the two tasks are recorded but not compared, since they include process start and Effect's import, which the startup timing reports apart.
- Leaked handles are recorded and not judged, since the issue only asks for them to be recorded.
- Process checks read `ps -axww` and count a process as alive while its command line carries the test's random marker and it isn't a zombie. Grandchildren are `sh` loops, so their short `sleep` children carry no marker; those end within a second of their parent.
- A grandchild that leaves its process group (`setsid`) isn't tested: the criterion covers the hub's process groups.
