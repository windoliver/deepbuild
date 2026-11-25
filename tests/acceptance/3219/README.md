# Acceptance tests for #3219: the GPU has one lease

deep-show takes the hub's lease when a hub answers, waiters are served in the order they asked, and an export's
receipt names the lease the table held.

Written first, blind, by a job that never saw an implementation of #3219; none existed on a branch it could see. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## Sources

Only these were read:

- Issue #3219's body (Scope, the seven acceptance criteria, Proof, Runs on, Depends on), and the bodies of the issues it
  names: #2133 (its GPU-lease paragraph and criterion: on a time-out the kit reports `"lease": {"gpu": false}` and
  answers its GPU cases BLOCKED), #1015 (`deep lease`, the two GPU modes: shared for functional GPU work, exclusive for
  exports and timing checks), #237 (the lease table), #1392, #3171, #3218 and the epic #241.
- `node scripts/design-section.mjs --issue 3219`: `docs/technical-design.md` Lease; `docs/canvas-primitives.md` Export
  ("An export holds the GPU lease while it runs, so a second export waits for the lease instead of sharing the GPU")
  and Render-back. Also `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Wrong programs, the
  edit guard, Dogfooding, Tests written first, Repo guards) and Numbers version 0 has to hold (the Budgets table, the
  timing rule, the reference Macs).
- AGENTS.md.
- The base commit `f8c6cff8` (read for surfaces, never for expected values): `crates/deep-show/src/kit/goldens.rs`
  (`GpuLease`: `~/.cache/deepbuild-gpu/lease`, `create_new`, a PID, `kill -0`, `take` 600 tries 500 ms apart, `wait`
  50 ms apart with no limit), `crates/deep-show/src/kit/mod.rs` (`KitCall`, `kit`, the reply's `"lease": {"gpu": …}`
  built from the request), `crates/deep-show/src/kit/fixtures.rs` and `kit/modules.rs` (`test.kit.gpu`, the
  `test-kit-gpu-pass` feature), `crates/deep-show/src/export/frames.rs` (`Lease::take`, `release` and the receipt's
  `lease` record) and `export/run.rs`, `crates/deep-show/src/main.rs` (the scenario's `planted`; an unknown name answers
  `{"ok":false,"code":"bad_input"}`), `packages/hub/src/heavy.ts` (`HeavyQueue`, `leaseCommand`, `DEEP_LEASED=1`, the
  250 ms poll, the wait line once a minute), `packages/hub/src/hub-control.ts` (`lease.wait` resolving the session with
  `agentAbove`), `packages/hub/src/paths.ts`, `packages/hub/src/plant.ts`, `packages/leases/src/index.ts` (`lease.acquired`
  with the subject `lease:<ULID>`, `lease.released`), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs` (a suite's own
  `lane.json`), `scripts/budget-window.mjs` (criterion IDs), and the suites `tests/acceptance/1015`, `18/mapping`, `138`,
  `157`, `501` and `1097` for format and helpers.

