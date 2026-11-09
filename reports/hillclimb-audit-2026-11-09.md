# Hill-climb audit: speed, memory, GPU, KISS and modularity

Base: `6a6d6b4f` (main, 2026-11-09). 34 npm workspaces, the four channel packages and 38 Rust crates were audited; 42 source files changed, +503 −194, all uncommitted in the worktree.

Ten read-only audits covered every package and crate and returned about 130 findings, each with its call sites, an exact edit and a proof plan. The 42 with the best gain for the least risk were applied, each re-read against the code first. The rest are listed under [Found and not applied](#found-and-not-applied), with the full write-ups in [hillclimb-audit-2026-11-09/](hillclimb-audit-2026-11-09/).

Every change keeps behavior, with one stated exception: a waiting `deep lease` sees a change in macOS memory pressure up to 1 s later (see hub, below).

## Measured

Wall time was not used: the machine's load average was between 25 and 480 throughout. These are counts that do not move with load.

| What | Base | Change | How |
|---|---|---|---|
| `deep-hook` PreToolUse, Read | 31.7 M instructions | 26.7 M (−15.7%) | `/usr/bin/time -l`, release builds, 15 interleaved runs a side, median |
| `deep-hook` PreToolUse, Bash `ls` | 31.5 M | 26.7 M (−15.3%) | same |
| `deep-hook` PreToolUse, Bash `cargo test` | 33.2 M | 27.3 M (−17.8%) | same |
| `deep-hook` PreToolUse, Bash `git status && git log` | 36.1 M | 32.7 M (−9.5%) | same |
| `deep-hook` PreToolUse, Edit | 85.8 M | 48.6 M (−43.3%) | same |
| `deep-hook` PostToolUse, 1 MiB output | 63.5 M, 7.0 MB peak | 46.3 M (−27.1%), 5.9 MB (−15.7%) | same; peak is the memory footprint |
| Modules the hub's kind table loads | 118 files, 1,136 KB | 90 files, 875 KB | a `load` hook counting files under `packages/` on `hub/dist/kinds.js` |
| Modules `@deepbuild/checks-numbers` loads | 53 files, 409 KB | 6 files, 17 KB | same |
| `deep find` scan, 2,000 messages of 4 KB | about 8.0 G instructions | about 0.45 G | the scan alone, old and new, on one synthetic archive; the fixed cost of 2.7 G is taken off both |
| Warm-stack walk, buffers made by its sort | 126,510 | 9,844 | counted on this checkout by the audit |

The hook was built from the shipped default rules with no hub running, so each run takes the fail-open path. Its stdout and exit status were the same on both sides in all 90 pairs.

Everything else below is a count from reading the code. Nothing else was measured.

## What changed

### deep-hook (runs on every agent hook)

- A call that writes nothing no longer looks up its checkout for the `top-level-folder` rule, and one that runs no git no longer looks it up for `other-checkout`. That was about 180 path lookups on every PreToolUse. A plain checkout's `.git` is resolved once, not twice. `matcher.rs`
- A `write:` or `read:` entry spells out each glob and each path once, with links resolved, where it did so once per glob and path pair. The shipped rules have 37 write globs, so one Edit resolved its path 37 times. `matcher.rs`
- The heavy-command match reuses the shell read the rules were matched on, for the same line, folder and home. A Bash call's line, and any script file it runs, was read twice. `heavy.rs`, `main.rs`
- The payload's newlines become spaces in its own buffer, and the request is lent to the socket write. Two copies of the payload are gone. `main.rs`

### deep-contracts (the JSON parser the hook and the generated types use)

- A string's run up to the next quote, escape or control character is copied in one piece, where each byte was pushed alone.
- An object keeps a table of its keys only past 16 members. The shipped `rules.json` has 296 objects and 722 keys, parsed on every PreToolUse, each of which made a hash table and cloned every key. A new test pins that a repeated key keeps its first place and its last value on both sides of 16.

### deep-canvas (the canvas core)

- A wave that changed nothing in the cache starts no threads. Every clean wave did: 16 mutexes and up to 15 thread spawns to apply nothing. This was the follow-up left open on Oct 31. `schedule/mod.rs`
- `compile` finds an operator's nodes as one range of the node map, where it scanned every node of the plan per read, and finds an array by binary search. A `view(…)` read term is matched without building a string. `schedule/mod.rs`
- `load` compares item IDs as borrowed text (it cloned up to three per node) and carries array epochs over by binary search. `schedule/mod.rs`
- A per-item node skips the read-tree lookup that only a read with several writers can hit. `schedule/mod.rs`
- `revise_items` asks each per-document `applies` once per patch, where it asked once per patched item. `schedule/mod.rs`
- An operator's view reads the scheduler's tables in place: no table map is built per node run. `view()` reuses the operator's own read term. `schedule/mod.rs`, `schedule/view.rs`
- Each step lends the stepping arrays to the operator; it cloned the whole map once per stepper per step. `schedule/steps.rs`
- A tree chunk hashes its keys from the stack (it copied 1 KB to the heap first). `schedule/tree.rs`
- The kind registry is built once at the seal and lent to every check and every patch's recheck, which rebuilt it each time. `Sealed::kinds()` keeps its signature. `registry/mod.rs`, `document/check.rs`, `document/packs.rs`
- `hidden()` returns at once when the view has no filter and no isolation, the usual state. It walked every item on each pointer move. `scope.rs`
- `eval_num`, a value's components and a swizzle stay on the stack: one or two allocations fewer per evaluation, and a path function calls it per sample. `expr.rs`
- `canonical_value` reads a field's width and default through the stack path helper `canonical_bytes` already used. `canon.rs`
- KISS: the scheduler's two hex encoders forward to `canon`'s, which they duplicated at one string per byte. `schedule/mod.rs`

### deep-canvas-motion, deep-canvas-graph, deep-canvas-marks, deep-text-gpui

- Motion: the schedule's order follows each node's dependents, where it asked every node whether it waited on the one just placed; an item's last place in the order comes from one pass. Compile was quadratic in targets: about 2 × 10⁸ lookups at the design's 10,000 animated items. `schedule.rs`, `program.rs`
- Graph: the router marks the lanes each box blocks, where it tested every grid cell against every box: about 16n³ tests per edge down to about 8n². `route.rs`
- Text: the set of runs a frame drew from is kept only once a caller starts counting. It was cleared only by the proof binary, so the app and deep-show kept every distinct label text they ever shaped, with a key clone per label. `deep-text-gpui/src/lib.rs`
- Marks: a template text copies the document's `data` alone, the only member its reader reads; it deep-cloned the whole document per template text per evaluation. A shape with no `width` or `opacity` column measures no arc lengths. `scene.rs`

### deep-scene3d-render, deep-effects-render (GPU)

- Instance records: each run of adjacent changed records goes in one `write_buffer`. One write per record meant one staging buffer and one blit per moving solid per frame. `instances_written` still counts one per record. `deep-scene3d-render/src/lib.rs`
- A culled instancer computes its prototype's bounds once per set, where it scanned the prototype's vertices once per element. `deep-scene3d-render/src/lib.rs`
- The effects chain releases the targets a frame's passes did not ask for. Bloom switched off left about 1.67 full-size `Rgba16Float` targets for the view's life: 28 MB at 1080p and 110 MB at 4K, against 256 MB a window. `deep-effects-render/src/frame.rs`
- `DocOps::plan` borrows each operator's checked graph, which it deep-cloned every frame. `deep-effects-render/src/docops.rs`

### hub

- A forgotten session's usage reader is freed with its seven sibling maps. One was kept per stopped Claude Code session for the hub's life. `core.ts`
- The once-a-second ask check binds the clock, so it is one compiled statement and not a new one each idle second. `core.ts`
- macOS's memory-pressure reading is kept for 1 s. Each waiting `deep lease` ran `sysctl` synchronously on the core thread four times a second. **This is the one visible change:** a waiter sees a new pressure level up to 1 s later. The test override and the injected reader are untouched. `heavy.ts`
- KISS: four copies of the claim lookup and four of the session name use `claimOf` and `sessionOf`; `cleanup` builds the queued set once. `gate-runner.ts`

### Other packages

- leases: one `ps` per agent per tick, where there was one per lease. A leased command with two extra kinds made three identical spawns a second.
- reading: `deep find` lowercases each text whole first and reads it character by character only on a hit. The two lowercasings agree on 17,211,680 strings checked here: every code point in 15 contexts around a capital sigma, and 500,000 random strings over a case-heavy alphabet.
- checks-command: a program's first line is read from its first 200 bytes, where the whole file was read (tens of MB for `cargo`, `go`, `uv`). The new reader matches the old expression on 3,403 files under `/usr/bin`, `/bin`, Homebrew and `node_modules/.bin`. `goTest` reads `go.mod` once per package, not once per test.
- contracts: a scalar `const` is compared by value. All 795 published consts are scalars, and each event validated two or three through canonical text.
- cli: the facts engine and `node:zlib` load only in `deep explain` and `deep debug bundle`.
- env-local: the warm-stack walk encodes each path once for its sort.
- workspaces: `diffOf` indexes each reading once.

### Modularity

- `@deepbuild/conformance` gains two narrow entries, `/result` and `/slot-types`, each an existing file with no runtime import of a kit. The check kits of checks-numbers, checks-work, checks-review and proof take their three values from them. The hub loaded all eleven slot kits, the fake agent and the generator to reach those three values; it now loads two small files. No behavior changes: `Finding` is the same class by either entry. The package card names the entries.

## Verification

| Check | Result |
|---|---|
| `cargo check --all-targets` on each edited crate | clean; two warnings in files this change does not touch (`deep-canvas-effects/src/fusion.rs:323`, `deep-canvas-marks/src/animator.rs:657`) |
| `cargo build -p deep-gpu-layer -p deep-show` | builds, so every crate downstream of the edits compiles |
| `cargo test` deep-canvas, deep-contracts | 264 and 6 pass; deep-canvas again after the clippy fix |
| `cargo test` deep-canvas-motion, deep-canvas-graph, deep-canvas-marks | 77, 3 and 105 pass |
| `cargo test` deep-scene3d-render, deep-effects-render | 16 and 3 pass |
| `cargo test` deep-hook, on the final source | 51 pass |
| deep-hook matcher, base against change | 38 shipped entries × 394 calls through `deep-hook check`: 14,972 pairs, 193 matches, 0 differ |
| `tsc --noEmit` on each edited package | clean |
| `npm run build --workspaces` | builds |
| Focused vitest, 24 files | 483 pass, 22 fail. All 22 fail the same way on an untouched copy of main (see below) |
| Second vitest batch and the hook's acceptance suites | PENDING-TS-2 |
| Canvas and GPU acceptance suites, 47 files | PENDING-RUST-ACCEPTANCE |
| `cargo clippy --all-targets` on the eight edited crates | no warning on a line this change touches. Main's own findings stay: 57 warnings in files or lines it does not touch, five of which fail `-D warnings` on main too (`deep-canvas/src/registry/core_lists.rs:863`, `deep-canvas-effects/src/fusion.rs:323` and three files of deep-canvas-marks) |
| `scripts/canvas-lint.mjs` | 38 FAIL lines, the same 38 by file and message on main's copy |
| `scripts/repo-rules.mjs` | 58 FAIL lines, none in a file this change touches |
| `node scripts/affected.mjs` | not run: see below |

**The 22 focused failures are main's.** A copy of `6a6d6b4f` with its own install and build fails the same tests with the same messages: 18 in `packages/checks-command/test/regressions.test.ts` (three `BLOCKED` for no `pnpm` or `go` on this Mac, the rest pytest and Vitest runs that read `uncounted`), 2 in `packages/contracts/test/events.test.ts` (`build.rolled_back@1` has no read cap on `commit`), `packages/cli/test/cli.test.ts` (`BLOCKED`: no older Node here) and `tests/acceptance/45/hub.test.ts` AC2 (`handbacks_sent_back` names no source). None is in `scripts/known-failures.json`. Main's copy fails one more regressions test than the change does.

**Not run.** `node scripts/affected.mjs` selects 511 parallel and 604 alone vitest files, 114 node files and `cargo test -p deep-app` for the TypeScript edits alone, plus 76 timed and 46 slow files. With two test slots on the machine, both held for over three hours by other sessions, it could not finish; the focused runs above stand in for it and are not a full affected verdict. No timed budget, no live suite and no preflight ran. `cargo fmt --all --check` was not run workspace-wide: main has formatting drift in five of the edited files, which was left as it is, and the edits themselves are formatted.

## Found and not applied

Each line names the finding in its write-up. "Needs a decision" means the fix changes something observable.

### Hub and record: [01-hub-hot.md](hillclimb-audit-2026-11-09/01-hub-hot.md), [02-hub-rest.md](hillclimb-audit-2026-11-09/02-hub-rest.md)

- **The event loop walks the repo's folder tree inside the hook handler** (01 F3): 3,371 `readdirSync` calls per 3 s refresh in this repo, before the ack on a PreToolUse with a path. It breaks the Hot path row of the design, and #16's AC14 test sends only `Bash`, so nothing catches it. The fix moves the read into the parser worker: about 80 lines and an issue of its own.
- A partial index on `session.start`/`session.end` (01 F2): `askingNow` stepped 61,003 event rows on a synthetic record, 1,003 with the index. One line of DDL, added to every record.
- An unchanged-tree stop builds a full checkout, carries every check, then deletes it (02 F3). Stop-path change.
- The asks core decodes every event of every kind at start and on each sync (02 F4).
- Every claim reads and splits the whole transcript to find one line (02 F5).
- The gate runner keeps every run's full stdout and stderr; only the last 2,000 characters are read (02 F6). Not applied: the records also flow into `claimVerdict`, and that path was not traced to its end.
- `rulesAt` rebuilds every rule and re-reads the held file per call (01 F4); session IDs inlined into eight queries per state pass (01 F5, needs a decision on one unit test); the minute state pass reads all history (01 F7); `turn_events` feeds only a reader nothing calls (01 F8, owner's call).
- Needs-you runs up to three git spawns per card (02 F8); `ownChanges` recompiles its regexes per changed file (02 F10); `modified()` does 24 reads where 2 do (02 F11); kept keys hold path lists twice (02 F7).
- Modularity: two seams in `core.ts` qualify, Your rules (#344, about 195 lines with its own state) and transcript reading (`readTranscript` and `endTurn` could be free functions today). The last audit's two no longer hold: spool replay is already out, and evidence attachment is 45 stateless lines.

### Extension host, supervisor, runner: [03-host-supervisor.md](hillclimb-audit-2026-11-09/03-host-supervisor.md)

- Memory that grows for the hub's life: `Sources.recorded` keeps every source answer, whole library files included (F1); `Host.requests` keeps every action result (F4); the runner keeps every ended job's stdout and prompt (F3). Each bound needs a decision.
- Each hook copies every job in the record and runs `path.relative` per job (F2, crosses into the hub).
- The supervisor keeps every past run until its first cleanup (F6); two spawns per 100 ms while a sandboxed run lives (F7); `keysOf` walks the checkout twice per run (F9).
- The host reads `notices.json` from disk four times a second (F14); a sandboxed load captures output nothing can read (F15); small copies in framing, archive and series (F10–F12).

### Small TypeScript packages: [04-ts-small.md](hillclimb-audit-2026-11-09/04-ts-small.md)

- A session's readings are refolded with five sorts and three quadratic scans (F3, medium risk).
- `unheld` rescans every reported test once per control (F5); journey screens are copied up to six times a step (F10); `Buyer.sync` and the OTLP receiver do work with no caller yet (F9, F13); `canonicalModel` is exported and unused (F12).

### deep-hook and runtime crates: [05-rust-runtime.md](hillclimb-audit-2026-11-09/05-rust-runtime.md)

- deep-hook reads and parses `config.json` four times per PreToolUse (F6). `proofs` is 87% of `rules.json`'s objects and the hook never reads it; moving it changes the file the hub writes.
- deep-logic copies an item's whole memory two or three times to hash it, and clones every item's arrays each step (F7, F8); a logic item is compiled once per seek, restore and fork (F12).
- The relay copies each frame once per recipient (F9); codecs keep a frame clone and a second proxy buffer (F11); streaming proxy pictures would cut 5.6 GB held for a minute of 1080p30 to one picture, but changes output for a stream whose size changes midway (F16).

### Canvas core and modules: [06-canvas-core.md](hillclimb-audit-2026-11-09/06-canvas-core.md), [07-canvas-modules.md](hillclimb-audit-2026-11-09/07-canvas-modules.md), [08-marks-text.md](hillclimb-audit-2026-11-09/08-marks-text.md)

- `Steps::checkpoints` has no bound: one map per 0.5 s of play (06 O1). A design call.
- A hover builds and sorts an owned `Target` for every item (06 3b; the early return in 3a is applied).
- Each constraint allocates 5 to 10 vectors per frame, against "no allocation after warm-up", and `no_alloc.rs` has no constraint document (07 F3).
- The scheduled `channels` node evaluates the whole motion program per animated item (07 F6, design level).
- `build_path` hashes and copies every shape's outline for a report only one surface reads (08 F2); auto layout serializes every item into a throwaway JSON (08 F5); the draw list's text maps are deep-copied on the fast path (08 F8).
- Effects: a compute output's clear is rebuilt every frame (07 F7); about 30 uniform buffers and 30 bind groups are made per frame for 15 shipped passes (07 F8).
- Core code names module kinds at four places (06, Modularity). No dependency on a module crate; each is a name the core would have to edit.

### 3D and GPU: [09-gpu-3d.md](hillclimb-audit-2026-11-09/09-gpu-3d.md)

- **The mesh cache never evicts** (M1): a mesh that deforms with time leaks a vertex and an index buffer per frame. Evicting changes `meshes_built` when a shape returns.
- The puffs' buffer is created and uploaded every frame, on the camera-only path too (G2).
- The whole path deep-clones the document and recompiles the motion program every frame (C2). Trap: `shots::Plan::compile` reads `doc["size"]`, so the fix caches the compile by size.
- Motion blur uploads side meshes with tangents and index buffers nothing binds (G3); the output bind group is recreated every frame with a post module (G4); effect passes rebuild parameter buffers and bind groups per frame (G5).
- Modularity: `Cascaded::prepare` and `EnvState::prepare` can leave `lib.rs` as `local::Locals` already has, about 340 lines with no runtime change (X1). The lights as a whole are not a seam.

### App and proof hosts: [10-app-show.md](hillclimb-audit-2026-11-09/10-app-show.md)

- Every hub reply and events page is deep-cloned twice on the UI thread (1).
- The Agents panel polls `agents.read` every 2 s for the app's life, hidden or not (2).
- `deep-show canvas` replays its whole call log on every call and never trims it, and one click on a Terminal starts a 4 Hz poll that feeds it: 14,400 entries an hour (3). No behavior-preserving edit exists, because the stand-in's clock is the call index. Needs an owner decision.
- `to_rgba8()` on an owned decode copies the full frame, 1.9 MB per layer picture in the app; `into_rgba8()` does not (6).
- The shipped app fills two unbounded thread-local maps on every canvas paint that only replica builds read (10).

None of deep-app, deep-show, deep-replica, deep-logic, deep-relay, deep-codecs or the extension host was edited.