What the base does: deep-show never calls the hub. A kit on the GPU backend takes the lease file, whatever a hub holds,
and its reply's `lease` is `{"gpu": true}`; after its 600 tries it draws anyway and still says `true` (#2133). An export
takes the file, polling every 50 ms, and its receipt's `lease` is deep-show's own record with no ID. The table holds no
GPU lease of deep-show's. The hub refuses a `DEEP_HUB_PLANT` it doesn't list, and deep-show refuses an unknown
`planted`.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every file starts `deep hub run` (and `deep lease`) from packages/cli/dist
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease cargo build --locked --bin deep-show --no-default-features --features full,test-kit-gpu-pass
scripts/lease cargo build --locked -q -p deep-hook --features env-plants
node node_modules/vitest/vitest.mjs run tests/acceptance/3219/<file>.test.ts --testTimeout=7200000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/3219/tsconfig.json
```

Each file builds the two binaries itself if they aren't built (the same cargo commands, with the runner's
environment), so the two `cargo build` lines only take the builds out of the timed run. Run the files one at a time:
`lane.json` puts the folder on the alone line. Times on this Mac (Mac17,10) at load 20 to 240: `kit-table.test.ts`,
`modes.test.ts`, `receipt.test.ts` and `environment.test.ts` a few minutes each once a right program runs both legs;
`no-hub.test.ts` about 6 minutes (the kit's 5-minute wait); `order.test.ts` 10 to 14 minutes for the 20 runs plus the
planted leg's few; `budgets.test.ts` seconds where it reads INCONCLUSIVE, and on a fit reference Mac the merge base's
build plus 200 kit runs.

Nothing needs the network, a model, a sign-in or a real `claude`. Folders are under `/tmp/dh3219-*` and are removed after
each file; each test has its own HOME, so nothing touches this Mac's real hub, table or `~/.cache/deepbuild-gpu/lease`.
Every process a test starts (each hub, each session's stand-in agent, each shell command's process group, the `sleep`
whose PID holds the file in AC5) is stopped by its PID or process group's ID, never by name or port; a group the test
stopped with SIGSTOP is continued first. `budgets.test.ts` builds the merge base's deep-show under
`target/base-3219/` only on a fit reference Mac, and keeps it.

## The surface under test

Names marked *(chosen)* are this job's choices where the issue and the design name none; a dispute starts there.

- **deep-show run, as a session's command.** Each kit or export is one `deep-show run` with one JSON scenario on stdin
  (`{evidence, sessions, processes, panels, docs, calls}`, as #501's and #138's suites write it) and one answer line,
  `{ok, replies}`. It runs as a scripted Claude Code session's shell command, `cd <repo> && exec deep-show run < in >
  out`, its stderr the command's output as the agent sees it: the session is a stand-in agent process
  (`fixtures/agent.mjs`, from #1015's) whose SessionStart went through the real deep-hook, and the shell `exec`s
  deep-show, so its PID is the shell's and its process group's. Its HOME is the test's, where the test's own hub
  listens (`~/.deepbuild/hub.sock`, `control.token` beside it). How deep-show reaches the hub and how it asks is the
  implementer's; the calling session is the one the hub finds above deep-show's process, as for `deep lease`.
- **The kit.** `{"call": "kit", "modules": ["test.kit.gpu"], "parts": ["fixtures"], "backends": ["gpu"]}` on the
  build with `full,test-kit-gpu-pass`: the test module's two fixtures, whose GPU cases (`…#check2`, backend `gpu`) a GPU
  pass fills. A kit *drew* when it has GPU cases and one is PASS or FAIL; its GPU cases are *BLOCKED* when every one
  is.
- **The kit reply's `lease`.** `gpu` stays a boolean: whether the kit held a GPU lease. With no hub, the reply says the
  lease was the file's as `"lease": {"gpu": true, "from": "file"}` (`from` *(chosen)*). A kit that held none:
  `"lease": {"gpu": false}` (#2133). With a hub, no reply field is read: the table is.
- **The export.** A `deep show` of a 160 × 90 film at 24 fps (a ground and a sliding block, no sound), then `{"call":
  "export", "doc": …, "out": …, "video": {"codec": "h264"}}`, with no `session`, so the hub names the caller. 48 frames
  (2 s) unless said; the first export of AC3 has 2,400 (100 s) so it holds the lease for several seconds.
- **The receipt's `lease`.** #157's record (`resource`, `holder`, `asked`, `acquired`, `waited_ms`, `released`, ms
  since the Unix epoch) plus `id` *(chosen)*: the table's lease ID, `lease:<ULID>`, the subject of its `lease.acquired`
  event.
- **The table.** Followed on the test hub's control socket: one `stream.subscribe` from the record's start, each event
  folded as its frame arrives, and `events.read` for anything the stream hasn't carried yet: `lease.acquired` (subject
  the lease ID; `data.resource.kind`, `data.mode`, `data.holder`; its `ts` is when the lease was granted) and
  `lease.released` (subject the same ID; its `ts`). A lease is the kit's or export's when its kind is `gpu` and its
  holder is that session's, `session:<the session ID's letters and digits>` (#1015). The time the table records a lease
  was asked for is `asked`, ms since the Unix epoch, in the `lease.acquired` event's data *(chosen)*. AC6 reads it; AC2
  and AC3 use it, when it's there, only to check that the fixture arranged the asks in the order the criterion names.
- **The lease file.** `~/.cache/deepbuild-gpu/lease` under the test's HOME, watched for the whole run through its
  folder with `fs.watch`, which reports the file made, written or removed however briefly it lived; each event reads
  the PID the file holds. The watch makes the folder; that takes no lease.
- **Holding a draw** *(chosen)*. AC2 stops a kit (SIGSTOP to its process group) on the table event that grants it its
  gpu lease, and continues it (SIGCONT) when the export and the third kit have asked: a kit stopped while it draws still
  holds its lease, since a lease ends on proof that its holder has ended (design: Lease), never by a missed poll.
- **Having asked** *(chosen)*. AC2 takes a run as having asked once its stderr has a line naming a wait (the Scope's
  wait line, which `deep lease` prints at once) or 45 s have passed. AC4 lets the holder go on the same line, or on
  the kit's end, or after 120 s.
- **No fixed waits.** Every wait here is for an event (a run's end, a table event, an output line, a file event), each
  bounded by a `// deadline:` timer that only turns a hang into a result (`scripts/wait-ratchet.mjs`). The one wait the
  criterion itself sets, AC3's "1 s later", is the second export's own shell's `sleep 1` before it runs deep-show.
- **An exclusive holder** (AC4). `deep lease gpu:exclusive -- holder ac4` in a second session: `holder`
  (`fixtures/holder.pl`, from #1015's stand-in) says it holds and runs until the test writes its go file.
- **The environment of a leased command** (AC4). The kit's own session first runs `deep lease gpu:shared -- /usr/bin/env`;
  every variable that command got beyond the session's own environment, except the shell's `PWD`, `OLDPWD`, `SHLVL` and
  `_`, is the leased command's environment. At the base that is `DEEP_LEASED=1`, with `MAKEFLAGS` and
  `CARGO_MAKEFLAGS` where the hub keeps a job pool; whatever the implementation adds (a lease ID, say) comes with it.
  Its lease has ended by the time the kit runs, so no lease in the table is the kit's.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#3219.<first 8 hex of the SHA-256 of the criterion's text,
trimmed, white space collapsed>`, as `scripts/budget-window.mjs` computes it). One test per criterion; each planted
program runs inside the test of the criterion that names it, through the same judge, which must fail naming what the
criterion says.

| ID | File | What it asserts |
|---|---|---|
| AC1 `#3219.6dfa18b9` | `kit-table.test.ts` | with a hub, a kit draws, the table holds a `gpu` lease `shared` under its session, granted while the kit ran, and the lease file is never seen and isn't there after; the planted deep-show that takes the file beside the hub fails, naming `~/.cache/deepbuild-gpu/lease` |
| AC2 `#3219.150005e0` | `modes.test.ts` | kits 1 and 2 hold `gpu` leases `shared` that overlap; the export, which asks while both are held where they draw, is granted only after both are released; the third kit, which asks after the export, is granted only after the export's lease is released; every kit draws and the export exports; the planted lease fails, naming the third kit |
| AC3 `#3219.2c286a34` | `order.test.ts` | in each of 20 runs the kit, asking while the first export holds the lease, draws before the second export, whose shell sleeps 1 s before it starts; the count is printed; the planted queue fails, naming the kit and its session |
| AC4 `#3219.a0eeff4a` | `environment.test.ts` | a kit run with a leased command's environment and no lease of its own doesn't end while an exclusive holder holds the lease, takes a `gpu` lease of its own granted after the holder's is released, and draws; the planted deep-show that trusts the environment fails, naming the holder |
| AC5 `#3219.3e5e1a25` | `no-hub.test.ts` | with no hub, the kit holds the lease file (its PID seen in it), draws, and its reply says `{"gpu": true, "from": "file"}`; with the file held by a live process past the kit's wait, every GPU case is BLOCKED and the reply says `{"gpu": false}` |
| AC6 `#3219.b9bc7bce` | `receipt.test.ts` | the receipt's `lease.id` is a `gpu` lease the table recorded under the export's session, and the receipt's `asked`, `acquired` and `released` equal the table's; the planted receipt fails, naming the ID it wrote |
| AC7 `#3219.018fc9c7` | `budgets.test.ts` | with a hub, the kit takes the table's lease (else FAIL); on a fit reference Mac, five runs of p50 over 20 kit runs a side, this build's less the merge base's, judged against 5 ms; elsewhere INCONCLUSIVE |

### AC1, `kit-table.test.ts`

A world (a temp HOME, its hub with `DEEP_HUB_TEST_CORES=12`), one session, one kit. Its failures are listed together:
the kit's reply can't be read or it drew nothing; no `gpu` lease under the session's holder; the lease isn't `shared`;
it was granted outside the kit's run (`t0..t1`, the shell's start and end as the agent saw them); the lease file was
seen while the kit ran (named `~/.cache/deepbuild-gpu/lease`, with when and the PID it held); the file is there after.
The release may follow the kit's end (on proof), so the table is read once the lease is released or 30 s have passed.

### AC2, `modes.test.ts`

Four sessions, `kit 1`, `kit 2`, `the export` and `the third kit`. Kits 1 and 2 start together; each is stopped on the
table event that grants it its lease. The export then starts; once it has asked, the third kit starts; once it has
asked, kits 1 and 2 go on. Each run's end is waited for (20 minutes at most), and the table read once every lease of
theirs is released (or 30 s). The failures, listed together: a kit that drew with no table lease (the base); a kit's
reply unreadable, drawing nothing, holding no `gpu` lease or one not `shared`; the export's receipt unreadable or no
lease of its; kits 1 and 2 not overlapping; the export granted while kit 1 or kit 2 still held the lease (naming that
kit); the third kit granted before the export's release (naming "the third kit", and the kits it was granted beside).
The grants on the fixture are printed, in ms from the first run's start.

### AC3, `order.test.ts`

Three sessions, `first-export`, `kit` and `second-export`, one hub, run after run. Each run: the first export starts;
once it holds the lease (the table event of its `gpu` lease, or the lease file holding its PID), the kit starts, and
with it the second export's shell, which sleeps 1 s before it runs deep-show. Which drew first: from the table when
the kit and the second export both hold table leases (the kit's granted first); otherwise the kit drew first when it
ended before the second export's receipt says it released the lease (the two never draw at once, so a kit that waited
out the second export ends after that release). A run is void, and named, when the first export never held the lease,
the kit started after its release, the second export asked after it (by the table's `asked`, else the receipt's), or
the table's `asked` shows the kit asking after the second export. 20 valid runs (30 at most) are judged; every one
must have the kit first, each failure naming the run, "the kit" and its holder. The planted leg stops at the first
valid run where the kit isn't first; it must fail naming the kit and its holder.

### AC4, `environment.test.ts`

Two sessions, the kit's and the holder's. The leased command's environment is taken (above); its lease is waited for
until released. The holder starts and must hold an exclusive `gpu` lease (else BLOCKED). The kit starts with that
environment, as a plain command, while the holder holds; the holder is let go once the kit says it waits, or when it
has ended, or after 120 s. The failures, listed together, each naming the holder (`session:…`, its command and
session): the kit unreadable, or drawing nothing once the holder let go; the kit ended before the holder's lease was
released (it drew beside it); the kit took no `gpu` lease of its own in the table, or one granted before the holder's
release.

### AC5, `no-hub.test.ts`

Two temp HOMEs where no hub ever ran, each kit started by the test itself. Leg one: the file watched; the kit must
draw, its reply must be `{"gpu": true, "from": "file"}`, and the file must have held its PID. Leg two: the file holds
the PID of a `/bin/sleep 3600` this test started; the kit's GPU cases must all be BLOCKED, and its reply's `lease`
`{"gpu": false}`. Both legs' failures are listed together. At the base leg two takes the kit's full wait, about 5
minutes.

### AC6, `receipt.test.ts`

One session exports the 2 s film. The failures: the receipt unreadable or without a lease record; no `lease.id`; an ID
the table never recorded; the table's lease not a `gpu` lease under the export's session; any of `asked`, `acquired`
and `released` not equal to the table's (or the table recording none), each naming the ID.

### AC7, `budgets.test.ts`

A kit with a hub first: the table must hold its `gpu` lease, or the test fails (there is no lease whose taking could
be timed; this is how it fails at the base). Then `environmentProblem()`: a reference Mac the design names (Mac15,7 M3
Pro 36 GB, Mac15,12 M3 16 GB, Mac17,10 M5 Max 64 GB), on mains, Low Power Mode off, no thermal warning, the 1-minute
load within the cores. If any fails, the budget reads INCONCLUSIVE with the reason and nothing is built. Otherwise the
merge base `f8c6cff8`'s deep-show is built from `git archive` (never a copy of `.git`) under
`target/base-3219/f8c6cff822b5/`, and five runs each take the p50 of 20 kit runs a side, interleaved, as the same
session's commands beside the same hub; each run's value is this build's p50 less the merge base's. #1097's judge:
PASS when all five are within 5 ms, FAIL when all five are over it by more than the margin (the larger of 5% and the
spread), INCONCLUSIVE otherwise, and INCONCLUSIVE when the machine stopped being fit during the runs.

## Wrong programs

Each is selected the way its side selects plants at the base, and none exists there: at the base deep-show answers an
unknown `planted` with `{"ok":false,"code":"bad_input"}` and the hub refuses to start with an unknown `DEEP_HUB_PLANT`,
so each planted leg fails before its judge. The implementer adds each.

| Criterion | Name | Side | Selected by | What it does | Its failure must name |
|---|---|---|---|---|---|
| AC1 | `kit_takes_file_beside_hub` *(chosen)* | deep-show | the scenario's `"planted"` | a kit on the GPU backend takes the lease file though a hub answers | `~/.cache/deepbuild-gpu/lease` |
| AC2 | `shared-passes-waiting-exclusive` *(chosen)* | hub | `DEEP_HUB_PLANT` on the test's hub | a later shared request is granted beside the shared holders while an exclusive request waits ahead of it | `the third kit` |
| AC3 | `serves-most-asks` *(chosen)* | hub | `DEEP_HUB_PLANT` on the test's hub | no order among the gpu lease's waiters: a freed lease goes to whichever waiter asks for it first once it is free, so the one that asks most often wins most often, as the file's waits did | `the kit` and the kit's holder |
| AC4 | `trusts_leased_env` *(chosen)* | deep-show | the scenario's `"planted"` | a deep-show whose environment is a leased command's takes itself as holding the lease and draws without asking | the exclusive holder's `session:…` |
| AC6 | `receipt_writes_own_lease` *(chosen)* | deep-show | the scenario's `"planted"` | the receipt's lease record is deep-show's own (its own ID or times), not the table's | the ID the planted receipt wrote |

A planted leg that can't run (deep-show doesn't answer, the export isn't delivered, the planted receipt has no ID, the
hub doesn't start) fails the test, naming why, never passes. AC5's criterion names no wrong program: the merge base is
its wrong program (#2133's defect and the missing `from`), and its run there is in `BASE-FAILURE.txt`. AC7 names none:
its leg that can fail anywhere is the table lease it times, which the merge base lacks.

The hub's plants go in `packages/hub/src/plant.ts`, the list a `DEEP_HUB_PLANT` must be on. Every session's command gets
the same `DEEP_HUB_PLANT` as the hub (as #1015's world gives it), so a plant whose wrong behavior sits partly on
deep-show's side of the ask can read it there too; that is the implementer's to choose.

## Readings where the issue leaves a choice

1. **"While it draws."** A kit's lease must be granted while its process runs and its GPU cases must have drawn; how
   much of the kit's run the hold covers (the whole kit call, as the base holds the file, or each draw) is the
   implementer's. AC2 needs the kit to run on for a moment after its grant, while the table's event reaches the test,
   so that it can be stopped holding the lease; a run where a kit ended first is INCONCLUSIVE, never PASS.
2. **One lease a call.** Each kit call or export holds one table lease; with several, the earliest granted is read.
3. **The calling session.** The session whose agent process is above deep-show's (the hub's `agentAbove`, as for `deep
   lease`); its holder is `session:<the ID's letters and digits>`. Each kit and export here runs in its own session, so
   the holder tells them apart.
4. **Modes.** Kits shared (AC1, AC2: the criterion and #1015). The export's mode isn't asserted: AC2 checks that it
   waits for both kits and that the third kit waits for it, which only an exclusive export gives.
5. **"Asks while they draw" and "asks after the export"** (AC2) are arranged by holding the kits (SIGSTOP) and by
   waiting for each run's wait line, 45 s at most; when the table records `asked`, a run whose asks came in another
   order is INCONCLUSIVE.
6. **"A second export asks 1 s later"** (AC3): the second export's shell starts with the kit's and sleeps 1 s before
   it runs deep-show. Both ask soon after deep-show starts, the export only after presenting its film, so it asks at
   least about 1 s after the kit. The first export held the lease 13 to 73 s in the base runs (load 20 to 240), so a
   kit's wait at the table must outlast that.
7. **The merge base's count** (AC3) is this file's own run on the merge base, "with the waits as they are": the
   order is read there from the kit's end and the second export's receipt, since the base's deep-show takes no table
   lease. It is recorded in `BASE-FAILURE.txt`, and the preflight's run of this new file on the merge base records it
   again; the test doesn't build the merge base itself.
8. **The leased environment** (AC4) is a real `deep lease` command's, captured, so it holds whatever the implementation
   gives a leased command. The holder holds until the kit says it waits or ends (120 s at most): a kit that ended
   while the holder held drew beside it, whatever it answered. A kit that waits without saying so waits the 120 s, so
   its own wait at the table must last longer than that (the file's lasts 5 minutes).
9. **"With no hub"** (AC5) is a HOME where no hub ever ran. The BLOCKED half is run with no hub, where a kit's wait is
   bounded today (600 tries 500 ms apart); how long a kit waits at the table with a hub is the implementer's, so that
   half isn't run with a hub.
10. **The three times** (AC6) must equal the table's to the millisecond: `asked` the table's `asked` *(chosen, above)*,
    `acquired` the `lease.acquired` event's `ts`, `released` the `lease.released` event's `ts`.
11. **"A kit's first case"** (AC7) is read as the whole kit run over `test.kit.gpu`'s fixtures on the GPU backend, from
    the shell's start to its end: its GPU cases are its first and only cases on the GPU, and the lease is taken once,
    before them. The merge base's side takes the uncontended file.
12. **Off macOS** every file fails at its start with a message starting `INCONCLUSIVE:`: the kits on the GPU backend
    and the H.264 exports draw through macOS's Metal device. The issue says the order and the modes run on any
    machine against a test's own table; here they are those of deep-show's own kits and exports, which need the GPU,
    so they don't. A stand-in order test with no GPU is #1015's (`tests/acceptance/1015/gpu.test.ts`).

## BLOCKED and INCONCLUSIVE legs

- Off macOS: every file, `INCONCLUSIVE:` (reading 12).
- AC2: a kit that ended before it could be stopped holding its lease, or asks the table shows in another order:
  INCONCLUSIVE (skipped with the reason). A planted leg that can't be so arranged fails.
- AC3: fewer than 20 valid runs in 30, with no run judged wrong: INCONCLUSIVE.
- AC4: `deep lease gpu:shared -- /usr/bin/env` that doesn't run, gives no variable or whose lease isn't recorded and
  released; a holder that doesn't start or holds no exclusive lease: BLOCKED (a failure starting `BLOCKED:`).
- AC7: anywhere but a fit reference Mac, or a machine loaded past its cores: INCONCLUSIVE with the reason and nothing
  built; a merge base that doesn't unpack or build: BLOCKED.
- A cargo build that fails fails the test, naming cargo's error; deep-hook's: BLOCKED.

## What the implementer adds outside this folder

- The five plants above: `shared-passes-waiting-exclusive` and `serves-most-asks` in `packages/hub/src/plant.ts`;
  `kit_takes_file_beside_hub`, `trusts_leased_env` and `receipt_writes_own_lease` among deep-show's scenario plants.
- The kit reply's `lease.from` (`"file"` with no hub), the receipt's `lease.id`, and `asked` in `lease.acquired`'s
  data, besides the behavior itself.
- No `scripts/lanes.mjs` edit: this folder's own `lane.json` puts it on the alone line, with its reason `shared: the
  GPU` (a new suite's lane file lands with it; scripts/lanes-lists.mjs).

## Files

- `README.md`: this file.
- `helpers.ts`: builds, the world and its hub, the stand-in agent and sessions, scenarios, deep-show runs, the table,
  the lease-file watch, the judges and the timing rule (what each part was copied from is in its header).
- `kit-table.test.ts` (AC1), `modes.test.ts` (AC2), `order.test.ts` (AC3), `environment.test.ts` (AC4),
  `no-hub.test.ts` (AC5), `receipt.test.ts` (AC6), `budgets.test.ts` (AC7).
- `fixtures/agent.mjs`: the stand-in agent process (from #1015's, with each command's start and end times).
- `fixtures/holder.pl`: the stand-in exclusive holder (from #1015's stand-in).
- `lane.json`: the folder runs alone.
- `tsconfig.json`: the typecheck.
- `BASE-FAILURE.txt`: each file's run on the base, with AC3's merge-base count.
